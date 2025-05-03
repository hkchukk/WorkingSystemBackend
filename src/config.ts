import { Algorithm, type Options } from "@node-rs/argon2";

export const argon2Config: Options = {
  algorithm: Algorithm.Argon2id,
  timeCost: 8,
  parallelism: 8,
  secret: Buffer.from(process.env.HASHINGSECRET),
};
