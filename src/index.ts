import { Hono } from "hono";
import { cors } from "hono/cors";
import { sessionMiddleware, CookieStore } from "hono-sessions";
import type { HonoGenericContext } from "./Types/types";
import { argon2Config } from "./config";
import { hash } from "@node-rs/argon2";
import { Glob } from "bun";
import type IRouter from "./Interfaces/IRouter";
import CronManager from "./Utils/CronManager";
import redisClient from "./Client/RedisClient";

const app = new Hono<HonoGenericContext>();
const store = new CookieStore()

app.use("*", cors({ origin: "http://localhost:4321/", credentials: true }));

app.use("*", sessionMiddleware({
  store,
  cookieOptions: { maxAge: 60 * 60 * 24, secure: true },
  expireAfterSeconds: 60 * 60 * 24,
  autoExtendExpiration: true,
  encryptionKey: Bun.env.SESSIONSECRET
}))

app.get("/", (c) => {
  return c.text("Hello World!");
});

app.get("/hashing/:password", async (c) => {
  const password = c.req.param("password");
  return c.text(await hash(password, argon2Config));
});

// 載入路由
for await (const file of new Glob(`${__dirname}/routes/**/*.ts`).scan({
	absolute: true,
})) {
	const module = await import(file);
	const { path, router }: IRouter = module.default;
	app.route(path, router);
}

// 初始化系統組件
async function initializeSystem() {
	console.log("🚀 正在初始化系統組件...");

	// 檢查快取連接
	try {
		await redisClient.ping();
		console.log("✅ Redis 快取連接成功");
	} catch (error) {
		console.error("❌ Redis 快取連接失敗:", error);
	}

	// 初始化 Cron 任務
	try {
		const cronInitialized = await CronManager.initializeCronJobs();
		if (cronInitialized) {
			console.log("✅ Cron 任務初始化完成");
		} else {
			console.warn("⚠️  Cron 任務初始化失敗，定時任務可能無法正常運行");
		}
	} catch (error) {
		console.error("❌ Cron 任務初始化過程中發生錯誤:", error);
	}

	console.log("🎉 系統初始化完成！");
}

// 在應用啟動時初始化系統
initializeSystem().catch(error => {
	console.error("❌ 系統初始化失敗:", error);
});

export default app;
