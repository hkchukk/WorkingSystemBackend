import { Router } from "@nhttp/nhttp";
import { authenticated } from "../Middleware/middleware.ts";
import { requireWorker, requireEmployer, requireApprovedEmployer } from "../Middleware/guards.ts";
import type IRouter from "../Interfaces/IRouter.ts";
import dbClient from "../Client/DrizzleClient.ts";
import { eq, and, desc, sql, count } from "drizzle-orm";
import { gigs, gigApplications, workers, employers, workerRatings, employerRatings } from "../Schema/DatabaseSchema.ts";
import validate from "@nhttp/zod";
import { createRatingSchema } from "../Middleware/validator.ts";
import moment from "moment";

const router = new Router();

// ========== 商家對打工者評分（基於工作）==========

/**
 * 商家對打工者評分
 * POST /rating/worker/:workerId/gig/:gigId
 */
router.post(
  "/worker/:workerId/gig/:gigId",
  authenticated,
  requireEmployer,
  requireApprovedEmployer,
  validate(createRatingSchema),
  async ({ user, params, body, response }) => {
    try {
      const { gigId, workerId } = params;
      const { ratingValue, comment } = body;
      const employerId = user.employerId;

      // 檢查是否已經評分過
      const existingRating = await dbClient
        .select({ value: count() })
        .from(workerRatings)
        .where(and(eq(workerRatings.gigId, gigId), eq(workerRatings.workerId, workerId), eq(workerRatings.employerId, employerId)));

      const hasRated = existingRating[0].value > 0;

      if (hasRated) {
        return response.status(400).send({
          message: "您已經對這位打工者評分過了",
        });
      }

      // 直接查詢符合所有條件的紀錄總數，並檢查工作是否已結束
      const currentDate = moment().format("YYYY-MM-DD"); // YYYY-MM-DD 格式
      const result = await dbClient
        .select({ value: count() })
        .from(gigs)
        .innerJoin(
          gigApplications,
          and(
            // JOIN 的條件
            eq(gigs.gigId, gigApplications.gigId),
            eq(gigApplications.workerId, workerId),
            eq(gigApplications.status, "approved")
          )
        )
        .where(
          and(
            // Gigs 表的過濾條件
            eq(gigs.gigId, gigId),
            eq(gigs.employerId, employerId),
            sql`${gigs.dateEnd} < ${currentDate}` // 工作必須已結束
          )
        );

      const exists = result[0].value > 0;

      if (!exists) {
        return response.status(404).send({
          message: "找不到可評分的工作、指定的打工者沒有已批准的申請，或工作尚未結束",
        });
      }

      // 創建評分
      const [newRating] = await dbClient
        .insert(workerRatings)
        .values({
          gigId,
          workerId,
          employerId,
          ratingValue,
          comment: comment || null,
        })
        .returning();

      return response.status(201).send({
        message: "評分成功",
        data: {
          ratingId: newRating.ratingId,
          ratingValue: newRating.ratingValue,
          comment: newRating.comment,
          createdAt: newRating.createdAt,
        },
      });
    } catch (error) {
      console.error("評分打工者時發生錯誤:", error);
      return response.status(500).send({
        message: "評分失敗，請稍後再試",
      });
    }
  }
);

/**
 * 打工者對商家評分
 * POST /rating/employer/:employerId/gig/:gigId
 */
