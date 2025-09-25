import { Hono } from "hono";
import type IRouter from "../Interfaces/IRouter";
import type { HonoGenericContext } from "../Types/types";
import { authenticated } from "../Middleware/authentication";
import { requireAdmin } from "../Middleware/guards";
import dbClient from "../Client/DrizzleClient";
import { eq } from "drizzle-orm";
import { admins, employers } from "../Schema/DatabaseSchema";
import { zValidator } from "@hono/zod-validator";
import { adminRegisterSchema } from "../Types/zodSchema";
import { hash } from "@node-rs/argon2";
import { argon2Config } from "../config";
import NotificationHelper from "../Utils/NotificationHelper";
import { UserCache } from "../Client/Cache/Index";
import { Role } from "../Types/types";
import SessionManager from "../Utils/SessionManager";

const router = new Hono<HonoGenericContext>();

router.post("/register", zValidator("json", adminRegisterSchema), async (c) => {
	const { email, password } = c.req.valid("json");
	const hashedPassword = await hash(password, argon2Config);
	const newAdmin = await dbClient
		.insert(admins)
		.values({ email, password: hashedPassword })
		.returning();
	return c.json(newAdmin[0]);
});

router.get("/pendingEmployer", authenticated, requireAdmin, async (c) => {
	const pendingEmployers = await dbClient.query.employers.findMany({
		where: eq(employers.approvalStatus, "pending"),
	});
	return c.json(pendingEmployers);
});

router.patch(
	"/approveEmployer/:id",
	authenticated,
	requireAdmin,
	async (c) => {
		const id = c.req.param("id");
		const employerFound = await dbClient.query.employers.findFirst({
			where: eq(employers.employerId, id),
		});
		if (!employerFound) {
			return c.text("Employer not found", 404);
		}
		if (employerFound.approvalStatus !== "pending") {
			return c.text("Employer is not pending approval", 400);
		}
		const updatedEmployer = await dbClient
			.update(employers)
			.set({ approvalStatus: "approved" })
			.where(eq(employers.employerId, id))
			.returning();

		// 發送審核通過通知
		await NotificationHelper.notifyAccountApproved(
			employerFound.employerId,
			Role.EMPLOYER,
			employerFound.employerName
		);

		await UserCache.clearUserProfile(employerFound.employerId, Role.EMPLOYER);
		return c.json(updatedEmployer[0]);
	},
);

// 踢用戶下線
router.post("/kick-user/:userId", authenticated, async (c) => {
	const userId = c.req.param("userId");

	try {
		await SessionManager.clear(userId);
		return c.json({ message: `用戶 ${userId} 已被踢下線` });
	} catch (error) {
		console.error("踢用戶下線失敗:", error);
		return c.text("踢用戶下線失敗", 500);
	}
});

// 獲取所有活躍 sessions
router.get("/active-sessions", authenticated, async (c) => {
	try {
		const activeSessions = await SessionManager.getAll();
		return c.json({
			message: "活躍 sessions 獲取成功",
			sessions: activeSessions,
			count: activeSessions.length
		});
	} catch (error) {
		console.error("獲取活躍 sessions 失敗:", error);
		return c.text("獲取活躍 sessions 失敗", 500);
	}
});

export default { path: "/admin", router } as IRouter;
