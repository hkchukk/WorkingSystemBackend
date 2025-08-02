import { Hono } from "hono";
import { authenticated } from "../Middleware/authentication";
import { requireEmployer, requireApprovedEmployer } from "../Middleware/guards";
import type IRouter from "../Interfaces/IRouter";
import type { HonoGenericContext } from "../Types/types";
import dbClient from "../Client/DrizzleClient";
import { eq, and, desc, sql, gte, lte, or, lt, gt } from "drizzle-orm";
import { gigs, gigApplications } from "../Schema/DatabaseSchema";
import { zValidator } from "@hono/zod-validator";
import { createGigSchema, updateGigSchema } from "../Types/zodSchema";
import { uploadEnvironmentPhotos } from "../Middleware/fileUpload";
import moment from "moment";
import NotificationHelper from "../Utils/NotificationHelper";
import { FileManager, s3Client } from "../Client/Cache/Index";

const router = new Hono<HonoGenericContext>();

// 統一的照片上傳處理函數
async function handlePhotoUpload(reqFile: any, existingPhotos: any[] = []) {
  // 如果沒有上傳檔案，返回現有照片
  if (!reqFile?.environmentPhotos || reqFile.environmentPhotos.length === 0) {
    return {
      environmentPhotosInfo: existingPhotos,
      uploadedFiles: [],
      addedCount: 0,
      totalCount: existingPhotos.length,
      message: "未上傳新照片",
    };
  }

  const files = Array.isArray(reqFile.environmentPhotos) ? reqFile.environmentPhotos : [reqFile.environmentPhotos];

  // 檢查累加後是否超過3張照片限制
  const totalAfterAdd = existingPhotos.length + files.length;
  let uploadedFiles = files;
  let message = "";

  if (totalAfterAdd > 3) {
    const canAdd = 3 - existingPhotos.length;
    if (canAdd <= 0) {
      FileManager.cleanupTempFiles(files);
      return {
        environmentPhotosInfo: existingPhotos,
        uploadedFiles: [],
        addedCount: 0,
        totalCount: existingPhotos.length,
        message: "不能再添加照片，已達最大限制（3張）",
      };
    }
    uploadedFiles = files.slice(0, canAdd);
    const rejectedFiles = files.slice(canAdd);
    FileManager.cleanupTempFiles(rejectedFiles);
    message = `只能添加${canAdd}張照片，已忽略多餘的${files.length - canAdd}張`;
  } else {
    message = `成功添加${files.length}張照片`;
  }

  // 建立照片資訊
  const newPhotosInfo = uploadedFiles.map((file: any) => {
    // 驗證檔案物件的完整性
    if (!file || !file.filename || !file.name) {
      console.error('❌ 檔案物件不完整:', file);
      throw new Error("檔案資料不完整");
    }

    const photoData = {
      originalName: file.name,
      type: file.type,
      filename: file.filename,
      size: file.size,
    };

    // 驗證 photoData 不包含 URL
    if (photoData.filename && (photoData.filename.includes('http') || photoData.filename.includes('presigned'))) {
      console.error('❌ 檢測到嘗試儲存 URL 到環境照片資料庫:', photoData);
      throw new Error("環境照片資料格式錯誤");
    }

    console.log('✅ 新照片資料:', photoData);
    return photoData;
  });

  // 一次過並行上傳
  try {
    await Promise.all(
      uploadedFiles.map(async (file: any) => {
        const currentFile = Bun.file(file.path);

        // 檢查檔案是否存在
        if (!(await currentFile.exists())) {
          throw new Error(`檔案不存在: ${file.path}`);
        }

        await s3Client.write(`environment-photos/${file.filename}`, currentFile);
        console.log(`環境照片 ${file.name} 上傳成功`);
      })
    );
  } catch (uploadError) {
    console.error("上傳環境照片時出錯:", uploadError);
    throw new Error(`環境照片上傳失敗: ${uploadError instanceof Error ? uploadError.message : "未知錯誤"}`);
  }

  const allPhotos = [...existingPhotos, ...newPhotosInfo];

  return {
    environmentPhotosInfo: allPhotos,
    uploadedFiles,
    addedCount: newPhotosInfo.length,
    totalCount: allPhotos.length,
    message,
  };
}

