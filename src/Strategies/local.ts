import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import dbClient from "../Client/DrizzleClient.ts";
import { eq } from "drizzle-orm";
import { employers, workers, admins } from "../Schema/DatabaseSchema.ts";
import { verify } from "@node-rs/argon2";
import { argon2Config } from "../config.ts";
import { Role, type sessionUser } from "../Types/types.ts";

export function initStrategy() {
  passport.serializeUser((user: sessionUser, done) => {
    done(null, { ...user });
  });

  passport.deserializeUser(async (payload: sessionUser, done) => {
    if (payload.role === Role.EMPLOYER) {
      const employer = await dbClient.query.employers.findFirst({
        where: eq(employers.employerId, payload.id),
      });
      if (!employer) {
        return done(null, null);
      }
      const { password, ...remains } = employer;
      return done(null, { ...remains, role: Role.EMPLOYER });
    }
    if (payload.role === Role.WORKER) {
      const worker = await dbClient.query.workers.findFirst({
        where: eq(workers.workerId, payload.id),
      });
      if (!worker) {
        return done(null, null);
      }
      const { password, ...remains } = worker;
      return done(null, { ...remains, role: Role.WORKER });
    }
    if (payload.role === Role.ADMIN) {
      const admin = await dbClient.query.admins.findFirst({
        where: eq(admins.adminId, payload.id),
      });
      if (!admin) return done(null, null);
      const { password, ...remains } = admin;
      return done(null, { ...remains, role: Role.ADMIN });
    }
    done(null, null);
  });

  passport.use(
    new LocalStrategy(
      { usernameField: "email", passReqToCallback: true },
      async (req, email, password, done) => {
        const { platform } = req.headers;
        if (!platform?.length) {
          return done(null, false, { message: "Platform is required" });
        }

        if (!email?.length || !password?.length) {
          return done(null, false, {
            message: "Username and password are required",
          });
        }

        if (platform === "web-employer") {
          const employer = await dbClient.query.employers.findFirst({
            where: eq(employers.email, email),
          });
          if (!employer) {
            return done(null, false, { message: "No employer found" });
          }
          const passwordCorrect = await verify(
            employer.password,
            password,
            argon2Config,
          );
          if (!passwordCorrect) {
            return done(null, false, { message: "Incorrect password" });
          }
          const payload: sessionUser = {
            id: employer.employerId,
            role: Role.EMPLOYER,
          };
          return done(null, payload);
        }

        if (platform === "web-admin") {
          const admin = await dbClient.query.admins.findFirst({
            where: eq(admins.email, email),
          });
          if (!admin) {
            return done(null, false, { message: "No admin found" });
          }
          const passwordCorrect = await verify(
            admin.password,
            password,
            argon2Config,
          );
          if (!passwordCorrect) {
            return done(null, false, { message: "Incorrect password" });
          }
          const payload: sessionUser = {
            id: admin.adminId,
            role: Role.ADMIN,
          };
          return done(null, payload);
        }

        if (platform === "mobile") {
          const worker = await dbClient.query.workers.findFirst({
            where: eq(workers.email, email),
          });
          if (!worker) {
            return done(null, false, { message: "No worker found" });
          }
          const passwordCorrect = await verify(
            worker.password,
            password,
            argon2Config,
          );
          if (!passwordCorrect) {
            return done(null, false, { message: "Incorrect password" });
          }
          const payload: sessionUser = {
            id: worker.workerId,
            role: Role.WORKER,
          };
          return done(null, payload);
        }
        return done(null, false, { message: "Platform not supported" });
      },
    ),
  );
}
