import { Router } from "@nhttp/nhttp";
import { authenticated } from "../Middleware/middleware.ts";
import type IRouter from "../Interfaces/IRouter.ts";
import dbClient from "../Client/DrizzleClient.ts";
import { eq, and, desc } from "drizzle-orm";
import { gigs, employers, gigApplications } from "../Schema/DatabaseSchema.ts";
import validate from "@nhttp/zod";
import { createGigSchema, updateGigSchema } from "../Middleware/validator.ts";
import { Role } from "../Types/types.ts";

const router = new Router();

// 發佈新工作
router.post(
  "/create",
  authenticated,
  validate(createGigSchema),
  async ({ user, body, response }) => {
    try {
      // 確認用戶是商家
      if (user.role !== Role.EMPLOYER) {
        return response.status(403).send("只有商家可以發佈工作");
      }

      // 檢查商家是否已通過審核
      const employer = await dbClient.query.employers.findFirst({
        where: eq(employers.employerId, user.employerId),
      });

      if (!employer) {
        return response.status(404).send("商家不存在");
      }

      if (employer.approvalStatus !== "approved") {
        //return response.status(403).send("商家尚未通過審核，無法發佈工作");
      }

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
        environmentPhotos,
        publishedAt,
        unlistedAt
      } = body;

      const gigData = {
        employerId: user.employerId,
        title,
        description: description ? JSON.stringify(description) : null,
        dateStart: dateStart ? new Date(dateStart).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        dateEnd: dateEnd ? new Date(dateEnd).toISOString().split('T')[0] : null,
        timeStart,
        timeEnd,
        requirements: requirements ? JSON.stringify(requirements) : null,
        hourlyRate,
        city,
        district,
        address,
        contactPerson,
        contactPhone: contactPhone || null,
        contactEmail: contactEmail || null,
        environmentPhotos: environmentPhotos ? JSON.stringify(environmentPhotos) : null,
        publishedAt: publishedAt ? new Date(publishedAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        unlistedAt: unlistedAt ? new Date(unlistedAt).toISOString().split('T')[0] : null,
      };

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
          isActive: newGig.isActive,
          createdAt: newGig.createdAt,
        },
      });
    } catch (error) {
      console.error("創建工作時出錯:", error);
      return response.status(500).send("伺服器內部錯誤");
    }
  }
);

// 獲取自己發佈的工作
router.get(
  "/my-gigs",
  authenticated,
  async ({ user, response, query }) => {
    try {
      if (user.role !== Role.EMPLOYER) {
        return response.status(403).send("只有商家可以查看自己的工作");
      }

      const page = parseInt(query.page) || 1;
      const limit = parseInt(query.limit) || 10;
      const offset = (page - 1) * limit;

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
        limit,
        offset
      });

      return response.status(200).send({
        gigs: myGigs,
        pagination: {
          page,
          limit,
          hasMore: myGigs.length === limit,
        },
      });
    } catch (error) {
      console.error("獲取工作列表時出錯:", error);
      return response.status(500).send("伺服器內部錯誤");
    }
  }
);

// 獲取特定工作詳情
router.get(
  "/:gigId",
  authenticated,
  async ({ user, params, response }) => {
    try {
      const { gigId } = params;

      const gig = await dbClient.query.gigs.findFirst({
        where: eq(gigs.gigId, gigId),
        with: {
          gigApplications: {
            with: {
              worker: {
                columns: {
                  workerId: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                  phoneNumber: true,
                  highestEducation: true,
                  schoolName: true,
                  major: true,
                },
              },
            },
          },
        },
      });

      if (!gig) {
        return response.status(404).send("工作不存在");
      }

      // 如果是商家，只能查看自己的工作詳情
      if (user.role === Role.EMPLOYER && gig.employerId !== user.employerId) {
        return response.status(403).send("無權查看此工作");
      }

      // 添加申請計數統計
      const gigWithCounts = {
        ...gig,
        applicationCount: gig.gigApplications ? gig.gigApplications.length : 0,
        pendingApplications: gig.gigApplications ? gig.gigApplications.filter(app => app.status === "pending").length : 0,
      };

      return response.status(200).send(gigWithCounts);
    } catch (error) {
      console.error("獲取工作詳情時出錯:", error);
      return response.status(500).send("伺服器內部錯誤");
    }
  }
);

