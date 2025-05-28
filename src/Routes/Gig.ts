import { Router } from "@nhttp/nhttp";
import { authenticated } from "../Middleware/middleware.ts";
import type IRouter from "../Interfaces/IRouter.ts";
import dbClient from "../Client/DrizzleClient.ts";
import { eq, and, desc } from "drizzle-orm";
import { gigs, employers, gigApplications } from "../Schema/DatabaseSchema.ts";
import validate from "@nhttp/zod";
import { createGigSchema, updateGigSchema } from "../Middleware/validator.ts";
import { uploadEnvironmentPhotos } from "../Middleware/uploadFile.ts";
import { Role } from "../Types/types.ts";
import { S3Client } from "bun";

const router = new Router();

const client = new S3Client({
  region: "auto",
  accessKeyId: process.env.R2ACCESSKEYID,
  secretAccessKey: process.env.R2SECRETACCESSKEY,
  endpoint: process.env.R2ENDPOINT,
  bucket: "backend-files",
  retry: 1,
});

// 統一的照片上傳處理函數
const handlePhotoUpload = async (reqFile: any) => {
  if (!reqFile?.environmentPhotos) {
    return { environmentPhotosInfo: null, uploadedFiles: [] };
  }

  const files = Array.isArray(reqFile.environmentPhotos) 
    ? reqFile.environmentPhotos 
    : [reqFile.environmentPhotos];

  const uploadedFiles = files;

  // 驗證並限制環境照片數量
  if (files.length > 3) {
    console.warn(`警告：環境照片數量超過限制 (${files.length} > 3)，將只保留前 3 張`);
  }

  const environmentPhotosInfo = files.slice(0, 3).map((file: any) => ({
    originalName: file.name,
    type: file.type,
    filename: file.filename,
    size: file.size,
  }));

  // 上傳到 S3/R2
  try {
    await Promise.all(
      uploadedFiles.map(async (file: any) => {
        const currentFile = Bun.file(file.path);
        if (!currentFile.exists()) {
          throw new Error(`環境照片文件未找到: ${file.name}`);
        }
        await client.write(
          `environment-photos/${file.filename}`,
          currentFile,
        );
        console.log(`環境照片 ${file.name} 上傳成功`);
      })
    );
  } catch (uploadError) {
    console.error("上傳環境照片時出錯:", uploadError);
    throw new Error("環境照片上傳失敗");
  }

  return { environmentPhotosInfo, uploadedFiles };
};

// 清理臨時文件函數
const cleanupTempFiles = async (uploadedFiles: any[]) => {
  if (uploadedFiles.length > 0) {
    for (const file of uploadedFiles) {
      try {
        // 檢查 file.path 是否存在，如果不存在，嘗試構建路徑
        const filePath = file.path || `src/uploads/environmentPhotos/${file.filename}`;
        // 使用 Bun 的正確檔案刪除 API
        const bunFile = Bun.file(filePath);
        const exists = await bunFile.exists();
        
        if (exists) {
          await bunFile.delete();
          console.log(`成功刪除臨時文件: ${filePath}`);
        } else {
          console.log(`檔案不存在: ${filePath}`);
        }
      } catch (cleanupError) {
        console.error("清理臨時文件時出錯:", cleanupError);
      }
    }
  }
};

// 處理環境照片數據格式的輔助函數
const formatEnvironmentPhotos = (environmentPhotos: string | null) => {
  if (!environmentPhotos) return null;
  
  try {
    const photos = JSON.parse(environmentPhotos);
    if (Array.isArray(photos)) {
      // 確保數據庫中最多只有 3 張照片
      const limitedPhotos = photos.slice(0, 3);
      return limitedPhotos.map((photo: any) => ({
        originalName: photo.originalName,
        type: photo.type,
        filename: photo.filename,
        size: photo.size,
      }));
    }
    return photos;
  } catch (error) {
    console.error("解析環境照片數據時出錯:", error);
    return null;
  }
};

// 驗證商家權限和狀態
const validateEmployer = async (user: any) => {
  if (user.role !== Role.EMPLOYER) {
    throw new Error("只有商家可以執行此操作");
  }

  const employer = await dbClient.query.employers.findFirst({
    where: eq(employers.employerId, user.employerId),
  });

  if (!employer) {
    throw new Error("商家不存在");
  }

  // 暫時註釋審核檢查
  // if (employer.approvalStatus !== "approved") {
  //   throw new Error("商家尚未通過審核，無法發佈工作");
  // }

  return employer;
};

