import { Hono } from "hono";
import { authenticated } from "../Middleware/authentication";
import { requireEmployer, requireApprovedEmployer } from "../Middleware/guards";
import type IRouter from "../Interfaces/IRouter";
import type { HonoGenericContext } from "../Types/types";
import dbClient from "../Client/DrizzleClient";
import { eq, and, desc, sql, gte, lte, or, lt, gt, count } from "drizzle-orm";
import { gigs, gigApplications, attendanceCodes } from "../Schema/DatabaseSchema";
import { zValidator } from "@hono/zod-validator";
import { createGigSchema, updateGigSchema } from "../Types/zodSchema";
import { uploadEnvironmentPhotos } from "../Middleware/fileUpload";
import { FileManager, s3Client, GigCache } from "../Client/Cache/Index";
import { DateUtils } from "../Utils/DateUtils";
import { generateAttendanceCode } from "../Utils/AttendanceUtils";

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
      return {
        environmentPhotosInfo: existingPhotos,
        uploadedFiles: [],
        addedCount: 0,
        totalCount: existingPhotos.length,
        message: "不能再添加照片，已達最大限制（3張）",
      };
    }
    uploadedFiles = files.slice(0, canAdd);
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
        const key = `environment-photos/${file.filename}`;
        await s3Client.file(key).write(file.file as Blob, { type: file.type });
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
          console.warn('照片物件缺少 filename:', photo);
          return {
            url: null,
            error: "照片資料不完整",
            originalName: "********",
            type: photo?.type || 'unknown'
          };
        }

        const presignedUrl = await FileManager.getPresignedUrl(`environment-photos/${photo.filename}`);

        if (!presignedUrl) {
          console.warn(`環境照片 URL 生成失敗: ${photo.filename}`);
          return {
            url: null,
            error: "圖片連結生成失敗",
            originalName: "********",
            type: photo.type,
            filename: "********"
          };
        } else {
          return {
            url: presignedUrl,
            originalName: "********",
            type: photo.type,
            filename: "********"
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
    dateStart,
    dateEnd,
    publishedAt,
    unlistedAt,
  } = body;

  return {
    employerId: user.employerId,
    ...body,
    dateStart: dateStart ? DateUtils.formatDate(dateStart) : null,
    dateEnd: dateEnd ? DateUtils.formatDate(dateEnd) : null,
    publishedAt: publishedAt ? DateUtils.formatDate(publishedAt) : DateUtils.getCurrentDate(),
    unlistedAt: unlistedAt ? DateUtils.formatDate(unlistedAt) : null,
    environmentPhotos: environmentPhotosInfo ? environmentPhotosInfo : null,
  };
}

