import dbClient from "../Client/DrizzleClient.ts";
import { notifications } from "../Schema/DatabaseSchema.ts";

// 通知類型定義
export type NotificationType = 
  | "application_received"
  | "application_approved" 
  | "application_rejected"
  | "rating_received"
  | "gig_published"
  | "gig_expired"
  | "account_approved"
  | "account_rejected"
  | "user_welcome"
  | "system_announcement"
  | "other";

interface CreateNotificationParams {
  receiverId: string;
  title: string;
  message: string;
  type: NotificationType;
}

interface BatchNotificationParams {
  receiverIds: string[];
  title: string;
  message: string;
  type: NotificationType;
}

class NotificationHelper {
  
  /**
   * 建立單一通知
   */
  static async createNotification(params: CreateNotificationParams): Promise<boolean> {
    try {
      await dbClient.insert(notifications).values({
        receiverId: params.receiverId,
        title: params.title,
        message: params.message,
        type: params.type,
      });

      console.log(`通知已建立 - 接收者: ${params.receiverId}, 類型: ${params.type}`);
      return true;
    } catch (error) {
      console.error("建立通知失敗:", error);
      return false;
    }
  }

  /**
   * 批量建立通知
   */
  static async createBatchNotifications(params: BatchNotificationParams): Promise<boolean> {
    try {
      if (params.receiverIds.length === 0) {
        console.log("沒有接收者，跳過通知發送");
        return true;
      }

      // 分批處理，每批最多 1000 個用戶，避免資料庫負載過大
      const BATCH_SIZE = 1000;
      const batches = this.chunkArray(params.receiverIds, BATCH_SIZE);
      
      console.log(`開始批量發送通知 - 總接收者: ${params.receiverIds.length}, 分為 ${batches.length} 批`);

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const notificationData = batch.map(receiverId => ({
          receiverId,
          title: params.title,
          message: params.message,
          type: params.type,
        }));

        await dbClient.insert(notifications).values(notificationData);
        console.log(`第 ${i + 1}/${batches.length} 批通知已發送 (${batch.length} 個接收者)`);
      }
      
      console.log(`批量通知發送完成 - 總數: ${params.receiverIds.length}, 類型: ${params.type}`);
      return true;
    } catch (error) {
      console.error("批量建立通知失敗:", error);
      return false;
    }
  }

  /**
   * 將陣列分割成指定大小的批次
   */
  private static chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * 工作申請相關通知
   */
  static async notifyApplicationReceived(
    employerId: string,
    workerName: string,
    gigTitle: string,
  ): Promise<boolean> {
    return this.createNotification({
      receiverId: employerId,
      title: "收到新的工作申請",
      message: `${workerName} 申請了您的工作「${gigTitle}」，請及時處理。`,
      type: "application_received",
    });
  }

  static async notifyApplicationApproved(
    workerId: string,
    gigTitle: string,
    employerName: string,
  ): Promise<boolean> {
    return this.createNotification({
      receiverId: workerId,
      title: "工作申請已通過",
      message: `恭喜！您申請的工作「${gigTitle}」已被 ${employerName} 核准。`,
      type: "application_approved",
    });
  }

  static async notifyApplicationRejected(
    workerId: string,
    gigTitle: string,
    employerName: string,
    reason?: string
  ): Promise<boolean> {
    const message = reason 
      ? `很抱歉，您申請的工作「${gigTitle}」被 ${employerName} 拒絕。原因：${reason}`
      : `很抱歉，您申請的工作「${gigTitle}」被 ${employerName} 拒絕。`;

    return this.createNotification({
      receiverId: workerId,
      title: "工作申請未通過",
      message,
      type: "application_rejected",
    });
  }

  /**
   * 評價相關通知
   */
  static async notifyRatingReceived(
    receiverId: string,
    raterName: string,
    rating: number,
  ): Promise<boolean> {
    return this.createNotification({
      receiverId,
      title: "收到新評價",
      message: `${raterName} 給了您 ${rating} 星評價，快去查看吧！`,
      type: "rating_received",
    });
  }

  /**
   * 工作刊登相關通知
   */
  static async notifyGigPublished(
    employerId: string,
    gigTitle: string,
  ): Promise<boolean> {
    return this.createNotification({
      receiverId: employerId,
      title: "工作刊登成功",
      message: `您的工作「${gigTitle}」已成功刊登，等待打工者申請中。`,
      type: "gig_published",
    });
  }

  /**
   * 帳戶審核相關通知
   */
  static async notifyAccountApproved(
    userId: string,
    accountName: string
  ): Promise<boolean> {
    return this.createNotification({
      receiverId: userId,
      title: "帳戶審核通過",
      message: `恭喜！您的帳戶「${accountName}」已通過審核，現在可以開始使用所有功能。`,
      type: "account_approved",
    });
  }

  static async notifyAccountRejected(
    userId: string,
    accountName: string,
    reason?: string
  ): Promise<boolean> {
    const message = reason 
      ? `很抱歉，您的帳戶「${accountName}」審核未通過。原因：${reason}`
      : `很抱歉，您的帳戶「${accountName}」審核未通過，請聯繫客服了解詳情。`;

    return this.createNotification({
      receiverId: userId,
      title: "帳戶審核未通過",
      message,
      type: "account_rejected",
    });
  }

  /**
   * 系統公告通知
   */
  static async notifySystemAnnouncement(
    receiverIds: string[],
    title: string,
    message: string
  ): Promise<boolean> {
    return this.createBatchNotifications({
      receiverIds,
      title,
      message,
      type: "system_announcement",
    });
  }

  /**
   * 用戶註冊歡迎通知
   */
  static async notifyUserWelcome(
    userId: string,
    userName: string,
    userType: "worker" | "employer"
  ): Promise<boolean> {
    const welcomeMessages = {
      worker: {
        title: "歡迎加入打工平台！",
        message: `${userName}，歡迎您加入我們的打工平台！您現在可以開始瀏覽和申請工作機會。`
      },
      employer: {
        title: "歡迎加入商家平台！",
        message: `${userName}，歡迎您加入我們的平台！您的帳戶正在審核中，審核通過後即可開始發佈工作。`
      }
    };

    const { title, message } = welcomeMessages[userType];

    return this.createNotification({
      receiverId: userId,
      title,
      message,
      type: "user_welcome"
    });
  }

  /**
   * 獲取用戶群組
   */
  private static async getUserGroups(): Promise<{
    workers: string[];
    employers: string[];
    admins: string[];
  }> {
    try {
      const [workers, employers, admins] = await Promise.all([
        dbClient.query.workers.findMany({ columns: { workerId: true } }),
        dbClient.query.employers.findMany({ columns: { employerId: true } }),
        dbClient.query.admins.findMany({ columns: { adminId: true } })
      ]);

      return {
        workers: workers.map(w => w.workerId),
        employers: employers.map(e => e.employerId),
        admins: admins.map(a => a.adminId)
      };
    } catch (error) {
      console.error("獲取用戶群組失敗:", error);
      return { workers: [], employers: [], admins: [] };
    }
  }

  /**
   * 發送通知給指定用戶群組
   */
  static async notifyUserGroups(
    userGroups: {
      workers?: boolean;
      employers?: boolean;
      admins?: boolean;
    },
    title: string,
    message: string,
    type: NotificationType = "system_announcement"
  ): Promise<boolean> {
    try {
      const { workers, employers, admins } = await this.getUserGroups();
      const targetUsers: string[] = [];

      // 根據選擇的群組添加用戶ID
      if (userGroups.workers) targetUsers.push(...workers);
      if (userGroups.employers) targetUsers.push(...employers);
      if (userGroups.admins) targetUsers.push(...admins);

      if (targetUsers.length === 0) {
        console.log("沒有找到符合條件的用戶");
        return true;
      }

      // 批量發送通知
      const success = await this.createBatchNotifications({
        receiverIds: targetUsers,
        title,
        message,
        type,
      });

      if (success) {
        const groupNames = [];
        if (userGroups.workers) groupNames.push(`${workers.length} 名打工者`);
        if (userGroups.employers) groupNames.push(`${employers.length} 名商家`);
        if (userGroups.admins) groupNames.push(`${admins.length} 名管理員`);
        
        console.log(`通知已發送給 ${groupNames.join("、")}`);
      }

      return success;
    } catch (error) {
      console.error("發送群組通知失敗:", error);
      return false;
    }
  }
}

export default NotificationHelper; 