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
import { UserCache } from "../Client/Cache/index";
import { Role } from "../Types/types";

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
			employerFound.employerName
		);

		await UserCache.clearUserProfile(employerFound.employerId, Role.EMPLOYER);
		return c.json(updatedEmployer[0]);
	},
);

export default { path: "/admin", router } as IRouter;
