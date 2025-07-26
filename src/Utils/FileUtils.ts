import { S3Client } from "bun";
import { PresignedUrlCache } from "../Client/RedisClient.ts";

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

/**
 * 生成預簽名 URL，帶 Redis 快取
 * @param filePath 文件路徑
 * @param expiresIn 過期時間（秒），預設 1 小時
 * @returns 預簽名 URL 或 null
 */
export async function generatePresignedUrl(filePath: string, expiresIn = 3600): Promise<string | null> {
  if (!filePath) {
    console.warn("generatePresignedUrl called with empty filePath");
    return null;
  }

  const cacheKey = `presigned: ${filePath}`;
  const cachedUrl = await PresignedUrlCache.get(cacheKey);

  if (cachedUrl) {
    return cachedUrl;
  }

  try {
    // documentation and updated if necessary.
    // The exact structure of the returned value (string or object with a URL property)
    const signedRequestResult = await (s3Client as any).presign(filePath, {
      expires: expiresIn,
    });

    // Adjust if 'signedRequestResult' is an object (e.g., signedRequestResult.url)
    const finalUrl = typeof signedRequestResult === "object" && signedRequestResult.url ? signedRequestResult.url : signedRequestResult;

    if (!finalUrl) {
      console.error(`Failed to generate presigned URL for ${filePath}. Method might be incorrect or returned null/undefined.`);
      return null;
    }

    await PresignedUrlCache.set(cacheKey, finalUrl, expiresIn);
    return finalUrl;
  } catch (error) {
    console.error(`Error generating presigned URL for ${filePath}:`, error);
    return null;
  }
}

/**
 * 清除特定文件的預簽名 URL 快取
 * @param filename 文件名
 */
export async function clearPresignedUrlCache(filename: string): Promise<void> {
    await PresignedUrlCache.delete(filename);
}

/**
 * 清理臨時文件
 * @param uploadedFiles 上傳的文件陣列
 */
export async function cleanupTempFiles(uploadedFiles: any[]): Promise<void> {
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
