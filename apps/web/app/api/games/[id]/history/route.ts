import { db } from "@/lib/db";
import { HISTORY_PRE_TIPOFF_MIN } from "@/lib/games";
import { games, oddsSnapshots } from "@ohsboard/db";
import { and, asc, eq, gte } from "drizzle-orm";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: RouteParams) {
  const { id } = await params;

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }

  const [game] = await db
    .select({ startTime: games.startTime })
    .from(games)
    .where(eq(games.id, id))
    .limit(1);

  if (!game) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // When tip-off is unknown (TBD), the pre-tipoff cutoff doesn't apply —
  // return all snapshots and let the chart show what we have.
  const windowFilter = game.startTime
    ? and(
        eq(oddsSnapshots.gameId, id),
        gte(
          oddsSnapshots.capturedAt,
          new Date(game.startTime.getTime() - HISTORY_PRE_TIPOFF_MIN * 60_000),
        ),
      )
    : eq(oddsSnapshots.gameId, id);

  const rows = await db
    .select({
      market: oddsSnapshots.market,
      field: oddsSnapshots.field,
      player: oddsSnapshots.player,
      line: oddsSnapshots.line,
      priceAmerican: oddsSnapshots.priceAmerican,
      capturedAt: oddsSnapshots.capturedAt,
    })
    .from(oddsSnapshots)
    .where(windowFilter)
    .orderBy(asc(oddsSnapshots.capturedAt));

  const snapshots = rows.map((r) => ({
    market: r.market,
    field: r.field,
    player: r.player,
    line: r.line != null ? Number(r.line) : null,
    priceAmerican: r.priceAmerican,
    capturedAt: new Date(r.capturedAt).toISOString(),
  }));

  return NextResponse.json({ snapshots });
}
