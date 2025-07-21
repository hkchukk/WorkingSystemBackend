import { Router } from "@nhttp/nhttp";
import { authenticated } from "../Middleware/middleware.ts";
import {
  requireWorker,
  requireEmployer,
  requireApprovedEmployer
} from "../Middleware/guards.ts";
import type IRouter from "../Interfaces/IRouter.ts";
import dbClient from "../Client/DrizzleClient.ts";
import { eq, and, desc, or, lte, sql, gte } from "drizzle-orm";
import {
  gigs,
  gigApplications,
  employers,
} from "../Schema/DatabaseSchema.ts";
import validate from "@nhttp/zod";
import { reviewApplicationSchema } from "../Middleware/validator.ts";
import moment from "moment";
import NotificationHelper from "../Utils/NotificationHelper.ts";

const router = new Router();

// ========== Worker 相關路由 ==========

/**
 * Worker 申請工作
 * POST /application/apply/:gigId
 */
router.post(
  "/apply/:gigId",
  authenticated,
  requireWorker,
  async ({ user, params, response }) => {
    try {
      const { gigId } = params;
      const currentDate = moment().set({ hour: 0, minute: 0, second: 0, millisecond: 0 });
      const gig = await dbClient.query.gigs.findFirst({
        where: and(
          eq(gigs.gigId, gigId),
          eq(gigs.isActive, true),
          lte(gigs.publishedAt, currentDate.format('YYYY-MM-DD')),
          gte(gigs.dateEnd, currentDate.format('YYYY-MM-DD')),
          sql`(${gigs.unlistedAt} IS NULL OR ${gigs.unlistedAt} >= ${currentDate.format('YYYY-MM-DD')})`
        )
      });

      if (!gig) {
        return response.status(404).send({
          message: "工作不存在、已過期或已下架",
        });
      }

      // 檢查是否已經申請過這個工作（只有 pending 和 approved 狀態算作已申請）
      const existingApplication = await dbClient.query.gigApplications.findFirst({
        where: and(
          eq(gigApplications.workerId, user.workerId),
          eq(gigApplications.gigId, gigId),
          or(eq(gigApplications.status, "pending"), eq(gigApplications.status, "approved"))
        ),
      });

      if (existingApplication) {
        const statusText = existingApplication.status === "pending" ? "待審核" : "已核准";
        return response.status(400).send({
          message: `您已經申請過這個工作（${statusText}）`,
          applicationStatus: existingApplication.status,
        });
      }

      // 創建申請記錄
      const newApplication = await dbClient
        .insert(gigApplications)
        .values({
          workerId: user.workerId,
          gigId: gigId,
          status: "pending",
        })
        .returning();

      // 發送通知給商家
      await NotificationHelper.notifyApplicationReceived(
        gig.employerId,
        `${user.firstName} ${user.lastName}`,
        gig.title
      );

      return response.status(201).send({
        message: "申請提交成功，等待商家審核",
        data: {
          applicationId: newApplication[0].applicationId,
          gigTitle: gig.title,
          status: "pending",
          appliedAt: newApplication[0].createdAt,
        },
      });

    } catch (error) {
      console.error("申請工作時發生錯誤:", error);
      return response.status(500).send({
        message: "申請工作失敗",
        error: error instanceof Error ? error.message : "未知錯誤",
      });
    }
  }
);

/**
 * Worker 取消申請
 * POST /application/cancel/:applicationId
 */
router.post("/cancel/:applicationId", authenticated, requireWorker, async ({ user, params, response }) => {
  try {
    const { applicationId } = params;

    // 查找申請記錄
    const application = await dbClient.query.gigApplications.findFirst({
      where: and(
        eq(gigApplications.applicationId, applicationId),
        eq(gigApplications.workerId, user.workerId)
      )
    });

    if (!application) {
      return response.status(404).send({
        message: "申請記錄不存在",
      });
    }

    // 只有 pending 狀態的申請可以取消
    if (application.status !== "pending") {
      return response.status(400).send({
        message: `無法取消 ${application.status === "approved" ? "已核准" : "已拒絕"} 的申請`,
      });
    }

    // 更新申請狀態為 cancelled
    await dbClient
      .update(gigApplications)
      .set({
        status: "cancelled",
        updatedAt: new Date(),
      })
      .where(eq(gigApplications.applicationId, applicationId));

    return response.status(200).send({
      message: "申請已成功取消",
      data: {
        applicationId: applicationId,
        status: "cancelled",
      },
    });

  } catch (error) {
    console.error("取消申請時發生錯誤:", error);
    return response.status(500).send({
      message: "取消申請失敗",
      error: error instanceof Error ? error.message : "未知錯誤",
    });
  }
});

