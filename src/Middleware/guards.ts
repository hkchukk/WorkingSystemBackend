import { createMiddleware } from "hono/factory";
import type { HonoGenericContext } from "../Types/types";
import { Role } from "../Types/types";

// 角色檢查 Guard 函數
export const requireRole = (...roles: Role[]) => {
  return createMiddleware<HonoGenericContext>(async (c, next) => {
    const user = c.get("user");
    
    if (!user) {
      return c.text("需要登入", 401);
    }

    if (!roles.includes(user.role)) {
      const roleNames = {
        [Role.WORKER]: "打工者",
        [Role.EMPLOYER]: "商家",
        [Role.ADMIN]: "管理員",
      };
      
      const allowedRoles = roles.map(role => roleNames[role]).join("、");
      return c.text(`只有${allowedRoles}可以執行此操作`, 403);
    }

    await next();
  });
};

// 角色的 Guards
export const requireWorker = requireRole(Role.WORKER);
export const requireEmployer = requireRole(Role.EMPLOYER);
export const requireAdmin = requireRole(Role.ADMIN);
export const requireEmployerOrAdmin = requireRole(Role.EMPLOYER, Role.ADMIN);

// 商家審核狀態檢查 Guard
export const requireApprovedEmployer = createMiddleware<HonoGenericContext>(async (c, next) => {
  try {
    const user = c.get("user").role;
    
    /*
    if (!employer.length || employer[0].approvalStatus !== "approved") {
      return c.text("商家尚未通過審核，無法執行此操作", 403);
    }
    */
   
    await next();
  } catch (error) {
    console.error("商家審核狀態檢查時發生錯誤:", error);
    return c.text("商家審核狀態檢查失敗", 500);
  }
});