router.post(
  "/employer/:employerId/gig/:gigId",
  authenticated,
  requireWorker,
  validate(createRatingSchema),
  async ({ user, params, body, response }) => {
    try {
      const { gigId, employerId } = params;
      const { ratingValue, comment } = body;
      const workerId = user.workerId;

      // 檢查是否已經評分過
      const existingRating = await dbClient
        .select({ value: count() })
        .from(employerRatings)
        .where(and(eq(employerRatings.gigId, gigId), eq(employerRatings.workerId, workerId), eq(employerRatings.employerId, employerId)));

      const hasRated = existingRating[0].value > 0;

      if (hasRated) {
        return response.status(400).send({
          message: "您已經對這個商家評分過了",
        });
      }
      
      // 直接查詢符合所有條件的紀錄總數，並檢查工作是否已結束
      const currentDate = moment().format("YYYY-MM-DD"); // YYYY-MM-DD 格式
      const result = await dbClient
        .select({ value: count() })
        .from(gigs)
        .innerJoin(
          gigApplications,
          and(
            // JOIN 的條件
            eq(gigs.gigId, gigApplications.gigId),
            eq(gigApplications.workerId, workerId),
            eq(gigApplications.status, "approved")
          )
        )
        .where(
          and(
            // Gigs 表的過濾條件
            eq(gigs.gigId, gigId),
            eq(gigs.employerId, employerId),
            sql`${gigs.dateEnd} < ${currentDate}` // 工作必須已結束
          )
        );

      const exists = result[0].value > 0;

      if (!exists) {
        return response.status(404).send({
          message: "找不到可評分的工作、您沒有此工作的已批准申請，或工作尚未結束",
        });
      }

      // 創建評分
      const [newRating] = await dbClient
        .insert(employerRatings)
        .values({
          gigId,
          employerId,
          workerId,
          ratingValue,
          comment: comment || null,
        })
        .returning();

      return response.status(201).send({
        message: "評分成功",
        data: {
          ratingId: newRating.ratingId,
          ratingValue: newRating.ratingValue,
          comment: newRating.comment,
          createdAt: newRating.createdAt,
        },
      });
    } catch (error) {
      console.error("評分商家時發生錯誤:", error);
      return response.status(500).send({
        message: "評分失敗，請稍後再試",
      });
    }
  }
);

// ========== 評分查詢 ==========

/**
 * 商家查看打工者的評分統計
 * GET /rating/worker/:workerId
 */
router.get("/worker/:workerId", authenticated, requireEmployer, requireApprovedEmployer, async ({ params, response }) => {
  try {
    const { workerId } = params;

    // 驗證打工者是否存在
    const worker = await dbClient.query.workers.findFirst({
      where: eq(workers.workerId, workerId),
      columns: {
        firstName: true,
        lastName: true,
      },
    });

    if (!worker) {
      return response.status(404).send({
        message: "找不到指定的打工者",
      });
    }

    // 使用單一查詢計算總評數和總分
    const ratingStats = await dbClient
      .select({
        count: count(),
        average: sql<number>`coalesce(avg(${workerRatings.ratingValue}), 0)`,
      })
      .from(workerRatings)
      .where(eq(workerRatings.workerId, workerId));

    const totalRatings = ratingStats[0].count;
    const averageRating = totalRatings > 0 ? ratingStats[0].average : 0;

    return response.send({
      data: {
        worker: {
          workerId,
          name: `${worker.firstName} ${worker.lastName}`,
        },
        summary: {
          totalRatings,
          averageRating: Number(averageRating.toFixed(2)),
        },
      },
    });
  } catch (error) {
    console.error("獲取打工者評分時發生錯誤:", error);
    return response.status(500).send({
      message: "獲取評分失敗，請稍後再試",
    });
  }
});

/**
 * 打工者查看商家的評分統計
 * GET /rating/employer/:employerId
 */
router.get("/employer/:employerId", authenticated, requireWorker, async ({ params, response }) => {
  try {
    const { employerId } = params;

    // 驗證商家是否存在
    const employer = await dbClient.query.employers.findFirst({
      where: eq(employers.employerId, employerId),
      columns: {
        employerName: true,
        branchName: true,
      },
    });

    if (!employer) {
      return response.status(404).send({
        message: "找不到指定的商家",
      });
    }

    // 使用單一查詢計算總評數和總分
    const ratingStats = await dbClient
      .select({
        count: count(),
        average: sql<number>`coalesce(avg(${workerRatings.ratingValue}), 0)`,
      })
      .from(employerRatings)
      .where(eq(employerRatings.employerId, employerId));

    const totalRatings = ratingStats[0].count;
    const averageRating = totalRatings > 0 ? ratingStats[0].average : 0;

    return response.send({
      data: {
        employer: {
          employerId,
          name: employer.branchName ? `${employer.employerName} - ${employer.branchName}` : employer.employerName,
        },
        summary: {
          totalRatings,
          averageRating: Number(averageRating.toFixed(2)),
        },
      },
    });
  } catch (error) {
    console.error("獲取商家評分時發生錯誤:", error);
    return response.status(500).send({
      message: "獲取評分失敗，請稍後再試",
    });
  }
});

// ========== 我的評分 ==========

/**
 * 商家獲取自己給出的所有評分
 * GET /rating/my-ratings/employer
 */
