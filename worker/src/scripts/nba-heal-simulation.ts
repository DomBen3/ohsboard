// N6 — heal-simulation script. Targeted destructive scenario from PRD §14.5.
//
// Usage:
//   pnpm worker:nba:heal-sim                              # dry run (prints pre-state, refuses to delete)
//   pnpm worker:nba:heal-sim --yes                        # actually deletes prop_nba_points selectors
//   pnpm worker:nba:heal-sim --market=prop_nba_threes --yes
//
// IMPORTANT — read this before running:
//
// PRD §14.5 describes the heal-simulation scenario as:
//
//     "DELETE FROM selectors WHERE market='prop_nba_points'; → next run heals
//      → status=ok healed=true."
//
// That sentence assumes the LLM-heal path is wired for NBA props. **N4 may
// or may not wire LLM healing for NBA props** — the deterministic
// `extractNbaPropOU` walker (introduced in N3) is the primary extraction
// mechanism, and the healer's `Market` union currently lists only the three
// MLB game-level markets (total/run_line/moneyline). Two possibilities to
// be aware of when reading the post-run logs:
//
// A) **LLM-heal path wired for NBA props** (PRD §10.4 / §11): the next NBA
//    scrape_run logs `[healer] prop_nba_points: …` and the selectors table
//    re-acquires a row with `origin='heal'`. The simulation succeeds as
//    described in §14.5. This is the path the script below mimics.
//
// B) **Deterministic-only path (no LLM heal for NBA)**: `extractNbaPropOU`
//    walks the DOM by section heading and column-header triplet directly,
//    independent of any selector row in the DB. Deleting the seed selector
//    has no effect on extraction — the next scrape will still produce rows.
//    To exercise the recovery loop in this case, you'd want to simulate an
//    "alias miss" or section-heading drift instead (e.g. rename the section
//    anchor in the page reducer). That's a code edit, not a DB delete, so
//    it's outside the scope of this script.
//
// **What to do**: after N4 lands, read `worker/src/healer.ts` and
// `worker/src/scraper.ts` to confirm which path is in use. If it's path B,
// this script is still useful for verifying that selector deletion doesn't
// crash the scrape — but the "healed=true" outcome won't materialize, and
// the operator should fall back to the alias-override approach described in
// the PRD §14 commentary (or skip the heal-simulation step entirely).

import { createDb, selectors as selectorsTable, sports } from "@ohsboard/db";
import { and, eq } from "drizzle-orm";

const DATABASE_URL: string = (() => {
  const v = process.env.DATABASE_URL;
  if (!v) throw new Error("DATABASE_URL is required (load .env.local)");
  return v;
})();

const NBA_PROP_MARKETS = new Set<string>([
  "prop_nba_points",
  "prop_nba_threes",
  "prop_nba_rebounds",
  "prop_nba_assists",
]);

interface CliArgs {
  market: string;
  confirmed: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let market = "prop_nba_points";
  let confirmed = false;
  for (const arg of argv.slice(2)) {
    if (arg === "--yes" || arg === "-y") {
      confirmed = true;
    } else if (arg.startsWith("--market=")) {
      market = arg.slice("--market=".length);
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: nba-heal-simulation.ts [--market=prop_nba_<x>] [--yes]",
      );
      process.exit(0);
    } else {
      console.error(`unknown arg: ${arg}`);
      process.exit(2);
    }
  }
  if (!NBA_PROP_MARKETS.has(market)) {
    console.error(
      `--market must be one of: ${[...NBA_PROP_MARKETS].join(", ")} (got "${market}")`,
    );
    process.exit(2);
  }
  return { market, confirmed };
}

