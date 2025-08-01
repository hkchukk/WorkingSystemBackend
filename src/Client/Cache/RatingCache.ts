import { CacheManager } from "./CacheManager";
import { CACHE_PREFIXES, CACHE_TTL } from "./CacheConfig";

export interface RatingStats {
  totalRatings: number;
  averageRating: number;
}

// 評價相關快取
export class RatingCache {
  /**
   * 獲取評價統計快取
   */
  static async getRatingStats(targetId: string, type: 'worker' | 'employer'): Promise<RatingStats | null> {
    const key = `${CACHE_PREFIXES.RATING_STATS}${type}_${targetId}`;
    return await CacheManager.get<RatingStats>(key);
  }

  /**
   * 設定評價統計快取
   */
  static async setRatingStats(targetId: string, type: 'worker' | 'employer', stats: RatingStats): Promise<void> {
    const key = `${CACHE_PREFIXES.RATING_STATS}${type}_${targetId}`;
    await CacheManager.set(key, stats, CACHE_TTL.RATING_STATS);
  }

  /**
   * 清除評價統計快取
   */
  static async clearRatingStats(targetId: string, type: 'worker' | 'employer'): Promise<void> {
    const key = `${CACHE_PREFIXES.RATING_STATS}${type}_${targetId}`;
    await CacheManager.delete(key);
  }
}
