import type { Router } from "@nhttp/nhttp";

export default interface IRouter {
  path: string;
  router: Router;
}