async function main() {
  const args = parseArgs(process.argv);
  const db = createDb(DATABASE_URL);

  const nba = await db.query.sports.findFirst({
    where: eq(sports.slug, "nba"),
  });
  if (!nba) {
    console.error("[heal-sim] no NBA sport row — run db:seed first");
    process.exit(1);
  }

  console.log(`[heal-sim] target market: ${args.market}`);
  console.log(`[heal-sim] sport: nba (id=${nba.id})`);

  // Pre-state — show ALL selector rows for this (sport, market), regardless
  // of is_active, so the operator sees the full version history.
  const preRows = await db
    .select({
      id: selectorsTable.id,
      field: selectorsTable.field,
      version: selectorsTable.version,
      isActive: selectorsTable.isActive,
      onProbation: selectorsTable.onProbation,
      origin: selectorsTable.origin,
      selector: selectorsTable.selector,
      confidence: selectorsTable.confidence,
      createdAt: selectorsTable.createdAt,
    })
    .from(selectorsTable)
    .where(
      and(
        eq(selectorsTable.sportId, nba.id),
        eq(selectorsTable.market, args.market),
      ),
    )
    .orderBy(selectorsTable.field, selectorsTable.version);

  console.log("");
  console.log(`[heal-sim] pre-state: ${preRows.length} selector row(s)`);
  if (preRows.length === 0) {
    console.log(
      `[heal-sim] no selector rows found — nothing to delete. The market`,
    );
    console.log(
      `[heal-sim] may already be relying on the deterministic extractor (N3 walker).`,
    );
  } else {
    for (const r of preRows) {
      const flags = [
        r.isActive ? "active" : null,
        r.onProbation ? "probation" : null,
      ]
        .filter(Boolean)
        .join(",") || "inactive";
      console.log(
        `         ${r.field}/v${r.version} [${flags}] origin=${r.origin} conf=${r.confidence ?? "—"}`,
      );
      console.log(`           selector: ${r.selector}`);
    }
  }
  console.log("");

  if (!args.confirmed) {
    console.log(
      `[heal-sim] DRY RUN — no rows deleted. Re-run with --yes to actually delete.`,
    );
    console.log("");
    console.log(`[heal-sim] If --yes were passed, the next step would be:`);
    console.log(
      `             DELETE FROM selectors WHERE sport_id=${nba.id} AND market='${args.market}';`,
    );
    console.log(
      `             (${preRows.length} row(s) affected)`,
    );
    process.exit(0);
  }

  // Destructive path — actually delete.
  const deleted = await db
    .delete(selectorsTable)
    .where(
      and(
        eq(selectorsTable.sportId, nba.id),
        eq(selectorsTable.market, args.market),
      ),
    )
    .returning({ id: selectorsTable.id });
  console.log(
    `[heal-sim] DELETE ran — removed ${deleted.length} row(s) for sport=nba market=${args.market}`,
  );
  console.log("");
  console.log(`[heal-sim] Next steps for the operator:`);
  console.log(
    `[heal-sim]   1. Run a manual scrape: \`pnpm worker:start\` (or wait for the next 5-min cron tick).`,
  );
  console.log(
    `[heal-sim]   2. Watch the worker logs for \`[healer] ${args.market}\` lines.`,
  );
  console.log(
    `[heal-sim]   3. Confirm the next NBA scrape_run row has \`status='ok'\` AND \`healed=true\`:`,
  );
  console.log(
    `[heal-sim]        SELECT status, healed, heal_markets FROM scrape_runs`,
  );
  console.log(
    `[heal-sim]          WHERE sport_id=${nba.id} ORDER BY started_at DESC LIMIT 1;`,
  );
  console.log(
    `[heal-sim]   4. Confirm the selectors table re-acquired a row with origin='heal':`,
  );
  console.log(
    `[heal-sim]        SELECT field, version, is_active, origin, confidence FROM selectors`,
  );
  console.log(
    `[heal-sim]          WHERE sport_id=${nba.id} AND market='${args.market}';`,
  );
  console.log("");
  console.log(
    `[heal-sim] CAVEAT: if N4 runs NBA props through the deterministic`,
  );
  console.log(
    `[heal-sim]   extractNbaPropOU walker WITHOUT the LLM healer, the run will`,
  );
  console.log(
    `[heal-sim]   still succeed but \`healed\` will be false and no \`origin='heal'\``,
  );
  console.log(
    `[heal-sim]   row will appear. That's the path B outcome documented at the top`,
  );
  console.log(`[heal-sim]   of this file. Re-read healer.ts/scraper.ts to confirm.`);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
