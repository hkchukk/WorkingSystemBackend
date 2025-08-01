import type {Hono} from "hono";
import type { HonoGenericContext } from "../Types/types";

export default interface IRouter {
  path: string;
  router: Hono<HonoGenericContext>;
}
