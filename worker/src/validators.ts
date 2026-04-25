// Pure shape validators for market rows. Used by both the healer (to decide
// whether a proposed selector is worth persisting) and — potentially — by the
// scrape loop to detect when a previously-healthy selector has started to rot.

import type { RawOdds } from "./draftkings";
import {
  parseAmericanPrice,
  parseLinePrice,
  parseTotalLabel,
} from "./odds-parser";
import { parseOverUnderButton } from "./pitcher-props";

// Healer-facing markets: only the MLB game-level markets get LLM-healed; the
// prop markets (MLB pitcher props and the four NBA O/U props) use deterministic
// extractors and bypass this validator entirely.
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

// ---------------------------------------------------------------------------
// Player-prop shape validator (NBA O/U + MLB pitcher props).
//
// The deterministic extractors (`extractNbaPropOU`, `extractPitcherPropsBySection`)
// produce paired Over/Under `RawOdds` rows keyed by player + line. This
// validator is invoked from the orchestrator AFTER extraction to confirm the
// shape we got back is consistent — same line on both sides, sane bounds,
// 1–30 distinct players. It does not walk the DOM; it just sanity-checks the
// already-parsed rows so a downstream regression (e.g. a parser tweak)
// surfaces as a degraded-status run rather than silent bad data.
// ---------------------------------------------------------------------------

const MAX_PROP_PLAYERS = 30;

export interface PropPair {
  player: string;
  line: number;
  overPrice: number;
  underPrice: number;
}

export interface PropValidationResult {
  /** Distinct player-pairs that parsed cleanly. */
  validPairs: number;
  /** All distinct player names that appeared (paired or not). */
  playersSeen: number;
  /** True iff 1 ≤ validPairs ≤ MAX_PROP_PLAYERS and every row paired. */
  passes: boolean;
  /** First few normalized "Player O/U <line> <price>" strings for logging. */
  samples: string[];
  /** Reason summary when `passes=false`. */
  reason: string | null;
}

/**
 * Validate a batch of prop rows. Mirrors the deterministic extractor's pairing
 * logic: for each player we expect exactly one over and one under row with the
 * same `line`. American prices must parse; the `parseAmericanPrice` regex
 * already accepts ASCII `-` and U+2212 so DK's Unicode-minus prices pass.
 */
export function validatePropRows(rows: RawOdds[]): PropValidationResult {
  const samples = rows.slice(0, SAMPLE_PREVIEW_COUNT).map((r) => {
    const sign = r.priceAmerican > 0 ? "+" : "";
    const side = r.field === "over" ? "O" : "U";
    return `${r.player ?? "?"} ${side} ${r.line ?? "?"} ${sign}${r.priceAmerican}`;
  });

  if (rows.length === 0) {
    return {
      validPairs: 0,
      playersSeen: 0,
      passes: false,
      samples,
      reason: "empty",
    };
  }

  const byPlayer = new Map<
    string,
    { over: RawOdds | null; under: RawOdds | null }
  >();
  for (const r of rows) {
    if (!r.player) continue;
    const key = r.player.toLowerCase();
    let slot = byPlayer.get(key);
    if (!slot) {
      slot = { over: null, under: null };
      byPlayer.set(key, slot);
    }
    if (r.field === "over") slot.over = r;
    else if (r.field === "under") slot.under = r;
  }

  let validPairs = 0;
  let unpaired = 0;
  let lineMismatch = 0;
  let badPrice = 0;
  for (const slot of byPlayer.values()) {
    if (!slot.over || !slot.under) {
      unpaired++;
      continue;
    }
    if (slot.over.line === null || slot.under.line === null) {
      badPrice++;
      continue;
    }
    if (slot.over.line !== slot.under.line) {
      lineMismatch++;
      continue;
    }
    if (
      !Number.isFinite(slot.over.priceAmerican) ||
      !Number.isFinite(slot.under.priceAmerican)
    ) {
      badPrice++;
      continue;
    }
    validPairs++;
  }

  const playersSeen = byPlayer.size;
  const inBounds = validPairs >= 1 && validPairs <= MAX_PROP_PLAYERS;
  const passes = inBounds && unpaired === 0 && lineMismatch === 0 && badPrice === 0;

  let reason: string | null = null;
  if (!passes) {
    const parts: string[] = [];
    if (!inBounds) parts.push(`pairs=${validPairs} (want 1..${MAX_PROP_PLAYERS})`);
    if (unpaired) parts.push(`unpaired=${unpaired}`);
    if (lineMismatch) parts.push(`line_mismatch=${lineMismatch}`);
    if (badPrice) parts.push(`bad_price=${badPrice}`);
    reason = parts.join(" ") || "unknown";
  }

  return { validPairs, playersSeen, passes, samples, reason };
}

/**
 * Parse a single button text — `"O 17.5 −161"` / `"U 6.5 +110"` — into
 * `{side, line, price}`. Re-exports `parseOverUnderButton` for callers that
 * need the per-row primitive (e.g. the healer's row-text validation, were we
 * ever to add an LLM-heal arm for player props).
 */
export { parseOverUnderButton };