// 處理環境照片數據
async function formatEnvironmentPhotos(environmentPhotos: any, limit?: number) {
  if (!environmentPhotos) return null;

  if (Array.isArray(environmentPhotos)) {
    // 可選擇拿 1-3 張照片，預設全部
    const photosToProcess = limit ? environmentPhotos.slice(0, limit) : environmentPhotos;

    const photosWithUrls = await Promise.all(
      photosToProcess.map(async (photo: any) => {
        // 檢查照片物件是否有效
        if (!photo || !photo.filename) {
          console.warn('❌ 照片物件缺少 filename:', photo);
          return {
            url: null,
            error: "照片資料不完整",
            originalName: photo?.originalName || '未知檔案',
            type: photo?.type || 'unknown'
          };
        }

        console.log(`🔄 正在為環境照片生成 URL: ${photo.filename}`);
        const presignedUrl = await FileManager.getPresignedUrl(`environment-photos/${photo.filename}`);

        if (!presignedUrl) {
          console.warn(`❌ 環境照片 URL 生成失敗: ${photo.filename}`);
          return {
            url: null,
            error: "圖片連結生成失敗",
            originalName: photo.originalName,
            type: photo.type,
            filename: photo.filename
          };
        } else {
          return {
            url: presignedUrl,
            originalName: photo.originalName,
            type: photo.type,
            filename: photo.filename
          };
        }
      })
    );

    return photosWithUrls;
  }
  return environmentPhotos;
}

// 構建工作數據物件
function buildGigData(body: any, user: any, environmentPhotosInfo: any) {
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
    unlistedAt,
  } = body;

  return {
    employerId: user.employerId,
    title,
    description,
    dateStart: dateStart ? moment(dateStart).format("YYYY-MM-DD") : null,
    dateEnd: dateEnd ? moment(dateEnd).format("YYYY-MM-DD") : null,
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
    environmentPhotos: environmentPhotosInfo ? environmentPhotosInfo : null,
    publishedAt: publishedAt ? moment(publishedAt).format("YYYY-MM-DD") : moment().format("YYYY-MM-DD"),
    unlistedAt: unlistedAt ? moment(unlistedAt).format("YYYY-MM-DD") : null,
  };
}

// 刪除 S3 文件
router.delete("/deleteFile/:filename", authenticated, async (c) => {
  const user = c.get("user");
  const filename = c.req.param("filename");

  if (!filename) {
    return c.text("Filename is required", 400);
  }

  try {
    // 查找包含該文件的工作
    const targetGig = await dbClient.query.gigs.findFirst({
      where: and(eq(gigs.employerId, user.employerId), sql`environment_photos::text LIKE ${`%${filename}%`}`),
      columns: {
        gigId: true,
        environmentPhotos: true,
      },
    });

    const hasExactMatch =
      targetGig && Array.isArray(targetGig.environmentPhotos) && targetGig.environmentPhotos.some((photo: any) => photo.filename === filename);

    // 如果找不到包含該文件的工作，返回錯誤
    if (!targetGig || !hasExactMatch) {
      return c.json(
        {
          message: `沒有找到文件 ${filename}`,
        },
        404
      );
    }

    // 更新照片陣列
    const updatedPhotos = Array.isArray(targetGig.environmentPhotos)
      ? targetGig.environmentPhotos.filter((photo: any) => photo.filename !== filename)
      : [];

    // 更新資料庫
    await dbClient
      .update(gigs)
      .set({
        environmentPhotos: updatedPhotos.length > 0 ? updatedPhotos : [],
        updatedAt: new Date(),
      })
      .where(eq(gigs.gigId, targetGig.gigId));

    // 刪除 S3 文件
    await s3Client.delete(`environment-photos/${filename}`);

    // 清除 Redis 快取
    await FileManager.deleteCache(filename);

    return c.json(
      {
        message: `文件 ${filename} 刪除成功`,
      },
      200
    );
  } catch (error) {
    console.error(`刪除文件 ${filename} 時出錯:`, error);
    return c.text("刪除文件失敗", 500);
  }
});

