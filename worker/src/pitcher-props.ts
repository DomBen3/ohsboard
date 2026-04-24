/// <reference lib="dom" />
// Deterministic pitcher-prop extractor.
//
// DK's pitcher-props tab renders each market (Strikeouts O/U, Outs Recorded
// O/U, etc.) as a collapsed `div[data-testid="collapsible-wrapper"]` whose
// header h2 carries the market label. As of DK's 2026 redesign, the wrapper
// contains ONLY the header/trigger — the row content lives in the wrapper's
// IMMEDIATE NEXT SIBLING (a `<div>` inside the same `.cms-expander-container`
// parent). Rows are not rendered until the trigger is clicked. Each pitcher
// then appears inside the body sibling as `a.cb-player-page-link[href*="/players/"]`
// followed by two buttons whose visible text is exactly `"O <line> <price>"`
// and `"U <line> <price>"`.
//
// We locate and expand the market section by header text (aliases), then
// enumerate player rows in the body sibling — no LLM required. If DK renames
// the header outside our alias list, extraction returns zero rows and the
// scrape loop logs it alongside the game markets that DO go through the LLM
// healer.

import type { Page } from "playwright";
import type { PropMarket, RawOdds } from "./draftkings";
import { parseAmericanPrice } from "./odds-parser";

/** Possible market-header texts DK has used, in preference order. */
const MARKET_HEADER_ALIASES: Record<PropMarket, string[]> = {
  prop_pitcher_strikeouts: [
    "Strikeouts O/U",
    "Pitcher Strikeouts",
    "Strikeouts Thrown",
  ],
  prop_pitcher_outs_recorded: ["Outs Recorded O/U", "Outs Recorded"],
};

const COLLAPSIBLE_TRIGGER = 'button[data-testid="collapsible-trigger"]';
const COLLAPSIBLE_HEADER = '[data-testid="collapsible-header"]';

