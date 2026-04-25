// One-game NBA Points O/U smoke test.
//
// Picks the first scheduled NBA game on DK, navigates to the points
// subcategory page, extracts the section, persists rows under a fresh
// `scrape_runs` row, and prints a sample. The real cron orchestrator lives in
// `scraper.ts::scrapeNba`; this script stays around as a quick `pnpm
// worker:nba:test` health check — point a fresh dev DB at it after a DK DOM
// change and you'll know in ~30s whether the deterministic walk still works.

import {
  createDb,
  games,
  oddsSnapshots,
  scrapeRuns,
  sports,
  teams,
} from "@ohsboard/db";
import type { NbaTeam } from "@ohsboard/types";
import { and, eq } from "drizzle-orm";
import { chromium } from "playwright";
import {
  createPage,
  discoverGameUrls,
  NBA_LEAGUE_URL,
  navigateToGame,
  nbaSubcategoryUrl,
} from "../draftkings";
import { extractNbaPropOU } from "../nba-props";
import { parseDkEventId, parseTeamsFromSlug } from "../odds-parser";
import {
  fetchExpectedNbaGames,
  matchExpectedNbaGame,
  type ExpectedNbaGame,
} from "../schedule";

const DATABASE_URL: string = (() => {
  const v = process.env.DATABASE_URL;
  if (!v) throw new Error("DATABASE_URL is required (load .env.local)");
  return v;
})();

const HEADLESS = (process.env.HEADLESS ?? "true") !== "false";