router.get("/my-ratings/employer", authenticated, requireEmployer, requireApprovedEmployer, async ({ user, response, query }) => {
  try {
    const { limit = 10, offset = 0 } = query;
    const requestLimit = Number.parseInt(limit);
    const requestOffset = Number.parseInt(offset);
    const employerId = user.employerId;

    // 獲取商家的所有評分
    const myRatings = await dbClient.query.workerRatings.findMany({
      where: eq(workerRatings.employerId, employerId),
      columns: {
        ratingId: true,
        ratingValue: true,
        comment: true,
        createdAt: true,
      },
      with: {
        worker: {
          columns: {
            workerId: true,
            firstName: true,
            lastName: true,
          },
        },
        gig: {
          columns: {
            gigId: true,
            title: true,
            dateEnd: true,
          },
        },
      },
      orderBy: [desc(workerRatings.createdAt)],
      limit: requestLimit + 1, // 多查一筆來確認是否有更多資料
      offset: requestOffset,
    });

    const hasMore = myRatings.length > requestLimit;
    const returnRatings = hasMore ? myRatings.slice(0, requestLimit) : myRatings;

    return response.send({
      data: {
        myRatings: returnRatings.map((rating) => ({
          ratingId: rating.ratingId,
          worker: {
            workerId: rating.worker.workerId,
            name: `${rating.worker.firstName} ${rating.worker.lastName}`,
          },
          gig: {
            gigId: rating.gig.gigId,
            title: rating.gig.title,
            endDate: rating.gig.dateEnd,
          },
          ratingValue: rating.ratingValue,
          comment: rating.comment,
          createdAt: rating.createdAt,
        })),
        pagination: {
          limit: requestLimit,
          offset: requestOffset,
          hasMore,
          returned: returnRatings.length,
        },
      },
    });
  } catch (error) {
    console.error("獲取商家評分記錄時發生錯誤:", error);
    return response.status(500).send({
      message: "獲取評分記錄失敗，請稍後再試",
    });
  }
});

/**
 * 打工者獲取自己給出的所有評分
 * GET /rating/my-ratings/worker
 */
router.get("/my-ratings/worker", authenticated, requireWorker, async ({ user, response, query }) => {
  try {
    const { limit = 10, offset = 0 } = query;
    const requestLimit = Number.parseInt(limit);
    const requestOffset = Number.parseInt(offset);
    const workerId = user.workerId;

    // 獲取打工者的所有評分
    const myRatings = await dbClient.query.employerRatings.findMany({
      where: eq(employerRatings.workerId, workerId),
      columns: {
        ratingId: true,
        ratingValue: true,
        comment: true,
        createdAt: true,
      },
      with: {
        employer: {
          columns: {
            employerId: true,
            employerName: true,
            branchName: true,
          },
        },
        gig: {
          columns: {
            gigId: true,
            title: true,
            dateEnd: true,
          },
        },
      },
      orderBy: [desc(employerRatings.createdAt)],
      limit: requestLimit + 1, // 多查一筆來確認是否有更多資料
      offset: requestOffset,
    });

    const hasMore = myRatings.length > requestLimit;
    const returnRatings = hasMore ? myRatings.slice(0, requestLimit) : myRatings;

    return response.send({
      data: {
        myRatings: returnRatings.map((rating) => ({
          ratingId: rating.ratingId,
          employer: {
            employerId: rating.employer.employerId,
            name: rating.employer.branchName ? `${rating.employer.employerName} - ${rating.employer.branchName}` : rating.employer.employerName,
          },
          gig: {
            gigId: rating.gig.gigId,
            title: rating.gig.title,
            endDate: rating.gig.dateEnd,
          },
          ratingValue: rating.ratingValue,
          comment: rating.comment,
          createdAt: rating.createdAt,
        })),
        pagination: {
          limit: requestLimit,
          offset: requestOffset,
          hasMore,
          returned: returnRatings.length,
        },
      },
    });
  } catch (error) {
    console.error("獲取打工者評分記錄時發生錯誤:", error);
    return response.status(500).send({
      message: "獲取評分記錄失敗，請稍後再試",
    });
  }
});

// ========== 可評分列表 ==========

/**
 * 商家獲取可以評分的工作列表
 * GET /rating/list/employer
 */
