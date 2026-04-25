// Pure parsers for DraftKings' odds strings. No Playwright, no DB — safe to unit test.

// DraftKings sometimes renders prices with a Unicode minus (U+2212) instead of ASCII.
const PRICE_RE = /([+\-−])\s*(\d{2,5})/;

export function parseAmericanPrice(raw: string): number | null {
  const m = PRICE_RE.exec(raw);
  if (!m) return null;
  const sign = m[1] === "+" ? 1 : -1;
  const magnitude = Number(m[2]);
  if (!Number.isFinite(magnitude) || magnitude === 0) return null;
  return sign * magnitude;
}

const TOTAL_LABEL_RE = /^\s*(O|U|Over|Under)\s*([0-9]+(?:\.[0-9]+)?)\b/i;

export interface TotalSide {
  side: "over" | "under";
  line: number;
}

export function parseTotalLabel(raw: string): TotalSide | null {
  const m = TOTAL_LABEL_RE.exec(raw);
  if (!m) return null;
  const side = m[1].toLowerCase().startsWith("o") ? "over" : "under";
  const line = Number(m[2]);
  if (!Number.isFinite(line)) return null;
  return { side, line };
}

// Signed decimal like "+1.5" or "−1.5". MLB run line is always ±1.5, but we
// accept any signed halfline in case DK offers alternate lines at some point.
const SIGNED_LINE_RE = /([+\-−])\s*(\d+\.\d+)/;

export interface LinePrice {
  line: number; // signed, e.g. -1.5 or +1.5
  price: number; // American
}

/**
 * Parse a "line + price" cell like "-1.5 +129". DK's current game layout puts
 * the team label in a separate left-rail element, so the price button's text
 * is just the signed line followed by the American price — no team prefix.
 */
export function parseLinePrice(raw: string): LinePrice | null {
  const clean = raw.replace(/\s+/g, " ").trim();
  const lineMatch = SIGNED_LINE_RE.exec(clean);
  if (!lineMatch) return null;
  const lineSign = lineMatch[1] === "+" ? 1 : -1;
  const lineMag = Number(lineMatch[2]);
  if (!Number.isFinite(lineMag) || lineMag > 20) return null;

  // American price lives AFTER the signed line — slice past it so we don't
  // re-match the line itself as the price.
  const afterLine = clean.slice(lineMatch.index + lineMatch[0].length);
  const price = parseAmericanPrice(afterLine);
  if (price === null) return null;

  return { line: lineSign * lineMag, price };
}

// DraftKings event URLs look like `/event/some-slug/32221415`. Return the numeric
// id when present (stable across scrapes); otherwise fall back to the slug.
const EVENT_PATH_RE = /\/event\/([^/?#]+)\/(\d+)/;

export function parseDkEventId(url: string): string {
  const m = EVENT_PATH_RE.exec(url);
  if (m) return m[2];
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

// Parse "nationals-vs-mariners" / "yankees-at-redsox" / "la-lakers-%40-hou-rockets"
// (or `%2540` double-encoded) slugs into two display names when we can't read
// them from the DOM. Capitalizes each token.
const SLUG_SEP_RE = /-(?:vs|at|%2540|%40|@)-/i;

export function parseTeamsFromSlug(url: string): { away: string; home: string } | null {
  const m = EVENT_PATH_RE.exec(url);
  if (!m) return null;
  const parts = m[1].split(SLUG_SEP_RE);
  if (parts.length !== 2) return null;
  const [away, home] = parts.map(titleCase);
  return { away, home };
}

function titleCase(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}