// 獲取所有可用工作
router.get("/public", async (c) => {
  try {
    const limit = c.req.query("limit") || "10";
    const page = c.req.query("page") || "1";
    const city = c.req.query("city");
    const district = c.req.query("district");
    const minRate = c.req.query("minRate");
    const maxRate = c.req.query("maxRate");
    const dateStart = c.req.query("dateStart");

    // 驗證 city 和 district 必須成對
    if (district && !city) {
      return c.json(
        {
          error: "提供區域時必須同時提供城市",
        },
        400
      );
    }

    const requestLimit = Number.parseInt(limit);
    const requestPage = Number.parseInt(page);
    const minRateFilter = minRate ? Number.parseInt(minRate) : null;
    const maxRateFilter = maxRate ? Number.parseInt(maxRate) : null;

    /*
		// 生成快取鍵
		const filters = `public_${city || "all"}_${district || "all"}_${minRateFilter || "any"}_${maxRateFilter || "any"}_${dateStart || "any"}`;
		
		// 檢查快取
		let cachedData = await GigCache.getGigList(filters, requestPage);

		if (cachedData) {
			return c.json(cachedData, 200);
		}
		*/

    // 處理日期邏輯
    const today = moment().format("YYYY-MM-DD");
    const searchDateStart = dateStart || today;

    // 建立查詢條件
    const whereConditions = [
      eq(gigs.isActive, true),
      lte(gigs.publishedAt, today),
      sql`(${gigs.unlistedAt} IS NULL OR ${gigs.unlistedAt} >= ${today})`,
      gte(gigs.dateEnd, searchDateStart),
    ];

    city ? whereConditions.push(eq(gigs.city, city)) : null;
    district ? whereConditions.push(eq(gigs.district, district)) : null;
    minRateFilter ? whereConditions.push(gte(gigs.hourlyRate, minRateFilter)) : null;
    maxRateFilter ? whereConditions.push(lte(gigs.hourlyRate, maxRateFilter)) : null;

    const availableGigs = await dbClient.query.gigs.findMany({
      where: and(...whereConditions),
      orderBy: [
        sql`CASE WHEN ${gigs.dateStart}::date >= ${today}::date THEN 0 ELSE 1 END ASC`,
        sql`ABS(${gigs.dateStart}::date - ${today}::date) ASC`,
      ],
      limit: requestLimit + 1, // 多查一筆來確認是否有更多資料
      offset: requestLimit * (requestPage - 1),
      columns: {
        gigId: true,
        title: true,
        hourlyRate: true,
        city: true,
        district: true,
        updatedAt: true,
      },
    });

    const hasMore = availableGigs.length > requestLimit;
    hasMore ? availableGigs.pop() : null;

    const response_data = {
      gigs: availableGigs,
      pagination: {
        limit: requestLimit,
        page: requestPage,
        hasMore,
        returned: availableGigs.length,
      },
      filters: {
        city,
        district,
        minRate: minRateFilter,
        maxRate: maxRateFilter,
        dateStart: searchDateStart,
      },
    };

    //await GigCache.setGigList(filters, requestPage, response_data);
    return c.json(response_data, 200);
  } catch (error) {
    console.error("獲取工作列表時出錯:", error);
    return c.text("伺服器內部錯誤", 500);
  }
});

// 獲取單一可用工作（詳細版）
router.get("/public/:gigId", async (c) => {
  try {
    const gigId = c.req.param("gigId");

    if (!gigId) {
      return c.json({ error: "Gig ID is required" }, 400);
    }

    const today = moment().format("YYYY-MM-DD");

    const whereConditions = [
      eq(gigs.gigId, gigId),
      eq(gigs.isActive, true),
      lte(gigs.publishedAt, today),
      sql`(${gigs.unlistedAt} IS NULL OR ${gigs.unlistedAt} >= ${today})`,
    ];

    const gig = await dbClient.query.gigs.findFirst({
      where: and(...whereConditions),
      columns: {
        isActive: false,
        createdAt: false,
      },
      with: {
        employer: {
          columns: {
            employerId: true,
            employerName: true,
            branchName: true,
            industryType: true,
            address: true,
            employerPhoto: true,
          },
        },
      },
    });

    if (!gig) {
      return c.json({ message: "工作不存在或目前無法查看" }, 404);
    }

    const formattedGig = {
      ...gig,
      environmentPhotos: await formatEnvironmentPhotos(gig.environmentPhotos),
    };

    return c.json(formattedGig, 200);
  } catch (error) {
    console.error(`獲取詳細工作時出錯:`, error);
    return c.text("伺服器內部錯誤", 500);
  }
});

