import { Router } from "@nhttp/nhttp";
import { authenticated } from "../Middleware/middleware.ts";
import {
	requireEmployer,
	requireApprovedEmployer,
} from "../Middleware/guards.ts";
import type IRouter from "../Interfaces/IRouter.ts";
import dbClient from "../Client/DrizzleClient.ts";
import { eq, and, desc, sql } from "drizzle-orm";
import { gigs, gigApplications } from "../Schema/DatabaseSchema.ts";
import validate from "@nhttp/zod";
import { createGigSchema, updateGigSchema } from "../Middleware/validator.ts";
import { uploadEnvironmentPhotos } from "../Middleware/uploadFile.ts";
import { S3Client } from "bun";
import moment from "moment";
import { PresignedUrlCache } from "../Client/RedisClient.ts";

const router = new Router();

const client = new S3Client({
	region: "auto",
	accessKeyId: process.env.R2ACCESSKEYID,
	secretAccessKey: process.env.R2SECRETACCESSKEY,
	endpoint: process.env.R2ENDPOINT,
	bucket: "backend-files",
	retry: 1,
});

// 統一的照片上傳處理函數
const handlePhotoUpload = async (reqFile: any, existingPhotos: any[] = []) => {
	// 如果沒有上傳檔案，返回現有照片
	if (!reqFile?.environmentPhotos) {
		return {
			environmentPhotosInfo: existingPhotos,
			uploadedFiles: [],
			addedCount: 0,
			totalCount: existingPhotos.length,
			message: "未上傳新照片",
		};
	}

	const files = Array.isArray(reqFile.environmentPhotos)
		? reqFile.environmentPhotos
		: [reqFile.environmentPhotos];

	// 檢查累加後是否超過3張照片限制
	const totalAfterAdd = existingPhotos.length + files.length;
	let uploadedFiles = files;
	let message = "";

	if (totalAfterAdd > 3) {
		const canAdd = 3 - existingPhotos.length;
		if (canAdd <= 0) {
			cleanupTempFiles(files);
			return {
				environmentPhotosInfo: existingPhotos,
				uploadedFiles: [],
				addedCount: 0,
				totalCount: existingPhotos.length,
				message: "不能再添加照片，已達最大限制（3張）",
			};
		}
		uploadedFiles = files.slice(0, canAdd);
		const rejectedFiles = files.slice(canAdd);
		cleanupTempFiles(rejectedFiles);
		message = `只能添加${canAdd}張照片，已忽略多餘的${files.length - canAdd}張`;
	} else {
		message = `成功添加${files.length}張照片`;
	}

	// 建立照片資訊
	const newPhotosInfo = uploadedFiles.map((file) => ({
		originalName: file.name,
		type: file.type,
		filename: file.filename,
		size: file.size,
	}));

	// 一次過並行上傳
	try {
		await Promise.all(
			uploadedFiles.map(async (file) => {
				const currentFile = Bun.file(file.path);

				// 檢查檔案是否存在
				if (!(await currentFile.exists())) {
					throw new Error(`檔案不存在: ${file.path}`);
				}

				await client.write(`environment-photos/${file.filename}`, currentFile);
				console.log(`環境照片 ${file.name} 上傳成功`);
			}),
		);
	} catch (uploadError) {
		console.error("上傳環境照片時出錯:", uploadError);
		throw new Error(
			`環境照片上傳失敗: ${uploadError instanceof Error ? uploadError.message : "未知錯誤"}`,
		);
	}

	const allPhotos = [...existingPhotos, ...newPhotosInfo];

	return {
		environmentPhotosInfo: allPhotos,
		uploadedFiles,
		addedCount: newPhotosInfo.length,
		totalCount: allPhotos.length,
		message,
	};
};

