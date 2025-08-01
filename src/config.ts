import { Algorithm, Version, type Options } from "@node-rs/argon2";
import type { Options as EmailOptions } from "nodemailer/lib/smtp-connection";

export const argon2Config: Options = {
    algorithm: Algorithm.Argon2id,
    version: Version.V0x13,
    timeCost: 6,
    parallelism: 6,
    secret: new TextEncoder().encode(process.env.HASHINGSECRET),
};

// 郵件服務器配置 - 使用環境變數配置
export const emailConfig: EmailOptions = {
    host: process.env.EMAIL_HOST || "smtp.gmail.com", // 預設使用 Gmail SMTP
    port: parseInt(process.env.EMAIL_PORT || "587"),
    secure: process.env.EMAIL_SECURE === "true", // 使用 TLS
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
    // 額外的安全設置
    requireTLS: true,
    tls: {
        rejectUnauthorized: false // 在開發環境中可能需要
    }
}
