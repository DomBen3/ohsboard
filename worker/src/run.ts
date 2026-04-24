import { createDb, scrapeRuns, sports } from "@ohsboard/db";
import { eq } from "drizzle-orm";
import { env } from "./env";
import { getActive, release, tryClaim } from "./mutex";
import { scrapeMlb } from "./scraper";

const db = createDb(env.DATABASE_URL);

export interface RunOutcome {
  runId: string;
  cached: boolean;
}

export async function runMlbScrape(
  trigger: "cron" | "manual",
): Promise<RunOutcome> {
  const existing = getActive();
  if (existing) {
    console.log(`[run] scrape already in-flight (${existing}); reusing`);
    return { runId: existing, cached: true };
  }

  const mlb = await db.query.sports.findFirst({ where: eq(sports.slug, "mlb") });
  if (!mlb) throw new Error("MLB sport row not found — did you run db:seed?");

  const [inserted] = await db
    .insert(scrapeRuns)
    .values({ sportId: mlb.id, trigger, status: "running" })
    .returning({ id: scrapeRuns.id });

  if (!inserted) throw new Error("failed to create scrape_runs row");
  const runId = inserted.id;

  if (!tryClaim(runId)) {
    // Lost the race — another trigger claimed between getActive and tryClaim.
    return { runId: getActive() ?? runId, cached: true };
  }

  // Fire-and-return so HTTP callers aren't blocked 90s. The cron loop awaits
  // directly via the returned runId if it wants to.
  void executeRun(runId);

  return { runId, cached: false };
}

async function executeRun(runId: string): Promise<void> {
  try {
    const result = await scrapeMlb(db, runId);
    await db
      .update(scrapeRuns)
      .set({
        status: "ok",
        finishedAt: new Date(),
        gamesExpected: result.gamesExpected,
        gamesScraped: result.gamesScraped,
        rowsWritten: result.rowsWritten,
        shapePassRate: String(result.shapePassRate),
        healed: result.healed,
        healMarkets: result.healMarkets,
        healLlmTokens: result.healLlmTokens,
      })
      .where(eq(scrapeRuns.id, runId));
    console.log(`[run] ${runId} ok`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[run] ${runId} failed:`, message);
    await db
      .update(scrapeRuns)
      .set({
        status: "failed",
        finishedAt: new Date(),
        errorMessage: message,
      })
      .where(eq(scrapeRuns.id, runId));
  } finally {
    release(runId);
  }
}
