import type { Handler } from "@nhttp/nhttp";
import { Role } from "../Types/types";

export const authenticated: Handler = (rev, next) => {
  if (rev.isAuthenticated()) {
    return next();
  }
  return new Response("Unauthorized", { status: 401 });
};