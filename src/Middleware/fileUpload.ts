import { createMiddleware } from "hono/factory";
import type { HonoGenericContext } from "../Types/types";
import { nanoid } from "nanoid";

// 文件類型定義
export interface UploadedFile {
  name: string;
  type: string;
  size: number;
  filename: string;
  file: File; // 添加原始 File 物件的引用
}

// 文件上傳配置
interface FileUploadConfig {
  name: string;
  maxSize: number; // in bytes
  maxCount: number;
  accept: string[];
}

// 創建文件上傳中間件
export function createFileUploadMiddleware(configs: FileUploadConfig[]) {
  return createMiddleware<HonoGenericContext>(async (c, next) => {
    try {
      const body = await c.req.parseBody({ all: true });
      const uploadedFiles: Record<string, UploadedFile | UploadedFile[] | null> = {};

      for (const config of configs) {
        // 處理單個或多個文件，並過濾出有效文件
        const files = body[config.name];
        const allFiles = Array.isArray(files) ? files : (files ? [files] : []);
        const fileArray = allFiles.filter(file => file instanceof File && file.name);

        if (!files || fileArray.length === 0) {
          uploadedFiles[config.name] = config.maxCount === 1 ? null : [];
          continue;
        }

        console.log(`📁 處理 ${config.name} 檔案上傳: 收到 ${fileArray.length} 個檔案，限制 ${config.maxCount} 個`);

        // 驗證文件數量
        if (fileArray.length > config.maxCount) {
          const errorMessage = config.maxCount === 1
            ? `${config.name} 只能上傳一個檔案，但收到了 ${fileArray.length} 個檔案`
            : `${config.name} 最多只能上傳 ${config.maxCount} 個檔案，但收到了 ${fileArray.length} 個檔案`;

          console.error(`❌ 檔案數量超過限制: ${errorMessage}`);
          return c.text(errorMessage, 400);
        }

        const processedFiles: UploadedFile[] = [];

        for (const file of fileArray) {
          if (!(file instanceof File)) {
            return c.text(`Invalid file type for ${config.name}`, 400);
          }

          // 驗證文件大小
          if (file.size > config.maxSize) {
            return c.text(`File ${file.name} is too large. Maximum size: ${config.maxSize} bytes`, 400);
          }

          // 驗證文件類型
          const fileExtension = file.name.split('.').pop()?.toLowerCase();
          if (!fileExtension || !config.accept.includes(fileExtension)) {
            return c.text(`File type ${fileExtension} not allowed for ${config.name}. Allowed: ${config.accept.join(', ')}`, 400);
          }

          // 生成唯一文件名
          const timestamp = Date.now();
          const randomSuffix = nanoid(8);
          const filename = `${timestamp}_${randomSuffix}.${fileExtension}`;
          // 創建 UploadedFile 對象
          const uploadedFile: UploadedFile = {
            name: file.name,
            type: file.type,
            size: file.size,
            filename: filename,
            file: file, // 保留原始 File 物件引用
          };

          processedFiles.push(uploadedFile);
        }

        // 如果只允許一個文件，返回單個文件而不是數組
        if (config.maxCount === 1) {
          uploadedFiles[config.name] = processedFiles.length > 0 ? processedFiles[0] : null;
          console.log(`✅ ${config.name} 單檔案處理完成: ${processedFiles.length > 0 ? processedFiles[0].filename : '無檔案'}`);
        } else {
          uploadedFiles[config.name] = processedFiles;
          console.log(`✅ ${config.name} 多檔案處理完成: ${processedFiles.length} 個檔案`);
        }
      }

      // 將文件信息添加到 context
      c.set('uploadedFiles', uploadedFiles);

      await next();
    } catch (error) {
      console.error('File upload error:', error);
      return c.text('File upload failed', 500);
    }
  });
}

// 預定義的文件上傳中間件
export const uploadDocument = createFileUploadMiddleware([
  {
    name: "verificationDocuments",
    maxSize: 2 * 1024 * 1024, // 2MB
    maxCount: 2,
    accept: ["pdf", "jpg", "jpeg", "png"],
  },
  {
    name: "identificationDocuments",
    maxSize: 2 * 1024 * 1024, // 2MB
    maxCount: 2,
    accept: ["pdf", "jpg", "jpeg", "png"],
  }
]);

export const uploadProfilePhoto = createFileUploadMiddleware([
  {
    name: "profilePhoto",
    maxSize: 2 * 1024 * 1024, // 2MB
    maxCount: 1,
    accept: ["jpg", "jpeg", "png", "webp"],
  }
]);

export const uploadEnvironmentPhotos = createFileUploadMiddleware([
  {
    name: "environmentPhotos",
    maxSize: 5 * 1024 * 1024, // 5MB
    maxCount: 3,
    accept: ["jpg", "jpeg", "png", "webp"],
  }
]);