// 發佈新工作
router.post(
  "/create",
  authenticated,
  uploadEnvironmentPhotos,
  zValidator("form", createGigSchema),
  async (c) => {
    const user = c.get("user");
    const body = c.req.valid("form");
    const reqFile = c.get("uploadedFiles") || {};
    let uploadedFiles: any[] = [];

    try {
      // 處理照片上傳
      const { environmentPhotosInfo, uploadedFiles: filesList } = await handlePhotoUpload(reqFile);
      uploadedFiles = filesList;

      // 構建工作數據
      const gigData = buildGigData(body, user, environmentPhotosInfo);

      // 創建工作
      const insertedGig = await dbClient.insert(gigs).values(gigData).returning();

      const newGig = insertedGig[0];

      // 發送工作發佈成功通知
      await NotificationHelper.notifyGigPublished(user.employerId, newGig.title);

      return c.json(
        {
          message: "工作發佈成功",
          gig: {
            gigId: newGig.gigId,
            title: newGig.title,
            description: newGig.description,
            environmentPhotos: environmentPhotosInfo,
            isActive: newGig.isActive,
            createdAt: newGig.createdAt,
          },
        },
        201
      );
    } catch (error) {
      console.error("創建工作時出錯:", error);
      const errorMessage = error instanceof Error ? error.message : "伺服器內部錯誤";

      if (errorMessage.includes("照片上傳失敗")) {
        return c.json(errorMessage, 500);
      }

      return c.text("伺服器內部錯誤", 500);
    } finally {
      FileManager.cleanupTempFiles(uploadedFiles);
    }
  }
);

// 獲取自己發佈的工作
router.get("/my-gigs", authenticated, requireEmployer, async (c) => {
  try {
    const user = c.get("user");
    const limit = c.req.query("limit") || "10";
    const offset = c.req.query("offset") || "0";
    const status = c.req.query("status");
    const requestLimit = Number.parseInt(limit);
    const requestOffset = Number.parseInt(offset);
    const currentDate = moment().format("YYYY-MM-DD");

    // 建立基本查詢條件
    const whereConditions = [eq(gigs.employerId, user.employerId), eq(gigs.isActive, true)];

    // 根據狀態參數添加日期條件
    if (status && ["not_started", "ongoing", "completed"].includes(status)) {
      if (status === "not_started") {
        // 未開始：dateStart > currentDate
        whereConditions.push(gt(gigs.dateStart, currentDate));
      } else if (status === "completed") {
        // 已結束：dateEnd < currentDate
        whereConditions.push(lt(gigs.dateEnd, currentDate));
      } else if (status === "ongoing") {
        // 進行中：dateStart <= currentDate AND dateEnd >= currentDate
        whereConditions.push(and(lte(gigs.dateStart, currentDate), gte(gigs.dateEnd, currentDate)));
      }
    }

    const myGigs = await dbClient.query.gigs.findMany({
      where: and(...whereConditions),
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
        environmentPhotos: true,
      },
      limit: requestLimit + 1, // 多查一筆來確認是否有更多資料
      offset: requestOffset,
    });

    // 檢查是否有更多資料
    const hasMore = myGigs.length > requestLimit;
    const returnGigs = hasMore ? myGigs.slice(0, requestLimit) : myGigs;

    // 只取 1 張環境照片
    const gigsWithPhotos = await Promise.all(
      returnGigs.map(async (gig) => ({
        ...gig,
        environmentPhotos: await formatEnvironmentPhotos(gig.environmentPhotos, 1),
      }))
    );

    return c.json(
      {
        gigs: gigsWithPhotos,
        pagination: {
          limit: requestLimit,
          offset: requestOffset,
          hasMore,
          returned: gigsWithPhotos.length,
        },
      },
      200
    );
  } catch (error) {
    console.error("獲取工作列表時出錯:", error);
    return c.text("伺服器內部錯誤", 500);
  }
});

