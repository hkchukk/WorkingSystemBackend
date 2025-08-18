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
import { sendEmail } from "./Client/EmailClient";

const app = new Hono<HonoGenericContext>();
const store = new CookieStore();

app.use("*", cors({ origin: "*", credentials: true }));

app.use(
  "*",
  sessionMiddleware({
    store,
    cookieOptions: { maxAge: 60 * 60 * 24, secure: false },
    expireAfterSeconds: 60 * 60 * 24,
    autoExtendExpiration: true,
    encryptionKey: Bun.env.SESSIONSECRET,
  })
);

app.get("/", (c) => {
  return c.text("Hello World!");
});

app.get("/hashing/:password", async (c) => {
  const password = c.req.param("password");
  return c.text(await hash(password, argon2Config));
});

app.post("/send-test-email", async (c) => {
  try {
    const to = ""; // 換成您想測試的收件人地址
    const subject = "Hello from Nodemailer!";
    const html = "<h1>Welcome</h1><p>This is a test email sent using Nodemailer and Google OAuth2.</p>";

    await sendEmail(to, subject, html);
    return c.json({ success: true, message: "Email sent successfully!" });
  } catch (error) {
    console.error(error);
    return c.json({ success: false, message: "Failed to send email." }, 500);
  }
});

// 載入路由
for await (const file of new Glob(`${__dirname}/Routes/**/*.ts`).scan({
  absolute: true,
})) {
  const module = await import(file);
  const { path, router }: IRouter = module.default;
  app.route(path, router);
}

// 初始化系統組件
async function initializeSystem() {
  // 檢查快取連接
  try {
    await redisClient.ping();
  } catch (error) {
    console.error("❌ Redis 快取連接失敗:", error);
  }

  // 初始化 Cron 任務
  try {
    const cronInitialized = await CronManager.initializeCronJobs();

    if (cronInitialized) {
      console.log("✅ Cron 任務初始化完成");
    }
  } catch (error) {
    console.error("❌ Cron 任務初始化過程中發生錯誤:", error);
  }
}

// 在應用啟動時初始化系統
initializeSystem().catch((error) => {
  console.error("❌ 系統初始化失敗:", error);
});

export default app;
