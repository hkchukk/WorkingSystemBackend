import { Router } from "jsr:@nhttp/nhttp";
// @deno-types="npm:@types/passport"
import passport from "npm:passport";
import { authenticated } from "../Middleware/middleware.ts";
// @deno-types="npm:@types/cookie-signature"
import signature from "npm:cookie-signature";
import type IRouter from "../Interfaces/IRouter.ts";
import dbClient from "../Client/DrizzleClient.ts";
import { eq } from "npm:drizzle-orm";
import { employers, workers } from "../Schema/DatabaseSchema.ts";
import { argon2Config } from "../config.ts";
import { hash as argon2hash } from "jsr:@felix/argon2";
import validate from "jsr:@nhttp/zod";
import {
  employerSignupSchema,
  workerSignupSchema,
} from "../Middleware/validator.ts";
import { uploadDocument } from "../Middleware/uploadFile.ts";

const router = new Router();

router.post(
  "/register/worker",
  validate(workerSignupSchema),
  async ({ headers, response, body }) => {
    const platform = headers.get("platform");
    if (!platform?.length) {
      return response.status(400).send("Platform is required");
    }

    const {
      email,
      password,
      firstName,
      lastName,
      phoneNumber,
      highestEducation = "大學",
      schoolName,
      major,
      studyStatus = "就讀中",
      certificates = [],
    } = body;

    if (!email || !password || !firstName || !lastName) {
      return response
        .status(400)
        .send("email, password, firstName and lastName are required");
    }

    const existingUser = await dbClient
      .select()
      .from(workers)
      .where(eq(workers.email, email))
      .then((rows) => rows[0]);

    if (existingUser) {
      return response.status(409).send("User with this email already exists");
    }

    const hashedPassword = await argon2hash(password, argon2Config);

    const insertedUsers = await dbClient
      .insert(workers)
      .values({
        email,
        password: hashedPassword,
        firstName,
        lastName,
        phoneNumber,
        highestEducation,
        schoolName,
        major,
        studyStatus,
        certificates,
      })
      .returning();

    const newUser = insertedUsers[0];

    return response.status(201).send({
      message: "User registered successfully:",
      user: {
        workerId: newUser.workerId,
        email: newUser.email,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
      },
    });
  },
);

router.post(
  "/register/employee",
  validate(employerSignupSchema),
  uploadDocument,
  async (rev) => {
    const platform = rev.request.headers.get("platform");
    if (platform === "web-employer") {
      const {
        email,
        password,
        employerName,
        branchName,
        industryType,
        address,
        phoneNumber,
        identificationType,
        identificationNumber,
        employerPhoto,
        contactInfo,
      } = rev.body;

      const file = rev.file.verficationDocument;

      if (!email || !password || !employerName) {
        return rev.response
          .status(400)
          .send("email, password and employerName are required");
      }

      if (!identificationNumber) {
        return rev.response
          .status(400)
          .send("identificationNumber are required");
      }

      const existing = await dbClient
        .select()
        .from(employers)
        .where(eq(employers.email, email))
        .then((rows) => rows[0]);

      if (existing) {
        return rev.response
          .status(409)
          .send("employer with this email already exists");
      }

      if (!file) {
        return rev.send("File is required");
      }

      const verificationDocuments = file.path;

      const hashedPassword = await argon2hash(password, argon2Config);

      const insertedUsers = await dbClient
        .insert(employers)
        .values({
          email,
          password: hashedPassword,
          employerName,
          branchName,
          industryType,
          address,
          phoneNumber,
          identificationType,
          identificationNumber,
          verificationDocuments,
          employerPhoto,
          contactInfo,
        })
        .returning();

      const newUser = insertedUsers[0];

      return rev.response.status(201).send({
        message: "User registered successfully:",
        user: {
          employerId: newUser.employerId,
          email: newUser.email,
          employerName: newUser.employerName,
        },
      });
    }

    return rev.response.status(400).send("Invalid platform");
  },
);

router.post(
  "/login",
  passport.authenticate("local"),
  ({ response, user, sessionID }) => {
    response.cookie(
      "connect.sid",
      `s:${signature.sign(sessionID, Deno.env.get("SESSIONSECRET"))}`,
    );
    return user;
  },
);

router.get("/logout", ({ session }) => {
  session.destroy();
  return "Logged out";
});

router.get("/profile", authenticated, async ({ session, response }) => {
  const user = session.passport.user;

  if (user.role === "worker") {
    const worker = await dbClient
      .select()
      .from(workers)
      .where(eq(workers.workerId, user.id))
      .then((rows) => rows[0]);

    if (!worker) {
      return response.status(404).send("Worker not found");
    }
    const { password, ...remains } = worker;

    return response.status(200).send(remains);
  }

  if (user.role === "employer") {
    const employer = await dbClient
      .select()
      .from(employers)
      .where(eq(employers.employerId, user.id))
      .then((rows) => rows[0]);

    if (!employer) {
      return response.status(404).send("Employer not found");
    }
    const { password, ...remains } = employer;

    return response.status(200).send(remains);
  }

  return response.status(400).send("Invalid role");
});

export default { path: "/user", router } as IRouter;
