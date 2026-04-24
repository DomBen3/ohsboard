import { refreshRateLimits } from "@ohsboard/db";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export const REFRESH_MAX_PER_HOUR = 10;

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
}

function currentHourBucket(now: Date = new Date()): Date {
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
    ),
  );
}

/**
 * Atomically increment the per-(IP, hour) counter and report whether the
 * caller is still within the limit. Uses the partial-unique primary key on
 * (ip, hour_bucket) so contention across parallel presses resolves to a
 * single row per bucket.
 */
export async function incrementRefreshCount(
  ip: string,
): Promise<RateLimitResult> {
  const hourBucket = currentHourBucket();
  const inserted = await db
    .insert(refreshRateLimits)
    .values({ ip, hourBucket, count: 1 })
    .onConflictDoUpdate({
      target: [refreshRateLimits.ip, refreshRateLimits.hourBucket],
      set: { count: sql`${refreshRateLimits.count} + 1` },
    })
    .returning({ count: refreshRateLimits.count });

  const count = inserted[0]?.count ?? 1;
  return {
    allowed: count <= REFRESH_MAX_PER_HOUR,
    count,
    limit: REFRESH_MAX_PER_HOUR,
  };
}

/** Extract the originating client IP from Vercel/Next.js request headers. */
export function clientIpFromHeaders(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "0.0.0.0";
  const real = headers.get("x-real-ip");
  if (real) return real.trim();
  return "0.0.0.0";
}
