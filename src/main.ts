//@ts-types="npm:@types/express-session"
import session from "npm:express-session";
//@ts-types="npm:@types/passport"
import passport from "npm:passport";
import nhttp from "jsr:@nhttp/nhttp";
import cors from "jsr:@nhttp/nhttp/cors";
import memoryStore from "npm:memorystore";
import { initStrategy } from "./strategies/local.ts";
import { authenticated } from "./middleware.ts";
//@ts-types="npm:@types/cookie-signature"
import signature from "npm:cookie-signature";

initStrategy();

const MemoryStore = memoryStore(session);

const app = nhttp();

app.use(cors({ credentials: true }));

app.use(
	session({
		cookie: { maxAge: 60000 * 60 * 24, secure: true },
		store: new MemoryStore({
			checkPeriod: 60000 * 60 * 24,
		}),
		resave: true,
		saveUninitialized: false,
		secret: "akpEUnT8iZIFjm-CwmwIf",
	}),
);

app.use(passport.initialize());
app.use(passport.session());

app.get("/", () => {
	return "Hello World!";
});

app.post(
	"/login",
	passport.authenticate("local"),
	({ response, user, sessionID }) => {
		response.cookie(
			"connect.sid",
			`s:${signature.sign(sessionID, "akpEUnT8iZIFjm-CwmwIf")}`,
		);
		return user;
	},
);

app.get("/logout", ({ session, logout }) => {
	session.destroy();
	return "Logged out";
});

app.get("/protected", authenticated, () => {
	return "Protected";
});

app.listen(3000, () => {
	console.log("Server is ready");
});
