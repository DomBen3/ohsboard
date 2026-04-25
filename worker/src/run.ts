import { createDb, scrapeRuns, sports } from "@ohsboard/db";
import { and, eq } from "drizzle-orm";
import { env } from "./env";
import { getActive, release, tryClaim } from "./mutex";
import { runActiveSports, type SportScrapeOutcome } from "./scraper";

const db = createDb(env.DATABASE_URL);

export interface RunOutcome {
  /**
   * Primary scrape_runs id — typically the first active sport's run. The web
   * progress poller hits `/api/runs/<id>` against this id; per-sport rows
   * are still individually queryable via the same endpoint.
   */
  runId: string;
  cached: boolean;
  /**
   * One id per active sport. Always includes `runId`.
   */
  runIds: Record<string, string>;
}

/**
 * Sport-aware tick entry. Reads `sports.is_active=true` rows, creates one
 * `scrape_runs` row per active sport, single-flights the actual work behind a
 * shared mutex, and returns a primary runId for the caller to poll.
 *
 * When MLB is paused, the MLB row is not in the active set and `scrapeMlb`
 * does not run — no MLB rows accumulate. NBA-only operation just creates a
 * single NBA run and returns its id.
 */
export async function runScrape(
  trigger: "cron" | "manual",
): Promise<RunOutcome> {
  const existing = getActive();
  if (existing) {
    console.log(`[run] scrape already in-flight (${existing}); reusing`);
    return { runId: existing, cached: true, runIds: { primary: existing } };
  }

  const active = await db
    .select({ id: sports.id, slug: sports.slug })
    .from(sports)
    .where(eq(sports.isActive, true));

  if (active.length === 0) {
    throw new Error(
      "no active sports — nothing to scrape (check sports.is_active)",
    );
  }

  // Create one scrape_runs row per active sport up front so the web layer
  // can poll any of them right away.
  const runIds: Record<string, string> = {};
  for (const s of active) {
    const [inserted] = await db
      .insert(scrapeRuns)
      .values({ sportId: s.id, trigger, status: "running" })
      .returning({ id: scrapeRuns.id });
    if (!inserted) throw new Error(`failed to create scrape_runs row for ${s.slug}`);
    runIds[s.slug] = inserted.id;
  }
  const primaryRunId = runIds[active[0]!.slug]!;

  if (!tryClaim(primaryRunId)) {
    // Lost the race — back out the runs we just created so they don't sit as
    // permanent zombies, and reuse whatever the winner claimed.
    return {
      runId: getActive() ?? primaryRunId,
      cached: true,
      runIds: { primary: getActive() ?? primaryRunId },
    };
  }

  // Fire-and-return so HTTP callers aren't blocked 90s. The cron loop awaits
  // directly via the returned runId if it wants to.
  void executeRun(primaryRunId, runIds);

  return { runId: primaryRunId, cached: false, runIds };
}

/**
 * Backward-compat alias retained for any external scripts that imported the
 * old name. New code should call `runScrape`.
 */
export const runMlbScrape = runScrape;

async function executeRun(
  primaryRunId: string,
  runIds: Record<string, string>,
): Promise<void> {
  let outcomes: SportScrapeOutcome[] = [];
  try {
    outcomes = await runActiveSports(db, runIds);
    for (const o of outcomes) {
      if (o.status === "failed") {
        await db
          .update(scrapeRuns)
          .set({
            status: "failed",
            finishedAt: new Date(),
            errorMessage: o.errorMessage ?? "unknown",
          })
          .where(eq(scrapeRuns.id, o.runId));
        console.error(`[run] ${o.sportSlug} ${o.runId} failed:`, o.errorMessage);
        continue;
      }
      await db
        .update(scrapeRuns)
        .set({
          status: "ok",
          finishedAt: new Date(),
          gamesExpected: o.gamesExpected,
          gamesScraped: o.gamesScraped,
          rowsWritten: o.rowsWritten,
          shapePassRate: String(o.shapePassRate),
          healed: o.healed,
          healMarkets: o.healMarkets,
          healLlmTokens: o.healLlmTokens,
        })
        .where(eq(scrapeRuns.id, o.runId));
      console.log(
        `[run] ${o.sportSlug} ${o.runId} ok — ${o.gamesScraped}/${o.gamesExpected} games · ${o.rowsWritten} rows`,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[run] orchestrator failed:`, message);
    // Mark every still-running sport row as failed so the UI doesn't show a
    // permanent spinner.
    for (const id of Object.values(runIds)) {
      await db
        .update(scrapeRuns)
        .set({
          status: "failed",
          finishedAt: new Date(),
          errorMessage: message,
        })
        .where(and(eq(scrapeRuns.id, id), eq(scrapeRuns.status, "running")))
        .catch(() => undefined);
    }
  } finally {
    release(primaryRunId);
  }
}

