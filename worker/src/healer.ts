import { selectors as selectorsTable, type Db } from "@ohsboard/db";
import { and, eq } from "drizzle-orm";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";
import { env } from "./env";
import { captureRelevantHtml } from "./html-reducer";
import { getOpenAI } from "./openai";
import { validateMarketRows } from "./validators";

// Game-level markets. DK's Game tab puts the team label in a shared left-rail
// row (not inside the button), so moneyline / run-line buttons contain ONLY
// their own data (price, or line + price). Order in the DOM is (away, home)
// — that's how we assign rows to teams. Pitcher-prop markets live in their
// own subcategory page and are extracted deterministically (see
// pitcher-props.ts) rather than going through this LLM-healer path.
export type Market = "total" | "run_line" | "moneyline";

export interface HealOutcome {
  selector: string;
  confidence: number;
  reasoning: string;
  tokensUsed: number;
  rowsMatched: number;
  validRows: number;
}

interface HealerProposal {
  selector: string;
  reasoning: string;
  confidence: number;
}

const CSS_SELECTOR_RULES = `CSS SELECTOR RULES (STRICT):
- Must be a SYNTACTICALLY VALID CSS selector accepted by \`document.querySelectorAll\`.
- Do NOT use jQuery pseudo-classes: no \`:contains()\`, no \`:has-text()\`, no \`:text()\`. These are NOT real CSS and will throw.
- You MAY use \`:has()\` (CSS Selectors Level 4), but only with VALID CSS inside — e.g. \`section:has(h2.my-class)\`, NOT \`section:has(h2:contains("X"))\`.
- Only reference classes, IDs, attributes, tag names, and data-attributes that LITERALLY APPEAR in the HTML provided. Do not invent \`aria-label\`, \`data-testid\`, or class values that you did not see.
- To narrow by text, find a stable STRUCTURAL landmark in the HTML (a specific class, data-testid, or position under a known container) — we'll verify by text content on our side.
- Prefer stable data-attributes (e.g. \`data-testid\` patterns) over fragile \`:nth-child\` chains.`;

const SELECTOR_JSON_SCHEMA = {
  type: "object",
  properties: {
    selector: {
      type: "string",
      description: "A valid CSS selector (no JavaScript, no pseudo-elements).",
    },
    reasoning: {
      type: "string",
      description: "One sentence explaining why this selector identifies the market rows.",
    },
    confidence: {
      type: "number",
      description: "0.0–1.0 confidence that this selector correctly yields the intended rows.",
    },
  },
  required: ["selector", "reasoning", "confidence"],
  additionalProperties: false,
} as const;

function systemPrompt(market: Market): string {
  if (market === "run_line") {
    return `You are a CSS selector expert. You will be given reduced HTML from a DraftKings MLB game page. Find a CSS selector that matches EXACTLY TWO elements — the two Run Line (spread) price buttons for the GAME-LEVEL Run Line market.

${CSS_SELECTOR_RULES}

IMPORTANT context about DraftKings' layout:
- The team's name/label lives in a SEPARATE left-rail row, NOT inside the price button.
- Each price button's innerText contains ONLY a signed half-run line and the American price, e.g. "-1.5 +129" or "+1.5 −156".
- The two matched elements must be in document order: [0] = AWAY team's run line, [1] = HOME team's run line.

Requirements:
1. Returns exactly 2 elements.
2. Each matched element's innerText contains BOTH a signed ±1.5 line AND an American price.
3. MUST NOT match:
   - Moneyline buttons (no ±1.5 line — just a price)
   - Total Over/Under buttons (labeled O/U, not ±1.5)
   - Alternate spread markets (lines other than ±1.5)
   - Any player props (strikeouts, home runs, etc.)
4. Prefer stable data-attributes (e.g. data-testid patterns) over fragile :nth-child chains.

Respond ONLY with valid JSON matching the schema.`;
  }

  if (market === "moneyline") {
    return `You are a CSS selector expert. You will be given reduced HTML from a DraftKings MLB game page. Find a CSS selector that matches EXACTLY TWO elements — the two Moneyline price buttons for the GAME-LEVEL Moneyline market.

${CSS_SELECTOR_RULES}

IMPORTANT context about DraftKings' layout:
- The team's name/label lives in a SEPARATE left-rail row, NOT inside the price button.
- Each moneyline button's innerText is ONLY the American price, e.g. "-115" or "+145". No label, no team name, no line.
- The two matched elements must be in document order: [0] = AWAY team's moneyline, [1] = HOME team's moneyline.

Requirements:
1. Returns exactly 2 elements.
2. Each matched element's innerText is (or contains only) an American odds price.
3. MUST NOT match:
   - Run line buttons (those contain a ±1.5 line in addition to the price)
   - Total Over/Under buttons (those contain O/U labels and a total line)
   - Alternate moneyline lines or futures
   - Any player props
4. Prefer stable data-attributes (e.g. data-testid patterns with "ML" markers).

Respond ONLY with valid JSON matching the schema.`;
  }

  return `You are a CSS selector expert. You will be given reduced HTML from a DraftKings MLB game page. Find a CSS selector that matches EXACTLY TWO elements — one Over row and one Under row for the GAME-LEVEL Total runs market.

${CSS_SELECTOR_RULES}

Requirements:
1. Returns exactly 2 matching elements (Over and Under of the main game total).
2. Each matched element's innerText contains BOTH the label (Over/Under or O/U with a line like "8.5") AND an American odds price.
3. MUST NOT match player props such as "Total Bases", "Total Hits", etc.

Respond ONLY with valid JSON matching the schema.`;
}

