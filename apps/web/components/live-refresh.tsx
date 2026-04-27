"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import type { SportSlug } from "@ohsboard/types";

interface LiveRefreshProps {
  sport: SportSlug;
  /**
   * The `MAX(captured_at)` baked into the server-rendered DTO. The poller
   * compares each heartbeat against this and triggers a `router.refresh()`
   * once a newer value lands.
   */
  initialCapturedAt: string | null;
  intervalMs?: number;
}

interface HeartbeatBody {
  capturedAt: string | null;
  runId: string | null;
  runStatus: "running" | "ok" | "degraded" | "failed" | null;
}

/**
 * Background poller. Renders nothing visible. Hits `/api/heartbeat?sport=…`
 * on an interval; when the returned `capturedAt` is newer than the last seen
 * one, calls `router.refresh()` so the server component tree re-runs and
 * fresh data cascades down to scoreboard rows + chart cards.
 *
 * - Pauses while the tab is hidden (visibilityState=hidden).
 * - On resume: fires one immediate heartbeat to catch up, then resumes the
 *   interval.
 * - Aborts in-flight fetches on unmount or visibility change so we never
 *   process a response after we've stopped caring.
 */
export function LiveRefresh({
  sport,
  initialCapturedAt,
  intervalMs = 5000,
}: LiveRefreshProps) {
  const router = useRouter();
  // Refs (not state): we don't want any of these changes to re-render the
  // component itself. The whole point is that this component is invisible
  // and only acts via side effects on the parent server tree.
  const lastSeenRef = useRef<string | null>(initialCapturedAt);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchHeartbeat() {
      // Cancel any in-flight request so a slow heartbeat doesn't fire
      // router.refresh() after a faster, newer one already did.
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const res = await fetch(`/api/heartbeat?sport=${sport}`, {
          cache: "no-store",
          signal: ac.signal,
        });
        if (!res.ok) return;
        const body = (await res.json()) as HeartbeatBody;
        if (cancelled) return;
        if (
          body.capturedAt &&
          body.capturedAt !== lastSeenRef.current &&
          // Defensive: ignore non-monotonic values (clock skew or stale read).
          (lastSeenRef.current === null ||
            body.capturedAt > lastSeenRef.current)
        ) {
          lastSeenRef.current = body.capturedAt;
          router.refresh();
        }
      } catch {
        // AbortError + transient network failures are silent; next tick will
        // try again. We don't surface these to the user.
      }
    }

    function start() {
      if (timerRef.current !== null) return;
      // Fire one immediately so a newly visible / freshly mounted tab
      // catches up without waiting an interval.
      void fetchHeartbeat();
      timerRef.current = setInterval(fetchHeartbeat, intervalMs);
    }

    function stop() {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      abortRef.current?.abort();
      abortRef.current = null;
    }

    function onVisibilityChange() {
      if (document.visibilityState === "hidden") {
        stop();
      } else {
        start();
      }
    }

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stop();
    };
  }, [sport, intervalMs, router]);

  return null;
}
