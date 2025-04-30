import { Router } from "@nhttp/nhttp";
import passport from "passport";
import { authenticated } from "../middleware.ts";
import signature from "cookie-signature";
import { secret } from "../config.ts";
import type IRouter from "../interfaces/IRouter.ts";

const router = new Router();

router.post(
  "/login",
  passport.authenticate("local"),
  ({ response, user, sessionID }) => {
    response.cookie("connect.sid", `s:${signature.sign(sessionID, secret)}`);
    return user;
  },
);

router.get("/logout", ({ session }) => {
  session.destroy();
  return "Logged out";
});

router.get("/protected", authenticated, () => {
  return "Protected";
});

export default { path: "/user", router } as IRouter;
