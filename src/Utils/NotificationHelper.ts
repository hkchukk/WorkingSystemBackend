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

  // ========== 具體通知方法 ==========
  static async notifyApplicationReceived(employerId: string, workerName: string, gigTitle: string) {
    return this.create({
      receiverId: employerId,
      title: "收到新的工作申請",
      message: `${workerName} 申請了您的工作「${gigTitle}」，請及時處理。`,
      type: "application_received"
    });
  }

  static async notifyApplicationApproved(workerId: string, gigTitle: string, employerName: string) {
    return this.create({
      receiverId: workerId,
      title: "工作申請已通過",
      message: `恭喜！您申請的工作「${gigTitle}」已被 ${employerName} 核准。`,
      type: "application_approved"
    });
  }

  static async notifyApplicationRejected(workerId: string, gigTitle: string, employerName: string, reason?: string) {
    const message = reason 
      ? `很抱歉，您申請的工作「${gigTitle}」被 ${employerName} 拒絕。原因：${reason}`
      : `很抱歉，您申請的工作「${gigTitle}」被 ${employerName} 拒絕。`;
    
    return this.create({
      receiverId: workerId,
      title: "工作申請未通過",
      message,
      type: "application_rejected"
    });
  }

  static async notifyRatingReceived(receiverId: string, raterName: string, rating: number) {
    return this.create({
      receiverId,
      title: "收到新評價",
      message: `${raterName} 給了您 ${rating} 星評價，快去查看吧！`,
      type: "rating_received"
    });
  }

  static async notifyGigPublished(employerId: string, gigTitle: string) {
    return this.create({
      receiverId: employerId,
      title: "工作刊登成功",
      message: `您的工作「${gigTitle}」已成功刊登，等待打工者申請中。`,
      type: "gig_published"
    });
  }

  static async notifyAccountApproved(userId: string, accountName: string) {
    return this.create({
      receiverId: userId,
      title: "帳戶審核通過",
      message: `恭喜！您的帳戶「${accountName}」已通過審核，現在可以開始使用所有功能。`,
      type: "account_approved"
    });
  }

  static async notifyAccountRejected(userId: string, accountName: string, reason?: string) {
    const message = reason
      ? `很抱歉，您的帳戶「${accountName}」審核未通過。原因：${reason}`
      : `很抱歉，您的帳戶「${accountName}」審核未通過，請聯繫客服了解詳情。`;
    
    return this.create({
      receiverId: userId,
      title: "帳戶審核未通過",
      message,
      type: "account_rejected"
    });
  }

  static async notifyUserWelcome(userId: string, userName: string, userType: "worker" | "employer") {
    const title = userType === "worker" ? "歡迎加入打工平台！" : "歡迎加入商家平台！";
    const message = userType === "worker"
      ? `${userName}，歡迎您加入我們的打工平台！您現在可以開始瀏覽和申請工作機會。`
      : `${userName}，歡迎您加入我們的平台！您的帳戶正在審核中，審核通過後即可開始發佈工作。`;
    
    return this.create({
      receiverId: userId,
      title,
      message,
      type: "user_welcome"
    });
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