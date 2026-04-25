import "dotenv/config";
import { eq } from "drizzle-orm";
import { NBA_TEAMS } from "@ohsboard/types";
import { createDb } from "./client";
import { selectors, sports, teams } from "./schema";

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
  await db
    .insert(sports)
    .values([
      { slug: "mlb", name: "MLB", isActive: false },
      { slug: "nba", name: "NBA", isActive: true },
      { slug: "nfl", name: "NFL", isActive: false },
    ])
    .onConflictDoNothing({ target: sports.slug });

  // Force the active flags every run — onConflictDoNothing leaves existing
  // rows untouched, so without these UPDATEs an MLB row originally seeded as
  // active stays active and the worker would still scrape it.
  await db.update(sports).set({ isActive: false }).where(eq(sports.slug, "mlb"));
  await db.update(sports).set({ isActive: true }).where(eq(sports.slug, "nba"));
  await db.update(sports).set({ isActive: false }).where(eq(sports.slug, "nfl"));

  const nba = await db.select().from(sports).where(eq(sports.slug, "nba"));
  const nbaSportId = nba[0]?.id;
  if (!nbaSportId) {
    throw new Error("Failed to seed NBA sport row");
  }

  console.log("Seeding NBA teams…");
  const teamRows = NBA_TEAMS.map((t) => ({
    sportId: nbaSportId,
    externalId: `nba:${t.id}`,
    name: t.name,
    abbreviation: t.abbreviation,
  }));
  const insertedTeams = await db
    .insert(teams)
    .values(teamRows)
    .onConflictDoNothing({
      target: [teams.sportId, teams.externalId],
    })
    .returning();
  console.log(
    `  + ${insertedTeams.length}/${teamRows.length} NBA team rows inserted (existing rows skipped).`,
  );

  console.log("Active sports now:");
  const all = await db.select().from(sports);
  for (const s of all) {
    console.log(`  ${s.slug.padEnd(4)} ${s.isActive ? "ACTIVE" : "paused"}  (${s.name})`);
  }
  console.log("Done. Selectors will be populated by the healer on the next scrape.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