const ANCHORS: Record<Market, string[]> = {
  total: ["Total", "Over", "Under"],
  run_line: ["Run Line", "Spread", "+1.5", "-1.5", "−1.5"],
  moneyline: ["Moneyline", "ML"],
};

export interface HealerContext {
  db: Db;
  page: Page;
  sportId: number;
  runId: string;
}

/**
 * Ask OpenAI for a CSS selector for the given market, validate the proposal
 * against the current page, and persist it as the new active selector.
 * Returns the healed selector on success, or null if the healer failed
 * (bad JSON, invalid selector, validation didn't meet threshold).
 */
const MAX_OPENAI_ATTEMPTS = 2;

export async function healMarketSelector(
  ctx: HealerContext,
  market: Market,
): Promise<HealOutcome | null> {
  if (!env.OPENAI_API_KEY) {
    console.warn(`[healer] ${market}: OPENAI_API_KEY not set — cannot heal`);
    return null;
  }

  const liveUrl = ctx.page.url();
  const liveTitle = await ctx.page.title().catch(() => "");
  console.log(
    `[healer] ${market}: page url="${liveUrl}" title="${liveTitle.slice(0, 80)}"`,
  );

  console.log(`[healer] ${market}: capturing page HTML…`);
  const reduced = await captureRelevantHtml(ctx.page, ANCHORS[market]);
  const landmarks = extractLandmarks(reduced);
  console.log(
    `[healer] ${market}: reduced HTML ${reduced.length} chars (~${Math.round(reduced.length / 4)} tokens) · ${landmarks.classes.length} unique classes · ${landmarks.testIds.length} data-testids`,
  );

  let totalTokens = 0;
  let priorFeedback: string | null = null;

  for (let attempt = 1; attempt <= MAX_OPENAI_ATTEMPTS; attempt++) {
    const proposal = await askOpenAI(market, reduced, landmarks, priorFeedback);
    if (!proposal) {
      console.warn(
        `[healer] ${market}: attempt ${attempt} — OpenAI returned no usable proposal`,
      );
      return null;
    }
    totalTokens += proposal.tokensUsed;
    console.log(
      `[healer] ${market}: attempt ${attempt} proposal "${proposal.selector}" (confidence=${proposal.confidence}) — ${proposal.reasoning}`,
    );

    const validation = await validateOnPage(ctx.page, proposal.selector, market);
    if (validation.syntaxError) {
      console.warn(
        `[healer] ${market}: attempt ${attempt} — selector is INVALID CSS: ${validation.syntaxError}`,
      );
      priorFeedback = `Your previous selector \`${proposal.selector}\` was rejected by \`document.querySelectorAll\` with this error: ${validation.syntaxError}. Common cause: jQuery pseudo-classes like \`:contains()\` are NOT valid CSS. Use a structural selector (classes / data-testid / :has() with real CSS inside) — we verify text content on our side.`;
      continue;
    }
    console.log(
      `[healer] ${market}: attempt ${attempt} validation → ${validation.rowsMatched} rows matched, ${validation.validRows} parseable`,
    );
    if (!validation.passes) {
      const sampleBlurb = validation.samples.length
        ? `Sample matched texts (first 4): ${JSON.stringify(validation.samples)}.`
        : "No elements matched the selector at all.";
      priorFeedback = `Your previous selector \`${proposal.selector}\` matched ${validation.rowsMatched} element(s), of which ${validation.validRows} parsed as valid ${market} rows. ${sampleBlurb} Either the selector is too broad, too narrow, or references attributes/classes that don't appear in the HTML. Pick a selector using ONLY classes, IDs, or data-attributes you can see in the HTML.`;
      console.warn(
        `[healer] ${market}: attempt ${attempt} validation FAILED (${validation.validRows} parseable of ${validation.rowsMatched} matched); retrying with feedback`,
      );
      continue;
    }

    // Success.
    await persistActiveSelector(ctx, market, proposal);
    console.log(
      `[healer] ${market}: persisted as active selector (attempt ${attempt})`,
    );
    return {
      selector: proposal.selector,
      confidence: proposal.confidence,
      reasoning: proposal.reasoning,
      tokensUsed: totalTokens,
      rowsMatched: validation.rowsMatched,
      validRows: validation.validRows,
    };
  }

  console.warn(
    `[healer] ${market}: exhausted ${MAX_OPENAI_ATTEMPTS} attempts; giving up`,
  );
  await dumpReducedHtml(market, reduced, liveUrl).catch(() => undefined);
  return null;
}

