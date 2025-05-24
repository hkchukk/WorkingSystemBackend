import { z } from "@nhttp/zod";

export const workerSignupSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z.string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Must contain at least one uppercase letter")
    .regex(/[a-z]/, "Must contain at least one lowercase letter")
    .regex(/[0-9]/, "Must contain at least one number"),
  firstName: z.string(),
  lastName: z.string(),
  phoneNumber: z.string()
    .regex(/^(09\d{8}|\+8869\d{8}|0\d{1,2}-?\d{6,8})$/, "Invalid phone number"),
  highestEducation: z.enum(["高中", "大學", "碩士", "博士", "其他"]).default(
    "大學",
  ),
  schoolName: z.string().optional(),
  major: z.string().optional(),
  studyStatus: z.enum(["就讀中", "已畢業", "肄業"]),
  certificates: z.array(z.string()).optional(),
});

export const employerSignupSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z.string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Must contain at least one uppercase letter")
    .regex(/[a-z]/, "Must contain at least one lowercase letter")
    .regex(/[0-9]/, "Must contain at least one number"),
  employerName: z.string(),
  branchName: z.string().optional(),
  industryType: z.string().min(2, "Industry type required"),
  address: z.object({
    street: z.string().min(1),
    city: z.string().min(1),
    state: z.string().min(1),
    postalCode: z.string().min(1),
    country: z.string().min(1),
  }),
  phoneNumber: z.string()
    .regex(/^(09\d{8}|\+8869\d{8}|0\d{1,2}-?\d{6,8})$/, "Invalid phone number"),
  identificationType: z.enum(["unifiedBusinessNo", "personalId"]),
  identificationNumber: z.string().min(5, "ID number too short"),
  contactInfo: z.object({
    contactPerson: z.string().min(2),
    contactEmail: z.string().email(),
    contactPhone: z.string().min(10),
  }).optional(),
});
