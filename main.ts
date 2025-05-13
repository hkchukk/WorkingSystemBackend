// @deno-types="npm:@types/express-session"
import session from "npm:express-session";
// @deno-types="npm:@types/passport"
import passport from "npm:passport";
import {nhttp, multipart} from "jsr:@nhttp/nhttp";
import cors from "jsr:@nhttp/nhttp/cors";
import memoryStore from "npm:memorystore";
import { initStrategy } from "./Strategies/local.ts";
import type IRouter from "./Interfaces/IRouter.ts";
import { hash } from "jsr:@felix/argon2";
import { argon2Config } from "./config.ts";
import {expandGlob} from "jsr:@std/fs"

initStrategy(); 

const app = nhttp({ stackError: false });

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
    secret: Deno.env.get("SESSIONSECRET"),
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

for await (const file of expandGlob(`${Deno.cwd()}/Routes/**/*.ts`)) {
  const { path, router }: IRouter = (await import(`file://${file.path}`)).default;
  app.use(path, router);
}

app.listen(3000, () => {
  console.log("Server is ready");
});
