import type { Handler } from "jsr:@nhttp/nhttp";

export const authenticated: Handler = (rev, next) => {
    if (rev.isAuthenticated()) {
		return next();
	}
	return new Response("Unauthorized", { status: 401 });
};
