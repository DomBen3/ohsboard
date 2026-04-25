// N6 — read-only verification harness for the NBA pipeline.
//
// Reports on the PRD §14 acceptance checks that can be expressed as SQL
// queries. Prints one line per check with a `[PASS]` / `[FAIL]` / `[WARN]` /
// `[SKIP]` prefix, the supporting numbers, and a final summary. Exits non-zero
// if any check FAILs.
//
// Usage:
//   pnpm worker:nba:verify              # via root-level dotenv wrapper
//   pnpm --filter @ohsboard/worker nba:verify     # if env already loaded
//
// No mutations — safe to run against production at any time.
//
// Matches PRD §14 checks 1, 4, 5, 7 (data probes) plus the seed/shape sanity
// checks that don't have explicit numbers in §14 but follow from §8. Front-end
// behavior (§14.1, .2, .8, .9) and the live-refresh latency check (§14.3)
// can't be automated from SQL — those stay manual in the runbook.

import {
  createDb,
  games,
  oddsSnapshots,
  scrapeRuns,
  sports,
  teams,
} from "@ohsboard/db";
import { and, desc, eq, gt, inArray, like, sql } from "drizzle-orm";

const DATABASE_URL: string = (() => {
  const v = process.env.DATABASE_URL;
  if (!v) throw new Error("DATABASE_URL is required (load .env.local)");
  return v;
})();

const NBA_MARKETS = [
  "prop_nba_points",
  "prop_nba_threes",
  "prop_nba_rebounds",
  "prop_nba_assists",
] as const;

const MLB_MARKETS = [
  "moneyline",
  "run_line",
  "total",
  "prop_pitcher_strikeouts",
  "prop_pitcher_outs_recorded",
] as const;

type Status = "PASS" | "FAIL" | "WARN" | "SKIP";

interface CheckResult {
  name: string;
  status: Status;
  detail: string;
}

const results: CheckResult[] = [];

function record(
  name: string,
  status: Status,
  detail: string,
): void {
  results.push({ name, status, detail });
  console.log(`[${status}] ${name} — ${detail}`);
}

