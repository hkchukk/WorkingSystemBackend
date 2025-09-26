import moment from "moment";

/**
 * 統一使用台北時區 (UTC+8)
 */
export class DateUtils {
  // 台北時區為 UTC+8
  private static readonly TAIPEI_UTC_OFFSET = 8;

  /**
   * 獲取台北時區的當前日期 (YYYY-MM-DD 格式)
   */
  static getCurrentDate(): string {
    return moment().utcOffset(DateUtils.TAIPEI_UTC_OFFSET).format("YYYY-MM-DD");
  }

  /**
   * 獲取台北時區的當前時間戳
   */
  static getCurrentDateTime(): moment.Moment {
    return moment().utcOffset(DateUtils.TAIPEI_UTC_OFFSET);
  }

  /**
   * 將日期轉換為台北時區的 YYYY-MM-DD 格式
   * @param date - 日期字符串、Date 對象或 moment 對象
   */
  static formatDate(date: string | Date | moment.Moment): string {
    return moment(date).utcOffset(DateUtils.TAIPEI_UTC_OFFSET).format("YYYY-MM-DD");
  }

  /**
   * 獲取指定年月的開始和結束日期
   * @param year - 年份
   * @param month - 月份 (1-12)
   * @returns 包含 startDate 和 endDate 的物件
   */
  static getMonthRange(year: number, month: number): { startDate: string; endDate: string } {
    const startDate = moment(`${year}-${month.toString().padStart(2, "0")}-01`).utcOffset(DateUtils.TAIPEI_UTC_OFFSET).format("YYYY-MM-DD");
    const endDate = moment(startDate).endOf("month").format("YYYY-MM-DD");
    return { startDate, endDate };
  }

  /**
   * 比較兩個日期是否第一個早於第二個
   * @param date1 - 第一個日期
   * @param date2 - 第二個日期
   */
  static isDateBefore(date1: string | Date | moment.Moment, date2: string | Date | moment.Moment): boolean {
    const d1 = moment(date1).utcOffset(DateUtils.TAIPEI_UTC_OFFSET);
    const d2 = moment(date2).utcOffset(DateUtils.TAIPEI_UTC_OFFSET);
    return d1.isBefore(d2);
  }

  /**
   * 創建指定日期和時間的 moment 對象 (台北時區)
   * @param dateStr - 日期字符串 (YYYY-MM-DD)
   * @param timeStr - 時間字符串 (HH:mm)
   */
  static createDateTime(dateStr: string, timeStr: string): moment.Moment {
    return moment(`${dateStr} ${timeStr}`).utcOffset(DateUtils.TAIPEI_UTC_OFFSET);
  }

  /**
   * 比較兩個時間字符串是否第一個晚於第二個 (HH:mm 格式)
   * @param time1 - 第一個時間字符串
   * @param time2 - 第二個時間字符串
   */
  static isTimeAfter(time1: string, time2: string): boolean {
    const t1 = moment(time1, "HH:mm");
    const t2 = moment(time2, "HH:mm");
    return t1.isAfter(t2);
  }

  /**
   * 在指定日期基礎上添加或減去天數
   * @param date - 基準日期
   * @param days - 要添加的天數 (負數表示減去)
   * @returns 格式化的日期字符串
   */
  static addDays(date: string | Date | moment.Moment, days: number): string {
    const d = moment(date).utcOffset(DateUtils.TAIPEI_UTC_OFFSET).add(days, 'days');
    return d.format("YYYY-MM-DD");
  }

  /**
   * 獲取台北時區今天的 Date 物件 (用於日期比較驗證)
   * @returns 台北時區今天的 Date 物件，時間設為 00:00:00:000
   */
  static getCurrentDateObject(): Date {
    const today = moment().utcOffset(DateUtils.TAIPEI_UTC_OFFSET);
    today.set({ hour: 0, minute: 0, second: 0, millisecond: 0 });
    return today.toDate();
  }

  /**
   * 獲取台北時區當前時間的 Date 物件
   * @returns 台北時區當前時間的 Date 物件
   */
  static getCurrentDateTimeObject(): Date {
    return moment().utcOffset(DateUtils.TAIPEI_UTC_OFFSET).toDate();
  }
}
