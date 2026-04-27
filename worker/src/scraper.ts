import {
  games,
  scrapeRuns,
  selectors as selectorsTable,
  sports,
  teams,
  type Db,
} from "@ohsboard/db";
import { findMlbTeam, type NbaTeam } from "@ohsboard/types";
import { and, eq, sql } from "drizzle-orm";
import { chromium, type BrowserContext, type Page } from "playwright";
import {
  createPage,
  discoverGameUrls,
  extractMainMarkets,
  jitter,
  navigateToGame,
  NBA_LEAGUE_URL,
  nbaSubcategoryUrl,
  pitcherPropsUrl,
  type MarketSelectors,
  type NbaPropMarket,
  type NbaSubcategory,
  type PropMarket,
  type RawOdds,
} from "./draftkings";
import { env } from "./env";
import { healMarketSelector, type Market } from "./healer";
import { extractNbaPropOU } from "./nba-props";
import { insertOddsSnapshots, upsertGame, type OddsRow } from "./persist";
import { extractPitcherPropsBySection } from "./pitcher-props";
import {
  fetchExpectedMlbGames,
  fetchExpectedNbaGames,
  matchExpectedMlbGame,
  matchExpectedNbaGame,
  type ExpectedGame,
  type ExpectedNbaGame,
} from "./schedule";
import { validatePropRows } from "./validators";

export interface ScrapeResult {
  gamesExpected: number;
  gamesScraped: number;
  rowsWritten: number;
  shapePassRate: number;
  healed: boolean;
  healMarkets: string[];
  healLlmTokens: number;
}

export interface SportScrapeOutcome extends ScrapeResult {
  sportSlug: string;
  runId: string;
  status: "ok" | "degraded" | "failed";
  errorMessage?: string;
}

// ---- Per-sport market constants -------------------------------------------
//
// MLB game lines go through DB-persisted CSS selectors and the LLM-healer when
// a row count goes empty. MLB pitcher props and NBA player props use
// deterministic structural extractors keyed on header text + DK's collapsible
// testid landmarks; they don't consume heal budget.

const MLB_MARKETS: Market[] = ["total", "run_line", "moneyline"];
const MLB_PROP_MARKETS: PropMarket[] = [
  "prop_pitcher_strikeouts",
  "prop_pitcher_outs_recorded",
];
const NBA_PROP_MARKETS: NbaPropMarket[] = [
  "prop_nba_points",
  "prop_nba_threes",
  "prop_nba_rebounds",
  "prop_nba_assists",
];
const NBA_SUBCATEGORIES: Record<NbaPropMarket, NbaSubcategory> = {
  prop_nba_points: "points",
  prop_nba_threes: "threes",
  prop_nba_rebounds: "rebounds",
  prop_nba_assists: "assists",
};

/**
 * Per-sport heal cap. Only MLB game-line markets are LLM-healed today, so the
 * cap derives from `MLB_MARKETS.length` plus a small retry buffer. NBA's heal
 * budget is 0 (see `scrapeNba` — its 4 markets are deterministic-only).
 */
function maxHealAttemptsPerRun(sportSlug: string): number {
  if (sportSlug === "mlb") return MLB_MARKETS.length + 2;
  // NBA + future sports: deterministic-only by default.
  return 0;
}

const MARKET_KEY: Record<Market, keyof MarketSelectors> = {
  total: "totalRow",
  run_line: "runLineRow",
  moneyline: "moneylineRow",
};

// ---- Top-level dispatcher --------------------------------------------------

/**
 * Run all currently-active sports in series, each with its own `scrape_runs`
 * row. Returns one outcome per sport. Returns an empty array when no sport is
 * active (e.g. MLB paused + NBA paused).
 *
 * The caller is responsible for creating/marking each sport's `scrape_runs`
 * row; this function takes a map from sportSlug → runId to use.
 */
