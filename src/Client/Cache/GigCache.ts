import { CacheManager } from "./CacheManager";
import { CACHE_PREFIXES, CACHE_TTL } from "./CacheConfig";

// 工作相關快取
export class GigCache {
  /**
   * 獲取工作列表快取
   */
  static async getGigList(filters: string, page: number = 1): Promise<any | null> {
    const key = `${CACHE_PREFIXES.GIG_LIST}${filters}_${page}`;
    return await CacheManager.get(key);
  }

  /**
   * 設定工作列表快取
   */
  static async setGigList(filters: string, page: number, data: any): Promise<void> {
    const key = `${CACHE_PREFIXES.GIG_LIST}${filters}_${page}`;
    await CacheManager.set(key, data, CACHE_TTL.GIG_LIST);
  }
}
