import Redis from "ioredis";

// 創建 Redis 客戶端
const redisClient = new Redis({
	maxRetriesPerRequest: 3,
	lazyConnect: true,
	host:"0.0.0.0",
	port: 6379,
});

// 連接事件處理
redisClient.on("connect", () => {
	console.log("✅ Redis 連接成功");
});

redisClient.on("error", (error) => {
	console.error("❌ Redis 連接錯誤:", error);
});

redisClient.on("close", () => {
	console.log("⚠️ Redis 連接已關閉");
});

// Presigned URL 快取類
export class PresignedUrlCache {
	private static readonly PREFIX = "presigned:";
	private static readonly DEFAULT_TTL = 3300; // 55 分鐘 (3300 秒)

	/**
	 * 獲取快取的 presigned URL
	 */
	static async get(filename: string): Promise<string | null> {
		try {
			const key = this.PREFIX + filename;
			const cachedData = await redisClient.get(key);
			
			if (!cachedData) {
				return null;
			}

			const data = JSON.parse(cachedData);
			const now = Date.now();

			// 檢查是否即將過期（提前 5 分鐘重新生成）
			if (data.expiresAt - now < 300000) {
				console.log(`Presigned URL ${filename} 即將過期，需要重新生成`);
				return null;
			}

			return data.url;
		} catch (error) {
			console.error(`獲取快取的 presigned URL 失敗 ${filename}:`, error);
			return null;
		}
	}

	/**
	 * 設定快取的 presigned URL
	 */
	static async set(filename: string, url: string, expiresIn: number = 3600): Promise<void> {
		try {
			const key = this.PREFIX + filename;
			const expiresAt = Date.now() + (expiresIn * 1000);
			
			const data = {
				url,
				expiresAt,
				createdAt: Date.now(),
			};

			// 設定快取，TTL 比 presigned URL 短 5 分鐘，確保不會返回過期的 URL
			await redisClient.setex(key, this.DEFAULT_TTL, JSON.stringify(data));
			
			console.log(`已快取 presigned URL: ${filename} (過期時間: ${new Date(expiresAt).toISOString()})`);
		} catch (error) {
			console.error(`設定快取的 presigned URL 失敗 ${filename}:`, error);
		}
	}

	/**
	 * 刪除特定檔案的快取
	 */
	static async delete(filename: string): Promise<void> {
		try {
			const key = this.PREFIX + filename;
			await redisClient.del(key);
			console.log(`已刪除 presigned URL 快取: ${filename}`);
		} catch (error) {
			console.error(`刪除快取失敗 ${filename}:`, error);
		}
	}
}

export default redisClient;