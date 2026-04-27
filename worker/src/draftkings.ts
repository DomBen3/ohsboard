import type { BrowserContext, Page } from "playwright";
import {
  parseAmericanPrice,
  parseDkEventId,
  parseLinePrice,
  parseTeamsFromSlug,
  parseTotalLabel,
} from "./odds-parser";

export const LEAGUE_URL = "https://sportsbook.draftkings.com/leagues/baseball/mlb";

// Game link discovery uses a URL-pattern invariant, not a CSS class. DK's
// routing has used `/event/<slug>/<id>` for years and doesn't depend on DOM.
const EVENT_HREF_SELECTOR = 'a[href*="/event/"]';
const EVENT_URL_RE = /\/event\/[^/]+\/\d+/;

export type MarketSide = "home" | "away" | "over" | "under";

export type MainMarket = "moneyline" | "total" | "run_line";
export type PropMarket =
  | "prop_pitcher_strikeouts"
  | "prop_pitcher_outs_recorded";
export type NbaPropMarket =
  | "prop_nba_points"
  | "prop_nba_threes"
  | "prop_nba_rebounds"
  | "prop_nba_assists";
export type AnyMarket = MainMarket | PropMarket | NbaPropMarket;

export interface RawOdds {
  market: AnyMarket;
  field: MarketSide;
  line: number | null;
  priceAmerican: number;
  /** Only populated for player props; null for game-level markets. */
  player: string | null;
}

// Per-market row selectors. Any can be null when the healer hasn't found one
// yet — the scraper calls the healer to fill them in. Only game-level markets
// use DB-persisted selectors; pitcher props are handled deterministically in
// pitcher-props.ts against DK's header-text + collapsible structure.
export interface MarketSelectors {
  moneylineRow: string | null;
  totalRow: string | null;
  runLineRow: string | null;
}

export interface MainExtract {
  sourceUrl: string;
  dkEventId: string;
  home: string;
  away: string;
  startTime: Date;
  odds: RawOdds[];
  emptyMarkets: MainMarket[];
}

/** Pitcher-prop subcategory URL for a DK game. */
export function pitcherPropsUrl(gameUrl: string): string {
  const u = new URL(gameUrl);
  // Clear any pre-existing query params (e.g. `sgpmode=true` that discovery
  // picks up) so DK routes on our explicit category/subcategory rather than
  // an unrelated SGP view.
  u.search = "";
  // DK's tab hrefs use `category=all-odds` — `category=odds` is invalid and
  // silently falls back to the Popular tab, whose DOM has no Strikeouts
  // Thrown rows for the healer to find.
  u.searchParams.set("category", "all-odds");
  u.searchParams.set("subcategory", "pitcher-props");
  return u.toString();
}

export const NBA_LEAGUE_URL = "https://sportsbook.draftkings.com/leagues/basketball/nba";

export type NbaSubcategory = "points" | "threes" | "rebounds" | "assists";

/**
 * NBA per-game subcategory URL. The path-level `@` in DK slugs is
 * double-encoded as `%2540` in their hrefs; the URL constructor preserves
 * that verbatim (it doesn't re-encode the path), so the same form survives a
 * round-trip through `new URL(href).toString()`. Single-encoded `%40` causes
 * DK to drop the `subcategory` param and fall back to the default tab.
 */
export function nbaSubcategoryUrl(gameUrl: string, sub: NbaSubcategory): string {
  const u = new URL(gameUrl);
  u.search = "";
  u.searchParams.set("category", "all-odds");
  u.searchParams.set("subcategory", sub);
  return u.toString();
}

export async function discoverGameUrls(
  page: Page,
  leagueUrl: string = LEAGUE_URL,
): Promise<string[]> {
  const response = await page.goto(leagueUrl, {
    waitUntil: "commit",
    timeout: 60_000,
  });
  console.log(
    `[scraper] league page status=${response?.status() ?? "?"} finalUrl=${page.url()}`,
  );

  // Wait a bit for hydration so client-rendered links are attached.
  await page
    .waitForSelector(EVENT_HREF_SELECTOR, { timeout: 30_000, state: "attached" })
    .catch(() => undefined);

  const hrefs = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/event/"]'))
      .map((a) => a.href)
      .filter(Boolean),
  );

  // Dedupe by event id so `?sgpmode=true` and other query-string variants
  // don't count as separate games.
  const byEventId = new Map<string, string>();
  for (const u of hrefs) {
    const m = EVENT_URL_RE.exec(u);
    if (!m) continue;
    const id = parseDkEventId(u);
    // Prefer the shortest (query-string-free) URL for a given event id.
    const existing = byEventId.get(id);
    if (!existing || u.length < existing.length) byEventId.set(id, u);
  }
  const deduped = Array.from(byEventId.values());
  if (deduped.length === 0) {
    const title = await page.title().catch(() => "");
    const body = (await page.locator("body").innerText().catch(() => "")).slice(0, 200);
    console.warn(
      `[scraper] no game links found. title="${title}" bodyStart="${body.replace(/\s+/g, " ")}"`,
    );
  }
  return deduped;
}

/**
 * Navigate to a DK page. Returns the HTTP status from the navigation response
 * so callers can detect 403/429 (DK bot-block) without re-fetching. MLB call
 * sites ignore the return value; the NBA cross-game-parallel path uses it to
 * fall back to serial mode on first block.
 */
