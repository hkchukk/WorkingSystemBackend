import type { Handler } from "@nhttp/nhttp";
import { Role } from "../Types/types.ts";

// 角色檢查 Guard 函數
export const requireRole = (...roles: Role[]): Handler => {
  return (rev, next) => {

    if (!roles.includes(rev.user.role)) {
      const roleNames = {
        [Role.WORKER]: "打工者",
        [Role.EMPLOYER]: "商家",
        [Role.ADMIN]: "管理員",
      };
      
      const allowedRoles = roles.map(role => roleNames[role]).join("、");
      return new Response(`只有${allowedRoles}可以執行此操作`, { status: 403 });
    }

    return next();
  };
};

// 角色的 Guards
export const requireWorker = requireRole(Role.WORKER);
export const requireEmployer = requireRole(Role.EMPLOYER);
export const requireAdmin = requireRole(Role.ADMIN);
export const requireEmployerOrAdmin = requireRole(Role.EMPLOYER, Role.ADMIN);

// 商家審核狀態檢查 Guard
export const requireApprovedEmployer: Handler = async (rev, next) => {
  try {
    /*
    if (!rev.user.approvalStatus || rev.user.approvalStatus !== "approved") {
      return new Response("商家尚未通過審核，無法執行此操作", { status: 403 });
    }
    */

    return next();
  } catch (error) {
    console.error("商家審核狀態檢查時發生錯誤:", error);
    return new Response("商家審核狀態檢查失敗", { status: 500 });
  }
}; 