import redisClient from "../Client/RedisClient";

export class PasswordResetManager {
  private static readonly EXPIRY_TIME = 30 * 60; // 30 分鐘（秒）

  /**
   * 生成 6 位數字驗證碼
   */
  static generateVerificationCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * 儲存驗證碼
   */
  static async storeVerificationCode(email: string): Promise<string> {
    try {
      const code = this.generateVerificationCode();
      const resetKey = `password_reset:${email}`;
      const requestKey = `password_reset_request:${email}`;

      const pipeline = redisClient.pipeline();
      pipeline.setex(resetKey, this.EXPIRY_TIME, code); // 儲存驗證碼
      pipeline.setex(requestKey, 60, "1"); // 設置請求冷卻時間
      await pipeline.exec();
      
      return code;
    } catch (error) {
      console.error("Failed to store verification code with cooldown:", error);
      throw new Error("無法生成驗證碼");
    }
  }

  /**
   * 驗證碼驗證
   */
  static async verifyCode(email: string, code: string): Promise<boolean> {
    try {
      const key = `password_reset:${email}`;
      const storedCode = await redisClient.get(key);
      
      return storedCode === code;
    } catch (error) {
      console.error("Failed to verify code:", error);
      return false;
    }
  }

  /**
   * 刪除驗證碼
   */
  static async deleteVerificationCode(email: string): Promise<void> {
    try {
      const key = `password_reset:${email}`;
      await redisClient.unlink(key);
    } catch (error) {
      console.error("Failed to delete verification code:", error);
    }
  }

  /**
   * 設置請求冷卻時間
   */
  static async setRequestCooldown(email: string): Promise<void> {
    try {
      const requestKey = `password_reset_request:${email}`;
      await redisClient.setex(requestKey, 60, "1");
    } catch (error) {
      console.error("Failed to set request cooldown:", error);
    }
  }

  /**
   * 獲取密碼重設狀態
   */
  static async getResetStatus(email: string): Promise<{
    hasActiveCode: boolean;
    canRequestNew: boolean;
    remainingCodeTime: number;
    remainingCooldownTime: number;
  }> {
    try {
      const resetKey = `password_reset:${email}`;
      const requestKey = `password_reset_request:${email}`;

      const pipeline = redisClient.pipeline();
      pipeline.exists(resetKey); // 檢查是否有有效的驗證碼
      pipeline.ttl(resetKey); // 獲取驗證碼剩餘時間
      pipeline.exists(requestKey); // 檢查是否在冷卻期
      pipeline.ttl(requestKey); // 獲取冷卻剩餘時間

      const results = await pipeline.exec();
      
      if (!results || results.length !== 4) {
        throw new Error("Pipeline execution failed");
      }

      const hasActiveCode = (results[0][1] as number) === 1;
      const remainingCodeTime = Math.max(0, (results[1][1] as number) || 0);
      const inCooldown = (results[2][1] as number) === 1;
      const remainingCooldownTime = Math.max(0, (results[3][1] as number) || 0);
      const canRequestNew = !inCooldown;

      return {
        hasActiveCode,
        canRequestNew,
        remainingCodeTime,
        remainingCooldownTime,
      };
    } catch (error) {
      console.error("Failed to get reset status:", error);
      return {
        hasActiveCode: false,
        canRequestNew: true,
        remainingCodeTime: 0,
        remainingCooldownTime: 0,
      };
    }
  }
}
