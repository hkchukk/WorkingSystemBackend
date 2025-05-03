import session from "express-session";
import passport from "passport";
import nhttp from "@nhttp/nhttp";
import cors from "@nhttp/nhttp/cors";
import memoryStore from "memorystore";
import { initStrategy } from "./Strategies/local.ts";
import { Glob } from "bun";
import type IRouter from "./Interfaces/IRouter.ts";
import { hash } from "@node-rs/argon2";
import { argon2Config } from "./config.ts";

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
    secret: process.env.SESSIONSECRET,
  }),
);

app.use(passport.initialize());
app.use(passport.session());

app.get("/", () => {
  return "Hello World!";
});

app.get("/hashing/:password", ({ params }) => {
  const { password } = params;
  return hash(password, argon2Config);
});

for await (const file of new Glob("**/*.{ts,tsx}").scan({
  cwd: `${__dirname}/Routes`,
  absolute: true,
})) {
  const { path, router }: IRouter = (await import(file)).default;
  app.use(path, router);
}

app.listen(3000, () => {
  console.log("Server is ready");
});
