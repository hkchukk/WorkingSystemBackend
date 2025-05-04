import { Router } from "jsr:@nhttp/nhttp";
// @deno-types="npm:@types/passport"
import passport from "npm:passport";
import { authenticated } from "../Middleware/middleware.ts";
// @deno-types="npm:@types/cookie-signature"
import signature from "npm:cookie-signature";
import type IRouter from "../Interfaces/IRouter.ts";

const router = new Router();

router.post(
  "/login",
  passport.authenticate("local"),
  ({ response, user, sessionID }) => {
    response.cookie(
      "connect.sid",
      `s:${signature.sign(sessionID, process.env.SECRET)}`,
    );
    return user;
  },
);

router.get("/logout", ({ session }) => {
  session.destroy();
  return "Logged out";
});

router.get("/profile", authenticated, () => {
  return "profile";
});

export default { path: "/user", router } as IRouter;