// 獲取特定工作詳情
router.get("/:gigId", authenticated, requireEmployer, async (c) => {
  const user = c.get("user");
  try {
    const gigId = c.req.param("gigId");
    const application = c.req.query("application");
    const status = c.req.query("status");
    const limit = c.req.query("limit") || "10";
    const offset = c.req.query("offset") || "0";

    // 如果沒有要求整合申請記錄，使用簡單查詢
    if (application !== "true") {
      const gig = await dbClient.query.gigs.findFirst({
        where: and(eq(gigs.gigId, gigId), eq(gigs.employerId, user.employerId), eq(gigs.isActive, true)),
      });

      if (!gig) {
        return c.text("工作不存在或無權限查看", 404);
      }

      return c.json(
        {
          ...gig,
          environmentPhotos: await formatEnvironmentPhotos(gig.environmentPhotos),
        },
        200
      );
    }

    const requestLimit = Number.parseInt(limit);
    const requestOffset = Number.parseInt(offset);

    // 先查詢工作詳情
    const gig = await dbClient.query.gigs.findFirst({
      where: and(eq(gigs.gigId, gigId), eq(gigs.employerId, user.employerId), eq(gigs.isActive, true)),
    });

    if (!gig) {
      return c.text("工作不存在或無權限查看", 404);
    }

    // 建立申請記錄查詢條件
    const whereConditions = [eq(gigApplications.gigId, gigId)];
    if (status && ["pending", "approved", "rejected", "cancelled"].includes(status)) {
      whereConditions.push(eq(gigApplications.status, status as "pending" | "approved" | "rejected" | "cancelled"));
    }

    // 查詢申請記錄（在資料庫層面分頁，多查一筆來判斷 hasMore）
    const applications = await dbClient.query.gigApplications.findMany({
      where: and(...whereConditions),
      with: {
        worker: true,
      },
      orderBy: [desc(gigApplications.createdAt)],
      limit: requestLimit + 1, // 多查一筆來判斷 hasMore
      offset: requestOffset,
    });

    // 判斷是否有更多資料
    const hasMore = applications.length > requestLimit;
    const paginatedApplications = hasMore ? applications.slice(0, requestLimit) : applications;

    // 整合回應
    return c.json(
      {
        ...gig,
        environmentPhotos: await formatEnvironmentPhotos(gig.environmentPhotos),
        applications: {
          data: paginatedApplications.map((app) => ({
            applicationId: app.applicationId,
            workerId: app.workerId,
            workerName: `${app.worker.firstName} ${app.worker.lastName}`,
            workerEmail: app.worker.email,
            workerPhone: app.worker.phoneNumber,
            workerEducation: app.worker.highestEducation,
            workerSchool: app.worker.schoolName,
            workerMajor: app.worker.major,
            status: app.status,
            appliedAt: app.createdAt,
          })),
          pagination: {
            limit: requestLimit,
            offset: requestOffset,
            hasMore,
            returned: paginatedApplications.length,
          },
        },
      },
      200
    );
  } catch (error) {
    console.error("獲取工作詳情時出錯:", error);
    return c.text("伺服器內部錯誤", 500);
  }
});