export async function extractPitcherPropsBySection(
  page: Page,
  market: PropMarket,
): Promise<RawOdds[]> {
  const aliases = MARKET_HEADER_ALIASES[market];
  const rows = await page.evaluate(
    ({ aliases, triggerSel, headerSel }) => {
      const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
      const headers = Array.from(
        document.querySelectorAll<HTMLElement>(headerSel),
      );
      const headerEl = headers.find((h) => {
        const t = normalize(h.textContent ?? "");
        return aliases.some((a) => a.toLowerCase() === t.toLowerCase());
      });
      if (!headerEl) return { ok: false as const, reason: "header_not_found" };

      // Climb to the collapsible-wrapper for this section.
      let wrapper: HTMLElement | null = headerEl;
      while (wrapper && wrapper.getAttribute("data-testid") !== "collapsible-wrapper") {
        wrapper = wrapper.parentElement;
      }
      if (!wrapper) return { ok: false as const, reason: "wrapper_not_found" };

      // Expand the section by dispatching a real click sequence on the trigger.
      const trigger = wrapper.querySelector<HTMLElement>(triggerSel);
      if (trigger) {
        const opts = { bubbles: true, cancelable: true, view: window, button: 0 } as const;
        trigger.scrollIntoView({ block: "center" });
        trigger.dispatchEvent(new PointerEvent("pointerdown", opts));
        trigger.dispatchEvent(new MouseEvent("mousedown", opts));
        trigger.dispatchEvent(new PointerEvent("pointerup", opts));
        trigger.dispatchEvent(new MouseEvent("mouseup", opts));
        trigger.dispatchEvent(new MouseEvent("click", opts));
      }
      return { ok: true as const, reason: "expanded" };
    },
    {
      aliases,
      triggerSel: COLLAPSIBLE_TRIGGER,
      headerSel: COLLAPSIBLE_HEADER,
    },
  );

  if (!rows.ok) {
    console.log(`[props] ${market}: section skipped (${rows.reason})`);
    return [];
  }

  // After dispatching the click, rows render asynchronously in the wrapper's
  // next sibling (DK's `.cms-expander-container` keeps header and body as
  // separate children). Wait briefly for at least one player anchor to appear
  // in that sibling.
  await page
    .waitForFunction(
      ({ aliases, triggerSel, headerSel }) => {
        const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
        const headers = Array.from(
          document.querySelectorAll<HTMLElement>(headerSel),
        );
        const headerEl = headers.find((h) => {
          const t = normalize(h.textContent ?? "");
          return aliases.some((a) => a.toLowerCase() === t.toLowerCase());
        });
        if (!headerEl) return false;
        let wrapper: HTMLElement | null = headerEl;
        while (wrapper && wrapper.getAttribute("data-testid") !== "collapsible-wrapper") {
          wrapper = wrapper.parentElement;
        }
        if (!wrapper) return false;
        const body = wrapper.nextElementSibling as HTMLElement | null;
        if (!body) return false;
        return !!body.querySelector('a[href*="/players/"]');
      },
      { aliases, triggerSel: COLLAPSIBLE_TRIGGER, headerSel: COLLAPSIBLE_HEADER },
      { timeout: 8_000 },
    )
    .catch(() => undefined);

  const parsed = await page.evaluate(
    ({ aliases, headerSel }) => {
      const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
      const headers = Array.from(
        document.querySelectorAll<HTMLElement>(headerSel),
      );
      const headerEl = headers.find((h) => {
        const t = normalize(h.textContent ?? "");
        return aliases.some((a) => a.toLowerCase() === t.toLowerCase());
      });
      if (!headerEl) return [];
      let wrapper: HTMLElement | null = headerEl;
      while (wrapper && wrapper.getAttribute("data-testid") !== "collapsible-wrapper") {
        wrapper = wrapper.parentElement;
      }
      if (!wrapper) return [];
      // DK's redesign renders rows in the wrapper's next sibling, not inside
      // the wrapper. Fall back to the wrapper itself so we still work if DK
      // ever reverts.
      const body = (wrapper.nextElementSibling as HTMLElement | null) ?? wrapper;

      // For each pitcher anchor inside the body, climb to a common row
      // container and collect its two O/U buttons. `a[href*="/players/"]`
      // is stable (DK's player profile route hasn't drifted).
      const playerAnchors = Array.from(
        body.querySelectorAll<HTMLAnchorElement>('a[href*="/players/"]'),
      );
      const seen = new Set<HTMLElement>();
      const out: Array<{ player: string; overText: string; underText: string }> = [];
      for (const anchor of playerAnchors) {
        const playerName = normalize(anchor.textContent ?? "");
        if (!playerName) continue;

        // Climb until we find an ancestor that also contains two distinct
        // buttons (Over and Under). Caps at 8 levels to avoid selecting the
        // whole section (which would contain buttons from every pitcher).
        let row: HTMLElement | null = anchor.parentElement;
        for (let i = 0; i < 8 && row; i++) {
          const buttons = Array.from(
            row.querySelectorAll<HTMLElement>("button"),
          ).filter((b) => {
            const t = normalize(b.innerText ?? b.textContent ?? "");
            return /^[OU]\b/i.test(t);
          });
          const anchorsInside = row.querySelectorAll('a[href*="/players/"]').length;
          if (buttons.length >= 2 && anchorsInside === 1) {
            if (seen.has(row)) break;
            seen.add(row);
            const overBtn =
              buttons.find((b) =>
                /^O\b/i.test(normalize(b.innerText ?? b.textContent ?? "")),
              ) ?? buttons[0];
            const underBtn =
              buttons.find((b) =>
                /^U\b/i.test(normalize(b.innerText ?? b.textContent ?? "")),
              ) ?? buttons[1];
            if (overBtn && underBtn) {
              out.push({
                player: playerName,
                overText: normalize(overBtn.innerText ?? overBtn.textContent ?? ""),
                underText: normalize(underBtn.innerText ?? underBtn.textContent ?? ""),
              });
            }
            break;
          }
          row = row.parentElement;
        }
      }
      return out;
    },
    { aliases, headerSel: COLLAPSIBLE_HEADER },
  );

  const odds: RawOdds[] = [];
  const seenPlayers = new Set<string>();
  for (const r of parsed) {
    const key = r.player.toLowerCase();
    if (seenPlayers.has(key)) continue;
    const over = parseOverUnderButton(r.overText);
    const under = parseOverUnderButton(r.underText);
    if (!over || !under) continue;
    if (over.line !== under.line) {
      // Mismatched lines (e.g. DK showed an alternate line for one side). Skip.
      continue;
    }
    seenPlayers.add(key);
    odds.push(
      {
        market,
        field: "over",
        line: over.line,
        priceAmerican: over.price,
        player: r.player,
      },
      {
        market,
        field: "under",
        line: under.line,
        priceAmerican: under.price,
        player: r.player,
      },
    );
  }
  return odds;
}

/**
 * Parse a single O/U prop button's visible text, like `"O 17.5 −161"` or
 * `"U 6.5 +110"`. Returns null when the text is malformed.
 */
export function parseOverUnderButton(
  raw: string,
): { side: "over" | "under"; line: number; price: number } | null {
  const clean = raw.replace(/\s+/g, " ").trim();
  const m = /^([OU])\s*(\d+(?:\.\d+)?)\b/i.exec(clean);
  if (!m || m[1] === undefined || m[2] === undefined) return null;
  const side = m[1].toUpperCase() === "O" ? "over" : "under";
  const line = Number(m[2]);
  if (!Number.isFinite(line) || line > 100) return null;
  // Prices come AFTER the line. Slice past the "O 17.5" prefix so we don't
  // misread the line value as a price.
  const afterLine = clean.slice(m.index + m[0].length);
  const price = parseAmericanPrice(afterLine);
  if (price === null) return null;
  return { side, line, price };
}
