import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { env } from "./env.js";

const databaseUrl = new URL(env.DATABASE_URL);
for (const key of [...databaseUrl.searchParams.keys()]) {
  if (key.toLowerCase().startsWith("ssl") || key === "uselibpqcompat") {
    databaseUrl.searchParams.delete(key);
  }
}

export const pool = new Pool({
  connectionString: databaseUrl.toString(),
  ssl: {
    ca: readFileSync(env.DATABASE_CA_CERT_PATH, "utf8"),
    rejectUnauthorized: true,
  },
});
