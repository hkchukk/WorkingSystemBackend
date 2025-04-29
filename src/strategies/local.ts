import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";

export function initStrategy() {
  passport.serializeUser((user: { username: string }, done) => {
    done(null, user.username);
  });

  passport.deserializeUser((payload, done) => {
    done(null, payload);
  });

  passport.use(
    new LocalStrategy((username, password, done) => {
      if (username === "admin" && password === "admin") {
        return done(null, { username });
      }
      return done(null, false);
    }),
  );
}
