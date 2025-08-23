// ===== 打卡碼相關 =====

/**
 * 生成 4 位數字打卡碼
 */
export function generateAttendanceCode(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}