// 更新工作資訊
router.put(
  "/:gigId",
  authenticated,
  validate(updateGigSchema),
  async ({ user, params, body, response }) => {
    try {
      if (user.role !== Role.EMPLOYER) {
        return response.status(403).send("只有商家可以更新工作");
      }

      const { gigId } = params;

      // 檢查工作是否存在且屬於該商家
      const existingGig = await dbClient.query.gigs.findFirst({
        where: and(eq(gigs.gigId, gigId), eq(gigs.employerId, user.employerId)),
      });

      if (!existingGig) {
        return response.status(404).send("工作不存在或無權限修改");
      }

      const updateData: any = {};
      
      if (body.title) updateData.title = body.title;
      if (body.description !== undefined) updateData.description = body.description ? JSON.stringify(body.description) : null;
      if (body.dateStart) updateData.dateStart = new Date(body.dateStart).toISOString().split('T')[0];
      if (body.dateEnd) updateData.dateEnd = new Date(body.dateEnd).toISOString().split('T')[0];
      if (body.timeStart) updateData.timeStart = body.timeStart;
      if (body.timeEnd) updateData.timeEnd = body.timeEnd;
      if (body.requirements !== undefined) updateData.requirements = body.requirements ? JSON.stringify(body.requirements) : null;
      if (body.hourlyRate) updateData.hourlyRate = body.hourlyRate;
      if (body.city) updateData.city = body.city;
      if (body.district) updateData.district = body.district;
      if (body.address) updateData.address = body.address;
      if (body.contactPerson) updateData.contactPerson = body.contactPerson;
      if (body.contactPhone !== undefined) updateData.contactPhone = body.contactPhone;
      if (body.contactEmail !== undefined) updateData.contactEmail = body.contactEmail;
      if (body.environmentPhotos !== undefined) updateData.environmentPhotos = body.environmentPhotos ? JSON.stringify(body.environmentPhotos) : null;
      if (body.publishedAt) updateData.publishedAt = new Date(body.publishedAt).toISOString().split('T')[0];
      if (body.unlistedAt) updateData.unlistedAt = new Date(body.unlistedAt).toISOString().split('T')[0];
      if (body.isActive !== undefined) updateData.isActive = body.isActive;
      
      updateData.updatedAt = new Date();

      const updatedGig = await dbClient
        .update(gigs)
        .set(updateData)
        .where(eq(gigs.gigId, gigId))
        .returning();

      return response.status(200).send({
        message: "工作更新成功",
        gig: updatedGig[0],
      });
    } catch (error) {
      console.error("更新工作時出錯:", error);
      return response.status(500).send("伺服器內部錯誤");
    }
  }
);

// 停用/啟用工作
router.patch(
  "/:gigId/toggle-status",
  authenticated,
  async ({ user, params, response }) => {
    try {
      if (user.role !== Role.EMPLOYER) {
        return response.status(403).send("只有商家可以更改工作狀態");
      }

      const { gigId } = params;

      const existingGig = await dbClient.query.gigs.findFirst({
        where: and(eq(gigs.gigId, gigId), eq(gigs.employerId, user.employerId)),
      });

      if (!existingGig) {
        return response.status(404).send("工作不存在或無權限修改");
      }

      const updatedGig = await dbClient
        .update(gigs)
        .set({
          isActive: !existingGig.isActive,
          updatedAt: new Date(),
        })
        .where(eq(gigs.gigId, gigId))
        .returning();

      return response.status(200).send({
        message: `工作已${updatedGig[0].isActive ? "啟用" : "停用"}`,
        gig: updatedGig[0],
      });
    } catch (error) {
      console.error("切換工作狀態時出錯:", error);
      return response.status(500).send("伺服器內部錯誤");
    }
  }
);

// 刪除工作
router.delete(
  "/:gigId",
  authenticated,
  async ({ user, params, response }) => {
    try {
      if (user.role !== Role.EMPLOYER) {
        return response.status(403).send("只有商家可以刪除工作");
      }

      const { gigId } = params;

      const existingGig = await dbClient.query.gigs.findFirst({
        where: and(eq(gigs.gigId, gigId), eq(gigs.employerId, user.employerId)),
      });

      if (!existingGig) {
        return response.status(404).send("工作不存在或無權限刪除");
      }

      // 檢查是否有待處理的申請
      const pendingApplications = await dbClient.query.gigApplications.findMany({
        where: and(eq(gigApplications.gigId, gigId), eq(gigApplications.status, "pending")),
      });

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
  }
);

// 獲取所有可用工作（給打工者查看）
router.get(
  "/",
  async ({ query, response }) => {
    try {
      const page = parseInt(query.page) || 1;
      const limit = parseInt(query.limit) || 10;
      const offset = (page - 1) * limit;
      const city = query.city;
      const district = query.district;
      const minRate = query.minRate ? parseInt(query.minRate) : null;
      const maxRate = query.maxRate ? parseInt(query.maxRate) : null;

      let whereConditions = eq(gigs.isActive, true);

      const availableGigs = await dbClient.query.gigs.findMany({
        where: whereConditions,
        orderBy: [desc(gigs.createdAt)],
        limit,
        offset,
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
        filteredGigs = filteredGigs.filter(gig => gig.city.includes(city));
      }

      if (district) {
        filteredGigs = filteredGigs.filter(gig => gig.district.includes(district));
      }

      if (minRate) {
        filteredGigs = filteredGigs.filter(gig => gig.hourlyRate >= minRate);
      }

      if (maxRate) {
        filteredGigs = filteredGigs.filter(gig => gig.hourlyRate <= maxRate);
      }

      return response.status(200).send({
        gigs: filteredGigs,
        pagination: {
          page,
          limit,
          hasMore: filteredGigs.length === limit,
        },
        filters: {
          city,
          district,
          minRate,
          maxRate,
        },
      });
    } catch (error) {
      console.error("獲取工作列表時出錯:", error);
      return response.status(500).send("伺服器內部錯誤");
    }
  }
);

export default { path: "/gig", router } as IRouter; 