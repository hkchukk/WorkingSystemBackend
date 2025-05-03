import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import dbClient from "../Client/DrizzleClient";
import { eq } from "drizzle-orm";
import { employers, workers } from "../Schema/DatabaseSchema";
import { verify } from "@node-rs/argon2";
import { argon2Config } from "../config";

export function initStrategy() {
  passport.serializeUser((user: { username: string; role: string }, done) => {
    done(null, { username: user.username, role: user.role });
  });

  passport.deserializeUser((payload, done) => {
    // TODO: Fetch user from database using id and role
    done(null, payload);
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

        if (platform === "web") {
          const employer = await dbClient.query.employers.findFirst({
            where: eq(employers.email, email),
          });
          if (!employer) {
            return done(null, false, { message: "No employer found" });
          }
          const passwordCorrect = await verify(
            password,
            employer.password,
            argon2Config,
          );
          if (!passwordCorrect) {
            return done(null, false, { message: "Incorrect password" });
          }
          const payload = { id: employer.employerId, role: "employer" };
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
            password,
            worker.password,
            argon2Config,
          );
          if (!passwordCorrect) {
            return done(null, false, { message: "Incorrect password" });
          }
          const payload = { id: worker.workerId, role: "worker" };
          return done(null, payload);
        }
        return done(null, false, { message: "Platform not supported" });
      },
    ),
  );
}
