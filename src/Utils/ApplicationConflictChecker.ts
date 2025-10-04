import dbClient from "../Client/DrizzleClient";
import { gigApplications, gigs } from "../Schema/DatabaseSchema";
import { eq, and, lte, gte, lt, gt } from "drizzle-orm";

export class ApplicationConflictChecker {
  /**
   * 檢查打工者在指定時間是否有已確認的工作（衝突檢查）
   * @param workerId 打工者 ID
   * @param gigId 要檢查的工作 ID
   * @returns 如果有衝突返回衝突的工作列表，否則返回空陣列
   */
  static async checkWorkerScheduleConflict(
    workerId: string,
    gigId: string
  ): Promise<{
    hasConflict: boolean;
    conflictingGigs: Array<{
      gigId: string;
      title: string;
      dateStart: string;
      dateEnd: string;
      timeStart: string;
      timeEnd: string;
    }>;
  }> {
    try {
      const targetGig = await dbClient.query.gigs.findFirst({
        where: eq(gigs.gigId, gigId),
        columns: {
          gigId: true,
          title: true,
          dateStart: true,
          dateEnd: true,
          timeStart: true,
          timeEnd: true,
        },
      });

      if (!targetGig) {
        return { hasConflict: false, conflictingGigs: [] };
      }

      const confirmedApplications = await dbClient.query.gigApplications.findMany({
        where: and(
          eq(gigApplications.workerId, workerId),
          eq(gigApplications.status, "worker_confirmed"),
          eq(gigs.isActive, true),
          lte(gigs.dateStart, targetGig.dateEnd),
          gte(gigs.dateEnd, targetGig.dateStart),
          lt(gigs.timeStart, targetGig.timeEnd),
          gt(gigs.timeEnd, targetGig.timeStart)
        ),
        with: {
          gig: {
            columns: {
              gigId: true,
              title: true,
              dateStart: true,
              dateEnd: true,
              timeStart: true,
              timeEnd: true,
              isActive: true,
            },
          },
        },
      });

      const conflictingGigs = confirmedApplications
        .filter((app) => app.gig.gigId !== gigId)
        .map((app) => ({
          gigId: app.gig.gigId,
          title: app.gig.title,
          dateStart: app.gig.dateStart,
          dateEnd: app.gig.dateEnd,
          timeStart: app.gig.timeStart,
          timeEnd: app.gig.timeEnd,
        }));

      return {
        hasConflict: conflictingGigs.length > 0,
        conflictingGigs,
      };
    } catch (error) {
      console.error("檢查時間衝突時發生錯誤:", error);
      throw error;
    }
  }

  /**
   * 獲取所有與指定工作時間衝突的待回覆申請
   * 用於打工者確認工作時，自動取消其他衝突的申請
   */
  static async getConflictingPendingApplications(
    workerId: string,
    gigId: string
  ): Promise<string[]> {
    try {
      const targetGig = await dbClient.query.gigs.findFirst({
        where: eq(gigs.gigId, gigId),
        columns: {
          dateStart: true,
          dateEnd: true,
          timeStart: true,
          timeEnd: true,
        },
      });

      if (!targetGig) {
        return [];
      }

      const pendingApplications = await dbClient.query.gigApplications.findMany({
        where: and(
          eq(gigApplications.workerId, workerId),
          eq(gigApplications.status, "pending_worker_confirmation"),
          lte(gigs.dateStart, targetGig.dateEnd),
          gte(gigs.dateEnd, targetGig.dateStart),
          lt(gigs.timeStart, targetGig.timeEnd),
          gt(gigs.timeEnd, targetGig.timeStart)
        ),
        with: {
          gig: {
            columns: {
              gigId: true,
              dateStart: true,
              dateEnd: true,
              timeStart: true,
              timeEnd: true,
            },
          },
        },
      });

      const conflictingApplicationIds = pendingApplications
        .filter((app) => app.gig.gigId !== gigId)
        .map((app) => app.applicationId);

      return conflictingApplicationIds;
    } catch (error) {
      console.error("獲取衝突申請時發生錯誤:", error);
      throw error;
    }
  }

}

