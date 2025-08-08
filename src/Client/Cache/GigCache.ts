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

  /**
   * 取得雇主的工作 Count 快取
   */
  static async getMyGigsCount(employerId: string, status: string): Promise<number | null> {
    const key = `${CACHE_PREFIXES.MY_GIGS_COUNT}${employerId}:${status}`;
    const cached = await CacheManager.get<{ totalCount: number }>(key);
    return cached?.totalCount ?? null;
  }

  /**
   * 設定雇主工作 Count 快取
   */
  static async setMyGigsCount(employerId: string, status: string, totalCount: number): Promise<void> {
    const key = `${CACHE_PREFIXES.MY_GIGS_COUNT}${employerId}:${status}`;
    await CacheManager.set(key, { totalCount, updatedAt: new Date().toISOString() }, CACHE_TTL.MY_GIGS_COUNT);
  }

  /**
   * 清除雇主工作 Count 快取
   */
  static async clearMyGigsCount(employerId: string): Promise<void> {
    await CacheManager.deletePattern(`${CACHE_PREFIXES.MY_GIGS_COUNT}${employerId}:*`);
  }
}