// 清理臨時文件
const cleanupTempFiles = async (uploadedFiles: any[]) => {
	if (uploadedFiles.length === 0) return;

	Promise.all(
		uploadedFiles.map(async (file) => {
			try {
				const bunFile = Bun.file(file.path);
				if (await bunFile.exists()) {
					await bunFile.delete();
					console.log(`成功刪除臨時文件: ${file.filename}`);
				}
			} catch (cleanupError) {
				console.error(`清理臨時文件時出錯 ${file.filename}:`, cleanupError);
			}
		}),
	).catch((err) => console.error("批次清理檔案時出錯:", err));
};

// 處理環境照片數據格式的輔助函數（帶 Redis 快取）
const formatEnvironmentPhotos = async (environmentPhotos: any) => {
	if (!environmentPhotos) return null;

	if (Array.isArray(environmentPhotos)) {
		// 確保數據庫中最多只有 3 張照片
		const limitedPhotos = environmentPhotos.slice(0, 3);
		
		// 使用 Redis 快取策略生成 presigned URLs
		const photosWithUrls = await Promise.all(
			limitedPhotos.map(async (photo: any) => {
				try {
					// 首先檢查 Redis 快取
					let presignedUrl = await PresignedUrlCache.get(photo.filename);
					
					if (!presignedUrl) {
						// 快取中沒有或即將過期，重新生成
						presignedUrl = await client.presign(`environment-photos/${photo.filename}`, {
							expiresIn: 3600 // 1 小時
						});
						
						// 存入快取
						await PresignedUrlCache.set(photo.filename, presignedUrl, 3600);
					}
					
					return {
						originalName: photo.originalName,
						type: photo.type,
						filename: photo.filename,
						size: photo.size,
						url: presignedUrl,
					};
				} catch (error) {
					console.error(`生成 presigned URL ${photo.filename} 時出錯:`, error);
					return {
						originalName: photo.originalName,
						type: photo.type,
						filename: photo.filename,
						size: photo.size,
						url: null,
						error: '圖片連結生成失敗',
					};
				}
			})
		);

		return photosWithUrls;
	}
	return environmentPhotos;
};

// 構建工作數據物件
const buildGigData = (body: any, user: any, environmentPhotosInfo: any) => {
	const {
		title,
		description,
		dateStart,
		dateEnd,
		timeStart,
		timeEnd,
		requirements,
		hourlyRate,
		city,
		district,
		address,
		contactPerson,
		contactPhone,
		contactEmail,
		publishedAt,
		unlistedAt,
	} = body;

	return {
		employerId: user.employerId,
		title,
		description,
		dateStart: dateStart ? moment(dateStart).format("YYYY-MM-DD") : null,
		dateEnd: dateEnd ? moment(dateEnd).format("YYYY-MM-DD") : null,
		timeStart,
		timeEnd,
		requirements,
		hourlyRate,
		city,
		district,
		address,
		contactPerson,
		contactPhone,
		contactEmail,
		environmentPhotos: environmentPhotosInfo
			? environmentPhotosInfo
			: null,
		publishedAt: publishedAt
			? moment(publishedAt).format("YYYY-MM-DD")
			: moment().format("YYYY-MM-DD"),
		unlistedAt: unlistedAt
			? moment(unlistedAt).format("YYYY-MM-DD")
			: null,
	};
};