async function dumpReducedHtml(
  market: Market,
  html: string,
  liveUrl: string,
): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = join(tmpdir(), `ohs-heal-${market}-${stamp}.html`);
  const banner = `<!-- OhsBoard heal dump · ${market} · ${liveUrl} · ${stamp} -->\n`;
  await writeFile(file, banner + html, "utf-8");
  console.log(`[healer] ${market}: dumped failed reduced HTML → ${file}`);
}

interface LandmarkInventory {
  classes: string[];
  testIds: string[];
  ariaLabels: string[];
}

function extractLandmarks(html: string): LandmarkInventory {
  const classSet = new Set<string>();
  const testIdSet = new Set<string>();
  const ariaSet = new Set<string>();

  for (const m of html.matchAll(/\sclass="([^"]+)"/g)) {
    for (const c of m[1].split(/\s+/)) {
      if (c && c.length > 1 && c.length < 80) classSet.add(c);
    }
  }
  for (const m of html.matchAll(/\sdata-testid="([^"]+)"/g)) {
    if (m[1].length < 80) testIdSet.add(m[1]);
  }
  for (const m of html.matchAll(/\saria-label="([^"]+)"/g)) {
    if (m[1].length < 80) ariaSet.add(m[1]);
  }

  return {
    classes: Array.from(classSet).slice(0, 80),
    testIds: Array.from(testIdSet).slice(0, 40),
    ariaLabels: Array.from(ariaSet).slice(0, 30),
  };
}

function formatLandmarks(inv: LandmarkInventory): string {
  const parts: string[] = [];
  parts.push(
    `CLASSES PRESENT IN THIS HTML (use ONLY these, exactly as spelled):\n${inv.classes.join(", ") || "<none>"}`,
  );
  parts.push(
    `data-testid VALUES PRESENT:\n${inv.testIds.join(", ") || "<none>"}`,
  );
  parts.push(
    `aria-label VALUES PRESENT:\n${inv.ariaLabels.join(", ") || "<none>"}`,
  );
  return parts.join("\n\n");
}

interface ProposalWithTokens extends HealerProposal {
  tokensUsed: number;
}

