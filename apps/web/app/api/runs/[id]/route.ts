import { db } from "@/lib/db";
import { scrapeRuns } from "@ohsboard/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: RouteParams) {
  const { id } = await params;

  // UUID sanity check — avoid sending arbitrary strings to Drizzle.
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }

  const [row] = await db
    .select({
      id: scrapeRuns.id,
      status: scrapeRuns.status,
      trigger: scrapeRuns.trigger,
      startedAt: scrapeRuns.startedAt,
      finishedAt: scrapeRuns.finishedAt,
      gamesExpected: scrapeRuns.gamesExpected,
      gamesScraped: scrapeRuns.gamesScraped,
      rowsWritten: scrapeRuns.rowsWritten,
      healed: scrapeRuns.healed,
      healMarkets: scrapeRuns.healMarkets,
      healLlmTokens: scrapeRuns.healLlmTokens,
      errorMessage: scrapeRuns.errorMessage,
    })
    .from(scrapeRuns)
    .where(eq(scrapeRuns.id, id))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({
    id: row.id,
    status: row.status,
    trigger: row.trigger,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    gamesExpected: row.gamesExpected,
    gamesScraped: row.gamesScraped,
    rowsWritten: row.rowsWritten,
    healed: row.healed,
    healMarkets: row.healMarkets ?? [],
    healLlmTokens: row.healLlmTokens,
    errorMessage: row.errorMessage,
  });
}
