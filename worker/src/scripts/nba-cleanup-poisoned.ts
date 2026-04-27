// One-off cleanup: delete NBA `games` rows with `external_id LIKE 'dk:%'`.
// These rows came from the unmatched-fallback code path that wrote
// `new Date()` into `start_time` on every cron tick (fixed in scraper.ts).
// Their odds_snapshots rows are removed via ON DELETE CASCADE.
//
// `nba:<espn_id>` rows are kept — those have authoritative ESPN tip-offs.
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: "../.env.local" });

import { createDb, games, sports } from "@ohsboard/db";
import { and, eq, like } from "drizzle-orm";

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) throw new Error("DATABASE_URL missing");
const db = createDb(dbUrl);

const nba = await db.query.sports.findFirst({
  where: eq(sports.slug, "nba"),
});
if (!nba) throw new Error("nba sport row missing");

const targets = await db
  .select({
    id: games.id,
    externalId: games.externalId,
    sourceUrl: games.sourceUrl,
    startTime: games.startTime,
  })
  .from(games)
  .where(and(eq(games.sportId, nba.id), like(games.externalId, "dk:%")));

console.log(`Found ${targets.length} poisoned dk:% rows:`);
for (const r of targets) {
  console.log(`  - ${r.externalId.padEnd(20)} start=${r.startTime.toISOString()}`);
}

if (targets.length === 0) {
  console.log("Nothing to delete.");
  process.exit(0);
}

const deleted = await db
  .delete(games)
  .where(and(eq(games.sportId, nba.id), like(games.externalId, "dk:%")))
  .returning({ id: games.id });

console.log(`\nDeleted ${deleted.length} rows (odds_snapshots cascaded).`);
process.exit(0);
