import { scrapeRuns, selectors as selectorsTable, sports, type Db } from "@ohsboard/db";
import { findMlbTeam } from "@ohsboard/types";
import { and, eq } from "drizzle-orm";
import { chromium, type Page } from "playwright";
import {
  createPage,
  discoverGameUrls,
  extractMainMarkets,
  jitter,
  navigateToGame,
  pitcherPropsUrl,
  type MarketSelectors,
  type PropMarket,
  type RawOdds,
} from "./draftkings";
import { env } from "./env";
import { healMarketSelector, type Market } from "./healer";
import { insertOddsSnapshots, upsertGame, type OddsRow } from "./persist";
import { extractPitcherPropsBySection } from "./pitcher-props";
import {
  fetchExpectedMlbGames,
  matchExpectedGame,
  type ExpectedGame,
} from "./statsapi";

export interface ScrapeResult {
  gamesExpected: number;
  gamesScraped: number;
  rowsWritten: number;
  shapePassRate: number;
  healed: boolean;
  healMarkets: string[];
  healLlmTokens: number;
}

// DB-selector + LLM-heal markets. Prop markets are handled by a deterministic
// structural extractor (see pitcher-props.ts) — they don't need heal attempts.
const MARKETS: Market[] = ["total", "run_line", "moneyline"];
const PROP_MARKETS: PropMarket[] = [
  "prop_pitcher_strikeouts",
  "prop_pitcher_outs_recorded",
];
// Cap heal attempts per run so a bad DOM day can't blow the OpenAI budget.
// +2 allows retries after a first-attempt heal failure.
const MAX_HEAL_ATTEMPTS_PER_RUN = MARKETS.length + 2;

const MARKET_KEY: Record<Market, keyof MarketSelectors> = {
  total: "totalRow",
  run_line: "runLineRow",
  moneyline: "moneylineRow",
};

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

    const gamesExpected = expectedGames?.length ?? urls.length;
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
        for (const pm of PROP_MARKETS) {
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
          ? matchExpectedGame(expectedGames, mainExtract.home, mainExtract.away)
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
        const totalPerGameMarkets = MARKETS.length + PROP_MARKETS.length;
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
): Promise<{ healedAny: boolean; tokens: number }> {
  let healedAny = false;
  let tokens = 0;
  let mutable = current;
  for (const market of emptyMarkets) {
    if (healedMarkets.has(market)) continue;
    if (counter.attempts >= MAX_HEAL_ATTEMPTS_PER_RUN) {
      console.warn(
        `[scraper] heal budget exhausted (${counter.attempts}/${MAX_HEAL_ATTEMPTS_PER_RUN}); skipping ${market}`,
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
