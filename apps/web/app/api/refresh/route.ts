import { db } from "@/lib/db";
import {
  REFRESH_MAX_PER_HOUR,
  clientIpFromHeaders,
  incrementRefreshCount,
} from "@/lib/rate-limit";
import { scrapeRuns } from "@ohsboard/db";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STALE_WHILE_REVALIDATE_MS = 60_000;

export async function POST(request: Request) {
  // 1. Stale-while-revalidate: if the last successful run finished less than
  //    60s ago, treat the DB as authoritative and skip the worker trigger.
  const [lastOk] = await db
    .select({
      id: scrapeRuns.id,
      finishedAt: scrapeRuns.finishedAt,
    })
    .from(scrapeRuns)
    .where(eq(scrapeRuns.status, "ok"))
    .orderBy(desc(scrapeRuns.finishedAt))
    .limit(1);

  if (lastOk?.finishedAt) {
    const ageMs = Date.now() - new Date(lastOk.finishedAt).getTime();
    if (ageMs < STALE_WHILE_REVALIDATE_MS) {
      return NextResponse.json({
        cached: true,
        reason: "swr",
        runId: lastOk.id,
        ageMs,
      });
    }
  }

  // 2. Per-IP rate limit (10 req / rolling hour).
  const ip = clientIpFromHeaders(request.headers);
  const rl = await incrementRefreshCount(ip);
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: "rate_limited",
        count: rl.count,
        limit: rl.limit,
        retryAfterSeconds: Math.max(
          1,
          60 * 60 - Math.floor(Date.now() / 1000) % (60 * 60),
        ),
      },
      {
        status: 429,
        headers: {
          "retry-after": "60",
          "x-ratelimit-limit": String(REFRESH_MAX_PER_HOUR),
          "x-ratelimit-remaining": "0",
        },
      },
    );
  }

  // 3. Proxy to the worker's /trigger endpoint (which holds the single-flight
  //    mutex and fires-and-returns the runId).
  const workerUrl = process.env.WORKER_URL;
  const workerSecret = process.env.WORKER_SECRET;
  if (!workerUrl || !workerSecret) {
    return NextResponse.json(
      { error: "worker_not_configured" },
      { status: 503 },
    );
  }

  try {
    const res = await fetch(`${workerUrl}/trigger`, {
      method: "POST",
      headers: { "x-worker-secret": workerSecret },
    });
    const body = (await res.json()) as {
      runId?: string;
      cached?: boolean;
      error?: string;
    };
    if (!res.ok || body.error) {
      return NextResponse.json(
        { error: body.error ?? `worker_${res.status}` },
        { status: res.status >= 400 ? res.status : 502 },
      );
    }
    return NextResponse.json(
      {
        cached: body.cached ?? false,
        reason: body.cached ? "single_flight" : "new",
        runId: body.runId,
      },
      {
        headers: {
          "x-ratelimit-limit": String(REFRESH_MAX_PER_HOUR),
          "x-ratelimit-remaining": String(
            Math.max(0, REFRESH_MAX_PER_HOUR - rl.count),
          ),
        },
      },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "worker_unreachable" },
      { status: 502 },
    );
  }
}
