import type { Page } from "playwright";

// Upper bound on the characters we ship to the LLM. 1 token ≈ 4 chars for
// English HTML; ~120k chars keeps us well under a 40k-token budget.
const MAX_CHARS = 120_000;
// Lower bound on the characters of the chosen subtree. If the anchor only
// matches a tiny label (e.g. "Moneyline" in a tab header), we must climb
// ancestors to reach the actual odds container.
const MIN_TEXT_CHARS = 8_000;

/**
 * Capture an LLM-friendly HTML snippet covering the subtree most likely to
 * contain the requested market. Flow:
 *   1. Score every element by how many `anchors` its innerText contains.
 *   2. Start from the highest-scoring candidate (tie-break: smallest).
 *   3. Climb ancestors until the chosen subtree has enough structural context
 *      (MIN_TEXT_CHARS) — this gets us the market CARD, not a lone label.
 *   4. Clone + strip scripts/styles/attrs, serialize, truncate to MAX_CHARS.
 *
 * IMPORTANT: single flat arrow. tsx injects `__name(fn, "name")` around
 * nested function declarations; that helper isn't defined in Playwright's
 * page context, so nested `function foo() {}` blocks break `evaluate`.
 */
export async function captureRelevantHtml(
  page: Page,
  anchors: string[],
): Promise<string> {
  return page.evaluate(
    ({ anchors, maxChars, minTextChars }) => {
      const lowered = anchors.map((a) => a.toLowerCase());

      // SCRIPT/STYLE/NOSCRIPT/TEMPLATE/IFRAME all expose their source text via
      // `innerText`, and on DK that includes huge `window.__INITIAL_STATE__`
      // JSON blobs that contain our anchor tokens. Scoring those pollutes the
      // reducer's choice — we'd serialize a subtree whose visible DOM has zero
      // classes / testids. Filter them out before scoring.
      const skipTags = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "IFRAME"]);
      const all = Array.from(document.querySelectorAll<HTMLElement>("*")).filter(
        (el) => !skipTags.has(el.tagName),
      );
      const cands: Array<{ el: HTMLElement; score: number; size: number }> = [];
      for (const el of all) {
        const text = (el.innerText ?? "").toLowerCase();
        if (text.length === 0) continue;
        let score = 0;
        for (const a of lowered) {
          if (text.includes(a)) score++;
        }
        if (score > 0) cands.push({ el, score, size: text.length });
      }
      cands.sort((a, b) => b.score - a.score || a.size - b.size);

      let target: HTMLElement = cands[0]?.el ?? document.body;
      // Climb until we have enough content context to capture the market card.
      while (
        target.parentElement &&
        (target.innerText?.length ?? 0) < minTextChars
      ) {
        target = target.parentElement;
      }

      // Clone + strip noise before serializing.
      const clone = target.cloneNode(true) as HTMLElement;
      clone
        .querySelectorAll("script, style, noscript, svg, iframe, link, meta")
        .forEach((n) => n.remove());
      clone.querySelectorAll("*").forEach((el) => {
        const attrs = Array.from(el.attributes);
        for (const attr of attrs) {
          if (attr.name.startsWith("on") || attr.name === "style") {
            el.removeAttribute(attr.name);
          }
        }
      });
      const html = clone.outerHTML;
      if (html.length <= maxChars) return html;
      return html.slice(0, maxChars) + "<!-- [truncated] -->";
    },
    { anchors, maxChars: MAX_CHARS, minTextChars: MIN_TEXT_CHARS },
  );
}
