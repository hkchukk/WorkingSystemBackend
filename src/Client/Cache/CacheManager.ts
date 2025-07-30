import redisClient from "../RedisClient.ts";

// 通用快取類
export class CacheManager {
	/**
	 * 獲取快取資料
	 */
	static async get<T>(key: string): Promise<T | null> {
		try {
			const cachedData = await redisClient.get(key);
			if (!cachedData) {
				return null;
			}
			return JSON.parse(cachedData) as T;
		} catch (error) {
			console.error(`獲取快取失敗 ${key}:`, error);
			return null;
		}
	}

	/**
	 * 設定快取資料
	 */
	static async set(key: string, data: any, ttl: number): Promise<void> {
		try {
			await redisClient.setex(key, ttl, JSON.stringify(data));
		} catch (error) {
			console.error(`設定快取失敗 ${key}:`, error);
		}
	}

	/**
	 * 刪除快取
	 */
	static async delete(key: string): Promise<void> {
		try {
			await redisClient.unlink(key);
		} catch (error) {
			console.error(`刪除快取失敗 ${key}:`, error);
		}
	}

	/**
	 * 刪除符合的所有快取
	 */
	static async deletePattern(pattern: string): Promise<void> {
		try {
			const keys = await redisClient.keys(pattern);
			if (keys.length > 0) {
				await redisClient.unlink(...keys);
				console.log(`已刪除 ${keys.length} 個快取項目: ${pattern}`);
			}
		} catch (error) {
			console.error(`刪除模式快取失敗 ${pattern}:`, error);
		}
	}

	/**
	 * 批量設定快取
	 */
	static async setMultiple(items: Array<{ key: string; data: any; ttl: number }>): Promise<void> {
		try {
			const pipeline = redisClient.pipeline();
			for (const item of items) {
				pipeline.setex(item.key, item.ttl, JSON.stringify(item.data));
			}
			await pipeline.exec();
		} catch (error) {
			console.error('批量設定快取失敗:', error);
		}
	}

	/**
	 * 批量獲取快取
	 */
	static async getMultiple<T>(keys: string[]): Promise<Record<string, T | null>> {
		try {
			const results = await redisClient.mget(...keys);
			const output: Record<string, T | null> = {};
			
			keys.forEach((key, index) => {
				const value = results[index];
				output[key] = value ? JSON.parse(value) as T : null;
			});
			
			return output;
		} catch (error) {
			console.error('批量獲取快取失敗:', error);
			return keys.reduce((acc, key) => ({ ...acc, [key]: null }), {});
		}
	}
}
