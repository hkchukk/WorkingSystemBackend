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
import NotificationHelper from "../Utils/NotificationHelper.ts";
import {
  employerSignupSchema,
  workerSignupSchema,
  updateWorkerProfileSchema,
  updateEmployerProfileSchema
} from "../Middleware/validator.ts";
import { uploadDocument, uploadProfilePhoto } from "../Middleware/uploadFile.ts";
import { file, S3Client, S3File } from "bun";
import { PresignedUrlCache } from "../Client/RedisClient.ts";
import { Role } from "../Types/types.ts";

const s3Client = new S3Client({
  region: "auto",
  accessKeyId: process.env.R2ACCESSKEYID,
  secretAccessKey: process.env.R2SECRETACCESSKEY,
  endpoint: process.env.R2ENDPOINT,
  bucket: "backend-files",
  retry: 1,
});

const R2_BUCKET_NAME = "backend-files";

async function generatePresignedUrl(filePath: string, expiresIn = 3600): Promise<string | null> {
  if (!filePath) {
    console.warn("generatePresignedUrl called with empty filePath");
    return null;
  }

  const cacheKey = `presigned:${R2_BUCKET_NAME}:${filePath}`;

  try {
    const cachedUrl = await PresignedUrlCache.get(cacheKey);
    if (cachedUrl) {
      // PresignedUrlCache.get already checks for near expiry
      console.log(`Returning cached presigned URL for ${filePath}`);
      return cachedUrl;
    }
  } catch (error) {
    console.error(`Error fetching from PresignedUrlCache for ${cacheKey}:`, error);
    // Proceed to generate a new URL if cache fetch fails
  }

  try {
    // documentation and updated if necessary.
    // The exact structure of the returned value (string or object with a URL property)
    const signedRequestResult = await (s3Client as any).presign(filePath, {
      expires: expiresIn,
    });

    // Adjust if 'signedRequestResult' is an object (e.g., signedRequestResult.url)
    const finalUrl = typeof signedRequestResult === 'object' && signedRequestResult.url ? signedRequestResult.url : signedRequestResult;

    if (!finalUrl) {
      console.error(`Failed to generate presigned URL for ${filePath}. Method might be incorrect or returned null/undefined.`);
      return null;
    }

    await PresignedUrlCache.set(cacheKey, finalUrl, expiresIn);
    console.log(`Successfully generated and cached presigned URL for ${filePath}`);
    return finalUrl;

  } catch (error) {
    console.error(`Error generating presigned URL for ${filePath}:`, error);
    return null;
  }
}

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

    // 發送歡迎通知給新註冊的打工者
    await NotificationHelper.notifyUserWelcome(
      newUser.workerId,
      newUser.firstName,
      "worker"
    );

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

    let files = null;
    if (body.identificationType === "businessNo" && reqFile.verficationDocument) {
      files = reqFile.verficationDocument.length === undefined ? [reqFile.verficationDocument] : reqFile.verficationDocument;
    } else if (body.identificationType === "personalId" && reqFile.identificationDocument) {
      files = reqFile.identificationDocument.length === undefined ? [reqFile.identificationDocument] : reqFile.identificationDocument;
    } else {
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

        await Promise.all(
          files.map(
            async (file: { path: string; filename: string; name: string }) => {
              const currentFile = Bun.file(file.path);
              if (!currentFile.exists()) {
                throw new Error(
                  `Verification document file not found: ${file.name}`,
                );
              }
              await s3Client.write(
                `documents/${identificationType}/${file.filename}`,
                currentFile,
              );
              console.log(`File ${file.name} uploaded successfully`);
            },
          ),
        );

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

        const newUser = insertedUsers[0];

        // 發送歡迎通知給新註冊的商家
        await NotificationHelper.notifyUserWelcome(
          newUser.employerId,
          newUser.employerName,
          "employer"
        );

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

router.get("/logout", ({ response, session }) => {
  session.destroy();
  return response.status(200).send("Logged out successfully");
});

router.get("/profile", authenticated, async ({ user, response }) => {
  if (user.role === Role.WORKER) {
    const { password, profilePhoto, ...workerData } = user;
    let photoUrlData = null;

    if (profilePhoto?.r2Name) {
      const url = await generatePresignedUrl(`profile-photos/workers/${profilePhoto.r2Name}`);
      if (url) {
        photoUrlData = {
          url: url,
          originalName: profilePhoto.originalName,
          type: profilePhoto.type,
        };
      } else {
        // Keep photoUrlData as null if URL generation fails
        console.warn(`Failed to generate presigned URL for worker ${user.workerId} photo ${profilePhoto.r2Name}`);
      }
    }
    return { ...workerData, profilePhoto: photoUrlData };
  }

  if (user.role === Role.EMPLOYER) {
    const { password, employerPhoto, verificationDocuments, ...employerData } = user; // Exclude verificationDocuments for now
    let photoUrlData = null;

    if (employerPhoto?.r2Name) {
      const url = await generatePresignedUrl(`profile-photos/employers/${employerPhoto.r2Name}`);
      if (url) {
        photoUrlData = {
          url: url,
          originalName: employerPhoto.originalName,
          type: employerPhoto.type,
        };
      } else {
        // Keep photoUrlData as null if URL generation fails
        console.warn(`Failed to generate presigned URL for employer ${user.employerId} photo ${employerPhoto.r2Name}`);
      }
    }
    // Return verificationDocuments as is from the DB for this route; it's handled by another endpoint.
    return { ...employerData, employerPhoto: photoUrlData, verificationDocuments };
  }

  return response.status(400).send("Invalid role");
});

router.put("/update/profile", authenticated, async ({ body, response, request, user }) => {
  try {
    if (user.role === Role.WORKER) {
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

    }
    if (user.role === Role.EMPLOYER) {
      const validationResult = updateEmployerProfileSchema.safeParse(body);

      if (!validationResult.success) {
        return response.status(400).json({
          message: "Validation failed",
          errors: validationResult.error.flatten(),
        });
      }

      const validatedData = validationResult.data;

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

    }
    return response.status(400).send("Invalid user role for profile update");
  } catch (error) {
    console.error("Error updating profile:", error);
    return response.status(500).send("Internal server error");
  }
});

router.put(
  "/update/identification",
  authenticated,
  uploadDocument,
  async ({ headers, body, file: reqFile, response, user }) => {
    let files = null;
    try {
      if (reqFile.length === 0) {
        return response.status(400).send("No file uploaded");
      }

      if (body.identificationType === "businessNo" && reqFile.verficationDocument) {
        files = reqFile.verficationDocument.length === undefined ? [reqFile.verficationDocument] : reqFile.verficationDocument;
      } else if (body.identificationType === "personalId" && reqFile.identificationDocument) {
        files = reqFile.identificationDocument.length === undefined ? [reqFile.identificationDocument] : reqFile.identificationDocument;
      } else {
        return response.status(400).send("Invalid identification document");
      }

      if (user.role === Role.EMPLOYER && headers.get("platform") === "web-employer") {
        const filesInfo: {
          originalName: string;
          type: string;
          r2Name: string;
        }[] = files.map((file: { name: string; type: string; filename: string }) => ({
          originalName: file.name as string,
          type: file.type as string,
          r2Name: file.filename as string,
        }));

        const deleteFiles = JSON.parse(user.verificationDocuments).map(
          (file: { r2Name: string }) =>
            s3Client.delete(`documents/${body.identificationType}/${file.r2Name}`)
        );

        await Promise.all(deleteFiles);

        await Promise.all(
          files.map(async (file: { path: string; filename: string; name: string }) => {
            const currentFile = Bun.file(file.path);
            if (!currentFile.exists()) {
              throw new Error(`Verification document file not found: ${file.name}`);
            }
            await s3Client.write(
              `documents/${body.identificationType}/${file.filename}`,
              currentFile,
            );
            console.log(`File ${file.name} uploaded successfully`);
          }),
        );

        await dbClient
          .update(employers)
          .set({
            identificationType: body.identificationType,
            identificationNumber: body.identificationNumber,
            verificationDocuments: JSON.stringify(filesInfo),
            updatedAt: new Date(),
          })
          .where(eq(employers.employerId, user.employerId));

        return response.status(200).send("Identification updated successfully");
      }
      return response.status(400).send("Invalid user role for identification update");
    }
    catch (error) {
      console.error("Error updating identification:", error);
      return response.status(500).send("Internal server error");
    }
    finally {
      cleanupTempFiles(files);
    }
  }
);

router.put(
  "/update/profilePhoto",
  authenticated,
  uploadProfilePhoto,
  async ({ headers, file: reqFile, user, response }) => {
    try {
      if (reqFile.length === 0) {
        return response.status(400).send("No file uploaded");
      }

      const filesInfo: {
        originalName: string;
        type: string;
        r2Name: string;
      } = {
        originalName: reqFile.profilePhoto.name,
        type: reqFile.profilePhoto.type,
        r2Name: reqFile.profilePhoto.filename,
      }

      if (user.role === "worker" && headers.get("platform") === "mobile") {
        if (user.profilePhoto?.r2Name) {
          await s3Client.delete(`profile-photos/workers/${user.profilePhoto.r2Name}`);
        }

        await s3Client.write(
          `profile-photos/workers/${filesInfo.r2Name}`,
          Bun.file(reqFile.profilePhoto.path),
        );

        await dbClient
          .update(workers)
          .set({
            profilePhoto: filesInfo,
            updatedAt: new Date(),
          })
          .where(eq(workers.workerId, user.workerId));

        return response.status(200).send("Profile photo updated successfully");

      }
      if (user.role === "employer" && headers.get("platform") === "web-employer") {
        if (user.employerPhoto?.r2Name) {
          await s3Client.delete(`profile-photos/employers/${user.employerPhoto.r2Name}`);
        }

        await s3Client.write(
          `profile-photos/employers/${filesInfo.r2Name}`,
          Bun.file(reqFile.profilePhoto.path),
        );

        await dbClient
          .update(employers)
          .set({
            employerPhoto: filesInfo,
            updatedAt: new Date(),
          })
          .where(eq(employers.employerId, user.employerId));

        return response.status(200).send("Profile photo updated successfully");
      }

      return response.status(400).send("Platform requiered or mismatch");
    } catch (error) {
      return response.status(500).send("Internal server error");
    } finally {
      cleanupTempFiles([reqFile.profilePhoto]);
    }
  }
);

router.get("/employer/verification-documents", authenticated, async ({ user, response }) => {
  if (!user || user.role !== "employer") {
    return response.status(403).send("Forbidden: Employer access required.");
  }

  const employer = user; // user object is the employer object from authenticated middleware

  if (!employer.verificationDocuments || typeof employer.verificationDocuments !== 'string') {
    console.log(`Employer ${employer.employerId} has no verification documents or format is incorrect.`);
    return response.status(200).json([]); // Return empty array if no documents
  }

  try {
    const documentsArray = JSON.parse(employer.verificationDocuments);
    if (!Array.isArray(documentsArray)) {
      console.error(`Error parsing verificationDocuments for employer ${employer.employerId}: Not an array.`);
      return response.status(500).send("Error processing verification documents.");
    }

    const documentsWithUrls = await Promise.all(
      documentsArray.map(async (doc: any) => {
        if (doc?.r2Name && employer.identificationType) {
          const filePath = `documents/${employer.identificationType}/${doc.r2Name}`;
          const url = await generatePresignedUrl(filePath);
          if (url) {
            return {
              originalName: doc.originalName,
              type: doc.type,
              url: url,
            };
          }
          console.warn(`Failed to generate presigned URL for document ${doc.r2Name} of employer ${employer.employerId}`);
          // Return the document without a URL if generation fails, or omit it
          return {
            originalName: doc.originalName,
            type: doc.type,
            url: null, // Explicitly set URL to null
            error: "Failed to generate URL for this document.",
          };

        }
        // If doc is malformed or r2Name is missing, filter it out or return with error
        return null;
      })
    );

    // Filter out any null entries that resulted from malformed doc objects
    const validDocuments = documentsWithUrls.filter(doc => doc !== null);

    return response.status(200).json(validDocuments);
  } catch (error) {
    console.error(`Error processing verification documents for employer ${employer.employerId}:`, error);
    return response.status(500).send("Internal server error while processing documents.");
  }
});

export default { path: "/user", router } as IRouter;