// 更新工作資訊
router.put(
  "/:gigId",
  authenticated,
  requireEmployer,
  requireApprovedEmployer,
  uploadEnvironmentPhotos,
  zValidator("form", updateGigSchema),
  async (c) => {
    const user = c.get("user");
    const body = c.req.valid("form");
    const reqFile = c.get("uploadedFiles") || {};
    let uploadedFiles: any[] = [];

    try {
      const gigId = c.req.param("gigId");

      // 處理照片上傳（如果有新照片上傳）
      const existingGig = await dbClient.query.gigs.findFirst({
        where: and(eq(gigs.gigId, gigId), eq(gigs.employerId, user.employerId)),
      });

      if (!existingGig) {
        return c.text("工作不存在或無權限修改", 404);
      }

      // 檢查工作是否已停用
      if (!existingGig.isActive) {
        return c.text("已停用的工作無法更新", 400);
      }

      // 檢查是否有申請中或已核准的申請
      const activeApplications = await dbClient.query.gigApplications.findFirst({
        where: and(eq(gigApplications.gigId, gigId), or(eq(gigApplications.status, "pending"), eq(gigApplications.status, "approved"))),
        columns: { applicationId: true },
      });

      if (activeApplications) {
        return c.text("此工作有申請中或已核准的申請者，無法更新", 400);
      }

      // 使用原始的照片資料，而不是格式化後的資料
      const existingPhotos = Array.isArray(existingGig.environmentPhotos) ? existingGig.environmentPhotos : [];
      const { environmentPhotosInfo, uploadedFiles: filesList, addedCount, totalCount, message } = await handlePhotoUpload(reqFile, existingPhotos);
      uploadedFiles = filesList;

      await dbClient
        .update(gigs)
        .set({
          ...body,
          updatedAt: new Date(),
          dateStart: body.dateStart ? moment(body.dateStart).format("YYYY-MM-DD") : undefined,
          dateEnd: body.dateEnd ? moment(body.dateEnd).format("YYYY-MM-DD") : undefined,
          publishedAt: body.publishedAt ? moment(body.publishedAt).format("YYYY-MM-DD") : undefined,
          unlistedAt: body.unlistedAt ? moment(body.unlistedAt).format("YYYY-MM-DD") : undefined,
          environmentPhotos: addedCount > 0 ? environmentPhotosInfo : undefined,
        })
        .where(eq(gigs.gigId, gigId));

      // 檢查是否有照片相關操作
      const hasPhotoOperation = reqFile?.environmentPhotos || addedCount > 0;
      const responseMessage =
        hasPhotoOperation && addedCount > 0
          ? `工作更新成功，${message}`
          : hasPhotoOperation && addedCount === 0
          ? `工作更新成功，${message}`
          : "工作更新成功";

      return c.json(
        {
          message: responseMessage,
          photoInfo: hasPhotoOperation
            ? {
                totalPhotos: totalCount,
                addedPhotos: addedCount,
              }
            : undefined,
        },
        200
      );
    } catch (error) {
      console.error("更新工作時出錯:", error);
      const errorMessage = error instanceof Error ? error.message : "伺服器內部錯誤";

      if (errorMessage.includes("照片上傳失敗")) {
        return c.json(errorMessage, 500);
      }

      return c.text("伺服器內部錯誤", 500);
    } finally {
      FileManager.cleanupTempFiles(uploadedFiles);
    }
  }
);

// 停用/刪除工作
router.patch("/:gigId/toggle-status", authenticated, requireEmployer, requireApprovedEmployer, async (c) => {
  const user = c.get("user");
  try {
    const gigId = c.req.param("gigId");

    // 一次查詢獲取工作和申請資料
    const gigWithApplications = await dbClient.query.gigs.findFirst({
      where: and(eq(gigs.gigId, gigId), eq(gigs.employerId, user.employerId)),
      with: {
        gigApplications: {
          where: eq(gigApplications.status, "approved"),
          limit: 1, // 只需要知道是否存在已核准的申請
        },
      },
    });

    if (!gigWithApplications) {
      return c.text("工作不存在或無權限修改", 404);
    }

    // 如果工作已經停用，不允許操作
    if (!gigWithApplications.isActive) {
      return c.json(
        {
          message: "工作已經停用，無法再次操作",
        },
        400
      );
    }

    const hasApprovedApplications = gigWithApplications.gigApplications.length > 0;

    // 根據是否有已核准的申請者決定操作
    if (hasApprovedApplications) {
      // 有已核准的申請者，停用工作
      await dbClient
        .update(gigs)
        .set({
          isActive: false,
          updatedAt: new Date(),
        })
        .where(eq(gigs.gigId, gigId));

      return c.json(
        {
          message: "工作已停用",
          action: "disabled",
        },
        200
      );
    }
    // 沒有已核准的申請者，直接刪除工作
    await dbClient.delete(gigs).where(eq(gigs.gigId, gigId));

    return c.json(
      {
        message: "工作已刪除",
        action: "deleted",
      },
      200
    );
  } catch (error) {
    console.error("處理工作停用/刪除時出錯:", error);
    return c.text("伺服器內部錯誤", 500);
  }
});

