import { Algorithm, Version, type Options } from "@node-rs/argon2";

export const argon2Config: Options = {
	algorithm:Algorithm.Argon2id,
	version:Version.V0x13,
	timeCost: 6,
	parallelism: 6,
	secret: new TextEncoder().encode(process.env.HASHINGSECRET),
};
