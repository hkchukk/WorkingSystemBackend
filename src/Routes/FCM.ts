import { Hono } from "hono";
import { authenticated } from "../Middleware/authentication";
import type IRouter from "../Interfaces/IRouter";
import type { HonoGenericContext } from "../Types/types";
import { Role } from "../Types/types";
import dbClient from "../Client/DrizzleClient";
import { eq, sql } from "drizzle-orm";
import { workers, employers, admins } from "../Schema/DatabaseSchema";
import { zValidator } from "@hono/zod-validator";
import { registerFCMTokenSchema, deleteFCMTokensSchema, sendTestPushSchema } from "../Types/zodSchema";
import FCMClient, { FCMTokenData } from "../Client/FCMClient";
import NotificationHelper from "../Utils/NotificationHelper";

const router = new Hono<HonoGenericContext>();

// 註冊 FCM Token
router.post("/register", authenticated, zValidator("json", registerFCMTokenSchema), async (c) => {
  try {
    const user = c.get("user");
    const { token, deviceType } = c.req.valid("json");

    const isValidToken = await FCMClient.validateToken(token);

    if (!isValidToken) {
      return c.json({
        message: "無效的 FCM Token",
      }, 400);
    }

    // 獲取用戶現有的 FCM tokens
    let userData: any = null;

    if (user.role === Role.WORKER) {
      userData = await dbClient.query.workers.findFirst({
        where: eq(workers.workerId, user.userId),
        columns: { fcmTokens: true },
      });
    } else if (user.role === Role.EMPLOYER) {
      userData = await dbClient.query.employers.findFirst({
        where: eq(employers.employerId, user.userId),
        columns: { fcmTokens: true },
      });
    } else if (user.role === Role.ADMIN) {
      userData = await dbClient.query.admins.findFirst({
        where: eq(admins.adminId, user.userId),
        columns: { fcmTokens: true },
      });
    }

    // 解析現有的 tokens
    let existingTokensData: FCMTokenData[] = [];

    if (userData?.fcmTokens) {
      existingTokensData = Array.isArray(userData.fcmTokens) 
        ? userData.fcmTokens 
        : JSON.parse(userData.fcmTokens as string);
    }

    // 檢查 token 是否已存在
    const currentTokens = existingTokensData.map(tokenData => tokenData.token);

    if (currentTokens.includes(token)) {
      return c.json({
        message: "FCM Token 已存在",
      }, 200);
    }

    // 添加新的 token
    const newTokenData: FCMTokenData = { token, deviceType };
    const tokenExists = existingTokensData.some(t => t.token === token);

    if (!tokenExists) {
      existingTokensData.push(newTokenData);
    }

    if (user.role === Role.WORKER) {
      await dbClient
        .update(workers)
        .set({
          fcmTokens: existingTokensData,
          updatedAt: sql`now()`,
        })
        .where(eq(workers.workerId, user.userId));
    } else if (user.role === Role.EMPLOYER) {
      await dbClient
        .update(employers)
        .set({
          fcmTokens: existingTokensData,
          updatedAt: sql`now()`,
        })
        .where(eq(employers.employerId, user.userId));
    } else if (user.role === Role.ADMIN) {
      await dbClient
        .update(admins)
        .set({
          fcmTokens: existingTokensData,
        })
        .where(eq(admins.adminId, user.userId));
    }

    return c.json({
      message: "FCM Token 註冊成功",
    }, 200);
  } catch (error) {
    console.error("FCM Token 註冊失敗:", error);
    return c.json({
      message: "FCM Token 註冊失敗",
    }, 500);
  }
});

