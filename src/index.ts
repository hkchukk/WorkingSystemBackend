import session from "express-session";
import passport from "passport";
import { nhttp, multipart } from "@nhttp/nhttp";
import cors from "@nhttp/nhttp/cors";
import Redis from "ioredis";
import { RedisStore } from "connect-redis";
import { initStrategy } from "./Strategies/local.ts";
import type IRouter from "./Interfaces/IRouter.ts";
import { hash } from "@node-rs/argon2";
import { argon2Config } from "./config.ts";
import { Glob } from "bun";

initStrategy();

const app = nhttp({ stackError: false });

app.use(cors({ credentials: true }));

app.use(
	session({
		cookie: { maxAge: 60000 * 60 * 24, secure: true },
		store: new RedisStore({
			client: new Redis(6379),
			prefix: "session:",
		}),
		resave: false,
		saveUninitialized: false,
		secret: process.env.SESSIONSECRET,
	}),
);

app.use(passport.initialize());
app.use(passport.session());

app.get("/", () => {
	return "Hello World!";
});

app.get("/hashing/:password", ({ params }) => {
	const { password } = params;
	return hash(password, argon2Config);
});

for await (const file of new Glob(`${__dirname}/Routes/**/*.ts`).scan({
	absolute: true,
})) {
	const { path, router }: IRouter = await import(file);
	app.use(path, router);
}

app.listen(3000, () => {
	console.log("Server is ready");
});