// 刪除 S3 文件
router.delete("/deleteFile/:filename", authenticated, requireEmployer, async ({ params, user, response }) => {
	const { filename } = params;

	if (!filename) {
		return response.status(400).send("Filename is required");
	}

	try {
		// 查找包含該文件的工作
		const targetGig = await dbClient.query.gigs.findFirst({
			where: and(
				eq(gigs.employerId, user.employerId),
				sql`environment_photos::text LIKE ${`%${filename}%`}`
			),
			columns: {
				gigId: true,
				environmentPhotos: true,
			},
		});
		
		const hasExactMatch = targetGig &&
			Array.isArray(targetGig.environmentPhotos) &&
			targetGig.environmentPhotos.some((photo: any) => photo.filename === filename);

		// 如果找不到包含該文件的工作，返回錯誤
		if (!targetGig || !hasExactMatch) {
			return response.status(404).send({
				message: `沒有找到文件 ${filename}`,
			});
		}
		
		// 更新照片陣列
		const updatedPhotos = Array.isArray(targetGig.environmentPhotos) 
		? targetGig.environmentPhotos.filter((photo: any) => photo.filename !== filename)
		: [];
		
		// 更新資料庫
		await dbClient
			.update(gigs)
			.set({
				environmentPhotos: updatedPhotos.length > 0 ? updatedPhotos : [],
				updatedAt: new Date(),
			})
			.where(eq(gigs.gigId, targetGig.gigId));
		
		// 刪除 S3 文件
		await client.delete(`environment-photos/${filename}`);
		
		// 清除 Redis 快取
		await PresignedUrlCache.delete(filename);
		
		return response.status(200).send({
			message: `文件 ${filename} 刪除成功`,
		});
	} catch (error) {
		console.error(`刪除文件 ${filename} 時出錯:`, error);
		return response.status(500).send("刪除文件失敗");
	}
});

// 發佈新工作
router.post(
	"/create",
	authenticated,
	requireEmployer,
	requireApprovedEmployer,
	uploadEnvironmentPhotos,
	validate(createGigSchema),
	async ({ user, body, file, response }) => {
		const reqFile = file || {};
		let uploadedFiles: any[] = [];

		try {
			// 處理照片上傳
			const { environmentPhotosInfo, uploadedFiles: filesList } =
				await handlePhotoUpload(reqFile);
			uploadedFiles = filesList;

			// 構建工作數據
			const gigData = buildGigData(body, user, environmentPhotosInfo);

			// 創建工作
			const insertedGig = await dbClient
				.insert(gigs)
				.values(gigData)
				.returning();

			const newGig = insertedGig[0];

			return response.status(201).send({
				message: "工作發佈成功",
				gig: {
					gigId: newGig.gigId,
					title: newGig.title,
					description: newGig.description,
					environmentPhotos: environmentPhotosInfo,
					isActive: newGig.isActive,
					createdAt: newGig.createdAt,
				},
			});
		} catch (error) {
			console.error("創建工作時出錯:", error);
			const errorMessage =
				error instanceof Error ? error.message : "伺服器內部錯誤";

			if (errorMessage.includes("照片上傳失敗")) {
				return response.status(500).send(errorMessage);
			}

			return response.status(500).send("伺服器內部錯誤");
		} finally {
			cleanupTempFiles(uploadedFiles);
		}
	},
);

// 獲取自己發佈的工作
router.get(
	"/my-gigs",
	authenticated,
	requireEmployer,
	async ({ user, response, query }) => {
		try {
			const { limit = 10, offset = 0 } = query;
			const requestLimit = Number.parseInt(limit);
			const requestOffset = Number.parseInt(offset);

			const myGigs = await dbClient.query.gigs.findMany({
				where: eq(gigs.employerId, user.employerId),
				orderBy: [desc(gigs.createdAt)],
				columns: {
					gigId: true,
					title: true,
					dateStart: true,
					dateEnd: true,
					timeStart: true,
					timeEnd: true,
					publishedAt: true,
					unlistedAt: true,
					isActive: true,
				},
				limit: requestLimit + 1, // 多查一筆來確認是否有更多資料
				offset: requestOffset,
			});

			// 檢查是否有更多資料
			const hasMore = myGigs.length > requestLimit;
			const returnGigs = hasMore ? myGigs.slice(0, requestLimit) : myGigs;

			return response.status(200).send({
				gigs: returnGigs,
				pagination: {
					limit: requestLimit,
					offset: requestOffset,
					hasMore,
					returned: returnGigs.length,
				},
			});
		} catch (error) {
			console.error("獲取工作列表時出錯:", error);
			return response.status(500).send("伺服器內部錯誤");
		}
	},
);

