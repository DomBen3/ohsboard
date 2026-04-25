/// <reference lib="dom" />
// Deterministic NBA O/U player-prop extractor.
//
// On the per-game NBA event page (`?category=all-odds&subcategory=<market>`),
// each market renders multiple stacked accordions. The one we care about for
// scraping is the second-from-top: `Points O/U`, `Threes O/U`, `Rebounds O/U`,
// `Assists O/U`. Each is a `[data-testid="collapsible-wrapper"]` whose header
// h2 carries the market label, with the body rendered in the wrapper's
// IMMEDIATE NEXT SIBLING (DK's `.cms-expander-container` keeps header and
// body as separate children — same shape as pitcher props).
//
// Each row inside the body contains one `a[href*="/players/"]` and two
// buttons whose accessible names are exactly `"O <line> <price>"` and
// `"U <line> <price>"`. Prices may use Unicode minus (U+2212) — the parser
// handles both. The walk is identical to pitcher-props.ts except for the
// per-market header alias list. We keep this as a separate module rather
// than generalize pitcher-props.ts so MLB code paths stay untouched while
// NBA is brought online.

import type { Page } from "playwright";
import type { NbaPropMarket, RawOdds } from "./draftkings";
import { parseOverUnderButton } from "./pitcher-props";

const MARKET_HEADER_ALIASES: Record<NbaPropMarket, string[]> = {
  prop_nba_points: ["Points O/U", "Player Points"],
  prop_nba_threes: ["Threes O/U", "3-Pointers Made", "Threes Made"],
  prop_nba_rebounds: ["Rebounds O/U", "Player Rebounds"],
  prop_nba_assists: ["Assists O/U", "Player Assists"],
};

const COLLAPSIBLE_TRIGGER = 'button[data-testid="collapsible-trigger"]';
const COLLAPSIBLE_HEADER = '[data-testid="collapsible-header"]';

export async function extractNbaPropOU(
  page: Page,
  market: NbaPropMarket,
): Promise<RawOdds[]> {
  const aliases = MARKET_HEADER_ALIASES[market];

  // Poll-wait for the section header to attach before we try to click it.
  // Headless Chromium occasionally hydrates collapsible-header elements ~3-6s
  // after `domcontentloaded` even when `Points O/U` is in the SSR HTML, so a
  // fixed waitForTimeout in the caller is unreliable. This wait gives up
  // silently after 15s — the caller already records the empty result.
  await page
    .waitForFunction(
      ({ aliases, headerSel }) => {
        const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
        const headers = Array.from(
          document.querySelectorAll<HTMLElement>(headerSel),
        );
        return headers.some((h) => {
          const t = normalize(h.textContent ?? "");
          return aliases.some((a) => a.toLowerCase() === t.toLowerCase());
        });
      },
      { aliases, headerSel: COLLAPSIBLE_HEADER },
      { timeout: 15_000 },
    )
    .catch(() => undefined);

  const expand = await page.evaluate(
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

      let wrapper: HTMLElement | null = headerEl;
      while (wrapper && wrapper.getAttribute("data-testid") !== "collapsible-wrapper") {
        wrapper = wrapper.parentElement;
      }
      if (!wrapper) return { ok: false as const, reason: "wrapper_not_found" };

      // NBA O/U sections are often pre-expanded on the per-game page (unlike
      // pitcher props, which start collapsed). If the wrapper's next sibling
      // already contains player anchors, clicking the trigger COLLAPSES the
      // section and the row walk yields zero rows. Skip the click in that
      // case; only dispatch when no rows are visible yet.
      const body = wrapper.nextElementSibling as HTMLElement | null;
      const alreadyExpanded = !!body?.querySelector('a[href*="/players/"]');
      if (alreadyExpanded) {
        return { ok: true as const, reason: "already_expanded" };
      }
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
      return { ok: true as const, reason: "click_dispatched" };
    },
    { aliases, triggerSel: COLLAPSIBLE_TRIGGER, headerSel: COLLAPSIBLE_HEADER },
  );

  if (!expand.ok) {
    console.log(`[nba-props] ${market}: section skipped (${expand.reason})`);
    return [];
  }
  console.log(`[nba-props] ${market}: section located (${expand.reason})`);

  await page
    .waitForFunction(
      ({ aliases, headerSel }) => {
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
      { aliases, headerSel: COLLAPSIBLE_HEADER },
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
      const body = (wrapper.nextElementSibling as HTMLElement | null) ?? wrapper;

      const playerAnchors = Array.from(
        body.querySelectorAll<HTMLAnchorElement>('a[href*="/players/"]'),
      );
      const seen = new Set<HTMLElement>();
      const out: Array<{ player: string; overText: string; underText: string }> = [];
      for (const anchor of playerAnchors) {
        const playerName = normalize(anchor.textContent ?? "");
        if (!playerName) continue;

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
    if (over.line !== under.line) continue;
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
