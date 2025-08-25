import redisClient from "../Client/RedisClient";

export class LoginAttemptManager {
  private static readonly MAX_ATTEMPTS = 3;
  private static readonly LOCKOUT_DURATION = 5 * 60; // 5 分鐘（秒）

  /**
   * 生成鎖定鍵值
   */
  private static generateKey(platform: string, email: string, ip: string, type: 'attempts' | 'locked'): string {
    return `login_${type}:${platform}:${email}:${ip}`;
  }

  /**
   * 獲取用戶登錄失敗次數
   */
  static async getFailedAttempts(platform: string, email: string, ip: string): Promise<number> {
    try {
      const key = this.generateKey(platform, email, ip, 'attempts');
      const attempts = await redisClient.get(key);
      return attempts ? parseInt(attempts) : 0;
    } catch (error) {
      console.error("Failed to get login attempts:", error);
      return 0;
    }
  }

  /**
   * 記錄登錄失敗
   */
  static async recordFailedAttempt(platform: string, email: string, ip: string): Promise<{ isLocked: boolean; attemptsLeft: number }> {
    try {
      const currentAttempts = await this.getFailedAttempts(platform, email, ip);
      const newAttempts = currentAttempts + 1;
      const pipeline = redisClient.pipeline();
      const attemptsKey = this.generateKey(platform, email, ip, 'attempts');
      pipeline.setex(attemptsKey, this.LOCKOUT_DURATION, newAttempts.toString());

      if (newAttempts >= this.MAX_ATTEMPTS) {
        const lockedKey = this.generateKey(platform, email, ip, 'locked');
        pipeline.setex(lockedKey, this.LOCKOUT_DURATION, "1");
      }

      await pipeline.exec();

      if (newAttempts >= this.MAX_ATTEMPTS) {
        return { isLocked: true, attemptsLeft: 0 };
      }

      return { isLocked: false, attemptsLeft: this.MAX_ATTEMPTS - newAttempts };
    } catch (error) {
      console.error("Failed to record failed attempt:", error);
      return { isLocked: false, attemptsLeft: this.MAX_ATTEMPTS };
    }
  }

  /**
   * 清除登錄失敗記錄
   */
  static async clearFailedAttempts(platform: string, email: string, ip: string): Promise<void> {
    try {
      const pipeline = redisClient.pipeline();
      const attemptsKey = this.generateKey(platform, email, ip, 'attempts');
      const lockedKey = this.generateKey(platform, email, ip, 'locked');
      pipeline.unlink(attemptsKey);
      pipeline.unlink(lockedKey);
      await pipeline.exec();
    } catch (error) {
      console.error("Failed to clear failed attempts:", error);
    }
  }

  /**
   * 獲取用戶登錄狀態
   */
  static async getLoginStatus(platform: string, email: string, ip: string): Promise<{
    isLocked: boolean;
    failedAttempts: number;
    attemptsLeft: number;
    remainingLockTime: number;
  }> {
    try {
      const attemptsKey = this.generateKey(platform, email, ip, 'attempts');
      const lockedKey = this.generateKey(platform, email, ip, 'locked');

      const pipeline = redisClient.pipeline();
      pipeline.exists(lockedKey);
      pipeline.get(attemptsKey);
      pipeline.ttl(lockedKey);

      const results = await pipeline.exec();
      
      if (!results || results.length !== 3) {
        throw new Error("Pipeline execution failed");
      }

      const isLocked = (results[0][1] as number) === 1;
      const failedAttempts = parseInt((results[1][1] as string) || "0");
      const ttl = (results[2][1] as number) || 0;
      const remainingLockTime = ttl > 0 ? ttl : 0;
      const attemptsLeft = Math.max(0, this.MAX_ATTEMPTS - failedAttempts);

      return {
        isLocked,
        failedAttempts,
        attemptsLeft,
        remainingLockTime,
      };
    } catch (error) {
      console.error("Failed to get login status:", error);
      return {
        isLocked: false,
        failedAttempts: 0,
        attemptsLeft: this.MAX_ATTEMPTS,
        remainingLockTime: 0,
      };
    }
  }
}