// 刪除 S3 文件
router.delete("/deleteFile/:filename", authenticated, requireEmployer, requireApprovedEmployer, async (c) => {
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
        dateEnd: true,
        isActive: true,
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

    const today = DateUtils.getCurrentDate();

    // 檢查工作是否已過期
    if (DateUtils.formatDate(targetGig.dateEnd) < today) {
      return c.json(
        {
          message: "工作已過期，無法刪除照片",
        },
        400
      );
    }

    // 檢查工作是否已關閉
    if (!targetGig.isActive) {
      return c.json(
        {
          message: "工作已關閉，無法刪除照片",
        },
        400
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
        updatedAt: sql`now()`,
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
    const searchQuery = c.req.query("searchQuery");

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
    const today = DateUtils.getCurrentDate();
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

    // PGroonga 關鍵字搜尋（title / description 任一符合）
    searchQuery ? whereConditions.push(sql`(${gigs.title} &@~ ${searchQuery} OR ${gigs.description} &@~ ${searchQuery})`) : null;

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
        searchQuery: searchQuery || null,
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

    const today = DateUtils.getCurrentDate();

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

    if (gig.employer.employerPhoto && typeof gig.employer.employerPhoto === 'object' && 'r2Name' in gig.employer.employerPhoto) {
      const photo = gig.employer.employerPhoto as any;
      const url = await FileManager.getPresignedUrl(`profile-photos/employers/${photo.r2Name}`);
      if (url) {
        gig.employer.employerPhoto = {
          url: url,
          originalName: photo.originalName,
          type: photo.type,
        };
      }
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
  requireEmployer,
  requireApprovedEmployer,
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
      await GigCache.clearMyGigsCount(user.employerId);

      const newGig = insertedGig[0];

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
          }
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
    }
  }
);

// 獲取自己發佈的工作
router.get("/my-gigs", authenticated, requireEmployer, async (c) => {
  try {
    const user = c.get("user");
    const limit = c.req.query("limit") || "10";
    const offset = c.req.query("offset") || "0";
    const status = c.req.query("status") || "ongoing";
    const requestLimit = Number.parseInt(limit);
    const requestOffset = Number.parseInt(offset);
    const currentDate = DateUtils.getCurrentDate();

    // 建立基本查詢條件
    const whereConditions = [eq(gigs.employerId, user.employerId)];

    // 根據狀態參數添加日期條件
    if (status && ["not_started", "ongoing", "completed", "closed", "unpublished"].includes(status)) {
      if (status === "not_started") {
        // 未開始：dateStart > currentDate 且 isActive = true
        whereConditions.push(gt(gigs.dateStart, currentDate), eq(gigs.isActive, true));
      } else if (status === "completed") {
        // 已結束：dateEnd < currentDate
        whereConditions.push(lt(gigs.dateEnd, currentDate));
      } else if (status === "ongoing") {
        // 進行中：dateStart <= currentDate AND dateEnd >= currentDate 且 isActive = true
        whereConditions.push(and(lte(gigs.dateStart, currentDate), gte(gigs.dateEnd, currentDate)), eq(gigs.isActive, true));
      } else if (status === "closed") {
        // 已關閉：isActive = false
        whereConditions.push(eq(gigs.isActive, false));
      } else if (status === "unpublished") {
        // 已下架：isActive = true 且 unlistedAt 不為空 且 dateEnd >= currentDate
        whereConditions.push(
          eq(gigs.isActive, true),
          gte(gigs.dateEnd, currentDate),
          sql`${gigs.unlistedAt} IS NOT NULL`
        );
      }
    }

    const myGigs = await dbClient.query.gigs.findMany({
      where: and(...whereConditions),
      orderBy: [desc(gigs.createdAt), desc(gigs.gigId)],
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
        dateStart: gig.dateStart ? DateUtils.formatDate(gig.dateStart) : null,
        dateEnd: gig.dateEnd ? DateUtils.formatDate(gig.dateEnd) : null,
        publishedAt: gig.publishedAt ? DateUtils.formatDate(gig.publishedAt) : null,
        unlistedAt: gig.unlistedAt ? DateUtils.formatDate(gig.unlistedAt) : null,
        environmentPhotos: await formatEnvironmentPhotos(gig.environmentPhotos, 1),
      }))
    );

    let totalCountValue = await GigCache.getMyGigsCount(user.employerId, status);
    if (totalCountValue == null) {
      const [row] = await dbClient
        .select({ total: count() })
        .from(gigs)
        .where(and(...whereConditions));
      totalCountValue = Number(row?.total ?? 0);
      await GigCache.setMyGigsCount(user.employerId, status, totalCountValue);
    }

    const totalPage = Math.max(1, Math.ceil(totalCountValue / requestLimit));

    return c.json(
      {
        gigs: gigsWithPhotos,
        pagination: {
          limit: requestLimit,
          offset: requestOffset,
          hasMore,
          returned: gigsWithPhotos.length,
          totalCount: totalCountValue,
          totalPage,
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
    const gig = await dbClient.query.gigs.findFirst({
      where: and(eq(gigs.gigId, gigId), eq(gigs.employerId, user.employerId)),
    });

    if (!gig) {
      return c.text("工作不存在或無權限查看", 404);
    }

    // 檢查當天是否已有打卡碼
    const today = DateUtils.getCurrentDate();
    const existingCode = await dbClient.query.attendanceCodes.findFirst({
      where: and(
        eq(attendanceCodes.gigId, gigId),
        eq(attendanceCodes.validDate, today),
      )
    });

    let attendanceCode: string;
    let attendanceCodeInfo: any;

    if (existingCode) {
      // 使用現有的打卡碼
      attendanceCode = existingCode.attendanceCode;
      attendanceCodeInfo = {
        attendanceCode,
        validDate: existingCode.validDate,
        expiresAt: existingCode.expiresAt,
      };
    } else {
      // 生成新的打卡碼
      attendanceCode = generateAttendanceCode();
      
      // 儲存打卡碼到資料庫
      const [newCode] = await dbClient.insert(attendanceCodes).values({
        gigId,
        attendanceCode,
        validDate: today,
        expiresAt: sql`(CURRENT_DATE + INTERVAL '1 day' - INTERVAL '1 second')`
      }).returning();
      
      attendanceCodeInfo = {
        attendanceCode,
        validDate: newCode.validDate,
        expiresAt: newCode.expiresAt,
      };
      
      console.log(`生成新打卡碼 - 工作ID: ${gigId}, 打卡碼: ${attendanceCode}`);
    }

    return c.json(
      {
        ...gig,
        environmentPhotos: await formatEnvironmentPhotos(gig.environmentPhotos),
        attendanceCodeInfo
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

      // 檢查工作是否存在
      const existingGig = await dbClient.query.gigs.findFirst({
        where: and(eq(gigs.gigId, gigId), eq(gigs.employerId, user.employerId)),
      });

      if (!existingGig) {
        return c.text("工作不存在或無權限修改", 404);
      }

      const today = DateUtils.getCurrentDate();

      // 檢查工作是否已過期
      if (DateUtils.formatDate(existingGig.dateEnd) < today) {
        return c.text("工作已過期，無法更新", 400);
      }

      // 檢查工作是否已關閉
      if (!existingGig.isActive) {
        return c.text("工作已關閉，無法更新", 400);
      }

      // 處理照片上傳
      const existingPhotos = Array.isArray(existingGig.environmentPhotos) ? existingGig.environmentPhotos : [];
      const { environmentPhotosInfo, uploadedFiles: filesList, addedCount, totalCount, message } = await handlePhotoUpload(reqFile, existingPhotos);
      uploadedFiles = filesList;

      await dbClient
        .update(gigs)
        .set({
          ...body,
          updatedAt: sql`now()`,
          dateStart: body.dateStart ? DateUtils.formatDate(body.dateStart) : undefined,
          dateEnd: body.dateEnd ? DateUtils.formatDate(body.dateEnd) : undefined,
          publishedAt: body.publishedAt ? DateUtils.formatDate(body.publishedAt) : DateUtils.getCurrentDate(),
          unlistedAt: body.unlistedAt ? DateUtils.formatDate(body.unlistedAt) : undefined,
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

      await GigCache.clearMyGigsCount(user.employerId);

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
    }
  }
);

// 關閉工作
router.patch("/:gigId/toggle-status", authenticated, requireEmployer, requireApprovedEmployer, async (c) => {
  const user = c.get("user");
  try {
    const gigId = c.req.param("gigId");
    const today = DateUtils.getCurrentDate();

    // 查詢獲取工作資料
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
      return c.json(
        {
          message: "工作不存在或無權限修改",
        },
        404
      );
    }

    // 如果工作已自然過期，不允許手動關閉
    if (DateUtils.formatDate(gigWithApplications.dateEnd) < today) {
      return c.json(
        {
          message: "工作已過期結束，無法手動操作",
        },
        400
      );
    }

    // 如果工作已經關閉，不允許重新開啟
    if (!gigWithApplications.isActive) {
      return c.json(
        {
          message: "工作已關閉，無法重新開啟",
        },
        400
      );
    }

    // 檢查工作是否有已核准的申請者
    if (gigWithApplications.gigApplications.length > 0) {
      return c.json(
        {
          message: "工作有已核准的申請者，請先處理相關申請",
        },
        400
      );
    }

    // 手動關閉工作
    await dbClient
      .update(gigs)
      .set({
        isActive: false,
        updatedAt: sql`now()`,
      })
      .where(eq(gigs.gigId, gigId));

    await GigCache.clearMyGigsCount(user.employerId);

    return c.json(
      {
        message: "工作已手動關閉",
      },
      200
    );
  } catch (error) {
    console.error("關閉工作時出錯:", error);
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

    const today = DateUtils.getCurrentDate();

    // 檢查工作是否已過期
    if (DateUtils.formatDate(existingGig.dateEnd) < today) {
      return c.text("工作已過期，無法操作", 400);
    }

    // 檢查工作是否已關閉
    if (!existingGig.isActive) {
      return c.text("工作已關閉，無法操作", 400);
    }
    
    const isCurrentlyListed = !existingGig.unlistedAt || existingGig.unlistedAt >= today;

    // 如果要下架工作，檢查是否已發佈
    if (isCurrentlyListed) {
      if (DateUtils.formatDate(existingGig.publishedAt) > today) {
        return c.text("工作尚未發佈，無法下架", 400);
      }
    }

    const newUnlistedAt = isCurrentlyListed ? today : null;

    await dbClient
      .update(gigs)
      .set({
        unlistedAt: newUnlistedAt,
        updatedAt: sql`now()`,
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
    const limit = c.req.query("limit") || "100";
    const offset = c.req.query("offset") || "0";
    const requestLimit = Number.parseInt(limit);
    const requestOffset = Number.parseInt(offset);

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

    const currentDate = DateUtils.getCurrentDate();
    const whereConditions = [
      eq(gigs.employerId, user.employerId),
      eq(gigs.isActive, true),
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
      const { startDate, endDate } = DateUtils.getMonthRange(yearNum, monthNum);

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
        environmentPhotos: true,
      },
      limit: requestLimit + 1, // 多查一筆來判斷 hasMore
      offset: requestOffset,
    });

    // 判斷是否有更多數據
    const hasMore = calendarGigs.length > requestLimit;
    const actualCalendarGigs = hasMore ? calendarGigs.slice(0, requestLimit) : calendarGigs;

    // 為每個工作處理環境照片，只取 1 張
    const gigsWithPhotos = await Promise.all(
      actualCalendarGigs.map(async (gig) => ({
        ...gig,
        environmentPhotos: await formatEnvironmentPhotos(gig.environmentPhotos, 1),
      }))
    );

    return c.json(
      {
        gigs: gigsWithPhotos,
        queryInfo: {
          year: year || null,
          month: month || null,
          dateStart: dateStart || null,
          dateEnd: dateEnd || null,
        },
        pagination: {
          limit: requestLimit,
          offset: requestOffset,
          hasMore: hasMore,
          returned: gigsWithPhotos.length,
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
