// Diagnostic: compare current `games` rows against ESPN expected list and
// the slug-derived team names that scrapeOneNbaGame would feed into
// matchExpectedNbaGame. Read-only — does not write to the DB.
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: "../.env.local" });

import { createDb, games, sports } from "@ohsboard/db";
import { and, eq } from "drizzle-orm";
import {
  fetchExpectedNbaGames,
  matchExpectedNbaGame,
} from "../schedule/espn-nba";

const SLUG_SEP_RE = /-(?:vs|at|%2540|%40|@)-/i;
function parseSlugTeams(url: string): { away: string; home: string } | null {
  const m = /\/event\/([^/?#]+)\/\d+/.exec(url);
  if (!m || !m[1]) return null;
  const parts = m[1].split(SLUG_SEP_RE);
  if (parts.length !== 2) return null;
  const titleCase = (slug: string) =>
    slug
      .split("-")
      .filter(Boolean)
      .map((w) => w[0]!.toUpperCase() + w.slice(1))
      .join(" ");
  const [awaySlug, homeSlug] = parts as [string, string];
  return { away: titleCase(awaySlug), home: titleCase(homeSlug) };
}

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) throw new Error("DATABASE_URL missing");
const db = createDb(dbUrl);

const nba = await db.query.sports.findFirst({
  where: eq(sports.slug, "nba"),
});
if (!nba) throw new Error("nba sport row missing");

const rows = await db
  .select({
    id: games.id,
    externalId: games.externalId,
    sourceUrl: games.sourceUrl,
    startTime: games.startTime,
  })
  .from(games)
  .where(eq(games.sportId, nba.id));

const nowMs = Date.now();
console.log(`\n=== DB games for NBA: ${rows.length} ===`);
for (const r of rows) {
  const ageMs = nowMs - r.startTime.getTime();
  const tag = Math.abs(ageMs) < 10 * 60_000 ? "  ⚠️  ~now" : "";
  console.log(
    `  ${r.externalId.padEnd(20)} start=${r.startTime.toISOString()} (Δnow=${Math.round(ageMs / 60_000)}m)${tag}`,
  );
  console.log(`    url=${r.sourceUrl}`);
  const slug = parseSlugTeams(r.sourceUrl);
  console.log(`    parseSlugTeams=${JSON.stringify(slug)}`);
}

console.log(`\n=== ESPN fetchExpectedNbaGames() ===`);
let expected;
try {
  expected = await fetchExpectedNbaGames();
  console.log(`  got ${expected.length} games`);
  for (const g of expected) {
    console.log(
      `    ${g.away.abbreviation} @ ${g.home.abbreviation}  start=${g.gameDate.toISOString()}  status=${g.statusName}`,
    );
  }
} catch (err) {
  console.log(`  ESPN fetch failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

console.log(`\n=== Match attempts (DK slug → ESPN) ===`);
for (const r of rows) {
  const slug = parseSlugTeams(r.sourceUrl);
  if (!slug) {
    console.log(`  ${r.externalId}: slug parse FAILED for ${r.sourceUrl}`);
    continue;
  }
  const matched = matchExpectedNbaGame(expected, slug.home, slug.away);
  console.log(
    `  ${slug.away} @ ${slug.home}  →  ${matched ? `MATCH ${matched.away.abbreviation}@${matched.home.abbreviation} (${matched.gameDate.toISOString()})` : "NO MATCH"}`,
  );
}

process.exit(0);