export async function navigateToGame(page: Page, url: string): Promise<number | null> {
  const response = await page.goto(url, { waitUntil: "commit", timeout: 60_000 });
  // Let hydration attach dynamic odds before anything tries to read them.
  await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => undefined);
  // Give the odds table a moment to render — it shows up after hydration.
  await page.waitForTimeout(1500);
  return response?.status() ?? null;
}

export async function extractMainMarkets(
  page: Page,
  url: string,
  sel: MarketSelectors,
): Promise<MainExtract> {
  const teams = await extractTeamNames(page, url);
  const emptyMarkets: MainMarket[] = [];
  const odds: RawOdds[] = [];

  if (sel.totalRow) {
    const rows = await extractTotalFromRows(page, sel.totalRow);
    if (rows.length === 0) emptyMarkets.push("total");
    odds.push(...rows);
  } else {
    emptyMarkets.push("total");
  }

  if (sel.runLineRow) {
    const rows = await extractRunLineFromRows(page, sel.runLineRow);
    if (rows.length === 0) emptyMarkets.push("run_line");
    odds.push(...rows);
  } else {
    emptyMarkets.push("run_line");
  }

  if (sel.moneylineRow) {
    const rows = await extractMoneylineFromRows(page, sel.moneylineRow);
    if (rows.length === 0) emptyMarkets.push("moneyline");
    odds.push(...rows);
  } else {
    emptyMarkets.push("moneyline");
  }

  return {
    sourceUrl: url,
    dkEventId: parseDkEventId(url),
    home: teams.home,
    away: teams.away,
    startTime: new Date(),
    odds,
    emptyMarkets,
  };
}

async function extractTeamNames(
  page: Page,
  url: string,
): Promise<{ home: string; away: string }> {
  const headerText = await page
    .locator("h1")
    .first()
    .innerText()
    .catch(() => "");
  const vsMatch = /^(.+?)\s+(?:@|at|vs\.?)\s+(.+)$/i.exec(headerText.trim());
  if (vsMatch) {
    // DK convention is "Away @ Home". Trim "Odds"/"Matchup" suffixes that
    // sometimes tail the h1.
    const stripSuffix = (s: string) =>
      s.replace(/\s+(?:odds|matchup|lines?|betting)\s*$/i, "").trim();
    return {
      away: stripSuffix(vsMatch[1]),
      home: stripSuffix(vsMatch[2]),
    };
  }
  const fromSlug = parseTeamsFromSlug(url);
  if (fromSlug) return fromSlug;
  return { home: "Home", away: "Away" };
}

async function extractRunLineFromRows(
  page: Page,
  rowSelector: string,
): Promise<RawOdds[]> {
  const texts = await safeReadTexts(page, rowSelector);
  const parsed = texts
    .map((t) => parseLinePrice(t))
    .filter((p): p is NonNullable<typeof p> => p !== null);
  if (parsed.length < 2) return [];
  const [awayCell, homeCell] = parsed;
  return [
    {
      market: "run_line",
      field: "away",
      line: awayCell.line,
      priceAmerican: awayCell.price,
      player: null,
    },
    {
      market: "run_line",
      field: "home",
      line: homeCell.line,
      priceAmerican: homeCell.price,
      player: null,
    },
  ];
}

async function extractMoneylineFromRows(
  page: Page,
  rowSelector: string,
): Promise<RawOdds[]> {
  const texts = await safeReadTexts(page, rowSelector);
  const prices = texts
    .map((t) => parseAmericanPrice(t.replace(/\s+/g, " ").trim()))
    .filter((p): p is number => p !== null);
  if (prices.length < 2) return [];
  const [away, home] = prices;
  return [
    {
      market: "moneyline",
      field: "away",
      line: null,
      priceAmerican: away,
      player: null,
    },
    {
      market: "moneyline",
      field: "home",
      line: null,
      priceAmerican: home,
      player: null,
    },
  ];
}

async function extractTotalFromRows(
  page: Page,
  rowSelector: string,
): Promise<RawOdds[]> {
  const texts = await safeReadTexts(page, rowSelector);
  const out: RawOdds[] = [];
  for (const text of texts) {
    const clean = text.replace(/\s+/g, " ").trim();
    const total = parseTotalLabel(clean);
    const price = parseAmericanPrice(clean);
    if (!total || price === null) continue;
    out.push({
      market: "total",
      field: total.side,
      line: total.line,
      priceAmerican: price,
      player: null,
    });
  }
  return out;
}

async function safeReadTexts(page: Page, selector: string): Promise<string[]> {
  const res = await page
    .evaluate((sel: string) => {
      try {
        const els = document.querySelectorAll<HTMLElement>(sel);
        return Array.from(els)
          .slice(0, 40)
          .map((el) => {
            const vis = el.innerText ?? "";
            const raw = el.textContent ?? "";
            return vis.trim().length > 0 ? vis : raw;
          });
      } catch {
        return null;
      }
    }, selector)
    .catch(() => null);
  return res ?? [];
}

export function jitter(): Promise<void> {
  const ms = 500 + Math.random() * 1000;
  return new Promise((r) => setTimeout(r, ms));
}

export async function createPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  return page;
}
