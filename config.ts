import { type HashOptions, Variant } from "jsr:@felix/argon2";

export const argon2Config: Partial<HashOptions> = {
	variant: Variant.Argon2id,
	timeCost: 6,
	lanes: 6,
	secret: new TextEncoder().encode(Deno.env.get("HASHINGSECRET")),
};
