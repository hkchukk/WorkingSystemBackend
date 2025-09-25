import { Algorithm, Version, type Options } from "@node-rs/argon2";

export const argon2Config: Options = {
    algorithm: Algorithm.Argon2id,
    version: Version.V0x13,
    timeCost: 6,
    parallelism: 6,
    secret: new TextEncoder().encode(process.env.HASHINGSECRET),
};

export const fcmConfig = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
};