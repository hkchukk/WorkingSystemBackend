import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";

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
      { passReqToCallback: true },
      (req, username, password, done) => {
        if (username === "admin" && password === "admin") {
          return done(null, { username, role: "admin" });
        }
        return done(null, false);
      },
    ),
  );
}
