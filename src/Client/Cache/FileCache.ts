import { S3Client } from "bun";
import { CacheManager } from "./CacheManager.ts";
import { CACHE_PREFIXES, CACHE_TTL } from "./CacheConfig.ts";

// S3 客戶端配置
export const s3Client = new S3Client({
  region: "auto",
  accessKeyId: process.env.R2ACCESSKEYID,
  secretAccessKey: process.env.R2SECRETACCESSKEY,
  endpoint: process.env.R2ENDPOINT,
  bucket: "backend-files",
  retry: 1,
});

export const R2_BUCKET_NAME = "backend-files";

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

    try {
      // 檢查快取
      const key = this.PREFIX + filePath;
      const cachedUrl = await CacheManager.get<string>(key);

      if (cachedUrl) {
        return cachedUrl;
      }

      // 生成新的預簽名 URL
      const signedRequestResult = await (s3Client as any).presign(filePath, {
        expires: expiresIn,
      });

      const finalUrl = typeof signedRequestResult === "object" && signedRequestResult.url 
        ? signedRequestResult.url 
        : signedRequestResult;

      if (!finalUrl) {
        console.error(`Failed to generate presigned URL for ${filePath}`);
        return null;
      }

      // 快取新生成的 URL
      await CacheManager.set(key, finalUrl, this.DEFAULT_TTL);
      console.log(`已生成並快取 presigned URL: ${filePath}`);

      return finalUrl;
    } catch (error) {
      console.error(`Error getting presigned URL for ${filePath}:`, error);
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
      console.log(`已刪除 presigned URL 快取: ${filename}`);
    } catch (error) {
      console.error(`刪除快取失敗 ${filename}:`, error);
    }
  }

  /**
   * 批量刪除檔案快取
   */
  static async deleteBatchCache(filenames: string[]): Promise<void> {
    const deletePromises = filenames.map(filename => this.deleteCache(filename));
    await Promise.all(deletePromises);
  }

  /**
   * 清理臨時文件
   * @param uploadedFiles 上傳的文件陣列
   */
  static async cleanupTempFiles(uploadedFiles: any[]): Promise<void> {
    if (uploadedFiles.length === 0) return;

    Promise.all(
      uploadedFiles.map(async (file) => {
        try {
          const bunFile = Bun.file(file.path);
          if (await bunFile.exists()) {
            await bunFile.delete();
            console.log(`成功刪除臨時文件: ${file.filename}`);
          }
        } catch (cleanupError) {
          console.error(`清理臨時文件時出錯 ${file.filename}:`, cleanupError);
        }
      })
    ).catch((err) => console.error("批次清理檔案時出錯:", err));
  }
}
