import admin from "firebase-admin";
import { fcmConfig } from "../config";

export interface FCMTokenData {
  token: string;
  deviceType: "android" | "ios" | "web";
}

class FCMClient {
  private static instance: FCMClient;
  private adminApp: admin.app.App | null;

  private constructor() {
    this.initializeFirebase();
  }

  public static getInstance(): FCMClient {
    if (!FCMClient.instance) {
      FCMClient.instance = new FCMClient();
    }
    return FCMClient.instance;
  }

  private initializeFirebase(): void {
    try {
      if (admin.apps.length === 0) {
        if (!fcmConfig.projectId || !fcmConfig.privateKey || !fcmConfig.clientEmail) {
          console.warn("Firebase 配置不完整，FCM 功能將被禁用");
          return;
        }

        this.adminApp = admin.initializeApp({
          credential: admin.credential.cert({
            projectId: fcmConfig.projectId,
            privateKey: fcmConfig.privateKey,
            clientEmail: fcmConfig.clientEmail,
          }),
        });

        console.log("Firebase Admin SDK 初始化成功");
      } else {
        this.adminApp = admin.apps[0] as admin.app.App;
      }
    } catch (error) {
      console.error("Firebase Admin SDK 初始化失敗:", error);
    }
  }

  /**
   * 發送單一推播通知
   */
  public async sendToToken(
    token: string,
    notification: {
      title: string;
      body: string;
    },
    data?: Record<string, string>
  ): Promise<boolean> {
    if (!this.adminApp) {
      console.warn("Firebase Admin SDK 未初始化，無法發送推播");
      return false;
    }

    try {
      const message: admin.messaging.Message = {
        token,
        notification,
        data,
        android: {
          priority: "high",
          notification: {
            channelId: "default",
            priority: "high",
            defaultSound: true,
          },
        },
        apns: {
          payload: {
            aps: {
              alert: notification,
              sound: "default",
              badge: 1,
            },
          },
        },
        webpush: {
          notification: {},
        },
      };

      const response = await admin.messaging().send(message);
      console.log("推播發送成功:", response);
      return true;
    } catch (error) {
      console.error("推播發送失敗:", error);
      return false;
    }
  }

  /**
   * 發送批量推播通知
   */
  public async sendToMultipleTokens(
    tokens: string[],
    notification: {
      title: string;
      body: string;
    },
    data?: Record<string, string>
  ): Promise<{ successCount: number; failureCount: number }> {
    if (!this.adminApp) {
      console.warn("Firebase Admin SDK 未初始化，無法發送推播");
      return { successCount: 0, failureCount: 0 };
    }

    if (tokens.length === 0) {
      return { successCount: 0, failureCount: 0 };
    }

    try {
      const message: admin.messaging.MulticastMessage = {
        tokens,
        notification,
        data,
        android: {
          priority: "high",
          notification: {
            channelId: "default",
            priority: "high",
            defaultSound: true,
          },
        },
        apns: {
          payload: {
            aps: {
              alert: notification,
              sound: "default",
              badge: 1,
            },
          },
        },
        webpush: {
          notification: {},
        },
      };

      const response = await admin.messaging().sendEachForMulticast(message);
      console.log(`批量推播結果: 成功 ${response.successCount}, 失敗 ${response.failureCount}`);
      
      return {
        successCount: response.successCount,
        failureCount: response.failureCount,
      };
    } catch (error) {
      console.error("批量推播發送失敗:", error);
      return { successCount: 0, failureCount: tokens.length };
    }
  }

  /**
   * 發送通知到主題
   */
  public async sendToTopic(
    topic: string,
    notification: {
      title: string;
      body: string;
    },
    data?: Record<string, string>
  ): Promise<boolean> {
    if (!this.adminApp) {
      console.warn("Firebase Admin SDK 未初始化，無法發送推播");
      return false;
    }

    try {
      const message: admin.messaging.Message = {
        topic,
        notification,
        data,
        android: {
          priority: "high",
          notification: {
            channelId: "default",
            priority: "high",
            defaultSound: true,
          },
        },
        apns: {
          payload: {
            aps: {
              alert: notification,
              sound: "default",
              badge: 1,
            },
          },
        },
        webpush: {
          notification: {},
        },
      };

      const response = await admin.messaging().send(message);
      console.log("主題推播發送成功:", response);
      return true;
    } catch (error) {
      console.error("主題推播發送失敗:", error);
      return false;
    }
  }

  /**
   * 訂閱主題
   */
  public async subscribeToTopic(tokens: string[], topic: string): Promise<boolean> {
    if (!this.adminApp) {
      console.warn("Firebase Admin SDK 未初始化，無法訂閱主題");
      return false;
    }

    try {
      const response = await admin.messaging().subscribeToTopic(tokens, topic);
      console.log("主題訂閱成功:", response);
      return true;
    } catch (error) {
      console.error("主題訂閱失敗:", error);
      return false;
    }
  }

  /**
   * 取消訂閱主題
   */
  public async unsubscribeFromTopic(tokens: string[], topic: string): Promise<boolean> {
    if (!this.adminApp) {
      console.warn("Firebase Admin SDK 未初始化，無法取消訂閱主題");
      return false;
    }

    try {
      const response = await admin.messaging().unsubscribeFromTopic(tokens, topic);
      console.log("取消主題訂閱成功:", response);
      return true;
    } catch (error) {
      console.error("取消主題訂閱失敗:", error);
      return false;
    }
  }

  /**
   * 驗證 FCM Token 是否有效
   */
  public async validateToken(token: string): Promise<boolean> {
    if (!this.adminApp) {
      return false;
    }

    try {
      const message: admin.messaging.Message = {
        token,
        data: { test: "validation" },
      };
      
      await admin.messaging().send(message, true); // 第二個參數是 dryRun
      return true;
    } catch (error) {
      console.error("Token 驗證失敗:", error);
      return false;
    }
  }
}

export default FCMClient.getInstance();
