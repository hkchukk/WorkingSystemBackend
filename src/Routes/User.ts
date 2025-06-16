import { Router } from "@nhttp/nhttp";
import passport from "passport";
import { authenticated } from "../Middleware/middleware.ts";
import signature from "cookie-signature";
import type IRouter from "../Interfaces/IRouter.ts";
import dbClient from "../Client/DrizzleClient.ts";
import { eq } from "drizzle-orm";
import { employers, workers } from "../Schema/DatabaseSchema.ts";
import { argon2Config } from "../config.ts";
import { hash as argon2hash } from "@node-rs/argon2";
import validate from "@nhttp/zod";
import {
  employerSignupSchema,
  workerSignupSchema,
  updateWorkerProfileSchema,
  updateEmployerProfileSchema
} from "../Middleware/validator.ts";
import { uploadDocument } from "../Middleware/uploadFile.ts";
import { S3Client, S3File } from "bun";

const router = new Router();

// 清理臨時文件
const cleanupTempFiles = async (uploadedFiles: any[]) => {
  if (uploadedFiles.length === 0) return;
  
  Promise.all(
    uploadedFiles.map(async (file) => {
      try {
        const bunFile = Bun.file(file.path);
        if (await bunFile.exists()) {
          await bunFile.delete();
          console.log(`成功刪除臨時文件: ${file.filename}`);
        }
      } catch (cleanupError) {
        console.error(`清理臨時文件時出錯 ${file.filename}:`, cleanupError);
      }
    })
  ).catch(err => console.error('批次清理檔案時出錯:', err));
};

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

    const existingUser = await dbClient.query.workers.findFirst({
      where: eq(workers.email, email),
    });

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
  "/register/employer",
  uploadDocument,
  validate(employerSignupSchema),
  async ({ headers, body, file: reqFile, response }) => {
    
    var files = null;
    if(body.identificationType == "businessNo" && reqFile.verficationDocument) {
      files = reqFile.verficationDocument.length == undefined ? [reqFile.verficationDocument] : reqFile.verficationDocument;
    }else if(body.identificationType == "personalId" && reqFile.identificationDocument) {
      files = reqFile.identificationDocument.length == undefined ? [reqFile.identificationDocument] : reqFile.identificationDocument;
    }else{
      return response.status(400).send("Invalid identification document");
    }

    try {
      const platform: string = headers.get("platform");
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
        } = body;

        const existing = await dbClient.query.employers.findFirst({
          where: eq(employers.email, email),
        });

        if (existing) {
          return response
            .status(409)
            .send("employer with this email already exists");
        }

        const filesInfo: {
          originalName: string;
          type: string;
          r2Name: string;
        }[] = files.map((
          file: { name: string; type: string; filename: string },
        ) => ({
          originalName: file.name as string,
          type: file.type as string,
          r2Name: file.filename as string,
        }));

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
            verificationDocuments: JSON.stringify(filesInfo),
            employerPhoto,
            contactInfo,
          })
          .returning();

        const client = new S3Client({
          region: "auto",
          accessKeyId: process.env.R2ACCESSKEYID,
          secretAccessKey: process.env.R2SECRETACCESSKEY,
          endpoint: process.env.R2ENDPOINT,
          bucket: "backend-files",
          retry: 1,
        });

        await Promise.all(
          files.map(
            async (file: { path: string; filename: string; name: string }) => {
              const currentFile = Bun.file(file.path);
              if (!currentFile.exists()) {
                throw new Error(
                  `Verification document file not found: ${file.name}`,
                );
              }
              await client.write(
                `documents/${identificationType}/${file.filename}`,
                currentFile,
              );
              console.log(`File ${file.name} uploaded successfully`);
            },
          ),
        );

        const newUser = body;

        return response.status(201).send({
          message: "User registered successfully:",
          user: {
            employerId: newUser.employerId,
            email: newUser.email,
            employerName: newUser.employerName,
          },
        });
      }
      return response.status(400).send("Invalid platform");
    } catch (error) {
      console.error("Error in register/employee:", error);
      return response.status(500).send("Internal server error");
    } finally {
      cleanupTempFiles(files);
    }
  },
);

router.post(
  "/login",
  passport.authenticate("local"),
  ({ response, user, sessionID }) => {
    response.cookie(
      "connect.sid",
      `s:${signature.sign(sessionID, process.env.SESSIONSECRET)}`,
    );
    return user;
  },
);

router.get("/logout", ({ session }) => {
  session.destroy();
  return "Logged out";
});

router.get("/profile", authenticated, async ({ user, response }) => {
  if (user.role === "worker") {
    const { password, ...remains } = user;

    return remains;
  }

  if (user.role === "employer") {
    const { password, ...remains } = user;

    return remains;
  }

  return response.status(400).send("Invalid role");
});

router.put("/update/profile", authenticated, async ({ body, response, request, user }) => {
  try {
    if (user.role === "worker") {
      const validationResult = updateWorkerProfileSchema.safeParse(body);

      if (!validationResult.success) {
        return response
          .status(400)
          .json({
          message: "Validation failed",
          errors: validationResult.error.flatten(),
        });
      }

      const validatedData = validationResult.data;

      const updatedWorker = await dbClient
        .update(workers)
        .set({ ...validatedData, updatedAt: new Date() })
        .where(eq(workers.workerId, user.workerId))
        .returning();

      const { password, ...workerData } = updatedWorker[0];
      return response.status(200).json(workerData);

    } else if (user.role === "employer") {
      const validationResult = updateEmployerProfileSchema.safeParse(body);

      if (!validationResult.success) {
        return response.status(400).json({
          message: "Validation failed",
          errors: validationResult.error.flatten(),
        });
      }

      const validatedData  = validationResult.data;

      const updatedEmployer = await dbClient
        .update(employers)
        .set({ ...validatedData, updatedAt: new Date() })
        .where(eq(employers.employerId, user.employerId))
        .returning();

      if (updatedEmployer.length === 0) {
        return response.status(404).send("Employer not found");
      }

      const { password: empPassword, ...employerData } = updatedEmployer[0];
      return response.status(200).json(employerData);

    } else {
      return response.status(400).send("Invalid user role for profile update");
    }
  } catch (error) {
    console.error("Error updating profile:", error);
    return response.status(500).send("Internal server error");
  }
});

export default { path: "/user", router } as IRouter;