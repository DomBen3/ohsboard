import { db } from "@/lib/db";
import { oddsSnapshots } from "@ohsboard/db";
import { asc, eq } from "drizzle-orm";
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
    .where(eq(oddsSnapshots.gameId, id))
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
