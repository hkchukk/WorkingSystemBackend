import type { Router } from "jsr:@nhttp/nhttp";

export default interface IRouter {
  path: string;
  router: Router;
}
