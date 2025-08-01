import { CacheManager } from "./CacheManager";
import { CACHE_PREFIXES, CACHE_TTL } from "./CacheConfig";

// 用戶相關快取
export class UserCache {
  /**
   * 獲取用戶資料快取
   */
  static async getUserProfile(userId: string, role: string): Promise<any | null> {
    const key = `${CACHE_PREFIXES.USER_PROFILE}${role}_${userId}`;
    return await CacheManager.get(key);
  }

  /**
   * 設定用戶資料快取
   */
  static async setUserProfile(userId: string, role: string, userData: any): Promise<void> {
    const key = `${CACHE_PREFIXES.USER_PROFILE}${role}_${userId}`;
    await CacheManager.set(key, userData, CACHE_TTL.USER_PROFILE);
  }

  /**
   * 清除用戶資料快取
   */
  static async clearUserProfile(userId: string, role: string): Promise<void> {
    const key = `${CACHE_PREFIXES.USER_PROFILE}${role}_${userId}`;
    await CacheManager.delete(key);
  }
}
