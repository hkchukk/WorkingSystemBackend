import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import dbClient from "../Client/DrizzleClient";
import { eq } from "drizzle-orm";
import { workers } from "../Schema/DatabaseSchema";

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
        } else if (platform === "mobile") {
          const worker = await dbClient.query.workers.findFirst({
            where: eq(workers.email, email),
          });
          if (!worker) {
            return done(null, false, { message: "No worker found" });
          }
          const passwordCorrect = await Bun.password.verify(
            password,
            worker.password,
          );
          if (!passwordCorrect) {
            return done(null, false, { message: "Incorrect password" });
          }
        } else {
          return done(null, false, { message: "Platform not supported" });
        }

        // if (email === "admin" && password === "admin") {
        //   return done(null, { username: email, role: "admin" });
        // }
        // return done(null, false);
      },
    ),
  );
}
