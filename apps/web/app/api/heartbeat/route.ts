import { db } from "@/lib/db";
import { games, oddsSnapshots, scrapeRuns, sports } from "@ohsboard/db";
import { desc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_SLUGS = new Set(["nba", "mlb", "nfl"]);

/**
 * Cheap heartbeat for the live-refresh poller. Returns the most recent
 * snapshot timestamp + the latest scrape_run status for the requested sport.
 * Clients compare `capturedAt` against the value they last saw and call
 * `router.refresh()` only when it changes — no point re-running the full
 * server tree every 5 s if nothing has landed.
 *
 * Cost: one MAX over the existing `(game_id, market, captured_at desc)` index
 * + one ordered SELECT against `scrape_runs`. Sub-millisecond on Neon.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug = url.searchParams.get("sport");
  if (!slug || !VALID_SLUGS.has(slug)) {
    return NextResponse.json({ error: "bad_sport" }, { status: 400 });
  }

  const sport = await db.query.sports.findFirst({
    where: eq(sports.slug, slug),
  });
  if (!sport) {
    return NextResponse.json(
      { capturedAt: null, runId: null, runStatus: null },
      { status: 200 },
    );
  }

  // MAX(captured_at) for any snapshot belonging to a game in this sport.
  // Joining `games` is cheap because the WHERE clause restricts to one
  // sport's game ids; the index on `odds_snapshots(game_id, ...)` covers it.
  const [maxRow] = await db
    .select({
      capturedAt: sql<Date | null>`MAX(${oddsSnapshots.capturedAt})`,
    })
    .from(oddsSnapshots)
    .innerJoin(games, eq(games.id, oddsSnapshots.gameId))
    .where(eq(games.sportId, sport.id));

  const [run] = await db
    .select({
      id: scrapeRuns.id,
      status: scrapeRuns.status,
    })
    .from(scrapeRuns)
    .where(eq(scrapeRuns.sportId, sport.id))
    .orderBy(desc(scrapeRuns.startedAt))
    .limit(1);

  return NextResponse.json({
    capturedAt: maxRow?.capturedAt
      ? new Date(maxRow.capturedAt).toISOString()
      : null,
    runId: run?.id ?? null,
    runStatus: run?.status ?? null,
  });
}