async function askOpenAI(
  market: Market,
  reducedHtml: string,
  landmarks: LandmarkInventory,
  priorFeedback: string | null,
): Promise<ProposalWithTokens | null> {
  try {
    const client = getOpenAI();
    const messages: Array<{ role: "system" | "user"; content: string }> = [
      { role: "system", content: systemPrompt(market) },
      { role: "user", content: formatLandmarks(landmarks) },
      { role: "user", content: reducedHtml },
    ];
    if (priorFeedback) {
      messages.push({
        role: "user",
        content: `FEEDBACK ON YOUR PREVIOUS ATTEMPT:\n${priorFeedback}\n\nTry again. Return a STRICTLY VALID CSS selector that uses ONLY classes / testids / aria-labels from the inventory above.`,
      });
    }
    const completion = await client.chat.completions.create({
      model: env.OPENAI_MODEL,
      messages,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "selector_proposal",
          strict: true,
          schema: SELECTOR_JSON_SCHEMA,
        },
      },
    });
    const raw = completion.choices[0]?.message?.content;
    const tokensUsed = completion.usage?.total_tokens ?? 0;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as HealerProposal;
    if (!parsed.selector || typeof parsed.selector !== "string") return null;
    return { ...parsed, tokensUsed };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[healer] ${market}: OpenAI call failed — ${msg}`);
    return null;
  }
}

interface ValidationOutcome {
  rowsMatched: number;
  validRows: number;
  passes: boolean;
  samples: string[];
  /** Set when the selector itself is invalid CSS (querySelectorAll throws). */
  syntaxError: string | null;
}

async function validateOnPage(
  page: Page,
  selector: string,
  market: Market,
): Promise<ValidationOutcome> {
  type BrowserResult = { texts: string[] } | { error: string };
  const result = (await page
    .evaluate((sel: string): BrowserResult => {
      try {
        const els = document.querySelectorAll<HTMLElement>(sel);
        const texts = Array.from(els)
          .slice(0, 60)
          .map((el) => {
            const vis = el.innerText ?? "";
            const raw = el.textContent ?? "";
            return vis.trim().length > 0 ? vis : raw;
          });
        return { texts };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    }, selector)
    .catch((err) => ({ error: err instanceof Error ? err.message : String(err) }))) as BrowserResult;

  if ("error" in result) {
    return {
      rowsMatched: 0,
      validRows: 0,
      passes: false,
      samples: [],
      syntaxError: result.error,
    };
  }

  const shape = validateMarketRows(result.texts, market);
  if (!shape.passes && shape.samples.length > 0) {
    console.log(
      `[healer] ${market}: sample matched texts:`,
      ...shape.samples.map((t, i) => `\n  [${i}] "${t}"`),
    );
  }
  return {
    rowsMatched: shape.rowsMatched,
    validRows: shape.validRows,
    passes: shape.passes,
    samples: shape.samples,
    syntaxError: null,
  };
}

async function persistActiveSelector(
  ctx: HealerContext,
  market: Market,
  proposal: HealerProposal,
): Promise<void> {
  // Deactivate any existing active row (partial unique index allows only one).
  await ctx.db
    .update(selectorsTable)
    .set({ isActive: false })
    .where(
      and(
        eq(selectorsTable.sportId, ctx.sportId),
        eq(selectorsTable.source, "draftkings"),
        eq(selectorsTable.market, market),
        eq(selectorsTable.field, "row"),
        eq(selectorsTable.isActive, true),
      ),
    );

  // Compute next version.
  const prior = await ctx.db
    .select({ version: selectorsTable.version })
    .from(selectorsTable)
    .where(
      and(
        eq(selectorsTable.sportId, ctx.sportId),
        eq(selectorsTable.source, "draftkings"),
        eq(selectorsTable.market, market),
        eq(selectorsTable.field, "row"),
      ),
    );
  const nextVersion = prior.reduce((m, r) => Math.max(m, r.version), 0) + 1;

  await ctx.db.insert(selectorsTable).values({
    sportId: ctx.sportId,
    source: "draftkings",
    market,
    field: "row",
    selectorType: "css",
    selector: proposal.selector,
    version: nextVersion,
    isActive: true,
    onProbation: true,
    origin: "heal",
    healRunId: ctx.runId,
    confidence: String(proposal.confidence),
    notes: proposal.reasoning.slice(0, 500),
  });
}
