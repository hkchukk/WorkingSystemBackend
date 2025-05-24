import type { Handler } from "@nhttp/nhttp";

export const authenticated: Handler = (rev, next) => {
  if (rev.isAuthenticated()) {
    return next();
  }
  return new Response("Unauthorized", { status: 401 });
};
