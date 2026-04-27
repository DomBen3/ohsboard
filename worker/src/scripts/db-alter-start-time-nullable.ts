// One-off DDL: drop NOT NULL on games.start_time so the scraper can persist
// games whose authoritative tip-off is not yet known (UI renders these as
// "TBD"). Idempotent — re-running is a no-op.
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: "../.env.local" });

import { createDb } from "@ohsboard/db";
import { sql } from "drizzle-orm";

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) throw new Error("DATABASE_URL missing");
const db = createDb(dbUrl);

await db.execute(
  sql`ALTER TABLE games ALTER COLUMN start_time DROP NOT NULL`,
);
console.log("OK: games.start_time is now nullable");
process.exit(0);
