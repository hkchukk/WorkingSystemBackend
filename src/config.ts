import { Algorithm, Version, type Options } from "@node-rs/argon2";
import { Options as EmailOptions } from "nodemailer/lib/smtp-connection";

export const argon2Config: Options = {
  algorithm: Algorithm.Argon2id,
  version: Version.V0x13,
  timeCost: 6,
  parallelism: 6,
  secret: new TextEncoder().encode(process.env.HASHINGSECRET),
};

//TODO: Fill in email server details and authenticate information
export const emailConfig: EmailOptions = {
  host: "",
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
}
