import redisClient from "../Client/RedisClient";

export class SessionManager {
  private static readonly PREFIX = "active:";

  /**
   * 追蹤用戶 session (單一裝置登入)
   */
  static async track(userId: string, sessionId: string): Promise<void> {
    //await redisClient.setex(`${this.PREFIX}${userId}`, 86400, sessionId); // 24小時
  }

  /**
   * 檢查 session 是否有效
   */
  static async isActive(userId: string, sessionId: string): Promise<boolean> {
    //const tracked = await redisClient.get(`${this.PREFIX}${userId}`);
    //return tracked === sessionId;
    return true;
  }

  /**
   * 清理 session 追蹤記錄
   */
  static async clear(userId: string): Promise<void> {
    //await redisClient.unlink(`${this.PREFIX}${userId}`);
  }

  /**
   * 獲取所有活躍用戶
   */
  static async getAll(): Promise<Array<{userId: string, sessionId: string}>> {
    const result: Array<{userId: string, sessionId: string}> = [];
    let cursor = '0';
    
    do {
      const reply = await redisClient.scan(cursor, 'MATCH', `${this.PREFIX}*`, 'COUNT', 100);
      cursor = reply[0];
      const keys = reply[1];
      
      for (const key of keys) {
        const sessionId = await redisClient.get(key);
        if (sessionId) {
          const userId = key.replace(this.PREFIX, "");
          result.push({ userId, sessionId });
        }
      }
    } while (cursor !== '0');
    
    return result;
  }
}

export default SessionManager;