router.get("/list/employer", authenticated, requireEmployer, requireApprovedEmployer, async ({ user, response, query }) => {
  try {
    const { limit = 10, offset = 0 } = query;
    const requestLimit = Number.parseInt(limit);
    const requestOffset = Number.parseInt(offset);
    const employerId = user.employerId;
    const currentDate = moment().format("YYYY-MM-DD");

    // 查詢該商家可評分的工作
    const ratableGigs = await dbClient
      .select({
        gigId: gigs.gigId,
        title: gigs.title,
        dateEnd: gigs.dateEnd,
        workerId: gigApplications.workerId,
        workerFirstName: workers.firstName,
        workerLastName: workers.lastName,
      })
      .from(gigs)
      .innerJoin(gigApplications, and(
        eq(gigs.gigId, gigApplications.gigId),
        eq(gigApplications.status, "approved")
      ))
      .innerJoin(workers, eq(gigApplications.workerId, workers.workerId))
      .leftJoin(workerRatings, and(
        eq(gigs.gigId, workerRatings.gigId),
        eq(gigApplications.workerId, workerRatings.workerId),
        eq(workerRatings.employerId, employerId)
      ))
      .where(and(
        eq(gigs.employerId, employerId),
        sql`${gigs.dateEnd} < ${currentDate}`, // 工作必須已結束
        sql`${workerRatings.ratingId} IS NULL` // 該商家未評分
      ))
      .orderBy(desc(gigs.dateEnd))
      .limit(requestLimit + 1) // 多查一筆來確認是否有更多資料
      .offset(requestOffset);

    const hasMore = ratableGigs.length > requestLimit;
    const returnGigs = hasMore ? ratableGigs.slice(0, requestLimit) : ratableGigs;

    return response.send({
      data: {
        ratableGigs: returnGigs.map((gig) => ({
          gigId: gig.gigId,
          title: gig.title,
          endDate: gig.dateEnd,
          worker: {
            workerId: gig.workerId,
            name: `${gig.workerFirstName} ${gig.workerLastName}`,
          },
        })),
        pagination: {
          limit: requestLimit,
          offset: requestOffset,
          hasMore,
          returned: returnGigs.length,
        },
      },
    });
  } catch (error) {
    console.error("獲取可評分工作時發生錯誤:", error);
    return response.status(500).send({
      message: "獲取可評分工作失敗，請稍後再試",
    });
  }
});

/**
 * 打工者獲取可以評分的工作列表
 * GET /rating/list/worker
 */
router.get("/list/worker", authenticated, requireWorker, async ({ user, response, query }) => {
  try {
    const { limit = 10, offset = 0 } = query;
    const requestLimit = Number.parseInt(limit);
    const requestOffset = Number.parseInt(offset);
    const workerId = user.workerId;
    const currentDate = moment().format("YYYY-MM-DD");

    // 查詢該打工者可評分的工作
    const ratableGigs = await dbClient
      .select({
        gigId: gigs.gigId,
        title: gigs.title,
        dateEnd: gigs.dateEnd,
        employerId: employers.employerId,
        employerName: employers.employerName,
        branchName: employers.branchName,
      })
      .from(gigApplications)
      .innerJoin(gigs, eq(gigApplications.gigId, gigs.gigId))
      .innerJoin(employers, eq(gigs.employerId, employers.employerId))
      .leftJoin(employerRatings, and(
        eq(gigs.gigId, employerRatings.gigId),
        eq(employerRatings.workerId, workerId),
        eq(employerRatings.employerId, gigs.employerId)
      ))
      .where(and(
        eq(gigApplications.workerId, workerId),
        eq(gigApplications.status, "approved"),
        sql`${gigs.dateEnd} < ${currentDate}`, // 工作必須已結束
        sql`${employerRatings.ratingId} IS NULL` // 該打工者未評分
      ))
      .orderBy(desc(gigs.dateEnd))
      .limit(requestLimit + 1) // 多查一筆來確認是否有更多資料
      .offset(requestOffset);

    const hasMore = ratableGigs.length > requestLimit;
    const returnGigs = hasMore ? ratableGigs.slice(0, requestLimit) : ratableGigs;

    return response.send({
      data: {
        ratableGigs: returnGigs.map((gig) => ({
          gigId: gig.gigId,
          title: gig.title,
          endDate: gig.dateEnd,
          employer: {
            employerId: gig.employerId,
            name: gig.branchName ? `${gig.employerName} - ${gig.branchName}` : gig.employerName,
          },
        })),
        pagination: {
          limit: requestLimit,
          offset: requestOffset,
          hasMore,
          returned: returnGigs.length,
        },
      },
    });
  } catch (error) {
    console.error("獲取可評分工作時發生錯誤:", error);
    return response.status(500).send({
      message: "獲取可評分工作失敗，請稍後再試",
    });
  }
});

export default { path: "/rating", router } as IRouter;