/**
 * Worker 查看自己的申請記錄
 * GET /application/my-applications
 */
router.get("/my-applications", authenticated, requireWorker, async ({ user, query, response }) => {
  try {
    const { status, limit = 10, offset = 0 } = query;

    // 建立查詢條件
    const whereConditions = [eq(gigApplications.workerId, user.workerId)];

    if (status && ["pending", "approved", "rejected", "cancelled"].includes(status)) {
      whereConditions.push(eq(gigApplications.status, status));
    }

    const requestLimit = Number.parseInt(limit);
    const requestOffset = Number.parseInt(offset);

    // 查詢申請記錄（多查一筆來判斷是否還有更多數據）
    const applications = await dbClient.query.gigApplications.findMany({
      where: and(...whereConditions),
      with: {
        gig: {
          with: {
            employer: true,
          },
        },
      },
      orderBy: [desc(gigApplications.createdAt)],
      limit: requestLimit + 1, // 多查一筆來判斷 hasMore
      offset: requestOffset,
    });

    // 判斷是否有更多數據
    const hasMore = applications.length > requestLimit;
    const actualApplications = hasMore ? applications.slice(0, requestLimit) : applications;

    return response.status(200).send({
      message: "獲取申請記錄成功",
      data: {
        applications: actualApplications.map(app => ({
          applicationId: app.applicationId,
          gigId: app.gigId,
          gigTitle: app.gig.title,
          employerName: app.gig.employer.employerName,
          hourlyRate: app.gig.hourlyRate,
          workDate: `${app.gig.dateStart} ~ ${app.gig.dateEnd}`,
          workTime: `${app.gig.timeStart} ~ ${app.gig.timeEnd}`,
          status: app.status,
          appliedAt: app.createdAt,
        })),
        pagination: {
          limit: requestLimit,
          offset: requestOffset,
          hasMore: hasMore,
          returned: actualApplications.length,
        },
      },
    });

  } catch (error) {
    console.error("查看申請記錄時發生錯誤:", error);
    return response.status(500).send({
      message: "獲取申請記錄失敗",
      error: error instanceof Error ? error.message : "未知錯誤",
    });
  }
});

/**
 * Worker 行事曆 - 查看已核准的工作行程
 * GET /application/worker/calendar
 */
router.get("/worker/calendar", authenticated, requireWorker, async ({ user, query, response }) => {
  try {
    const {
      year,
      month,
      dateStart,
      dateEnd
    } = query;

    // 檢查是否提供了必要的日期參數
    const hasYearMonth = year && month;
    const hasDateRange = dateStart || dateEnd;

    if (!hasYearMonth && !hasDateRange) {
      return response.status(400).send({
        error: "必須提供年月參數 (year, month) 或日期範圍參數 (dateStart, dateEnd)"
      });
    }

    // 建立基本查詢條件
    const whereConditions = [
      eq(gigApplications.workerId, user.workerId),
      eq(gigApplications.status, "approved")
    ];

    // 根據日期參數添加過濾條件
    if (hasYearMonth) {
      // 月份查詢模式
      const yearNum = Number.parseInt(year);
      const monthNum = Number.parseInt(month);

      if (yearNum < 2020 || yearNum > 2050 || monthNum < 1 || monthNum > 12) {
        return response.status(400).send({
          error: "年份必須在 2020-2050 之間，月份必須在 1-12 之間"
        });
      }

      const startDate = moment(`${yearNum}-${monthNum.toString().padStart(2, '0')}-01`).format('YYYY-MM-DD');
      const endDate = moment(startDate).endOf('month').format('YYYY-MM-DD');

      // 過濾工作期間與該月有重疊的工作
      whereConditions.push(
        and(
          lte(gigs.dateStart, endDate),
          gte(gigs.dateEnd, startDate)
        )
      );
    } else if (hasDateRange) {
      // 自訂日期範圍模式
      dateStart ? whereConditions.push(gte(gigs.dateStart, dateStart)) : null;
      dateEnd ? whereConditions.push(lte(gigs.dateEnd, dateEnd)) : null;
    }

    // 執行資料庫查詢
    const results = await dbClient
      .select({
        gigId: gigs.gigId,
        title: gigs.title,
        dateStart: gigs.dateStart,
        dateEnd: gigs.dateEnd,
        timeStart: gigs.timeStart,
        timeEnd: gigs.timeEnd,
        employerId: employers.employerId,
        employerName: employers.employerName,
        branchName: employers.branchName
      })
      .from(gigApplications)
      .innerJoin(gigs, eq(gigApplications.gigId, gigs.gigId))
      .innerJoin(employers, eq(gigs.employerId, employers.employerId))
      .where(and(...whereConditions))
      .orderBy(gigs.dateStart, gigs.timeStart);

    const calendarGigs = results.map(row => {
      return {
        gigId: row.gigId,
        title: row.title,
        dateStart: row.dateStart,
        dateEnd: row.dateEnd,
        timeStart: row.timeStart,
        timeEnd: row.timeEnd,
        employer: {
          employerId: row.employerId,
          employerName: row.employerName,
          branchName: row.branchName
        },
      };
    });

    return response.status(200).send({
      message: "獲取 Worker 行事曆成功",
      data: {
        gigs: calendarGigs,
        count: calendarGigs.length,
        queryInfo: {
          year: year || null,
          month: month || null,
          dateStart: dateStart || null,
          dateEnd: dateEnd || null,
        }
      }
    });

  } catch (error) {
    console.error("獲取 Worker 行事曆時發生錯誤:", error);
    return response.status(500).send({
      message: "獲取 Worker 行事曆失敗",
      error: error instanceof Error ? error.message : "未知錯誤",
    });
  }
});