// 構建工作數據物件
const buildGigData = (body: any, user: any, environmentPhotosInfo: any) => {
  const {
    title,
    description,
    dateStart,
    dateEnd,
    timeStart,
    timeEnd,
    requirements,
    hourlyRate,
    city,
    district,
    address,
    contactPerson,
    contactPhone,
    contactEmail,
    publishedAt,
    unlistedAt
  } = body;

  return {
    employerId: user.employerId,
    title,
    description: description ? JSON.stringify(description) : null,
    dateStart: dateStart ? new Date(dateStart).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
    dateEnd: dateEnd ? new Date(dateEnd).toISOString().split('T')[0] : null,
    timeStart,
    timeEnd,
    requirements: requirements ? JSON.stringify(requirements) : null,
    hourlyRate,
    city,
    district,
    address,
    contactPerson,
    contactPhone: contactPhone || null,
    contactEmail: contactEmail || null,
    environmentPhotos: environmentPhotosInfo ? JSON.stringify(environmentPhotosInfo) : null,
    publishedAt: publishedAt ? new Date(publishedAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
    unlistedAt: unlistedAt ? new Date(unlistedAt).toISOString().split('T')[0] : null,
  };
};

// 獲取環境照片
router.get("/getFile/:filename", async ({ params, response }) => {
  const { filename } = params;
  
  console.log("Fetching file:", filename);

  if (!filename) {
    return response.status(400).send("Filename is required");
  }

  try {
    const file = client.file(`environment-photos/${filename}`);
    const arrayBuffer: ArrayBuffer = await file.arrayBuffer();
    if (!arrayBuffer) {
      return response.status(404).send("File not found");
    }
    const array = Buffer.from(arrayBuffer);

    response.setHeader("Content-Type", "image/jpeg");
    response.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    return response.send(array);
  } catch (error) {
    console.error("Error fetching file:", error);
    return response.status(500).send("Internal server error");
  }
});

// 發佈新工作
router.post(
  "/create",
  authenticated,
  uploadEnvironmentPhotos,
  validate(createGigSchema),
  async ({ user, body, file: reqFile, response }) => {
    let uploadedFiles: any[] = [];
    
    try {
      // 驗證商家權限
      await validateEmployer(user);

      // 處理照片上傳
      const { environmentPhotosInfo, uploadedFiles: files } = await handlePhotoUpload(reqFile);
      uploadedFiles = files;

      // 構建工作數據
      const gigData = buildGigData(body, user, environmentPhotosInfo);

      // 創建工作
      const insertedGig = await dbClient
        .insert(gigs)
        .values(gigData)
        .returning();

      const newGig = insertedGig[0];

      return response.status(201).send({
        message: "工作發佈成功",
        gig: {
          gigId: newGig.gigId,
          title: newGig.title,
          description: newGig.description,
          environmentPhotos: environmentPhotosInfo,
          isActive: newGig.isActive,
          createdAt: newGig.createdAt,
        },
      });
    } catch (error) {
      console.error("創建工作時出錯:", error);
      const errorMessage = error instanceof Error ? error.message : "伺服器內部錯誤";
      
      if (errorMessage.includes("只有商家") || errorMessage.includes("商家不存在") || errorMessage.includes("尚未通過審核")) {
        return response.status(403).send(errorMessage);
      }
      if (errorMessage.includes("照片上傳失敗")) {
        return response.status(500).send(errorMessage);
      }
      
      return response.status(500).send("伺服器內部錯誤");
    } finally {
      // 清理臨時文件
      await cleanupTempFiles(uploadedFiles);
    }
  }
);

// 獲取自己發佈的工作
router.get(
  "/my-gigs",
  authenticated,
  async ({ user, response, query }) => {
    try {
      // 驗證商家權限
      await validateEmployer(user);

      const page = parseInt(query.page) || 1;
      const limit = parseInt(query.limit) || 10;
      const offset = (page - 1) * limit;

      const myGigs = await dbClient.query.gigs.findMany({
        where: eq(gigs.employerId, user.employerId),
        orderBy: [desc(gigs.createdAt)],
        columns: {
          gigId: true,
          title: true,
          dateStart: true,
          dateEnd: true,
          timeStart: true,
          timeEnd: true,
          publishedAt: true,
          unlistedAt: true,
          isActive: true,
        },
        limit,
        offset
      });

      return response.status(200).send({
        gigs: myGigs,
        pagination: {
          page,
          limit,
          hasMore: myGigs.length === limit,
        },
      });
    } catch (error) {
      console.error("獲取工作列表時出錯:", error);
      const errorMessage = error instanceof Error ? error.message : "伺服器內部錯誤";
      
      if (errorMessage.includes("只有商家") || errorMessage.includes("商家不存在")) {
        return response.status(403).send(errorMessage);
      }
      
      return response.status(500).send("伺服器內部錯誤");
    }
  }
);

// 獲取特定工作詳情
router.get(
  "/:gigId",
  authenticated,
  async ({ user, params, response }) => {
    try {
      const { gigId } = params;

      const gig = await dbClient.query.gigs.findFirst({
        where: eq(gigs.gigId, gigId),
        with: {
          gigApplications: {
            with: {
              worker: {
                columns: {
                  workerId: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                  phoneNumber: true,
                  highestEducation: true,
                  schoolName: true,
                  major: true,
                },
              },
            },
          },
        },
      });

      if (!gig) {
        return response.status(404).send("工作不存在");
      }

      // 如果是商家，只能查看自己的工作詳情
      if (user.role === Role.EMPLOYER && gig.employerId !== user.employerId) {
        return response.status(403).send("無權查看此工作");
      }

      // 添加申請計數統計
      const gigWithCounts = {
        ...gig,
        environmentPhotos: formatEnvironmentPhotos(typeof gig.environmentPhotos === 'string' ? gig.environmentPhotos : null),
        applicationCount: gig.gigApplications ? gig.gigApplications.length : 0,
        pendingApplications: gig.gigApplications ? gig.gigApplications.filter(app => app.status === "pending").length : 0,
      };

      return response.status(200).send(gigWithCounts);
    } catch (error) {
      console.error("獲取工作詳情時出錯:", error);
      return response.status(500).send("伺服器內部錯誤");
    }
  }
);

// 更新工作資訊
router.put(
  "/:gigId",
  authenticated,
  uploadEnvironmentPhotos,
  validate(updateGigSchema),
  async ({ user, params, body, file: reqFile, response }) => {
    let uploadedFiles: any[] = [];
    
    try {
      // 驗證商家權限
      await validateEmployer(user);

      const { gigId } = params;

      // 檢查工作是否存在且屬於該商家
      const existingGig = await dbClient.query.gigs.findFirst({
        where: and(eq(gigs.gigId, gigId), eq(gigs.employerId, user.employerId)),
      });

      if (!existingGig) {
        return response.status(404).send("工作不存在或無權限修改");
      }

      // 處理照片上傳（如果有新照片上傳）
      const { environmentPhotosInfo, uploadedFiles: files } = await handlePhotoUpload(reqFile);
      uploadedFiles = files;

      // 構建更新數據
      const updateData: any = {};
      
      if (body.title) updateData.title = body.title;
      if (body.description !== undefined) updateData.description = body.description ? JSON.stringify(body.description) : null;
      if (body.dateStart) updateData.dateStart = new Date(body.dateStart).toISOString().split('T')[0];
      if (body.dateEnd) updateData.dateEnd = new Date(body.dateEnd).toISOString().split('T')[0];
      if (body.timeStart) updateData.timeStart = body.timeStart;
      if (body.timeEnd) updateData.timeEnd = body.timeEnd;
      if (body.requirements !== undefined) updateData.requirements = body.requirements ? JSON.stringify(body.requirements) : null;
      if (body.hourlyRate) updateData.hourlyRate = body.hourlyRate;
      if (body.city) updateData.city = body.city;
      if (body.district) updateData.district = body.district;
      if (body.address) updateData.address = body.address;
      if (body.contactPerson) updateData.contactPerson = body.contactPerson;
      if (body.contactPhone !== undefined) updateData.contactPhone = body.contactPhone;
      if (body.contactEmail !== undefined) updateData.contactEmail = body.contactEmail;
      if (environmentPhotosInfo) updateData.environmentPhotos = JSON.stringify(environmentPhotosInfo);
      if (body.publishedAt) updateData.publishedAt = new Date(body.publishedAt).toISOString().split('T')[0];
      if (body.unlistedAt) updateData.unlistedAt = new Date(body.unlistedAt).toISOString().split('T')[0];
      if (body.isActive !== undefined) updateData.isActive = body.isActive;
      
      updateData.updatedAt = new Date();

      await dbClient
        .update(gigs)
        .set(updateData)
        .where(eq(gigs.gigId, gigId));

      return response.status(200).send({
        message: "工作更新成功",
      });
    } catch (error) {
      console.error("更新工作時出錯:", error);
      const errorMessage = error instanceof Error ? error.message : "伺服器內部錯誤";
      
      if (errorMessage.includes("只有商家") || errorMessage.includes("商家不存在")) {
        return response.status(403).send(errorMessage);
      }
      if (errorMessage.includes("照片上傳失敗")) {
        return response.status(500).send(errorMessage);
      }
      
      return response.status(500).send("伺服器內部錯誤");
    } finally {
      // 清理臨時文件
      await cleanupTempFiles(uploadedFiles);
    }
  }
);

// 停用/啟用工作
router.patch(
  "/:gigId/toggle-status",
  authenticated,
  async ({ user, params, response }) => {
    try {
      // 驗證商家權限
      await validateEmployer(user);

      const { gigId } = params;

      const existingGig = await dbClient.query.gigs.findFirst({
        where: and(eq(gigs.gigId, gigId), eq(gigs.employerId, user.employerId)),
      });

      if (!existingGig) {
        return response.status(404).send("工作不存在或無權限修改");
      }

      const newIsActive = !existingGig.isActive;

      await dbClient
        .update(gigs)
        .set({
          isActive: newIsActive,
          updatedAt: new Date(),
        })
        .where(eq(gigs.gigId, gigId));

      return response.status(200).send({
        message: `工作已${newIsActive ? "啟用" : "停用"}`,
      });
    } catch (error) {
      console.error("切換工作狀態時出錯:", error);
      const errorMessage = error instanceof Error ? error.message : "伺服器內部錯誤";
      
      if (errorMessage.includes("只有商家") || errorMessage.includes("商家不存在")) {
        return response.status(403).send(errorMessage);
      }
      
      return response.status(500).send("伺服器內部錯誤");
    }
  }
);

// 刪除工作
router.delete(
  "/:gigId",
  authenticated,
  async ({ user, params, response }) => {
    try {
      // 驗證商家權限
      await validateEmployer(user);

      const { gigId } = params;

      const existingGig = await dbClient.query.gigs.findFirst({
        where: and(eq(gigs.gigId, gigId), eq(gigs.employerId, user.employerId)),
      });

      if (!existingGig) {
        return response.status(404).send("工作不存在或無權限刪除");
      }

      // 檢查是否有待處理的申請
      const pendingApplications = await dbClient.query.gigApplications.findMany({
        where: and(eq(gigApplications.gigId, gigId), eq(gigApplications.status, "pending")),
      });

      if (pendingApplications.length > 0) {
        return response.status(400).send("有待處理的申請，無法刪除工作");
      }

      await dbClient.delete(gigs).where(eq(gigs.gigId, gigId));

      return response.status(200).send({
        message: "工作刪除成功",
      });
    } catch (error) {
      console.error("刪除工作時出錯:", error);
      const errorMessage = error instanceof Error ? error.message : "伺服器內部錯誤";
      
      if (errorMessage.includes("只有商家") || errorMessage.includes("商家不存在")) {
        return response.status(403).send(errorMessage);
      }
      
      return response.status(500).send("伺服器內部錯誤");
    }
  }
);

// 獲取所有可用工作（給打工者查看）
router.get(
  "/",
  async ({ query, response }) => {
    try {
      const page = parseInt(query.page) || 1;
      const limit = parseInt(query.limit) || 10;
      const offset = (page - 1) * limit;
      const city = query.city;
      const district = query.district;
      const minRate = query.minRate ? parseInt(query.minRate) : null;
      const maxRate = query.maxRate ? parseInt(query.maxRate) : null;

      let whereConditions = eq(gigs.isActive, true);

      const availableGigs = await dbClient.query.gigs.findMany({
        where: whereConditions,
        orderBy: [desc(gigs.createdAt)],
        limit,
        offset,
        with: {
          employer: {
            columns: {
              employerId: true,
              employerName: true,
              branchName: true,
              industryType: true,
              address: true,
            },
          },
        },
      });

      // 進一步過濾（Drizzle ORM 某些複雜查詢可能需要在應用層處理）
      let filteredGigs = availableGigs;

      if (city) {
        filteredGigs = filteredGigs.filter(gig => gig.city.includes(city));
      }

      if (district) {
        filteredGigs = filteredGigs.filter(gig => gig.district.includes(district));
      }

      if (minRate) {
        filteredGigs = filteredGigs.filter(gig => gig.hourlyRate >= minRate);
      }

      if (maxRate) {
        filteredGigs = filteredGigs.filter(gig => gig.hourlyRate <= maxRate);
      }

      // 格式化環境照片數據
      const formattedGigs = filteredGigs.map(gig => ({
        ...gig,
        environmentPhotos: formatEnvironmentPhotos(typeof gig.environmentPhotos === 'string' ? gig.environmentPhotos : null),
      }));

      return response.status(200).send({
        gigs: formattedGigs,
        pagination: {
          page,
          limit,
          hasMore: filteredGigs.length === limit,
        },
        filters: {
          city,
          district,
          minRate,
          maxRate,
        },
      });
    } catch (error) {
      console.error("獲取工作列表時出錯:", error);
      return response.status(500).send("伺服器內部錯誤");
    }
  }
);

export default { path: "/gig", router } as IRouter; 