// 獲取用戶的 FCM Tokens
router.get("/tokens", authenticated, async (c) => {
  try {
    const user = c.get("user");
    let userData: any = null;

    if (user.role === Role.WORKER) {
      userData = await dbClient.query.workers.findFirst({
        where: eq(workers.workerId, user.userId),
        columns: {
          fcmTokens: true,
        },
      });
    } else if (user.role === Role.EMPLOYER) {
      userData = await dbClient.query.employers.findFirst({
        where: eq(employers.employerId, user.userId),
        columns: {
          fcmTokens: true,
        },
      });
    } else if (user.role === Role.ADMIN) {
      userData = await dbClient.query.admins.findFirst({
        where: eq(admins.adminId, user.userId),
        columns: {
          fcmTokens: true,
        },
      });
    }

    if (!userData) {
      return c.json({
        message: "用戶不存在",
      }, 404);
    }

    const tokens = (userData.fcmTokens as FCMTokenData[]) || [];

    return c.json({
      data: {
        tokens,
        totalCount: tokens.length,
      },
    }, 200);

  } catch (error) {
    console.error("獲取 FCM Tokens 失敗:", error);
    return c.json({
      message: "獲取 FCM Tokens 失敗",
    }, 500);
  }
});

// 刪除 FCM Token
router.delete("/tokens", authenticated, zValidator("json", deleteFCMTokensSchema), async (c) => {
  try {
    const user = c.get("user");
    const { tokens } = c.req.valid("json");

    // 獲取當前用戶的 FCM tokens
    let userData: any = null;

    if (user.role === Role.WORKER) {
      userData = await dbClient.query.workers.findFirst({
        where: eq(workers.workerId, user.userId),
        columns: { fcmTokens: true },
      });
    } else if (user.role === Role.EMPLOYER) {
      userData = await dbClient.query.employers.findFirst({
        where: eq(employers.employerId, user.userId),
        columns: { fcmTokens: true },
      });
    } else if (user.role === Role.ADMIN) {
      userData = await dbClient.query.admins.findFirst({
        where: eq(admins.adminId, user.userId),
        columns: { fcmTokens: true },
      });
    }

    if (!userData) {
      return c.json({
        message: "用戶不存在",
      }, 404);
    }

    let tokensData: FCMTokenData[] = [];

    if (userData.fcmTokens) {
      tokensData = typeof userData.fcmTokens === 'string'
        ? JSON.parse(userData.fcmTokens)
        : userData.fcmTokens;
    }

    if (tokensData.length === 0) {
      return c.json({
        message: "用戶沒有任何 FCM Token",
      }, 404);
    }

    const updatedTokens = tokensData.filter(t => !tokens.includes(t.token));

    if (user.role === Role.WORKER) {
      await dbClient
        .update(workers)
        .set({
          fcmTokens: updatedTokens,
          updatedAt: sql`now()`,
        })
        .where(eq(workers.workerId, user.userId));
    } else if (user.role === Role.EMPLOYER) {
      await dbClient
        .update(employers)
        .set({
          fcmTokens: updatedTokens,
          updatedAt: sql`now()`,
        })
        .where(eq(employers.employerId, user.userId));
    } else if (user.role === Role.ADMIN) {
      await dbClient
        .update(admins)
        .set({
          fcmTokens: updatedTokens,
        })
        .where(eq(admins.adminId, user.userId));
    }

    const deletedCount = tokensData.length - updatedTokens.length;

    return c.json({
      message: `${deletedCount} 個 FCM Token 刪除成功`,
    }, 200);

  } catch (error) {
    console.error("刪除 FCM Token 失敗:", error);
    return c.json({
      message: "刪除 FCM Token 失敗",
    }, 500);
  }
});

// 發送測試推播通知
router.post("/test-push", authenticated, zValidator("json", sendTestPushSchema), async (c) => {
  try {
    const user = c.get("user");
    const { title, message, data } = c.req.valid("json");

    // 發送推播通知
    const success = await NotificationHelper.sendPushNotification(
      user.userId,
      user.role,
      title,
      message,
      data as Record<string, string>
    );

    if (success) {
      return c.json({
        message: "測試推播發送成功",
      }, 200);
    } else {
      return c.json({
        message: "測試推播發送失敗",
      }, 500);
    }
  } catch (error) {
    console.error("發送測試推播失敗:", error);
    return c.json({
      message: "發送測試推播失敗",
    }, 500);
  }
});

export default { path: "/fcm", router } as IRouter;
