import "dotenv/config";
import { createDb } from "./client";
import { selectors, sports } from "./schema";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL must be set (see .env.example)");
}

const db = createDb(DATABASE_URL);

async function main() {
  // Fresh seed on each run in dev: wipe all selectors so the healer discovers
  // them from scratch. The 2024 seeds from the legacy Python script no longer
  // match DraftKings' live DOM — M6's healer replaces them at runtime.
  const cleared = await db.delete(selectors).returning({ id: selectors.id });
  if (cleared.length > 0) {
    console.log(`Cleared ${cleared.length} existing selector row(s).`);
  }

  console.log("Seeding sports…");
  const insertedSports = await db
    .insert(sports)
    .values([
      { slug: "mlb", name: "MLB", isActive: true },
      { slug: "nba", name: "NBA", isActive: false },
      { slug: "nfl", name: "NFL", isActive: false },
    ])
    .onConflictDoNothing({ target: sports.slug })
    .returning();

  console.log(`  + ${insertedSports.length} sports inserted (existing rows skipped).`);
  console.log("Done. Selectors will be populated by the healer on the next scrape.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
