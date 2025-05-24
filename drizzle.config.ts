import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./Schema/DatabaseSchema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DBURL,
  },
});
