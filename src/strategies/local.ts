//@ts-types="npm:@types/passport"
import passport from "npm:passport";
//@ts-types="npm:@types/passport-local"
import { Strategy as LocalStrategy } from "npm:passport-local";

export function initStrategy() {
	passport.serializeUser((user, done) => {
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