// 獲取特定工作詳情
router.get(
	"/:gigId",
	authenticated,
	requireEmployer,
	async ({ user, params, query, response }) => {
		try {
			const { gigId } = params;
			const { application, status, limit = 10, offset = 0 } = query;

			// 如果沒有要求整合申請記錄，使用簡單查詢
			if (application !== "true") {
				const gig = await dbClient.query.gigs.findFirst({
					where: and(eq(gigs.gigId, gigId), eq(gigs.employerId, user.employerId)),
				});

				if (!gig) {
					return response.status(404).send("工作不存在或無權限查看");
				}

				return response.status(200).send({
					...gig,
					environmentPhotos: await formatEnvironmentPhotos(gig.environmentPhotos),
				});
			}

			const requestLimit = Number.parseInt(limit);
			const requestOffset = Number.parseInt(offset);

			// 先查詢工作詳情
			const gig = await dbClient.query.gigs.findFirst({
				where: and(eq(gigs.gigId, gigId), eq(gigs.employerId, user.employerId)),
			});

			if (!gig) {
				return response.status(404).send("工作不存在或無權限查看");
			}

			// 建立申請記錄查詢條件
			const whereConditions = [eq(gigApplications.gigId, gigId)];
			if (status && ["pending", "approved", "rejected", "cancelled"].includes(status)) {
				whereConditions.push(eq(gigApplications.status, status));
			}

			// 查詢申請記錄（在資料庫層面分頁，多查一筆來判斷 hasMore）
			const applications = await dbClient.query.gigApplications.findMany({
				where: and(...whereConditions),
				with: {
					worker: true,
				},
				orderBy: [desc(gigApplications.createdAt)],
				limit: requestLimit + 1, // 多查一筆來判斷 hasMore
				offset: requestOffset,
			});

			// 判斷是否有更多資料
			const hasMore = applications.length > requestLimit;
			const paginatedApplications = hasMore ? applications.slice(0, requestLimit) : applications;

			// 整合回應
			return response.status(200).send({
				...gig,
				environmentPhotos: await formatEnvironmentPhotos(gig.environmentPhotos),
				applications: {
					data: paginatedApplications.map(app => ({
						applicationId: app.applicationId,
						workerId: app.workerId,
						workerName: `${app.worker.firstName} ${app.worker.lastName}`,
						workerEmail: app.worker.email,
						workerPhone: app.worker.phoneNumber,
						workerEducation: app.worker.highestEducation,
						workerSchool: app.worker.schoolName,
						workerMajor: app.worker.major,
						status: app.status,
						appliedAt: app.createdAt,
					})),
					pagination: {
						limit: requestLimit,
						offset: requestOffset,
						hasMore,
						returned: paginatedApplications.length,
					},
				},
			});
		} catch (error) {
			console.error("獲取工作詳情時出錯:", error);
			return response.status(500).send("伺服器內部錯誤");
		}
	},
);

