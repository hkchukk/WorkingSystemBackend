import * as schema from "../Schema/DatabaseSchema.ts";
import { drizzle } from "npm:drizzle-orm/postgres-js";

const dbClient = drizzle(Deno.env.get("DBURL"), { schema: { ...schema } });

export default dbClient;