// ========== Employer 相關路由 ==========

/**
 * Employer 查看工作申請詳情
 * GET /application/gig/:gigId
 */
router.get("/gig/:gigId", authenticated, requireEmployer, requireApprovedEmployer, async ({ user, params, query, response }) => {
  try {
    const { gigId } = params;
    const { status, limit = 10, offset = 0 } = query;

    // 檢查工作權限
    const gig = await dbClient.query.gigs.findFirst({
      where: and(eq(gigs.gigId, gigId), eq(gigs.employerId, user.employerId)),
    });

    if (!gig) {
      return response.status(404).send({
        message: "工作不存在或無權限查看",
      });
    }

    const whereConditions = [eq(gigApplications.gigId, gigId)];

    // 單一狀態過濾：?status=pending 或不傳參數顯示全部
    if (status && ["pending", "approved", "rejected", "cancelled"].includes(status)) {
      whereConditions.push(eq(gigApplications.status, status));
    }

    const requestLimit = Number.parseInt(limit);
    const requestOffset = Number.parseInt(offset);

    // 查詢申請記錄（多查一筆來判斷是否還有更多數據）
    const applications = await dbClient.query.gigApplications.findMany({
      where: and(...whereConditions),
      with: {
        worker: true,
      },
      orderBy: [desc(gigApplications.createdAt)],
      limit: requestLimit + 1, // 多查一筆來判斷 hasMore
      offset: requestOffset,
    });

    // 判斷是否有更多數據
    const hasMore = applications.length > requestLimit;
    const actualApplications = hasMore ? applications.slice(0, requestLimit) : applications;

    // 計算統計資訊
    // 按工作分組統計

    return response.status(200).send({
      message: "獲取工作申請列表成功",
      data: {
        gigTitle: gig.title,
        applications: actualApplications.map(app => ({
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
          hasMore: hasMore,
          returned: actualApplications.length,
        },
      },
    });

  } catch (error) {
    console.error("查看工作申請時發生錯誤:", error);
    return response.status(500).send({
      message: "獲取工作申請列表失敗",
      error: error instanceof Error ? error.message : "未知錯誤",
    });
  }
});

/**
 * Employer 審核申請（核准或拒絕）
 * PUT /application/:applicationId/review
 */
router.put(
  "/:applicationId/review",
  authenticated,
  requireEmployer,
  requireApprovedEmployer,
  validate(reviewApplicationSchema),
  async ({ user, params, body, response }) => {
    try {
      const { applicationId } = params;
      const { status } = body;

      // 查找申請記錄
      const application = await dbClient.query.gigApplications.findFirst({
        where: eq(gigApplications.applicationId, applicationId),
        with: {
          gig: true,
        },
      });

      if (!application) {
        return response.status(404).send({
          message: "申請記錄不存在",
        });
      }

      // 檢查工作是否屬於該商家
      if (application.gig.employerId !== user.employerId) {
        return response.status(403).send({
          message: "您無權審核此申請",
        });
      }

      // 檢查工作是否仍然有效
      if (!application.gig.isActive) {
        return response.status(400).send({
          message: "此工作已停用，無法審核申請",
        });
      }

      // 檢查工作是否已過期
      const currentDate = moment().format('YYYY-MM-DD');
      if (application.gig.dateEnd && application.gig.dateEnd < currentDate) {
        return response.status(400).send({
          message: "此工作已過期，無法審核申請",
        });
      }

      // 只有 pending 狀態的申請可以審核
      if (application.status !== "pending") {
        return response.status(400).send({
          message: "此申請已經處理過了",
          currentStatus: application.status,
        });
      }

      // 更新申請狀態
      await dbClient
        .update(gigApplications)
        .set({
          status: status,
          updatedAt: new Date(),
        })
        .where(eq(gigApplications.applicationId, applicationId));

      // 發送通知給打工者
      if (status === "approved") {
        await NotificationHelper.notifyApplicationApproved(
          application.workerId,
          application.gig.title,
          user.employerName
        );
      } else if (status === "rejected") {
        await NotificationHelper.notifyApplicationRejected(
          application.workerId,
          application.gig.title,
          user.employerName,
          body.reason // 如果有拒絕原因的話
        );
      }

      const statusText = status === "approved" ? "核准" : "拒絕";

      return response.status(200).send({
        message: `申請已${statusText}`,
        data: {
          applicationId: applicationId,
          status: status,
        },
      });

    } catch (error) {
      console.error("審核申請時發生錯誤:", error);
      return response.status(500).send({
        message: "審核申請失敗",
        error: error instanceof Error ? error.message : "未知錯誤",
      });
    }
  }
);

/**
 * Employer 查看所有工作的申請
 * GET /application/gig/all
 */
router.get("/gig/all", authenticated, requireEmployer, requireApprovedEmployer, async ({ user, query, response }) => {
  try {
    const { status, limit = 10, offset = 0 } = query;

    // 先查詢該商家的所有工作 ID
    const userGigs = await dbClient.query.gigs.findMany({
      where: eq(gigs.employerId, user.employerId),
      columns: { gigId: true },
    });

    const userGigIds = userGigs.map(gig => gig.gigId);

    if (userGigIds.length === 0) {
      // 如果沒有工作，直接返回空結果
      return response.status(200).send({
        message: "沒有找到任何申請記錄",
      });
    }

    // 查詢所有工作的申請記錄
    let applicationWhereConditions = [];

    // 單一狀態過濾：?status=pending 或不傳參數顯示全部
    let applicationStatusConditions = null;

    if (status && ["pending", "approved", "rejected", "cancelled"].includes(status)) {
      applicationStatusConditions = eq(gigApplications.status, status);
    }

    // 建立申請查詢條件
    if (userGigIds.length === 1) {
      applicationWhereConditions.push(eq(gigApplications.gigId, userGigIds[0]));
    } else {
      const gigIdConditions = userGigIds.map(id => eq(gigApplications.gigId, id));
      applicationWhereConditions.push(or(...gigIdConditions));
    }

    // 添加狀態過濾條件
    if (applicationStatusConditions) {
      applicationWhereConditions.push(applicationStatusConditions);
    }

    const requestLimit = Number.parseInt(limit);
    const requestOffset = Number.parseInt(offset);

    // 查詢申請記錄
    const applications = await dbClient.query.gigApplications.findMany({
      with: {
        gig: true,
      },
      where: and(...applicationWhereConditions),
      orderBy: [desc(gigApplications.createdAt)],
      limit: requestLimit + 1, // 多查一筆來判斷 hasMore
      offset: requestOffset,
    });

    // 判斷是否有更多數據
    const hasMore = applications.length > requestLimit;
    const actualApplications = hasMore ? applications.slice(0, requestLimit) : applications;

    // 按工作分組並整合統計與申請資料
    const gigsWithApplications = actualApplications.reduce((acc: Record<string, any>, app) => {
      const gigId = app.gigId;

      acc[gigId] ??= {
        gigId: app.gig.gigId,
        gigTitle: app.gig.title,
        applicationCount: 0,
        applications: []
      };

      acc[gigId].applicationCount++;
      acc[gigId].applications.push({
        applicationId: app.applicationId,
        status: app.status,
        appliedAt: app.createdAt,
      });

      return acc;
    }, {});

    return response.status(200).send({
      message: "獲取所有申請記錄成功",
      data: {
        gigs: Object.values(gigsWithApplications),
        pagination: {
          limit: requestLimit,
          offset: requestOffset,
          hasMore: hasMore,
          returned: actualApplications.length,
        },
      },
    });

  } catch (error) {
    console.error("查看所有申請時發生錯誤:", error);
    return response.status(500).send({
      message: "獲取所有申請失敗",
      error: error instanceof Error ? error.message : "未知錯誤",
    });
  }
});

// 導出路由
export default { path: "/application", router } as IRouter;