// 更新工作資訊
router.put(
	"/:gigId",
	authenticated,
	requireEmployer,
	requireApprovedEmployer,
	uploadEnvironmentPhotos,
	validate(updateGigSchema),
	async ({ user, params, body, file, response }) => {
		const reqFile = file || {};
		let uploadedFiles: any[] = [];

		try {
			const { gigId } = params;

			// 處理照片上傳（如果有新照片上傳）
			const existingGig = await dbClient.query.gigs.findFirst({
				where: and(eq(gigs.gigId, gigId), eq(gigs.employerId, user.employerId)),
			});

			if (!existingGig) {
				return response.status(404).send("工作不存在或無權限修改");
			}

			const existingPhotos = await formatEnvironmentPhotos(existingGig.environmentPhotos) || [];
			const {
				environmentPhotosInfo,
				uploadedFiles: filesList,
				addedCount,
				totalCount,
				message,
			} = await handlePhotoUpload(reqFile, existingPhotos);
			uploadedFiles = filesList;

			// 構建更新數據
			// const updateData: any = {};

			// if (body.title) updateData.title = body.title;
			// if (body.description !== undefined)
			//   updateData.description = body.description
			//     ? JSON.stringify(body.description)
			//     : null;
			// if (body.dateStart)
			//   updateData.dateStart = new Date(body.dateStart)
			//     .toISOString()
			//     .split("T")[0];
			// if (body.dateEnd)
			//   updateData.dateEnd = new Date(body.dateEnd).toISOString().split("T")[0];
			// if (body.timeStart) updateData.timeStart = body.timeStart;
			// if (body.timeEnd) updateData.timeEnd = body.timeEnd;
			// if (body.requirements !== undefined)
			//   updateData.requirements = body.requirements
			//     ? JSON.stringify(body.requirements)
			//     : null;
			// if (body.hourlyRate) updateData.hourlyRate = body.hourlyRate;
			// if (body.city) updateData.city = body.city;
			// if (body.district) updateData.district = body.district;
			// if (body.address) updateData.address = body.address;
			// if (body.contactPerson) updateData.contactPerson = body.contactPerson;
			// if (body.contactPhone !== undefined)
			//   updateData.contactPhone = body.contactPhone;
			// if (body.contactEmail !== undefined)
			//   updateData.contactEmail = body.contactEmail;
			// if (addedCount > 0)
			//   updateData.environmentPhotos = JSON.stringify(environmentPhotosInfo);
			// if (body.publishedAt)
			//   updateData.publishedAt = new Date(body.publishedAt)
			//     .toISOString()
			//     .split("T")[0];
			// if (body.unlistedAt)
			//   updateData.unlistedAt = new Date(body.unlistedAt)
			//     .toISOString()
			//     .split("T")[0];
			// if (body.isActive !== undefined) updateData.isActive = body.isActive;

			// updateData.updatedAt = new Date();
			// await dbClient.update(gigs).set(updateData).where(eq(gigs.gigId, gigId));

			await dbClient
				.update(gigs)
				.set({
					...body,
					updatedAt: new Date(),
					dateStart: body.dateStart
						? moment(body.dateStart).format("YYYY-MM-DD")
						: undefined,
					dateEnd: body.dateEnd
						? moment(body.dateEnd).format("YYYY-MM-DD")
						: undefined,
					publishedAt: body.publishedAt
						? moment(body.publishedAt).format("YYYY-MM-DD")
						: undefined,
					unlistedAt: body.unlistedAt
						? moment(body.unlistedAt).format("YYYY-MM-DD")
						: undefined,
					environmentPhotos: addedCount > 0 ? environmentPhotosInfo : undefined,
				})
				.where(eq(gigs.gigId, gigId));

			// 只有在有照片相關操作時才顯示照片訊息
			const hasPhotoOperation = reqFile?.environmentPhotos;
			const responseMessage =
				hasPhotoOperation && addedCount > 0
					? `工作更新成功，${message}`
					: hasPhotoOperation && addedCount === 0
						? `工作更新成功，${message}`
						: "工作更新成功";

			return response.status(200).send({
				message: responseMessage,
				photoInfo: hasPhotoOperation
					? {
							totalPhotos: totalCount,
							addedPhotos: addedCount,
						}
					: undefined,
			});
		} catch (error) {
			console.error("更新工作時出錯:", error);
			const errorMessage =
				error instanceof Error ? error.message : "伺服器內部錯誤";

			if (errorMessage.includes("照片上傳失敗")) {
				return response.status(500).send(errorMessage);
			}

			return response.status(500).send("伺服器內部錯誤");
		} finally {
			cleanupTempFiles(uploadedFiles);
		}
	},
);

// 停用/啟用工作
router.patch(
	"/:gigId/toggle-status",
	authenticated,
	requireEmployer,
	requireApprovedEmployer,
	async ({ user, params, response }) => {
		try {
			const { gigId } = params;

			const existingGig = await dbClient.query.gigs.findFirst({
				where: and(eq(gigs.gigId, gigId), eq(gigs.employerId, user.employerId)),
			});

			if (!existingGig) {
				return response.status(404).send("工作不存在或無權限修改");
			}

			const newIsActive = !existingGig.isActive;

			await dbClient
				.update(gigs)
				.set({
					isActive: newIsActive,
					updatedAt: new Date(),
				})
				.where(eq(gigs.gigId, gigId));

			return response.status(200).send({
				message: `工作已${newIsActive ? "啟用" : "停用"}`,
			});
		} catch (error) {
			console.error("切換工作狀態時出錯:", error);
			return response.status(500).send("伺服器內部錯誤");
		}
	},
);

