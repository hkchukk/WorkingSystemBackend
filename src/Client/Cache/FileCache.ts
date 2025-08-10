import { S3Client } from "bun";
import { CacheManager } from "./CacheManager";
import { CACHE_PREFIXES, CACHE_TTL } from "./CacheConfig";

// S3 客戶端配置
export const s3Client = new S3Client({
  region: "auto",
  accessKeyId: process.env.R2ACCESSKEYID!,
  secretAccessKey: process.env.R2SECRETACCESSKEY!,
  endpoint: process.env.R2ENDPOINT!,
  bucket: "backend-files",
  retry: 1,
});

// 檔案管理工具類
export class FileManager {
  private static readonly PREFIX = CACHE_PREFIXES.PRESIGNED_URL;
  private static readonly DEFAULT_TTL = CACHE_TTL.PRESIGNED_URL;

  /**
   * 獲取或生成預簽名 URL
   * 如果快取中存在，返回快取的 URL
   * 否則生成新的預簽名 URL 並快取
   */
  static async getPresignedUrl(filePath: string, expiresIn = this.DEFAULT_TTL): Promise<string | null> {
    if (!filePath) {
      console.warn("getPresignedUrl called with empty filePath");
      return null;
    }

    if (typeof filePath !== 'string' || filePath.trim() === '') {
      console.warn(`getPresignedUrl called with invalid filePath: ${typeof filePath} - "${filePath}"`);
      return null;
    }

    try {
      // 檢查快取
      const key = this.PREFIX + filePath;
      const cachedUrl = await CacheManager.get<string>(key);

      if (cachedUrl) {
        return cachedUrl;
      }

      // 生成新的預簽名 URL
      const finalUrl = s3Client.presign(filePath, { expiresIn });

      if (!finalUrl || typeof finalUrl !== 'string') {
        console.error(`❌ 生成 presigned URL 失敗，返回值無效: ${filePath}`);
        return null;
      }

      // 快取新生成的 URL
      await CacheManager.set(key, finalUrl, this.DEFAULT_TTL);
      console.log(`✅ 已生成並快取 presigned URL: ${filePath}`);

      return finalUrl;
    } catch (error) {
      console.error(`❌ 生成 presigned URL 時發生錯誤: ${filePath}`, {
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined
      });
      return null;
    }
  }

  /**
   * 刪除特定檔案的快取
   */
  static async deleteCache(filename: string): Promise<void> {
    try {
      const key = this.PREFIX + filename;
      await CacheManager.delete(key);
      console.log(`✅ 已刪除 presigned URL 快取: ${filename}`);
    } catch (error) {
      console.error(`❌ 刪除快取失敗 ${filename}:`, error);
    }
  }

  /**
   * 批量刪除檔案快取
   */
  static async deleteBatchCache(filenames: string[]): Promise<void> {
    const deletePromises = filenames.map(filename => this.deleteCache(filename));
    await Promise.all(deletePromises);
  }
}
