import { Router } from '@nhttp/nhttp';
import passport from 'passport';
import { authenticated } from '../Middleware/middleware.ts';
import signature from 'cookie-signature';
import type IRouter from '../Interfaces/IRouter.ts';
import dbClient from '../Client/DrizzleClient.ts';
import { eq } from 'drizzle-orm';
import { employers, workers } from '../Schema/DatabaseSchema.ts';
import { argon2Config } from '../config.ts';
import { hash as argon2hash } from '@node-rs/argon2';
import validate from '@nhttp/zod';
import { employerSignupSchema, workerSignupSchema } from '../Middleware/validator.ts';
import { uploadDocument } from '../Middleware/uploadFile.ts';

const router = new Router();

router.post(
  '/register/worker',
  validate(workerSignupSchema),
  async ({ headers, response, body }) => {
    const platform = headers.get('platform');
    if (!platform?.length) {
      return response.status(400).send('Platform is required');
    }
    const {
      email,
      password,
      firstName,
      lastName,
      phoneNumber,
      highestEducation = '大學',
      schoolName,
      major,
      studyStatus = '就讀中',
      certificates = [],
    } = body;

    const existingUser = await dbClient.query.workers.findFirst({
      where: eq(workers.email, email),
    });

    if (existingUser) {
      return response.status(409).send('User with this email already exists');
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
      message: 'User registered successfully:',
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
  '/register/employee',
  validate(employerSignupSchema),
  uploadDocument,
  async ({ headers, body, file: reqFile, response }) => {
    const platform = headers.get('platform');
    if (platform === 'web-employer') {
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

      const file = reqFile.verficationDocument;

      if (!email || !password || !employerName) {
        return response
          .status(400)
          .send('email, password and employerName are required');
      }

      if (!identificationNumber) {
        return response
          .status(400)
          .send('identificationNumber are required');
      }

      const existing = await dbClient.query.employers.findFirst({
        where: eq(employers.email, email),
      });

      if (existing) {
        return response
          .status(409)
          .send('employer with this email already exists');
      }

      if (!file) {
        return response.status(422).send('File is required');
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

      return response.status(201).send({
        message: 'User registered successfully:',
        user: {
          employerId: newUser.employerId,
          email: newUser.email,
          employerName: newUser.employerName,
        },
      });
    }

    return response.status(400).send('Invalid platform');
  },
);

router.post(
  '/login',
  passport.authenticate('local'),
  ({ response, user, sessionID }) => {
    response.cookie(
      'connect.sid',
      `s:${signature.sign(sessionID, process.env.SESSIONSECRET)}`,
    );
    return user;
  },
);

router.get('/logout', ({ session }) => {
  session.destroy();
  return 'Logged out';
});

router.get('/profile', authenticated, async ({ user, response }) => {

  if (user.role === 'worker') {
    const { password, ...remains } = user;

    return remains;
  }

  if (user.role === 'employer') {
    const { password, ...remains } = user;

    return remains;
  }

  return response.status(400).send('Invalid role');
});

export default { path: '/user', router } as IRouter;