async function main() {
  const db = createDb(DATABASE_URL);

  // Cache the NBA + MLB sport rows once. Almost every check needs these.
  const sportsRows = await db
    .select({ id: sports.id, slug: sports.slug, isActive: sports.isActive })
    .from(sports);
  const nba = sportsRows.find((s) => s.slug === "nba");
  const mlb = sportsRows.find((s) => s.slug === "mlb");

  // --- Check 1: NBA active, MLB paused -------------------------------------
  {
    const name = "1. NBA active, MLB paused";
    if (!nba) {
      record(name, "FAIL", "no row in `sports` with slug='nba' (run db:seed)");
    } else if (!mlb) {
      record(name, "FAIL", "no row in `sports` with slug='mlb' (run db:seed)");
    } else if (nba.isActive && !mlb.isActive) {
      record(name, "PASS", `nba.is_active=true mlb.is_active=false`);
    } else {
      record(
        name,
        "FAIL",
        `nba.is_active=${nba.isActive} mlb.is_active=${mlb.isActive} (expected true/false)`,
      );
    }
  }

  // --- Check 2: 30 NBA teams seeded ---------------------------------------
  {
    const name = "2. 30 NBA teams seeded";
    const rows = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(teams)
      .where(like(teams.externalId, "nba:%"));
    const count = rows[0]?.count ?? 0;
    if (count === 30) {
      record(name, "PASS", `teams WHERE external_id LIKE 'nba:%' = 30`);
    } else {
      record(
        name,
        "FAIL",
        `teams WHERE external_id LIKE 'nba:%' = ${count} (expected 30)`,
      );
    }
  }

  // --- Check 3: All four NBA markets persisted in last 10 min --------------
  {
    const name = "3. All four NBA markets in last 10 min";
    const rows = await db
      .select({
        market: oddsSnapshots.market,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(oddsSnapshots)
      .where(
        and(
          gt(
            oddsSnapshots.capturedAt,
            sql`now() - interval '10 minutes'`,
          ),
          like(oddsSnapshots.market, "prop_nba_%"),
        ),
      )
      .groupBy(oddsSnapshots.market);
    const byMarket = new Map<string, number>(
      rows.map((r) => [r.market, r.count]),
    );
    const present = NBA_MARKETS.filter((m) => (byMarket.get(m) ?? 0) > 0);
    const missing = NBA_MARKETS.filter((m) => !(byMarket.get(m) ?? 0));
    if (missing.length === 0) {
      const tally = NBA_MARKETS.map(
        (m) => `${m.replace("prop_nba_", "")}=${byMarket.get(m)}`,
      ).join(" ");
      record(name, "PASS", `last 10 min: ${tally}`);
    } else {
      const tally = NBA_MARKETS.map(
        (m) => `${m.replace("prop_nba_", "")}=${byMarket.get(m) ?? 0}`,
      ).join(" ");
      record(
        name,
        "FAIL",
        `missing markets: [${missing.join(", ")}]; observed: ${tally}`,
      );
      if (present.length > 0) {
        console.log(
          `       (${present.length}/4 markets present — partial scrape; check scraper.ts dispatch)`,
        );
      } else {
        console.log(
          `       (no NBA props rows in last 10 min — worker may not have ticked, or all 4 markets failing)`,
        );
      }
    }
  }

  // --- Check 4: Latest finished NBA scrape_run is OK -----------------------
  //
  // A `running` row at the top means the operator invoked verify mid-tick —
  // not a failure. In that case look at the most recent FINISHED run; pass
  // when it's `ok`. The in-flight run gets a one-line note appended.
  {
    const name = "4. Latest NBA scrape_run is ok";
    if (!nba) {
      record(name, "SKIP", "no NBA sport row");
    } else {
      const rows = await db
        .select({
          id: scrapeRuns.id,
          status: scrapeRuns.status,
          startedAt: scrapeRuns.startedAt,
          finishedAt: scrapeRuns.finishedAt,
          gamesExpected: scrapeRuns.gamesExpected,
          gamesScraped: scrapeRuns.gamesScraped,
          rowsWritten: scrapeRuns.rowsWritten,
          healed: scrapeRuns.healed,
          errorMessage: scrapeRuns.errorMessage,
        })
        .from(scrapeRuns)
        .where(eq(scrapeRuns.sportId, nba.id))
        .orderBy(desc(scrapeRuns.startedAt))
        .limit(5);
      const inFlight = rows.find((r) => r.status === "running");
      const finished = rows.find((r) => r.status !== "running");
      const inFlightNote = inFlight
        ? ` (in-flight run id=${inFlight.id.slice(0, 8)} started ${Math.round((Date.now() - new Date(inFlight.startedAt).getTime()) / 1000)}s ago)`
        : "";

      if (!finished && inFlight) {
        record(
          name,
          "SKIP",
          `only an in-flight run exists (id=${inFlight.id.slice(0, 8)}) — re-run after the tick completes`,
        );
      } else if (!finished) {
        record(name, "FAIL", "no scrape_runs rows for NBA");
      } else if (finished.status === "ok" && finished.finishedAt !== null) {
        record(
          name,
          "PASS",
          `id=${finished.id.slice(0, 8)} status=ok healed=${finished.healed} rows=${finished.rowsWritten ?? 0} games=${finished.gamesScraped ?? 0}/${finished.gamesExpected ?? "?"}${inFlightNote}`,
        );
      } else {
        const errMsg = (finished.errorMessage ?? "(none)")
          .replace(/\s+/g, " ")
          .slice(0, 160);
        record(
          name,
          "FAIL",
          `id=${finished.id.slice(0, 8)} status=${finished.status} finished=${finished.finishedAt ? "yes" : "no"} error=${errMsg}${inFlightNote}`,
        );
      }
    }
  }

  // --- Check 5: MLB has not accumulated new rows since pause (warn-only) --
  {
    const name = "5. MLB has not scraped since pause";
    const rows = await db
      .select({
        market: oddsSnapshots.market,
        count: sql<number>`COUNT(*)::int`,
        latest: sql<Date>`MAX(${oddsSnapshots.capturedAt})`,
      })
      .from(oddsSnapshots)
      .where(
        and(
          gt(
            oddsSnapshots.capturedAt,
            sql`now() - interval '10 minutes'`,
          ),
          inArray(oddsSnapshots.market, [...MLB_MARKETS]),
        ),
      )
      .groupBy(oddsSnapshots.market);
    if (rows.length === 0) {
      record(
        name,
        "PASS",
        "no MLB market rows in last 10 min (pause respected)",
      );
    } else {
      const tally = rows
        .map((r) => `${r.market}=${r.count}`)
        .join(" ");
      record(
        name,
        "WARN",
        `MLB rows in last 10 min: ${tally} — worker may be scraping despite mlb.is_active=false`,
      );
    }
  }

  // --- Check 6: NBA games row exists with ESPN id --------------------------
  {
    const name = "6. NBA games row exists (ESPN id)";
    if (!nba) {
      record(name, "SKIP", "no NBA sport row");
    } else {
      const rows = await db
        .select({
          externalId: games.externalId,
          startTime: games.startTime,
        })
        .from(games)
        .where(
          and(
            eq(games.sportId, nba.id),
            like(games.externalId, "nba:%"),
          ),
        )
        .orderBy(desc(games.startTime))
        .limit(5);
      if (rows.length === 0) {
        // Fall back to seeing if there are any NBA games at all (maybe under
        // dk:* if ESPN match failed every time).
        const any = await db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(games)
          .where(eq(games.sportId, nba.id));
        const total = any[0]?.count ?? 0;
        if (total > 0) {
          record(
            name,
            "FAIL",
            `${total} NBA games row(s) exist but none with external_id LIKE 'nba:%' — ESPN cross-check failing`,
          );
        } else {
          record(
            name,
            "FAIL",
            "no NBA games rows at all — discovery or persistence broken",
          );
        }
      } else {
        const sample = rows
          .slice(0, 3)
          .map((r) => r.externalId)
          .join(", ");
        record(name, "PASS", `${rows.length} row(s); latest: ${sample}`);
      }
    }
  }

  // --- Check 7: Off-day shortcircuit detection (read-only) -----------------
  {
    const name = "7. Off-day shortcircuit (read-only)";
    if (!nba) {
      record(name, "SKIP", "no NBA sport row");
    } else {
      const rows = await db
        .select({
          status: scrapeRuns.status,
          gamesExpected: scrapeRuns.gamesExpected,
          gamesScraped: scrapeRuns.gamesScraped,
          startedAt: scrapeRuns.startedAt,
        })
        .from(scrapeRuns)
        .where(eq(scrapeRuns.sportId, nba.id))
        .orderBy(desc(scrapeRuns.startedAt))
        .limit(1);
      const r = rows[0];
      if (!r) {
        record(name, "SKIP", "no scrape_runs rows for NBA");
      } else if (
        r.status === "ok" &&
        r.gamesExpected === 0 &&
        r.gamesScraped === 0
      ) {
        record(
          name,
          "PASS",
          `latest run: status=ok games_expected=0 games_scraped=0 (genuine off-day)`,
        );
      } else {
        record(
          name,
          "SKIP",
          `latest run has games_expected=${r.gamesExpected} games_scraped=${r.gamesScraped} — only relevant on actual off-days`,
        );
      }
    }
  }

  // --- Summary -------------------------------------------------------------
  const tally: Record<Status, number> = {
    PASS: 0,
    FAIL: 0,
    WARN: 0,
    SKIP: 0,
  };
  for (const r of results) tally[r.status]++;

  console.log("");
  console.log(
    `Summary: ${tally.PASS} pass, ${tally.FAIL} fail, ${tally.WARN} warn, ${tally.SKIP} skip`,
  );
  if (tally.FAIL > 0) {
    console.log("");
    console.log("FAILED checks:");
    for (const r of results.filter((x) => x.status === "FAIL")) {
      console.log(`  - ${r.name}: ${r.detail}`);
    }
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
