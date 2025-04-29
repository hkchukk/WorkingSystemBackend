import session from "express-session";
import passport from "passport";
import nhttp from "@nhttp/nhttp";
import cors from "@nhttp/nhttp/cors";
import memoryStore from "memorystore";
import { initStrategy } from "./strategies/local.ts";
import { authenticated } from "./middleware.ts";
import signature from "cookie-signature";

const secret = "akpEUnT8iZIFjm-CwmwIf";

initStrategy();

const app = nhttp();

app.use(cors({ credentials: true }));

const MemoryStore = memoryStore(session);

app.use(
  session({
    cookie: { maxAge: 60000 * 60 * 24, secure: true },
    store: new MemoryStore({
      checkPeriod: 60000 * 60 * 24,
    }),
    resave: true,
    saveUninitialized: false,
    secret,
  }),
);

app.use(passport.initialize());
app.use(passport.session());

app.get("/", () => {
  return "Hello World!";
});

app.get("/hi/:user", ({ params }) => {
  return `Hello ${params.user}!`;
});

app.post(
  "/login",
  passport.authenticate("local"),
  ({ response, user, sessionID }) => {
    response.cookie("connect.sid", `s:${signature.sign(sessionID, secret)}`);
    return user;
  },
);

app.get("/logout", ({ session }) => {
  session.destroy();
  return "Logged out";
});

app.get("/protected", authenticated, () => {
  return "Protected";
});

app.listen(3000, () => {
  console.log("Server is ready");
});