async function main() {
  const db = createDb(DATABASE_URL);

  const nba = await db.query.sports.findFirst({ where: eq(sports.slug, "nba") });
  if (!nba) throw new Error("NBA sport row missing — run db:seed");
  if (!nba.isActive) {
    console.warn(
      `[nba-test] sports.is_active=false for NBA — proceeding anyway since this is the N3 manual smoke test`,
    );
  }

  let expected: ExpectedNbaGame[] = [];
  try {
    expected = await fetchExpectedNbaGames();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[nba-test] ESPN fetch failed (${msg}); proceeding without cross-check`);
  }

  const [run] = await db
    .insert(scrapeRuns)
    .values({
      sportId: nba.id,
      trigger: "manual",
      status: "running",
      gamesExpected: expected.length || null,
    })
    .returning({ id: scrapeRuns.id });
  if (!run) throw new Error("failed to create scrape_runs row");
  const runId = run.id;

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  let rowsWritten = 0;
  let gamesScraped = 0;

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      viewport: { width: 1440, height: 900 },
      locale: "en-US",
      timezoneId: "America/New_York",
    });
    await context.addInitScript({
      content: `
        globalThis.__name = globalThis.__name || function(fn){ return fn; };
        try {
          Object.defineProperty(navigator, 'webdriver', { get: function(){ return undefined; } });
        } catch (e) {}
      `,
    });

    const discoveryPage = await createPage(context);
    const urls = await discoverGameUrls(discoveryPage, NBA_LEAGUE_URL);
    await discoveryPage.close();
    if (urls.length === 0) {
      throw new Error("No NBA games discovered — DK may be off-day or selectors broken");
    }

    // Prefer a scheduled (statusState='pre') game — DK hides O/U sections on
    // in-progress and final games, so the first DOM-ordered URL can yield a
    // false negative even though the scraper plumbing is healthy.
    const url = pickScheduledGameUrl(urls, expected) ?? urls[0]!;
    const propsUrl = nbaSubcategoryUrl(url, "points");
    console.log(`[nba-test] run=${runId} games=${expected.length} target=${propsUrl}`);

    const gamePage = await createPage(context);
    await navigateToGame(gamePage, propsUrl);

    // Brief explicit wait for the Points O/U accordion header so we don't
    // race the page hydration.
    await gamePage
      .getByRole("heading", { name: /Points O\/U/i })
      .first()
      .waitFor({ state: "attached", timeout: 12_000 })
      .catch(() => undefined);

    const odds = await extractNbaPropOU(gamePage, "prop_nba_points");

    if (odds.length === 0) {
      console.warn(`[nba-test] zero rows — section likely missing or selector drift`);
      await db
        .update(scrapeRuns)
        .set({
          status: "degraded",
          gamesScraped: 0,
          rowsWritten: 0,
          finishedAt: new Date(),
          errorMessage: "Points O/U section yielded zero rows",
        })
        .where(eq(scrapeRuns.id, runId));
      return;
    }

    // Resolve teams + persist a games row.
    const teamsFromSlug = parseTeamsFromSlug(url);
    const dkEventId = parseDkEventId(url);
    const matched = matchExpectedNbaGame(
      expected,
      teamsFromSlug?.home ?? null,
      teamsFromSlug?.away ?? null,
    );
    if (!matched) {
      console.warn(
        `[nba-test] no ESPN match for "${teamsFromSlug?.away ?? "?"}" @ "${teamsFromSlug?.home ?? "?"}" — falling back to slug-only ids`,
      );
    }

    const homeTeamId = await upsertNbaTeam(
      db,
      nba.id,
      matched?.home ?? null,
      teamsFromSlug?.home ?? "Home",
    );
    const awayTeamId = await upsertNbaTeam(
      db,
      nba.id,
      matched?.away ?? null,
      teamsFromSlug?.away ?? "Away",
    );

    const startTime = matched?.gameDate ?? new Date();
    const [gameRow] = await db
      .insert(games)
      .values({
        sportId: nba.id,
        externalId: matched ? `nba:${matched.espnEventId}` : `dk:${dkEventId}`,
        sourceUrl: url,
        homeTeamId,
        awayTeamId,
        startTime,
      })
      .onConflictDoUpdate({
        target: [games.sportId, games.externalId],
        set: {
          sourceUrl: url,
          homeTeamId,
          awayTeamId,
          startTime,
        },
      })
      .returning({ id: games.id });
    if (!gameRow) throw new Error("game upsert failed");
    const gameId = gameRow.id;

    const inserted = await db
      .insert(oddsSnapshots)
      .values(
        odds.map((o) => ({
          scrapeRunId: runId,
          gameId,
          market: o.market,
          field: o.field,
          player: o.player,
          line: o.line !== null ? String(o.line) : null,
          priceAmerican: o.priceAmerican,
        })),
      )
      .returning({ id: oddsSnapshots.id });
    rowsWritten = inserted.length;
    gamesScraped = 1;

    const matchup = matched
      ? `${matched.away.abbreviation} @ ${matched.home.abbreviation}`
      : "unmatched";
    console.log(
      `[nba-test] ok — ${rowsWritten} rows · ${odds.length / 2} pairs · ${matchup}`,
    );

    // Print a small sample so the operator can sanity-check the values.
    for (const o of odds.slice(0, 4)) {
      console.log(
        `  ${o.player}  ${o.field === "over" ? "O" : "U"} ${o.line} ${o.priceAmerican > 0 ? "+" : ""}${o.priceAmerican}`,
      );
    }

    await gamePage.close();
    await context.close();

    await db
      .update(scrapeRuns)
      .set({
        status: "ok",
        gamesScraped,
        rowsWritten,
        finishedAt: new Date(),
      })
      .where(eq(scrapeRuns.id, runId));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[nba-test] failed: ${msg}`);
    await db
      .update(scrapeRuns)
      .set({
        status: "failed",
        finishedAt: new Date(),
        errorMessage: msg,
      })
      .where(eq(scrapeRuns.id, runId));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

function pickScheduledGameUrl(
  urls: string[],
  expected: ExpectedNbaGame[],
): string | null {
  for (const url of urls) {
    const teamsFromSlug = parseTeamsFromSlug(url);
    if (!teamsFromSlug) continue;
    const matched = matchExpectedNbaGame(
      expected,
      teamsFromSlug.home,
      teamsFromSlug.away,
    );
    if (matched && matched.statusState === "pre") return url;
  }
  return null;
}

async function upsertNbaTeam(
  db: ReturnType<typeof createDb>,
  sportId: number,
  team: NbaTeam | null,
  fallbackName: string,
): Promise<number> {
  const externalId = team
    ? `nba:${team.id}`
    : `dk:${fallbackName.trim().toLowerCase()}`;
  const displayName = team ? team.name : fallbackName;
  const abbreviation = team ? team.abbreviation : fallbackName.slice(0, 3).toUpperCase();

  const existing = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.sportId, sportId), eq(teams.externalId, externalId)))
    .limit(1);
  if (existing[0]) {
    await db
      .update(teams)
      .set({ name: displayName, abbreviation })
      .where(eq(teams.id, existing[0].id));
    return existing[0].id;
  }
  const [inserted] = await db
    .insert(teams)
    .values({ sportId, externalId, name: displayName, abbreviation })
    .onConflictDoNothing({ target: [teams.sportId, teams.externalId] })
    .returning({ id: teams.id });
  if (inserted) return inserted.id;
  const [raced] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.sportId, sportId), eq(teams.externalId, externalId)))
    .limit(1);
  if (!raced) throw new Error(`team upsert failed for ${displayName}`);
  return raced.id;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
