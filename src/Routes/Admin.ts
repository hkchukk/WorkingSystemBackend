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
import { emailClient } from "../Client/EmailClient";

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

router.patch(
	"/approveEmployer/:id",
	authenticated,
	requireAdmin,
	async (rev) => {
		const { id } = rev.params;
		const employerFound = await dbClient.query.employers.findFirst({
			where: eq(employers.employerId, id),
		});
		if (!employerFound) {
			return rev.response.status(404).send("Employer not found");
		}
		if (employerFound.approvalStatus !== "pending") {
			return rev.response.status(400).send("Employer is not pending approval");
		}
		const updatedEmployer = await dbClient
			.update(employers)
			.set({ approvalStatus: "approved" })
			.where(eq(employers.employerId, id))
			.returning();
		await emailClient.sendMail({
			from: ``,
			to: employerFound.email,
			subject: "",
			text: ""
		})
		return updatedEmployer[0];
	},
);

export default { path: "/admin", router } as IRouter;
