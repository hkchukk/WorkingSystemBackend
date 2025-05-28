import { z } from "@nhttp/zod";

export const workerSignupSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Must contain at least one uppercase letter")
    .regex(/[a-z]/, "Must contain at least one lowercase letter")
    .regex(/[0-9]/, "Must contain at least one number"),
  firstName: z.string(),
  lastName: z.string(),
  phoneNumber: z
    .string()
    .regex(/^(09\d{8}|\+8869\d{8}|0\d{1,2}-?\d{6,8})$/, "Invalid phone number"),
  highestEducation: z
    .enum(["高中", "大學", "碩士", "博士", "其他"])
    .default("大學"),
  schoolName: z.string().optional(),
  major: z.string().optional(),
  studyStatus: z.enum(["就讀中", "已畢業", "肄業"]),
  certificates: z.array(z.string()).optional(),
});

export const employerSignupSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Must contain at least one uppercase letter")
    .regex(/[a-z]/, "Must contain at least one lowercase letter")
    .regex(/[0-9]/, "Must contain at least one number"),
  employerName: z.string(),
  branchName: z.string().optional(),
  industryType: z.string().min(2, "Industry type required"),
  address: z.string().min(5, "Address must be at least 5 characters"),
  phoneNumber: z
    .string()
    .regex(/^(09\d{8}|\+8869\d{8}|0\d{1,2}-?\d{6,8})$/, "Invalid phone number"),
  identificationType: z.enum(["businessNo", "personalId"]),
  identificationNumber: z.string().min(5, "ID number too short"),
  contactInfo: z
    .object({
      contactPerson: z.string().min(2),
      contactEmail: z.string().email(),
      contactPhone: z.string().min(10),
    })
    .optional(),
});

// 工作發佈的驗證 Schema
export const createGigSchema = z.object({
  title: z.string().min(1, "工作標題不能為空").max(256, "工作標題過長"),
  description: z.any().optional(),
  dateStart: z.coerce.date(),
  dateEnd: z.coerce.date(),
  timeStart: z.string().transform((val) => {
    if (/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(val)) {
      return val;
    }
    const timeMatch = val.match(/(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      const hour = timeMatch[1].padStart(2, '0');
      const minute = timeMatch[2];
      return `${hour}:${minute}`;
    }
    throw new Error("時間格式不正確 (應為 HH:MM)");
  }),
  timeEnd: z.string().transform((val) => {
    if (/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(val)) {
      return val;
    }
    const timeMatch = val.match(/(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      const hour = timeMatch[1].padStart(2, '0');
      const minute = timeMatch[2];
      return `${hour}:${minute}`;
    }
    throw new Error("時間格式不正確 (應為 HH:MM)");
  }),
  requirements: z.any().optional(),
  hourlyRate: z.coerce.number().min(1, "時薪必須大於 0").max(10000, "時薪過高"),
  city: z.string().min(1, "城市不能為空").max(32, "城市名稱過長"),
  district: z.string().min(1, "地區不能為空").max(32, "地區名稱過長"),
  address: z.string().min(1, "地址不能為空").max(256, "地址過長"),
  contactPerson: z.string().min(1, "聯絡人不能為空").max(32, "聯絡人姓名過長"),
  contactPhone: z.string().regex(/^(09\d{8}|\+8869\d{8}|0\d{1,2}-?\d{6,8})$/, "聯絡電話格式不正確").optional(),
  contactEmail: z.string().email("聯絡人 Email 格式不正確").max(128, "Email 過長").optional(),
  publishedAt: z.coerce.date(),
  unlistedAt: z.coerce.date().optional(),
}).refine((data) => {
  if (data.timeStart && data.timeEnd) {
    const [startHour, startMin] = data.timeStart.split(':').map(Number);
    const [endHour, endMin] = data.timeEnd.split(':').map(Number);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;
    return endMinutes > startMinutes;
  }
  return true;
}, {
  message: "結束時間必須晚於開始時間",
  path: ["timeEnd"]
}).refine((data) => {
  if (data.dateStart && data.dateEnd) {
    return data.dateEnd >= data.dateStart;
  }
  return true;
}, {
  message: "結束日期必須晚於或等於開始日期",
  path: ["dateEnd"]
}).refine((data) => {
  if (data.publishedAt && data.unlistedAt) {
    return data.unlistedAt >= data.publishedAt;
  }
  return true;
}, {
  message: "下架日期必須晚於刊登日期",
  path: ["unlistedAt"]
});

export const updateGigSchema = z.object({
  title: z.string().min(1, "工作標題不能為空").max(256, "工作標題過長").optional(),
  description: z.any().optional(),
  dateStart: z.coerce.date().optional(),
  dateEnd: z.coerce.date().optional(),
  timeStart: z.string().transform((val) => {
    if (/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(val)) {
      return val;
    }
    const timeMatch = val.match(/(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      const hour = timeMatch[1].padStart(2, '0');
      const minute = timeMatch[2];
      return `${hour}:${minute}`;
    }
    throw new Error("時間格式不正確 (應為 HH:MM)");
  }).optional(),
  timeEnd: z.string().transform((val) => {
    if (/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(val)) {
      return val;
    }
    const timeMatch = val.match(/(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      const hour = timeMatch[1].padStart(2, '0');
      const minute = timeMatch[2];
      return `${hour}:${minute}`;
    }
    throw new Error("時間格式不正確 (應為 HH:MM)");
  }).optional(),
  requirements: z.any().optional(),
  hourlyRate: z.coerce.number().min(1, "時薪必須大於 0").max(10000, "時薪過高").optional(),
  city: z.string().min(1, "城市不能為空").max(32, "城市名稱過長").optional(),
  district: z.string().min(1, "地區不能為空").max(32, "地區名稱過長").optional(),
  address: z.string().min(1, "地址不能為空").max(256, "地址過長").optional(),
  contactPerson: z.string().min(1, "聯絡人不能為空").max(32, "聯絡人姓名過長").optional(),
  contactPhone: z.string().regex(/^(09\d{8}|\+8869\d{8}|0\d{1,2}-?\d{6,8})$/, "聯絡電話格式不正確").optional(),
  contactEmail: z.string().email("聯絡人 Email 格式不正確").max(128, "Email 過長").optional(),
  publishedAt: z.coerce.date().optional(),
  unlistedAt: z.coerce.date().optional(),
  isActive: z.coerce.boolean().optional(),
}).refine((data) => {
  if (data.timeStart && data.timeEnd) {
    const [startHour, startMin] = data.timeStart.split(':').map(Number);
    const [endHour, endMin] = data.timeEnd.split(':').map(Number);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;
    return endMinutes > startMinutes;
  }
  return true;
}, {
  message: "結束時間必須晚於開始時間",
  path: ["timeEnd"]
}).refine((data) => {
  if (data.dateStart && data.dateEnd) {
    return data.dateEnd >= data.dateStart;
  }
  return true;
}, {
  message: "結束日期必須晚於或等於開始日期",
  path: ["dateEnd"]
}).refine((data) => {
  if (data.publishedAt && data.unlistedAt) {
    return data.unlistedAt >= data.publishedAt;
  }
  return true;
}, {
  message: "下架日期必須晚於刊登日期",
  path: ["unlistedAt"]
});