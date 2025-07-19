import dbClient from "../Client/DrizzleClient.ts";
import { notifications, workers, employers, admins } from "../Schema/DatabaseSchema.ts";

// 通知類型定義
export type NotificationType = 
  | "application_received" | "application_approved" | "application_rejected"
  | "rating_received" | "gig_published" | "gig_expired"
  | "account_approved" | "account_rejected" | "user_welcome"
  | "system_announcement" | "other";

interface NotificationParams {
  receiverId: string;
  title: string;
  message: string;
  type: NotificationType;
}

class NotificationHelper {
  
  // 通知模板定義
  private static readonly TEMPLATES = {
    application_received: (workerName: string, gigTitle: string) => ({
      title: "收到新的工作申請",
      message: `${workerName} 申請了您的工作「${gigTitle}」，請及時處理。`
    }),
    application_approved: (gigTitle: string, employerName: string) => ({
      title: "工作申請已通過",
      message: `恭喜！您申請的工作「${gigTitle}」已被 ${employerName} 核准。`
    }),
    application_rejected: (gigTitle: string, employerName: string, reason?: string) => ({
      title: "工作申請未通過",
      message: reason 
        ? `很抱歉，您申請的工作「${gigTitle}」被 ${employerName} 拒絕。原因：${reason}`
        : `很抱歉，您申請的工作「${gigTitle}」被 ${employerName} 拒絕。`
    }),
    rating_received: (raterName: string, rating: number) => ({
      title: "收到新評價",
      message: `${raterName} 給了您 ${rating} 星評價，快去查看吧！`
    }),
    gig_published: (gigTitle: string) => ({
      title: "工作刊登成功",
      message: `您的工作「${gigTitle}」已成功刊登，等待打工者申請中。`
    }),
    account_approved: (accountName: string) => ({
      title: "帳戶審核通過",
      message: `恭喜！您的帳戶「${accountName}」已通過審核，現在可以開始使用所有功能。`
    }),
    account_rejected: (accountName: string, reason?: string) => ({
      title: "帳戶審核未通過",
      message: reason
        ? `很抱歉，您的帳戶「${accountName}」審核未通過。原因：${reason}`
        : `很抱歉，您的帳戶「${accountName}」審核未通過，請聯繫客服了解詳情。`
    }),
    user_welcome: (userName: string, userType: "worker" | "employer") => ({
      title: userType === "worker" ? "歡迎加入打工平台！" : "歡迎加入商家平台！",
      message: userType === "worker"
        ? `${userName}，歡迎您加入我們的打工平台！您現在可以開始瀏覽和申請工作機會。`
        : `${userName}，歡迎您加入我們的平台！您的帳戶正在審核中，審核通過後即可開始發佈工作。`
    })
  } as const;
  
  /**
   * 建立單一通知
   */
  static async create(params: NotificationParams): Promise<boolean> {
    try {
      await dbClient.insert(notifications).values(params);
      return true;
    } catch (error) {
      console.error("建立通知失敗:", error);
      return false;
    }
  }

  /**
   * 批量建立通知
   */
  static async createBatch(receiverIds: string[], params: Omit<NotificationParams, 'receiverId'>): Promise<boolean> {
    if (receiverIds.length === 0) return true;

    try {
      const BATCH_SIZE = 1000;
      
      // 序列處理批次
      for (let i = 0; i < receiverIds.length; i += BATCH_SIZE) {
        const batch = receiverIds.slice(i, i + BATCH_SIZE);
        const data = batch.map(receiverId => ({ receiverId, ...params }));
        await dbClient.insert(notifications).values(data);
        
        // 如果還有更多批次，稍微等待避免壓力過大
        if (i + BATCH_SIZE < receiverIds.length) {
          await new Promise(resolve => setTimeout(resolve, 10)); // 10ms 延遲
        }
      }
      return true;
    } catch (error) {
      console.error("批量建立通知失敗:", error);
      return false;
    }
  }

  /**
   * 使用模板創建通知
   */
  private static async createFromTemplate(
    receiverId: string,
    templateKey: keyof typeof NotificationHelper.TEMPLATES,
    ...args: any[]
  ): Promise<boolean> {
    const { title, message } = (this.TEMPLATES[templateKey] as any)(...args);
    return this.create({ receiverId, title, message, type: templateKey as NotificationType });
  }

  // ========== 具體通知方法 ==========
  static async notifyApplicationReceived(employerId: string, workerName: string, gigTitle: string) {
    return this.createFromTemplate(employerId, "application_received", workerName, gigTitle);
  }

  static async notifyApplicationApproved(workerId: string, gigTitle: string, employerName: string) {
    return this.createFromTemplate(workerId, "application_approved", gigTitle, employerName);
  }

  static async notifyApplicationRejected(workerId: string, gigTitle: string, employerName: string, reason?: string) {
    return this.createFromTemplate(workerId, "application_rejected", gigTitle, employerName, reason);
  }

  static async notifyRatingReceived(receiverId: string, raterName: string, rating: number) {
    return this.createFromTemplate(receiverId, "rating_received", raterName, rating);
  }

  static async notifyGigPublished(employerId: string, gigTitle: string) {
    return this.createFromTemplate(employerId, "gig_published", gigTitle);
  }

  static async notifyAccountApproved(userId: string, accountName: string) {
    return this.createFromTemplate(userId, "account_approved", accountName);
  }

  static async notifyAccountRejected(userId: string, accountName: string, reason?: string) {
    return this.createFromTemplate(userId, "account_rejected", accountName, reason);
  }

  static async notifyUserWelcome(userId: string, userName: string, userType: "worker" | "employer") {
    return this.createFromTemplate(userId, "user_welcome", userName, userType);
  }

  /**
   * 獲取用戶群組ID列表
   */
  private static async getUserGroups(groups: { workers?: boolean; employers?: boolean; admins?: boolean }): Promise<string[]> {
    try {
      // 檢查是否有任何群組被指定
      const hasGroups = groups.workers || groups.employers || groups.admins;
      
      if (!hasGroups) {
        return [];
      }

      // 構建 UNIONALL 查詢
      let unionQuery: any = undefined;

      if (groups.workers) {
        unionQuery = dbClient.select({
          id: workers.workerId
        }).from(workers);
      }

      if (groups.employers) {
        const employerQuery = dbClient.select({
          id: employers.employerId
        }).from(employers);
        
        if (unionQuery) {
          unionQuery = unionQuery.unionAll(employerQuery);
        } else {
          unionQuery = employerQuery;
        }
      }

      if (groups.admins) {
        const adminQuery = dbClient.select({
          id: admins.adminId
        }).from(admins);
        
        if (unionQuery) {
          unionQuery = unionQuery.unionAll(adminQuery);
        } else {
          unionQuery = adminQuery;
        }
      }

      const results = await unionQuery;
      return results.map((result: { id: any; }) => result.id);
    } catch (error) {
      console.error("獲取用戶群組失敗:", error);
      return [];
    }
  }

  /**
   * 發送通知給指定用戶群組
   */
  static async notifyUserGroups(
    groups: { workers?: boolean; employers?: boolean; admins?: boolean },
    title: string,
    message: string,
    type: NotificationType
  ) {
    const targetUsers = await this.getUserGroups(groups);
    return this.createBatch(targetUsers, { title, message, type });
  }
}

export default NotificationHelper; 