// 刪除工作
router.delete(
	"/:gigId",
	authenticated,
	requireEmployer,
	requireApprovedEmployer,
	async ({ user, params, response }) => {
		try {
			const { gigId } = params;

			const existingGig = await dbClient.query.gigs.findFirst({
				where: and(eq(gigs.gigId, gigId), eq(gigs.employerId, user.employerId)),
			});

			if (!existingGig) {
				return response.status(404).send("工作不存在或無權限刪除");
			}

			// 檢查是否有待處理的申請
			const pendingApplications = await dbClient.query.gigApplications.findMany(
				{
					where: and(
						eq(gigApplications.gigId, gigId),
						eq(gigApplications.status, "pending"),
					),
				},
			);

			if (pendingApplications.length > 0) {
				return response.status(400).send("有待處理的申請，無法刪除工作");
			}

			await dbClient.delete(gigs).where(eq(gigs.gigId, gigId));

			return response.status(200).send({
				message: "工作刪除成功",
			});
		} catch (error) {
			console.error("刪除工作時出錯:", error);
			return response.status(500).send("伺服器內部錯誤");
		}
	},
);

// 獲取所有可用工作（給打工者查看）
router.get("/", async ({ query, response }) => {
	try {
		const { limit = 10, offset = 0, city, district, minRate, maxRate } = query;
		const requestLimit = Number.parseInt(limit);
		const requestOffset = Number.parseInt(offset);
		const minRateFilter = minRate ? Number.parseInt(minRate) : null;
		const maxRateFilter = maxRate ? Number.parseInt(maxRate) : null;

		const availableGigs = await dbClient.query.gigs.findMany({
			where: eq(gigs.isActive, true),
			orderBy: [desc(gigs.createdAt)],
			limit: requestLimit + 1, // 多查一筆來確認是否有更多資料
			offset: requestOffset,
			with: {
				employer: {
					columns: {
						employerId: true,
						employerName: true,
						branchName: true,
						industryType: true,
						address: true,
					},
				},
			},
		});

		// 進一步過濾（Drizzle ORM 某些複雜查詢可能需要在應用層處理）
		let filteredGigs = availableGigs;

		if (city) {
			filteredGigs = filteredGigs.filter((gig) => gig.city.includes(city));
		}

		if (district) {
			filteredGigs = filteredGigs.filter((gig) =>
				gig.district.includes(district),
			);
		}

		if (minRateFilter) {
			filteredGigs = filteredGigs.filter((gig) => gig.hourlyRate >= minRateFilter);
		}

		if (maxRateFilter) {
			filteredGigs = filteredGigs.filter((gig) => gig.hourlyRate <= maxRateFilter);
		}

		// 檢查是否有更多資料（考慮過濾後的結果）
		const hasMore = filteredGigs.length > requestLimit;
		const returnGigs = hasMore ? filteredGigs.slice(0, requestLimit) : filteredGigs;

		// 格式化環境照片數據
		const formattedGigs = await Promise.all(
			returnGigs.map(async (gig) => ({
				...gig,
				environmentPhotos: await formatEnvironmentPhotos(gig.environmentPhotos),
			}))
		);

		return response.status(200).send({
			gigs: formattedGigs,
			pagination: {
				limit: requestLimit,
				offset: requestOffset,
				hasMore,
				returned: returnGigs.length,
			},
			filters: {
				city,
				district,
				minRate: minRateFilter,
				maxRate: maxRateFilter,
			},
		});
	} catch (error) {
		console.error("獲取工作列表時出錯:", error);
		return response.status(500).send("伺服器內部錯誤");
	}
});

export default { path: "/gig", router } as IRouter;