// 上架/下架工作
router.patch("/:gigId/toggle-listing", authenticated, requireEmployer, requireApprovedEmployer, async (c) => {
  const user = c.get("user");
  try {
    const gigId = c.req.param("gigId");

    const existingGig = await dbClient.query.gigs.findFirst({
      where: and(eq(gigs.gigId, gigId), eq(gigs.employerId, user.employerId)),
    });

    if (!existingGig) {
      return c.text("工作不存在或無權限修改", 404);
    }

    const today = moment().format("YYYY-MM-DD");
    const isCurrentlyListed = !existingGig.unlistedAt || existingGig.unlistedAt >= today;

    // 如果要上架工作，需要檢查一些條件
    if (!isCurrentlyListed) {
      // 檢查工作是否已過期
      if (existingGig.dateEnd && existingGig.dateEnd < today) {
        return c.text("工作已過期，無法重新上架", 400);
      }

      // 檢查工作是否被停用
      if (!existingGig.isActive) {
        return c.text("工作已停用，請先啟用工作", 400);
      }
    }

    const newUnlistedAt = isCurrentlyListed ? today : null;

    await dbClient
      .update(gigs)
      .set({
        unlistedAt: newUnlistedAt,
        updatedAt: new Date(),
      })
      .where(eq(gigs.gigId, gigId));

    return c.json(
      {
        message: `工作已${isCurrentlyListed ? "下架" : "上架"}`,
      },
      200
    );
  } catch (error) {
    console.error("切換工作上架狀態時出錯:", error);
    return c.text("伺服器內部錯誤", 500);
  }
});

// Employer 行事曆 - 查看已排定的工作
router.get("/employer/calendar", authenticated, requireEmployer, requireApprovedEmployer, async (c) => {
  const user = c.get("user");
  try {
    const year = c.req.query("year");
    const month = c.req.query("month");
    const dateStart = c.req.query("dateStart");
    const dateEnd = c.req.query("dateEnd");

    // 檢查是否提供了必要的日期參數
    const hasYearMonth = year && month;
    const hasDateRange = dateStart || dateEnd;

    if (!hasYearMonth && !hasDateRange) {
      return c.json(
        {
          error: "必須提供年月參數 (year, month) 或日期範圍參數 (dateStart, dateEnd)",
        },
        400
      );
    }

    const currentDate = moment().format("YYYY-MM-DD");
    const whereConditions = [
      eq(gigs.employerId, user.employerId),
      eq(gigs.isActive, true),
      lte(gigs.publishedAt, currentDate),
      sql`(${gigs.unlistedAt} IS NULL OR ${gigs.unlistedAt} >= ${currentDate})`,
    ];

    // 處理日期查詢邏輯
    if (hasYearMonth) {
      // 月份查詢模式
      const yearNum = Number.parseInt(year);
      const monthNum = Number.parseInt(month);

      // 驗證年月範圍
      if (yearNum < 2020 || yearNum > 2050 || monthNum < 1 || monthNum > 12) {
        return c.json(
          {
            error: "年份必須在 2020-2050 之間，月份必須在 1-12 之間",
          },
          400
        );
      }

      // 建立該月份的開始和結束日期
      const startDate = moment(`${yearNum}-${monthNum.toString().padStart(2, "0")}-01`).format("YYYY-MM-DD");
      const endDate = moment(startDate).endOf("month").format("YYYY-MM-DD");

      // 查詢工作期間與該月有重疊的工作
      whereConditions.push(and(lte(gigs.dateStart, endDate), gte(gigs.dateEnd, startDate)));
    } else if (hasDateRange) {
      if (dateStart && dateEnd) {
        // 工作期間與搜尋範圍有重疊
        whereConditions.push(and(lte(gigs.dateStart, dateEnd), gte(gigs.dateEnd, dateStart)));
      } else if (dateStart) {
        // 只提供開始日期
        whereConditions.push(gte(gigs.dateEnd, dateStart));
      } else if (dateEnd) {
        // 只提供結束日期
        whereConditions.push(lte(gigs.dateStart, dateEnd));
      }
    }

    const calendarGigs = await dbClient.query.gigs.findMany({
      where: and(...whereConditions),
      orderBy: [gigs.dateStart, gigs.timeStart],
      columns: {
        gigId: true,
        title: true,
        dateStart: true,
        dateEnd: true,
        timeStart: true,
        timeEnd: true,
      },
    });

    return c.json(
      {
        gigs: calendarGigs,
        count: calendarGigs.length,
        queryInfo: {
          year: year || null,
          month: month || null,
          dateStart: dateStart || null,
          dateEnd: dateEnd || null,
        },
      },
      200
    );
  } catch (error) {
    console.error("獲取 Employer 行事曆時出錯:", error);
    return c.text("伺服器內部錯誤", 500);
  }
});

export default { path: "/gig", router } as IRouter;
