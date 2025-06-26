import { Router } from "@nhttp/nhttp";
import type IRouter from "../Interfaces/IRouter";
import { authenticated } from "../Middleware/middleware";
import { requireAdmin } from "../Middleware/guards";
import dbClient from "../Client/DrizzleClient";
import { eq } from "drizzle-orm";
import { admins, employers } from "../Schema/DatabaseSchema";
import validate from "@nhttp/zod";
import { adminRegister } from "../Middleware/validator";
import { hash } from "@node-rs/argon2";
import { argon2Config } from "../config";

const router = new Router();

router.post("/register", validate(adminRegister), async (rev) => {
	const { email, password } = rev.body;
	const hashedPassword = await hash(password, argon2Config);
	const newAdmin = await dbClient
		.insert(admins)
		.values({ email, password: hashedPassword })
		.returning();
	return newAdmin[0];
});

router.get("/pendingEmployer", authenticated, requireAdmin, async (rev) => {
	const pendingEmployers = await dbClient.query.employers.findMany({
		where: eq(employers.approvalStatus, "pending"),
	});
	return pendingEmployers;
});

export default { path: "/admin", router } as IRouter;
