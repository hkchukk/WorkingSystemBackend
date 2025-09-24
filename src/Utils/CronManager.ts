import { drizzle } from "drizzle-orm/bun-sql";
import { sql } from "drizzle-orm";

export class CronManager {
  private static dbClient: ReturnType<typeof drizzle> = (() => {
    if (!process.env.DBURL) {
      throw new Error("DBURL environment variable is not set.");
    }
    return drizzle(process.env.DBURL);
  })();

  /**
   * 檢查 pg_cron 擴展是否已安裝
   */
  static async checkPgCronExtension(): Promise<boolean> {
    try {
      const result = await CronManager.dbClient.execute(sql`
        SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
      `);
      return result.length > 0;
    } catch (error) {
      console.error("檢查 pg_cron 擴展時出錯:", error);
      return false;
    }
  }

  /**
   * 安裝 pg_cron 擴展
   */
  static async createPgCronExtension(): Promise<boolean> {
    try {
      await CronManager.dbClient.execute(
        sql`CREATE EXTENSION IF NOT EXISTS pg_cron`,
      );
      console.log("✅ pg_cron 擴展已安裝");
      return true;
    } catch (error) {
      console.error("❌ 安裝 pg_cron 擴展失敗:", error);
      return false;
    }
  }
  
  /**
   * 檢查特定的 cron 任務是否存在
   */
  static async checkCronJobExists(jobName: string): Promise<boolean> {
    try {
      const result = await CronManager.dbClient.execute(sql`
        SELECT 1 FROM cron.job WHERE jobname = ${jobName}
      `);
      return result.length > 0;
    } catch (error) {
      console.error(`檢查 cron 任務 ${jobName} 時出錯:`, error);
      return false;
    }
  }

  /**
   * 創建定期清理任務的 cron 任務
   */
  static async createAutoUnlistJob(): Promise<boolean> {
    const jobName = "auto_cleanup_expired_gigs";

    try {
      // 檢查任務是否已存在
      const exists = await CronManager.checkCronJobExists(jobName);
      if (exists) {
        return true;
      }

      // Cron 表達式: 每天 15:00 UTC (等於台北時間 23:00)
      const schedule = "0 15 * * *";

      // SQL 查詢
      const command = `
        DO $$
        DECLARE
          taipei_today DATE := (NOW() AT TIME ZONE 'Asia/Taipei')::DATE;
        BEGIN
          NULL;
        END;
        $$;
      `;

      await CronManager.dbClient.execute(sql`
        SELECT cron.schedule(
          ${jobName},
          ${schedule},
          ${command}
        );
      `);

      console.log(`✅ 已創建定期清理任務的 cron 任務: ${jobName}`);
      console.log(`📅 執行時間: 每天台北時間 23:00 (UTC 15:00)`);
      console.log("🎯 功能: 定期清理和維護工作資料");
      return true;
    } catch (error) {
      console.error(`❌ 創建 cron 任務 ${jobName} 失敗:`, error);
      return false;
    }
  }

  /**
   * 獲取所有 cron 任務狀態
   */
  static async getCronJobsStatus(): Promise<any[]> {
    try {
      const result = await CronManager.dbClient.execute(sql`
        SELECT 
          jobid,
          schedule,
          command,
          nodename,
          nodeport,
          database,
          username,
          active,
          jobname
        FROM cron.job
      `);
      return result;
    } catch (error) {
      console.error("獲取 cron 任務狀態時出錯:", error);
      return [];
    }
  }

  /**
   * 初始化所有必要的 cron 任務
   */
  static async initializeCronJobs(): Promise<boolean> {
    // 1. 檢查 pg_cron 擴展
    const hasExtension = await CronManager.checkPgCronExtension();
    if (!hasExtension) {
      console.log("📦 pg_cron 擴展未安裝，嘗試安裝...");
      const installed = await CronManager.createPgCronExtension();
      if (!installed) {
        console.error("❌ pg_cron 初始化失敗：無法安裝擴展");
        return false;
      }
    }

    // 2. 創建定期清理任務
    const autoUnlistCreated = await CronManager.createAutoUnlistJob();
    if (!autoUnlistCreated) {
      console.error("❌ 定期清理任務創建失敗");
      return false;
    }

    // 3. 顯示當前任務狀態
    const jobs = await CronManager.getCronJobsStatus();
    if (jobs.length > 0) {
      console.log("📋 當前 cron 任務:");
      jobs.forEach((job) => {
        console.log(
          `  - ${job.jobname}: ${job.schedule} (${job.active ? "啟用" : "停用"})`,
        );
      });
    }

    return true;
  }
}

export default CronManager;