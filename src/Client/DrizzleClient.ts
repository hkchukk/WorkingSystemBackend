import * as schema from "../Schema/DatabaseSchema.ts";
import { drizzle } from "drizzle-orm/bun-sql";

const dbClient = drizzle(process.env.DBURL, { schema: { ...schema } });

export default dbClient;
