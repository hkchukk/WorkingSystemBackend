import { bodyParser, HttpError, Router } from "jsr:@nhttp/nhttp";
// @deno-types="npm:@types/passport"
import passport from "npm:passport";
import { authenticated } from "../Middleware/middleware.ts";
// @deno-types="npm:@types/cookie-signature"
import signature from "npm:cookie-signature";
import type IRouter from "../Interfaces/IRouter.ts";
import dbClient from "../Client/DrizzleClient.ts";
import { eq } from "npm:drizzle-orm";
import { employers, workers} from "../Schema/DatabaseSchema.ts";
import { argon2Config } from "../config.ts";
import { hash as argon2hash } from "jsr:@felix/argon2";

const router = new Router();

router.post("/register", async(rev) => {
  const platform = rev.request.headers.get("platform");
  if (!platform?.length) {
    return rev.response.status(400).send("Platform is required");
  }

  if(platform == "mobile"){
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
    } = rev.body;  

    if (!email || !password || !firstName || !lastName) {
      return rev.response
        .status(400)
        .send("email, password, firstName and lastName are required");
    }

    const existingUser = await dbClient
      .select()
      .from(workers)
      .where(eq(workers.email, email))
      .then((rows) => rows[0]);

    if (existingUser) {
        return rev.response
          .status(409)
          .send("User with this email already exists");
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

    return rev.response
      .status(201)
      .send({
        message: "User registered successfully:",
        user: {
          workerId: newUser.workerId,
          email: newUser.email,
          firstName: newUser.firstName,
          lastName: newUser.lastName,
        },
      });
  }

  if (platform == "web-employer"){
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
      verificationDocuments,
      employerPhoto,
      contactInfo,
    } = rev.body;

    if (!email || !password || !employerName) {
      return rev.response
        .status(400)
        .send("email, password and employerName are required");
    }

    if(!identificationNumber){
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

    return rev.response
      .status(201)
      .send({
        message: "User registered successfully:",
        user: {
          employerId: newUser.employerId,
          email: newUser.email,
          employerName: newUser.employerName,
        },
      });
  }

  return rev.response
    .status(400)
    .send("Invalid platform");
});

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

router.get("/profile", authenticated, () => {
  return "profile";
});

export default { path: "/user", router } as IRouter;
