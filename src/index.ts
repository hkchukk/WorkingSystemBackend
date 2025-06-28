import session from "express-session";
import passport from "passport";
import { nhttp } from "@nhttp/nhttp";
import cors from "@nhttp/nhttp/cors";
import Redis from "ioredis";
import { RedisStore } from "connect-redis";
import { initStrategy } from "./Strategies/local.ts";
import type IRouter from "./Interfaces/IRouter.ts";
import { hash } from "@node-rs/argon2";
import { argon2Config } from "./config.ts";
import { Glob } from "bun";
import redisClient from "./Client/RedisClient.ts";

initStrategy();

const app = nhttp({ stackError: false });

app.use(cors({ origin: 'http://localhost:4321/', credentials: true }));

app.use(
	session({
		cookie: { maxAge: 60000 * 60 * 24, secure: true },
		store: new RedisStore({
			client: new Redis(6379, "localhost"),
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
	const module = await import(file);
	const { path, router }: IRouter = module.default;
	app.use(path, router);
}

app.listen(3000, async () => {
	console.log("🚀 Server is ready on port 3000");

	// 初始化 Redis 連接（用於快取）
	try {
		await redisClient.ping();
		console.log("✅ Redis 快取連接成功");
	} catch (error) {
		console.error("❌ Redis 快取連接失敗:", error);
	}
});