export async function runActiveSports(
  db: Db,
  runIdsBySport: Record<string, string>,
): Promise<SportScrapeOutcome[]> {
  const active = await db
    .select({ id: sports.id, slug: sports.slug, name: sports.name })
    .from(sports)
    .where(eq(sports.isActive, true));

  const out: SportScrapeOutcome[] = [];
  for (const s of active) {
    const runId = runIdsBySport[s.slug];
    if (!runId) {
      console.warn(
        `[scraper] no runId provided for active sport ${s.slug}; skipping`,
      );
      continue;
    }
    try {
      let result: ScrapeResult;
      if (s.slug === "mlb") {
        result = await scrapeMlb(db, runId);
      } else if (s.slug === "nba") {
        result = await scrapeNba(db, runId);
      } else {
        console.warn(`[scraper] no implementation for sport ${s.slug}; skipping`);
        continue;
      }
      out.push({ ...result, sportSlug: s.slug, runId, status: "ok" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[scraper] ${s.slug} run ${runId} failed:`, message);
      out.push({
        sportSlug: s.slug,
        runId,
        status: "failed",
        errorMessage: message,
        gamesExpected: 0,
        gamesScraped: 0,
        rowsWritten: 0,
        shapePassRate: 0,
        healed: false,
        healMarkets: [],
        healLlmTokens: 0,
      });
    }
  }
  return out;
}

// ---- MLB ------------------------------------------------------------------

export async function scrapeMlb(db: Db, runId: string): Promise<ScrapeResult> {
  console.log(`[scraper] run ${runId} — starting`);
  const mlb = await db.query.sports.findFirst({ where: eq(sports.slug, "mlb") });
  if (!mlb) throw new Error("MLB sport row missing — run db:seed");

  let expectedGames: ExpectedGame[] | null = null;
  try {
    expectedGames = await fetchExpectedMlbGames();
    console.log(
      `[scraper] StatsAPI: ${expectedGames.length} games scheduled today`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[scraper] StatsAPI unavailable (${msg}); proceeding without cross-check`);
  }

  if (expectedGames && expectedGames.length === 0) {
    console.log(`[scraper] off-day — no games scheduled; finishing clean with 0 rows`);
    await db
      .update(scrapeRuns)
      .set({ gamesExpected: 0, gamesScraped: 0, rowsWritten: 0 })
      .where(eq(scrapeRuns.id, runId));
    return {
      gamesExpected: 0,
      gamesScraped: 0,
      rowsWritten: 0,
      shapePassRate: 1,
      healed: false,
      healMarkets: [],
      healLlmTokens: 0,
    };
  }

  let selectors = await loadMarketSelectors(db, mlb.id);
  console.log(
    `[scraper] active selectors: total=${s(selectors.totalRow)} run_line=${s(selectors.runLineRow)} moneyline=${s(selectors.moneylineRow)}`,
  );

  const browser = await chromium.launch({
    headless: env.HEADLESS,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  let gamesScraped = 0;
  let rowsWritten = 0;
  const healedMarkets = new Set<Market>();
  let healLlmTokens = 0;
  let healAttempts = 0;
  let marketsProbed = 0;
  let marketsPopulated = 0;
  const healCap = maxHealAttemptsPerRun("mlb");

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
    const urls = await discoverGameUrls(discoveryPage);
    await discoveryPage.close();
    console.log(`[scraper] discovered ${urls.length} game URLs`);

    // Same rationale as NBA: align `gamesExpected` to actual planned scrape
    // count so the front end's "Syncing N/M" indicator stays sane when the
    // schedule API reports fewer games than DK has up.
    const gamesExpected = Math.max(
      urls.length,
      expectedGames?.length ?? 0,
    );
    await db
      .update(scrapeRuns)
      .set({ gamesExpected })
      .where(eq(scrapeRuns.id, runId));

    const gamePage = await createPage(context);

    for (const [i, url] of urls.entries()) {
      try {
        await jitter();

        // Pass 1 — main game page: moneyline / total / run_line.
        await navigateToGame(gamePage, url);
        let mainExtract = await extractMainMarkets(gamePage, url, selectors);
        const mainHealResult = await healEmptyMarkets(
          gamePage,
          db,
          mlb.id,
          runId,
          mainExtract.emptyMarkets,
          healedMarkets,
          {
            get attempts() {
              return healAttempts;
            },
            increment: () => {
              healAttempts++;
            },
          },
          (newSelectors) => {
            selectors = newSelectors;
          },
          selectors,
          healCap,
        );
        healLlmTokens += mainHealResult.tokens;
        if (mainHealResult.healedAny) {
          mainExtract = await extractMainMarkets(gamePage, url, selectors);
        }

        // Pass 2 — pitcher-props subcategory page. Uses a deterministic
        // structural extractor: find the market section by header text
        // (`Strikeouts O/U`, `Outs Recorded O/U`), dispatch a real click
        // sequence on `button[data-testid="collapsible-trigger"]` to expand,
        // then enumerate rows by walking up from each `a[href*="/players/"]`
        // anchor. No LLM required — the relevant DK testids + header labels
        // have been stable. If DK renames a header outside our alias list
        // the market records 0 rows and we log it.
        await jitter();
        await navigateToGame(gamePage, pitcherPropsUrl(url));
        // Wait for the pitcher-props tab to actually render. Match on the
        // market header (h2 inside the collapsible) rather than the tab name.
        await gamePage
          .getByRole("heading", { name: /Strikeouts O\/U|Outs Recorded O\/U/i })
          .first()
          .waitFor({ state: "attached", timeout: 10_000 })
          .catch(() => undefined);
        const propOdds: RawOdds[] = [];
        const propEmpty: PropMarket[] = [];
        for (const pm of MLB_PROP_MARKETS) {
          const rows = await extractPitcherPropsBySection(gamePage, pm).catch(
            (err) => {
              const msg = err instanceof Error ? err.message : String(err);
              console.warn(`[props] ${pm}: extract failed — ${msg}`);
              return [] as RawOdds[];
            },
          );
          if (rows.length === 0) propEmpty.push(pm);
          propOdds.push(...rows);
        }

        // Merge + persist.
        const canonicalHome = findMlbTeam(mainExtract.home);
        const canonicalAway = findMlbTeam(mainExtract.away);
        const matched = expectedGames
          ? matchExpectedMlbGame(expectedGames, mainExtract.home, mainExtract.away)
          : null;
        const startTime = matched?.gameDate ?? mainExtract.startTime;

        const gameId = await upsertGame(db, {
          sportId: mlb.id,
          dkEventId: mainExtract.dkEventId,
          sourceUrl: mainExtract.sourceUrl,
          home: matched?.home ?? canonicalHome,
          away: matched?.away ?? canonicalAway,
          homeFallbackName: mainExtract.home,
          awayFallbackName: mainExtract.away,
          startTime,
        });

        const allOdds = [...mainExtract.odds, ...propOdds];
        const oddsRows: OddsRow[] = allOdds.map((o) => ({
          gameId,
          market: o.market,
          field: o.field,
          line: o.line,
          priceAmerican: o.priceAmerican,
          player: o.player,
        }));
        const written = await insertOddsSnapshots(db, runId, oddsRows);
        rowsWritten += written;
        gamesScraped += 1;

        const empty = [...mainExtract.emptyMarkets, ...propEmpty];
        const totalPerGameMarkets = MLB_MARKETS.length + MLB_PROP_MARKETS.length;
        marketsProbed += totalPerGameMarkets;
        marketsPopulated += totalPerGameMarkets - empty.length;

        const matchTag = matched
          ? " · stats"
          : canonicalHome && canonicalAway
            ? " · canonical"
            : " · unmapped";
        console.log(
          `[scraper] (${i + 1}/${urls.length}) ${mainExtract.away} @ ${mainExtract.home} — ${written} rows${
            empty.length ? ` — empty: ${empty.join(",")}` : ""
          }${matchTag}`,
        );

        await db
          .update(scrapeRuns)
          .set({ gamesScraped, rowsWritten })
          .where(eq(scrapeRuns.id, runId));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[scraper] game ${url} failed: ${msg}`);
      }
    }

    await gamePage.close();
    await context.close();

    const shapePassRate =
      marketsProbed === 0 ? 1 : marketsPopulated / marketsProbed;

    if (expectedGames && expectedGames.length > 0 && rowsWritten === 0) {
      console.warn(
        `[scraper] run ${runId}: StatsAPI expected ${expectedGames.length} games but no rows written — likely broken extractors`,
      );
    }

    return {
      gamesExpected,
      gamesScraped,
      rowsWritten,
      shapePassRate,
      healed: healedMarkets.size > 0,
      healMarkets: Array.from(healedMarkets),
      healLlmTokens,
    };
  } finally {
    await browser.close();
  }
}

// ---- NBA ------------------------------------------------------------------

/**
 * NBA scrape. Mirrors `scrapeMlb` structurally but targets the four player-
 * prop O/U markets (Points / Threes / Rebounds / Assists). Each game requires
 * four sequential subcategory page loads — DK only renders one O/U section
 * per `?subcategory=…`. Uses the deterministic extractor in `nba-props.ts`.
 *
 * Healer note: NBA O/U markets are deterministic-only and do NOT consume heal
 * budget. The market-header alias list in `nba-props.ts` covers DK's known
 * label variants; if DK renames a header outside that list the market records
 * 0 rows and is logged. Re-evaluate adding an LLM-heal arm when we see actual
 * label drift in the wild — adding one prematurely just burns OpenAI credits
 * on a robust extractor.
 */
export async function scrapeNba(db: Db, runId: string): Promise<ScrapeResult> {
  console.log(`[scraper:nba] run ${runId} — starting`);
  const nba = await db.query.sports.findFirst({ where: eq(sports.slug, "nba") });
  if (!nba) throw new Error("NBA sport row missing — run db:seed");

  let expectedGames: ExpectedNbaGame[] | null = null;
  try {
    expectedGames = await fetchExpectedNbaGames();
    console.log(
      `[scraper:nba] ESPN: ${expectedGames.length} games scheduled today`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[scraper:nba] ESPN unavailable (${msg}); proceeding without cross-check`,
    );
  }

  if (expectedGames && expectedGames.length === 0) {
    console.log(`[scraper:nba] off-day — no games scheduled; finishing clean with 0 rows`);
    await db
      .update(scrapeRuns)
      .set({ gamesExpected: 0, gamesScraped: 0, rowsWritten: 0 })
      .where(eq(scrapeRuns.id, runId));
    return {
      gamesExpected: 0,
      gamesScraped: 0,
      rowsWritten: 0,
      shapePassRate: 1,
      healed: false,
      healMarkets: [],
      healLlmTokens: 0,
    };
  }

  const browser = await chromium.launch({
    headless: env.HEADLESS,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  let gamesScraped = 0;
  let rowsWritten = 0;
  let marketsProbed = 0;
  let marketsPopulated = 0;

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
    console.log(`[scraper:nba] discovered ${urls.length} game URLs`);

    // ESPN excludes already-final and in-progress games from its scoreboard
    // count, so it can be smaller than DK's discovery (e.g. 3 vs 8). The DB
    // `gamesExpected` is what the front end's "Syncing N/M" indicator reads;
    // align it to the actual planned scrape count so the indicator never
    // shows scraped > expected. The off-day shortcircuit above already
    // handles the genuine `expectedGames.length === 0` case before we get
    // here, so taking max preserves that signal.
    const gamesExpected = Math.max(
      urls.length,
      expectedGames?.length ?? 0,
    );
    await db
      .update(scrapeRuns)
      .set({ gamesExpected })
      .where(eq(scrapeRuns.id, runId));

    // Cross-game parallelism. Up to NBA_GAME_CONCURRENCY games are scraped
    // concurrently in their own `Page` objects on a shared `BrowserContext`
    // (cookies + UA shared, memory bounded). On a 403/429 response from DK
    // the run flips to serial mode for the rest of the run; the next cron
    // tick starts parallel again. Override via env: NBA_GAME_CONCURRENCY.
    const concurrency = Math.max(
      1,
      Number(process.env.NBA_GAME_CONCURRENCY ?? 4),
    );
    let parallelMode = concurrency > 1;
    console.log(
      `[scraper:nba] running with concurrency=${parallelMode ? concurrency : 1}`,
    );

    const deps: NbaGameDeps = {
      db,
      context,
      expectedGames,
      sportId: nba.id,
      runId,
      total: urls.length,
    };

    let cursor = 0;
    while (cursor < urls.length) {
      const chunkSize = parallelMode ? concurrency : 1;
      const chunk = urls.slice(cursor, cursor + chunkSize);
      const offsets = chunk.map((_, i) => cursor + i);
      cursor += chunk.length;

      const settled = await Promise.allSettled(
        chunk.map((url, i) =>
          scrapeOneNbaGame(deps, url, offsets[i]!),
        ),
      );

      for (const r of settled) {
        if (r.status === "fulfilled") {
          const o = r.value;
          gamesScraped += o.scraped;
          rowsWritten += o.written;
          marketsProbed += o.marketsProbed;
          marketsPopulated += o.marketsPopulated;
          if (o.blocked && parallelMode) {
            console.warn(
              `[scraper:nba] DK block detected (HTTP ${o.blockedStatus}) — falling back to serial for the rest of this run`,
            );
            parallelMode = false;
          }
        } else {
          const reason = r.reason;
          if (reason instanceof DkBlockedError) {
            console.warn(
              `[scraper:nba] DK block thrown (HTTP ${reason.status}) — falling back to serial for the rest of this run`,
            );
            parallelMode = false;
          } else {
            const msg = reason instanceof Error ? reason.message : String(reason);
            console.warn(`[scraper:nba] game failed: ${msg}`);
          }
        }
      }
    }

    await context.close();

    const shapePassRate =
      marketsProbed === 0 ? 1 : marketsPopulated / marketsProbed;

    if (expectedGames && expectedGames.length > 0 && rowsWritten === 0) {
      console.warn(
        `[scraper:nba] run ${runId}: ESPN expected ${expectedGames.length} games but no rows written — likely broken extractors`,
      );
    }

    return {
      gamesExpected,
      gamesScraped,
      rowsWritten,
      shapePassRate,
      // NBA does not LLM-heal in this milestone — see banner comment.
      healed: false,
      healMarkets: [],
      healLlmTokens: 0,
    };
  } finally {
    await browser.close();
  }
}

// ---- helpers --------------------------------------------------------------

interface HealCounter {
  readonly attempts: number;
  increment(): void;
}

async function healEmptyMarkets(
  page: Page,
  db: Db,
  sportId: number,
  runId: string,
  emptyMarkets: Market[],
  healedMarkets: Set<Market>,
  counter: HealCounter,
  setSelectors: (next: MarketSelectors) => void,
  current: MarketSelectors,
  healCap: number,
): Promise<{ healedAny: boolean; tokens: number }> {
  let healedAny = false;
  let tokens = 0;
  let mutable = current;
  for (const market of emptyMarkets) {
    if (healedMarkets.has(market)) continue;
    if (counter.attempts >= healCap) {
      console.warn(
        `[scraper] heal budget exhausted (${counter.attempts}/${healCap}); skipping ${market}`,
      );
      continue;
    }
    counter.increment();
    const outcome = await healMarketSelector(
      { db, page, sportId, runId },
      market,
    );
    if (!outcome) continue;
    healedMarkets.add(market);
    tokens += outcome.tokensUsed;
    mutable = { ...mutable, [MARKET_KEY[market]]: outcome.selector };
    setSelectors(mutable);
    healedAny = true;
  }
  return { healedAny, tokens };
}

async function loadMarketSelectors(db: Db, sportId: number): Promise<MarketSelectors> {
  const rows = await db
    .select({
      market: selectorsTable.market,
      field: selectorsTable.field,
      selector: selectorsTable.selector,
    })
    .from(selectorsTable)
    .where(
      and(
        eq(selectorsTable.sportId, sportId),
        eq(selectorsTable.source, "draftkings"),
        eq(selectorsTable.field, "row"),
        eq(selectorsTable.isActive, true),
      ),
    );

  const out: MarketSelectors = {
    moneylineRow: null,
    totalRow: null,
    runLineRow: null,
  };
  for (const r of rows) {
    if (r.market === "moneyline") out.moneylineRow = r.selector;
    else if (r.market === "total") out.totalRow = r.selector;
    else if (r.market === "run_line") out.runLineRow = r.selector;
    // Prop markets are handled deterministically in pitcher-props.ts and have
    // no DB-persisted selector; ignore any stale rows in the table.
  }
  return out;
}

function s(sel: string | null): string {
  if (!sel) return "<none>";
  return sel.length > 60 ? `${sel.slice(0, 60)}…` : sel;
}

// Local helpers — keep the NBA path off the MLB-tied utilities in
// odds-parser.ts so its surface stays MLB-shaped for now.
function parseDkEventIdSafe(url: string): string {
  const m = /\/event\/[^/?#]+\/(\d+)/.exec(url);
  if (m && m[1]) return m[1];
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

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

async function upsertNbaTeamRow(
  db: Db,
  sportId: number,
  team: NbaTeam | null,
  fallbackName: string,
): Promise<number> {
  const externalId = team
    ? `nba:${team.id}`
    : `dk:${fallbackName.trim().toLowerCase()}`;
  const displayName = team ? team.name : fallbackName;
  const abbreviation = team
    ? team.abbreviation
    : fallbackName.slice(0, 3).toUpperCase() || "TBD";

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

interface NbaGameUpsert {
  sportId: number;
  externalId: string;
  sourceUrl: string;
  homeTeamId: number;
  awayTeamId: number;
  // Real tip-off (ESPN-derived) on insert. Null when no authoritative time
  // is available — the caller should refuse to upsert in that case rather
  // than poison `start_time` with `new Date()`. See `upsertNbaGameRow`.
  startTime: Date | null;
}

// ---- NBA per-game worker (parallel-safe) ----------------------------------

class DkBlockedError extends Error {
  constructor(public readonly status: number, url: string) {
    super(`DK returned ${status} for ${url}`);
    this.name = "DkBlockedError";
  }
}

interface NbaGameDeps {
  db: Db;
  context: BrowserContext;
  expectedGames: ExpectedNbaGame[] | null;
  sportId: number;
  runId: string;
  total: number;
}

interface PerGameOutcome {
  written: number;
  scraped: 0 | 1;
  marketsProbed: number;
  marketsPopulated: number;
  blocked: boolean;
  blockedStatus: number | null;
}

async function scrapeOneNbaGame(
  deps: NbaGameDeps,
  url: string,
  index: number,
): Promise<PerGameOutcome> {
  const slugTeams = parseSlugTeams(url);
  const homeName = slugTeams?.home ?? "Home";
  const awayName = slugTeams?.away ?? "Away";
  const matched = deps.expectedGames
    ? matchExpectedNbaGame(deps.expectedGames, homeName, awayName)
    : null;

  const dkEventId = parseDkEventIdSafe(url);
  const externalId = matched ? `nba:${matched.espnEventId}` : `dk:${dkEventId}`;
  // Only ESPN gives us a real tip-off; never fall back to `new Date()` here.
  // Persisting null lets the UI render "TBD" instead of dropping the game.
  const startTime = matched?.gameDate ?? null;
  if (!startTime) {
    console.warn(
      `[scraper:nba] no ESPN match for ${awayName} @ ${homeName} (url=${url}); persisting with TBD tip-off`,
    );
  }

  const homeTeamId = await upsertNbaTeamRow(
    deps.db,
    deps.sportId,
    matched?.home ?? null,
    matched?.home.name ?? homeName,
  );
  const awayTeamId = await upsertNbaTeamRow(
    deps.db,
    deps.sportId,
    matched?.away ?? null,
    matched?.away.name ?? awayName,
  );
  const gameId = await upsertNbaGameRow(deps.db, {
    sportId: deps.sportId,
    externalId,
    sourceUrl: url,
    homeTeamId,
    awayTeamId,
    startTime,
  });

  const page = await createPage(deps.context);
  let blocked = false;
  let blockedStatus: number | null = null;
  const gameOdds: RawOdds[] = [];
  const emptyMarkets: NbaPropMarket[] = [];
  const degradedMarkets: string[] = [];

  try {
    for (const market of NBA_PROP_MARKETS) {
      const sub = NBA_SUBCATEGORIES[market];
      await jitter();
      const status = await navigateToGame(page, nbaSubcategoryUrl(url, sub));

      if (status === 403 || status === 429) {
        // Surface block; let caller decide to flip serial. We still bail out
        // of the remaining markets for this game — the rest of the page
        // shell will likely be blocked too.
        blocked = true;
        blockedStatus = status;
        emptyMarkets.push(market);
        break;
      }

      const rows = await extractNbaPropOU(page, market).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[scraper:nba] ${market}: extract failed — ${msg}`);
        return [] as RawOdds[];
      });

      if (rows.length === 0) {
        emptyMarkets.push(market);
        continue;
      }

      const validation = validatePropRows(rows);
      if (!validation.passes) {
        degradedMarkets.push(`${market}(${validation.reason ?? "shape"})`);
        console.warn(
          `[scraper:nba] ${market}: shape check failed — ${validation.reason} · pairs=${validation.validPairs}/${validation.playersSeen}`,
        );
      }
      gameOdds.push(...rows);
    }
  } finally {
    await page.close().catch(() => undefined);
  }

  const oddsRows: OddsRow[] = gameOdds.map((o) => ({
    gameId,
    market: o.market,
    field: o.field,
    line: o.line,
    priceAmerican: o.priceAmerican,
    player: o.player,
  }));
  const written = await insertOddsSnapshots(deps.db, deps.runId, oddsRows);
  const scraped: 0 | 1 = written > 0 ? 1 : 0;
  const marketsProbed = NBA_PROP_MARKETS.length;
  const marketsPopulated = marketsProbed - emptyMarkets.length;

  // Atomic increment so concurrent games don't clobber each other's counts.
  // COALESCE handles the initial-NULL case before the first per-game write.
  if (written > 0 || scraped > 0) {
    await deps.db
      .update(scrapeRuns)
      .set({
        gamesScraped: sql`COALESCE(${scrapeRuns.gamesScraped}, 0) + ${scraped}`,
        rowsWritten: sql`COALESCE(${scrapeRuns.rowsWritten}, 0) + ${written}`,
      })
      .where(eq(scrapeRuns.id, deps.runId));
  }

  const matchTag = matched ? " · espn" : " · unmapped";
  const blockedTag = blocked ? ` — BLOCKED ${blockedStatus}` : "";
  const emptyTag = emptyMarkets.length ? ` — empty: ${emptyMarkets.join(",")}` : "";
  const degradedTag = degradedMarkets.length
    ? ` — degraded: ${degradedMarkets.join(",")}`
    : "";
  console.log(
    `[scraper:nba] (${index + 1}/${deps.total}) ${awayName} @ ${homeName} — ${written} rows${blockedTag}${emptyTag}${degradedTag}${matchTag}`,
  );

  return { written, scraped, marketsProbed, marketsPopulated, blocked, blockedStatus };
}

async function upsertNbaGameRow(db: Db, g: NbaGameUpsert): Promise<string> {
  // Two invariants encoded here:
  //   1. `start_time` is intentionally absent from the conflict-update set so
  //      that once a game's tip-off is known it can never be overwritten by
  //      a later scrape (e.g. a follow-up tick that fails to match ESPN).
  //   2. `start_time` is only INCLUDED in the insert payload when we have a
  //      real value. On a fresh insert with `g.startTime === null` the
  //      column defaults to NULL, which the UI renders as "TBD".
  const [inserted] = await db
    .insert(games)
    .values({
      sportId: g.sportId,
      externalId: g.externalId,
      sourceUrl: g.sourceUrl,
      homeTeamId: g.homeTeamId,
      awayTeamId: g.awayTeamId,
      startTime: g.startTime,
    })
    .onConflictDoUpdate({
      target: [games.sportId, games.externalId],
      set: {
        sourceUrl: g.sourceUrl,
        homeTeamId: g.homeTeamId,
        awayTeamId: g.awayTeamId,
      },
    })
    .returning({ id: games.id });
  if (!inserted) throw new Error(`game upsert failed for ${g.externalId}`);
  return inserted.id;
}
