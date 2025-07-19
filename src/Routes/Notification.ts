import { Router } from "@nhttp/nhttp";
import { authenticated } from "../Middleware/middleware.ts";
import type IRouter from "../Interfaces/IRouter.ts";
import dbClient from "../Client/DrizzleClient.ts";
import { eq, and, desc, count } from "drizzle-orm";
import { notifications } from "../Schema/DatabaseSchema.ts";
import validate from "@nhttp/zod";
import { createNotificationSchema, markAsReadSchema } from "../Middleware/validator.ts";

const router = new Router();

// 獲取當前用戶的通知列表
router.get("/list", authenticated, async ({ user, query, response }) => {
  try {
    const { limit = 10, offset = 0, unreadOnly } = query;
    const requestLimit = Number.parseInt(limit);
    const requestOffset = Number.parseInt(offset);
    const isUnreadOnly = unreadOnly === "true";

    // 建構查詢條件
    let whereCondition = eq(notifications.receiverId, user.workerId || user.employerId || user.adminId);

    if (isUnreadOnly) {
      whereCondition = and(
        whereCondition,
        eq(notifications.isRead, false)
      );
    }

    // 獲取通知列表 (只顯示部分訊息)
    const notificationList = await dbClient.query.notifications.findMany({
      where: whereCondition,
      orderBy: [desc(notifications.createdAt)],
      columns: {
        notificationId: true,
        title: true,
        type: true,
        isRead: true,
        createdAt: true,
      },
      limit: requestLimit + 1, // 多查一筆來確認是否有更多資料
      offset: requestOffset,
    });

    // 檢查是否有更多資料
    const hasMore = notificationList.length > requestLimit;
    const returnNotifications = hasMore ? notificationList.slice(0, requestLimit) : notificationList;

    return response.status(200).json({
      data: {
        notifications: returnNotifications,
        pagination: {
          limit: requestLimit,
          offset: requestOffset,
          hasMore,
          returned: returnNotifications.length,
        },
      },
    });

  } catch (error) {
    console.error("獲取通知列表失敗:", error);
    return response.status(500).json({
      message: "獲取通知列表失敗",
    });
  }
});

// 獲取未讀通知數量
router.get("/unread-count", authenticated, async ({ user, response }) => {
  try {
    const unreadResult = await dbClient
      .select({ count: count() })
      .from(notifications)
      .where(and(
        eq(notifications.receiverId, user.workerId || user.employerId || user.adminId),
        eq(notifications.isRead, false)
      ));

    const unreadCount = unreadResult[0]?.count || 0;

    return response.status(200).json({
      data: {
        unreadCount,
      },
    });

  } catch (error) {
    console.error("獲取未讀通知數量失敗:", error);
    return response.status(500).json({
      message: "獲取未讀通知數量失敗",
    });
  }
});

// 標記通知為已讀
router.put("/mark-as-read", authenticated, validate(markAsReadSchema), async ({ user, body, response }) => {
  try {
    const { notificationIds } = body;

    // 驗證通知是否屬於當前用戶
    const userNotifications = await dbClient.query.notifications.findMany({
      where: eq(notifications.receiverId, user.workerId || user.employerId || user.adminId),
      columns: {
        notificationId: true,
      },
    });

    const userNotificationIds = userNotifications.map(n => n.notificationId);
    const validNotificationIds = notificationIds.filter(id => userNotificationIds.includes(id));

    if (validNotificationIds.length === 0) {
      return response.status(400).json({
        message: "找不到有效的通知",
      });
    }

    // 批量更新為已讀
    const updatePromises = validNotificationIds.map(id =>
      dbClient
        .update(notifications)
        .set({
          isRead: true,
          readAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(notifications.notificationId, id))
    );

    await Promise.all(updatePromises);

    return response.status(200).json({
      message: `成功標記 ${validNotificationIds.length} 條通知為已讀`,
      data: {
        updatedCount: validNotificationIds.length,
      },
    });

  } catch (error) {
    console.error("標記通知已讀失敗:", error);
    return response.status(500).json({
      message: "標記通知已讀失敗",
    });
  }
});

// 標記所有通知為已讀
router.put("/mark-all-as-read", authenticated, async ({ user, response }) => {
  try {
    await dbClient
      .update(notifications)
      .set({
        isRead: true,
        readAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(notifications.receiverId, user.workerId || user.employerId || user.adminId),
        eq(notifications.isRead, false)
      ));

    return response.status(200).json({
      message: "成功標記所有通知為已讀",
    });

  } catch (error) {
    console.error("標記所有通知已讀失敗:", error);
    return response.status(500).json({
      message: "標記所有通知已讀失敗",
    });
  }
});

// 建立通知 (管理員或系統內部使用)
router.post("/create", authenticated, validate(createNotificationSchema), async ({ body, response }) => {
  try {
    const newNotification = await dbClient
      .insert(notifications)
      .values({
        receiverId: body.receiverId,
        title: body.title,
        message: body.message,
        type: body.type,
      })
      .returning();

    return response.status(201).json({
      message: "通知建立成功",
      data: newNotification[0],
    });

  } catch (error) {
    console.error("建立通知失敗:", error);
    return response.status(500).json({
      message: "建立通知失敗",
    });
  }
});

// 刪除通知
router.delete("/:notificationId", authenticated, async ({ user, params, response }) => {
  try {
    const { notificationId } = params;

    // 驗證通知是否屬於當前用戶
    const notification = await dbClient.query.notifications.findFirst({
      where: and(
        eq(notifications.notificationId, notificationId),
        eq(notifications.receiverId, user.workerId || user.employerId || user.adminId)
      ),
    });

    if (!notification) {
      return response.status(404).json({
        message: "找不到該通知",
      });
    }

    await dbClient
      .delete(notifications)
      .where(eq(notifications.notificationId, notificationId));

    return response.status(200).json({
      message: "通知刪除成功",
    });

  } catch (error) {
    console.error("刪除通知失敗:", error);
    return response.status(500).json({
      message: "刪除通知失敗",
    });
  }
});

// 獲取特定通知詳情
router.get("/:notificationId", authenticated, async ({ user, params, response }) => {
  try {
    const { notificationId } = params;

    const notification = await dbClient.query.notifications.findFirst({
      where: and(
        eq(notifications.notificationId, notificationId),
        eq(notifications.receiverId, user.workerId || user.employerId || user.adminId)
      ),
    });

    if (!notification) {
      return response.status(404).json({
        message: "找不到該通知",
      });
    }

    // 如果通知未讀，自動標記為已讀
    if (!notification.isRead) {
      const currentDate = new Date();

      await dbClient
        .update(notifications)
        .set({
          isRead: true,
          readAt: currentDate,
          updatedAt: currentDate,
        })
        .where(eq(notifications.notificationId, notificationId));

      notification.isRead = true;
      notification.readAt = currentDate;
    }

    return response.status(200).json({
      data: notification,
    });

  } catch (error) {
    console.error("獲取通知詳情失敗:", error);
    return response.status(500).json({
      message: "獲取通知詳情失敗",
    });
  }
});

export default { path: "/notifications", router } as IRouter; 