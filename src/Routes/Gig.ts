import { Router } from "@nhttp/nhttp";
import { authenticated } from "../Middleware/middleware.ts";
import {
	requireEmployer,
	requireApprovedEmployer,
} from "../Middleware/guards.ts";
import type IRouter from "../Interfaces/IRouter.ts";
import dbClient from "../Client/DrizzleClient.ts";
import { eq, and, desc, sql, gte, lte, or, lt, gt } from "drizzle-orm";
import { gigs, gigApplications } from "../Schema/DatabaseSchema.ts";
import validate from "@nhttp/zod";
import { createGigSchema, updateGigSchema } from "../Middleware/validator.ts";
import { uploadEnvironmentPhotos } from "../Middleware/uploadFile.ts";
import { S3Client } from "bun";
import moment from "moment";
import { PresignedUrlCache } from "../Client/RedisClient.ts";
import NotificationHelper from "../Utils/NotificationHelper.ts";

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
async function handlePhotoUpload(reqFile: any, existingPhotos: any[] = []) {
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
async function cleanupTempFiles(uploadedFiles: any[]) {
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
async function formatEnvironmentPhotos(environmentPhotos: any) {
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
						presignedUrl = client.presign(`environment-photos/${photo.filename}`, {
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
function buildGigData(body: any, user: any, environmentPhotosInfo: any) {
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

			// 發送工作發佈成功通知
			await NotificationHelper.notifyGigPublished(
				user.employerId,
				newGig.title
			);

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
			const { limit = 10, offset = 0, status } = query;
			const requestLimit = Number.parseInt(limit);
			const requestOffset = Number.parseInt(offset);
			const currentDate = moment().format('YYYY-MM-DD');

			// 建立基本查詢條件
			const whereConditions = [
				eq(gigs.employerId, user.employerId),
				eq(gigs.isActive, true),
			];

			// 根據狀態參數添加日期條件
			if (status && ['not_started', 'ongoing', 'completed'].includes(status)) {
				if (status === 'not_started') {
					// 未開始：dateStart > currentDate
					whereConditions.push(gt(gigs.dateStart, currentDate));
				} else if (status === 'completed') {
					// 已結束：dateEnd < currentDate
					whereConditions.push(lt(gigs.dateEnd, currentDate));
				} else if (status === 'ongoing') {
					// 進行中：dateStart <= currentDate AND dateEnd >= currentDate
					whereConditions.push(
						and(
							lte(gigs.dateStart, currentDate),
							gte(gigs.dateEnd, currentDate)
						)
					);
				}
			}

			const myGigs = await dbClient.query.gigs.findMany({
				where: and(...whereConditions),
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
					where: and(
						eq(gigs.gigId, gigId),
						eq(gigs.employerId, user.employerId),
						eq(gigs.isActive, true)
					),
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
				where: and(
					eq(gigs.gigId, gigId),
					eq(gigs.employerId, user.employerId),
					eq(gigs.isActive, true)
				),
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

			// 檢查工作是否已停用
			if (!existingGig.isActive) {
				return response.status(400).send("已停用的工作無法更新");
			}

			// 檢查是否有申請中或已核准的申請
			const activeApplications = await dbClient.query.gigApplications.findFirst({
				where: and(
					eq(gigApplications.gigId, gigId),
					or(
						eq(gigApplications.status, "pending"),
						eq(gigApplications.status, "approved")
					)
				),
			});

			if (activeApplications) {
				return response.status(400).send("此工作有申請中或已核准的申請者，無法更新");
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

// 停用/刪除工作
router.patch(
	"/:gigId/toggle-status",
	authenticated,
	requireEmployer,
	requireApprovedEmployer,
	async ({ user, params, response }) => {
		try {
			const { gigId } = params;

			// 一次查詢獲取工作和申請資料
			const gigWithApplications = await dbClient.query.gigs.findFirst({
				where: and(eq(gigs.gigId, gigId), eq(gigs.employerId, user.employerId)),
				with: {
					gigApplications: {
						where: eq(gigApplications.status, "approved"),
						limit: 1, // 只需要知道是否存在已核准的申請
					},
				},
			});

			if (!gigWithApplications) {
				return response.status(404).send("工作不存在或無權限修改");
			}

			// 如果工作已經停用，不允許操作
			if (!gigWithApplications.isActive) {
				return response.status(400).send({
					message: "工作已經停用，無法再次操作",
				});
			}

			const hasApprovedApplications = gigWithApplications.gigApplications.length > 0;

			// 根據是否有已核准的申請者決定操作
			if (hasApprovedApplications) {
				// 有已核准的申請者，停用工作
				await dbClient
					.update(gigs)
					.set({
						isActive: false,
						updatedAt: new Date(),
					})
					.where(eq(gigs.gigId, gigId));

				return response.status(200).send({
					message: "工作已停用",
					action: "disabled",
				});
			}
			// 沒有已核准的申請者，直接刪除工作
			await dbClient.delete(gigs).where(eq(gigs.gigId, gigId));

			return response.status(200).send({
				message: "工作已刪除",
				action: "deleted",
			});
		} catch (error) {
			console.error("處理工作停用/刪除時出錯:", error);
			return response.status(500).send("伺服器內部錯誤");
		}
	},
);

// 上架/下架工作
router.patch(
	"/:gigId/toggle-listing",
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

			const today = moment().format("YYYY-MM-DD");
			const isCurrentlyListed = !existingGig.unlistedAt || existingGig.unlistedAt >= today;

			// 如果要上架工作，需要檢查一些條件
			if (!isCurrentlyListed) {
				// 檢查工作是否已過期
				if (existingGig.dateEnd && existingGig.dateEnd < today) {
					return response.status(400).send("工作已過期，無法重新上架");
				}

				// 檢查工作是否被停用
				if (!existingGig.isActive) {
					return response.status(400).send("工作已停用，請先啟用工作");
				}
			}

			const newUnlistedAt = isCurrentlyListed ? today : null;

			await dbClient
				.update(gigs)
				.set({
					unlistedAt: newUnlistedAt,
					updatedAt: new Date(),
				})
				.where(eq(gigs.gigId, gigId));

			return response.status(200).send({
				message: `工作已${isCurrentlyListed ? "下架" : "上架"}`,
			});
		} catch (error) {
			console.error("切換工作上架狀態時出錯:", error);
			return response.status(500).send("伺服器內部錯誤");
		}
	},
);

// 獲取所有可用工作
router.get("/public/", async ({ query, response }) => {
	try {
		const {
			limit = 10,
			page = 1,
			city,
			district,
			minRate,
			maxRate,
			dateStart
		} = query;

		// 驗證 city 和 district 必須成對
		if (district && !city) {
			return response.status(400).send({
				error: "提供區域時必須同時提供城市"
			});
		}

		const requestLimit = Number.parseInt(limit);
		const requestPage = Number.parseInt(page);
		const minRateFilter = minRate ? Number.parseInt(minRate) : null;
		const maxRateFilter = maxRate ? Number.parseInt(maxRate) : null;

		// 處理日期邏輯
		const today = moment().format("YYYY-MM-DD");
		const searchDateStart = dateStart || today;

		// 建立查詢條件
		const whereConditions = [
			eq(gigs.isActive, true),
			lte(gigs.publishedAt, today),
			sql`(${gigs.unlistedAt} IS NULL OR ${gigs.unlistedAt} >= ${today})`,
			gte(gigs.dateEnd, searchDateStart)
		];

		city ? whereConditions.push(eq(gigs.city, city)) : null;
		district ? whereConditions.push(eq(gigs.district, district)) : null;
		minRateFilter ? whereConditions.push(gte(gigs.hourlyRate, minRateFilter)) : null;
		maxRateFilter ? whereConditions.push(lte(gigs.hourlyRate, maxRateFilter)) : null;

		const availableGigs = await dbClient.query.gigs.findMany({
			where: and(...whereConditions),
			orderBy: [
				sql`CASE WHEN ${gigs.dateStart}::date >= ${today}::date THEN 0 ELSE 1 END ASC`,
				sql`ABS(${gigs.dateStart}::date - ${today}::date) ASC`
			],
			limit: requestLimit + 1, // 多查一筆來確認是否有更多資料
			offset: limit * (requestPage - 1),
			columns: {
				gigId: true,
				title: true,
				hourlyRate: true,
				city: true,
				district: true,
				updatedAt: true,
			},
		});

		const hasMore = availableGigs.length > requestLimit;
		hasMore ? availableGigs.pop() : null;

		return response.status(200).send({
			gigs: availableGigs,
			pagination: {
				limit: requestLimit,
				page: requestPage,
				hasMore,
				returned: availableGigs.length,
			},
			filters: {
				city,
				district,
				minRate: minRateFilter,
				maxRate: maxRateFilter,
				dateStart: searchDateStart,
			},
		});
	} catch (error) {
		console.error("獲取工作列表時出錯:", error);
		return response.status(500).send("伺服器內部錯誤");
	}
});

// 獲取單一可用工作（詳細版）
router.get("/public/:gigId/", async ({ params, response }) => {
	try {
		const { gigId } = params;

		if (!gigId) {
			return response.status(400).send({ error: "Gig ID is required" });
		}

		const today = moment().format("YYYY-MM-DD");

		const whereConditions = [
			eq(gigs.gigId, gigId),
			eq(gigs.isActive, true),
			lte(gigs.publishedAt, today),
			sql`(${gigs.unlistedAt} IS NULL OR ${gigs.unlistedAt} >= ${today})`,
		];

		const gig = await dbClient.query.gigs.findFirst({
			where: and(...whereConditions),
			columns: {
				isActive: false,
				createdAt: false,
			},
			with: {
				employer: {
					columns: {
						employerId: true,
						employerName: true,
						branchName: true,
						industryType: true,
						address: true,
						employerPhoto: true,
					},
				},
			},
		});

		if (!gig) {
			return response.status(404).send({ message: "工作不存在或目前無法查看" });
		}

		const formattedGig = {
			...gig,
			environmentPhotos: await formatEnvironmentPhotos(gig.environmentPhotos),
		};

		return response.status(200).send(formattedGig);

	} catch (error) {
		console.error(`獲取詳細工作 ${params.gigId} 時出錯:`, error);
		return response.status(500).send("伺服器內部錯誤");
	}
});

// Employer 行事曆 - 查看已排定的工作
router.get("/employer/calendar", authenticated, requireEmployer, requireApprovedEmployer, async ({ user, query, response }) => {
	try {
		const {
			year,
			month,
			dateStart,
			dateEnd
		} = query;

		// 檢查是否提供了必要的日期參數
		const hasYearMonth = year && month;
		const hasDateRange = dateStart || dateEnd;

		if (!hasYearMonth && !hasDateRange) {
			return response.status(400).send({
				error: "必須提供年月參數 (year, month) 或日期範圍參數 (dateStart, dateEnd)"
			});
		}

		const currentDate = moment().format('YYYY-MM-DD');
		const whereConditions = [
			eq(gigs.employerId, user.employerId),
			eq(gigs.isActive, true),
			lte(gigs.publishedAt, currentDate),
			sql`(${gigs.unlistedAt} IS NULL OR ${gigs.unlistedAt} >= ${currentDate})`,
		];

		// 處理日期查詢邏輯
		if (hasYearMonth) {
			// 月份查詢模式
			const yearNum = Number.parseInt(year);
			const monthNum = Number.parseInt(month);

			// 驗證年月範圍
			if (yearNum < 2020 || yearNum > 2050 || monthNum < 1 || monthNum > 12) {
				return response.status(400).send({
					error: "年份必須在 2020-2050 之間，月份必須在 1-12 之間"
				});
			}

			// 建立該月份的開始和結束日期
			const startDate = moment(`${yearNum}-${monthNum.toString().padStart(2, '0')}-01`).format('YYYY-MM-DD');
			const endDate = moment(startDate).endOf('month').format('YYYY-MM-DD');

			// 查詢工作期間與該月有重疊的工作
			whereConditions.push(
				and(
					lte(gigs.dateStart, endDate),
					gte(gigs.dateEnd, startDate)
				)
			);
		} else if (hasDateRange) {
			if (dateStart && dateEnd) {
				// 工作期間與搜尋範圍有重疊
				whereConditions.push(
					and(
						lte(gigs.dateStart, dateEnd),
						gte(gigs.dateEnd, dateStart)
					)
				);
			} else if (dateStart) {
				// 只提供開始日期
				whereConditions.push(gte(gigs.dateEnd, dateStart));
			} else if (dateEnd) {
				// 只提供結束日期
				whereConditions.push(lte(gigs.dateStart, dateEnd));
			}
		}

		const calendarGigs = await dbClient.query.gigs.findMany({
			where: and(...whereConditions),
			orderBy: [gigs.dateStart, gigs.timeStart],
			columns: {
				gigId: true,
				title: true,
				dateStart: true,
				dateEnd: true,
				timeStart: true,
				timeEnd: true,
			},
		});

		return response.status(200).send({
			gigs: calendarGigs,
			count: calendarGigs.length,
			queryInfo: {
				year: year || null,
				month: month || null,
				dateStart: dateStart || null,
				dateEnd: dateEnd || null,
			}
		});

	} catch (error) {
		console.error("獲取 Employer 行事曆時出錯:", error);
		return response.status(500).send("伺服器內部錯誤");
	}
});


export default { path: "/gig", router } as IRouter;
