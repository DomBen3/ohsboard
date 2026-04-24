// Pure shape validators for market rows. Used by both the healer (to decide
// whether a proposed selector is worth persisting) and — potentially — by the
// scrape loop to detect when a previously-healthy selector has started to rot.

import {
  parseAmericanPrice,
  parseLinePrice,
  parseTotalLabel,
} from "./odds-parser";

export type Market = "total" | "run_line" | "moneyline";

export interface ValidationResult {
  /** Number of elements the selector matched. */
  rowsMatched: number;
  /** Subset of matched rows whose text parsed as a valid market row. */
  validRows: number;
  /** True when the selector's shape matches the market's expected pattern. */
  passes: boolean;
  /** Diagnostic preview of the first few matched row texts. */
  samples: string[];
}

const MAX_GAME_MARKET_ROWS = 20;
const SAMPLE_PREVIEW_COUNT = 4;
const SAMPLE_PREVIEW_CHARS = 200;

export function validateMarketRows(
  texts: string[],
  market: Market,
): ValidationResult {
  const samples = texts
    .slice(0, SAMPLE_PREVIEW_COUNT)
    .map((t) => t.replace(/\s+/g, " ").trim().slice(0, SAMPLE_PREVIEW_CHARS));

  if (texts.length === 0) {
    return { rowsMatched: 0, validRows: 0, passes: false, samples };
  }
  if (texts.length > MAX_GAME_MARKET_ROWS) {
    return { rowsMatched: texts.length, validRows: 0, passes: false, samples };
  }

  let validRows = 0;
  for (const text of texts) {
    if (!rowIsValid(text, market)) continue;
    validRows++;
  }

  // Game-level markets: must be exactly 2 valid rows (away/home or over/under).
  const passes = validRows === 2;
  return { rowsMatched: texts.length, validRows, passes, samples };
}

function rowIsValid(text: string, market: Market): boolean {
  const clean = text.replace(/\s+/g, " ").trim();

  if (market === "total") {
    const label = parseTotalLabel(clean);
    if (!label) return false;
    return parseAmericanPrice(clean) !== null;
  }

  if (market === "run_line") {
    const parsed = parseLinePrice(clean);
    if (!parsed) return false;
    return Math.abs(parsed.line) <= 5;
  }

  // moneyline
  return parseAmericanPrice(clean) !== null;
}
