"use client";

import { useEffect, useState } from "react";

export interface Snapshot {
  market: string;
  field: string;
  player: string | null;
  line: number | null;
  priceAmerican: number;
  capturedAt: string;
}

export interface UseGameHistoryResult {
  snapshots: Snapshot[] | null;
  error: string | null;
}

/**
 * Fetch the full odds history for a game. Refetches whenever `capturedAt`
 * changes — i.e. once per scrape tick the parent observes — so a card open
 * during a refresh smoothly picks up new points.
 *
 * Pass `enabled: false` when a parent already has the snapshots and is
 * threading them down via props — the hook returns `{snapshots: null, error: null}`
 * without firing a fetch. Lets a child component conditionally use the hook
 * without violating the rules of hooks (we always call it; the gate is inside
 * the effect).
 */
export function useGameHistory(
  gameId: string,
  capturedAt: string | null,
  options: { enabled?: boolean } = {},
): UseGameHistoryResult {
  const enabled = options.enabled ?? true;
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setError(null);
    fetch(`/api/games/${gameId}/history`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: { snapshots: Snapshot[] }) => {
        if (!cancelled) setSnapshots(data.snapshots);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [gameId, capturedAt, enabled]);

  return { snapshots, error };
}
