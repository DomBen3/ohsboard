"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";

const CLIENT_DEBOUNCE_MS = 30_000;
const POLL_INTERVAL_MS = 2_000;
const POLL_DEADLINE_MS = 120_000;
const LAST_PRESS_KEY = "ohs.lastRefreshPress";

type Tone = "info" | "ok" | "warn" | "error";

interface ToastState {
  msg: string;
  tone: Tone;
  ttl: number;
}

interface RefreshResponse {
  cached?: boolean;
  reason?: string;
  runId?: string;
  error?: string;
  count?: number;
  limit?: number;
  retryAfterSeconds?: number;
  ageMs?: number;
}

interface RunStatus {
  id: string;
  status: "running" | "ok" | "degraded" | "failed";
  healed: boolean;
  healMarkets: string[];
  gamesExpected: number | null;
  gamesScraped: number | null;
  rowsWritten: number | null;
  errorMessage: string | null;
}

export function RefreshButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState<string>("Refresh");
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string, tone: Tone = "info", ms = 4000) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, tone, ttl: ms });
    toastTimer.current = setTimeout(() => setToast(null), ms);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const handleClick = useCallback(async () => {
    if (busy) return;

    // Client-side debounce so hitting the button 3x in a row doesn't waste
    // server work (the server has its own rate-limit, this is UX polish).
    try {
      const last = Number(window.localStorage.getItem(LAST_PRESS_KEY) ?? 0);
      const waitMs = CLIENT_DEBOUNCE_MS - (Date.now() - last);
      if (waitMs > 0) {
        showToast(`Wait ${Math.ceil(waitMs / 1000)}s`, "warn", 2500);
        return;
      }
    } catch {
      /* localStorage disabled — fall through */
    }

    setBusy(true);
    setLabel("Syncing");
    setToast(null);

    try {
      const res = await fetch("/api/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });

      if (res.status === 429) {
        const body = (await res.json().catch(() => ({}))) as RefreshResponse;
        const mins = body.retryAfterSeconds
          ? Math.ceil(body.retryAfterSeconds / 60)
          : 60;
        showToast(`Rate limited · retry in ${mins}m`, "warn", 6000);
        return;
      }

      const body = (await res.json()) as RefreshResponse;
      if (!res.ok || body.error) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      try {
        window.localStorage.setItem(LAST_PRESS_KEY, String(Date.now()));
      } catch {
        /* ignore */
      }

      // SWR hit — cached data is already <60s old, just revalidate the page.
      if (body.cached && body.reason === "swr") {
        showToast("Already fresh", "ok", 2500);
        router.refresh();
        return;
      }

      // Worker said "scrape already in-flight" — poll its runId.
      if (!body.runId) {
        showToast("Synced", "ok");
        router.refresh();
        return;
      }

      setLabel("Syncing");
      const outcome = await pollRun(body.runId, (status) => {
        // Refetch the scoreboard on every tick — new rows land in Neon as each
        // game finishes extracting, and router.refresh() re-runs the server
        // component without remounting client components.
        router.refresh();
        if (status.status === "running") {
          if (status.gamesExpected && status.gamesExpected > 0) {
            setLabel(
              `Syncing · ${status.gamesScraped ?? 0}/${status.gamesExpected}`,
            );
          } else {
            setLabel("Syncing");
          }
        }
      });
      if (outcome === null) {
        showToast("Timed out; showing older data", "warn", 5000);
      } else if (outcome.status === "ok") {
        if (outcome.healed && outcome.healMarkets.length > 0) {
          showToast(
            `Agent healed: ${outcome.healMarkets.join(", ")}`,
            "ok",
            6500,
          );
        } else if (outcome.rowsWritten != null) {
          showToast(`Synced · ${outcome.rowsWritten} rows`, "ok");
        } else {
          showToast("Synced", "ok");
        }
      } else if (outcome.status === "degraded") {
        showToast("Synced (degraded)", "warn", 5000);
      } else if (outcome.status === "failed") {
        showToast(
          outcome.errorMessage
            ? `Failed · ${outcome.errorMessage.slice(0, 60)}`
            : "Sync failed",
          "error",
          6500,
        );
      }
      router.refresh();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Refresh failed",
        "error",
        5000,
      );
    } finally {
      setBusy(false);
      setLabel("Refresh");
    }
  }, [busy, router, showToast]);

  return (
    <div className="flex items-center gap-3">
      {toast ? <ToastPill toast={toast} /> : null}
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className={clsx(
          "relative overflow-hidden",
          "inline-flex items-center gap-2 px-4 py-2",
          "border border-[var(--color-rule)] bg-[var(--color-ink-raised)]",
          "font-display text-[11px] uppercase tracking-[0.24em]",
          "text-[var(--color-chalk)] transition-colors",
          "hover:border-[var(--color-signal)] hover:bg-[var(--color-ink-hover)]",
          "disabled:cursor-wait disabled:opacity-80",
        )}
      >
        {busy ? (
          <span
            aria-hidden
            className="shimmer-bg pointer-events-none absolute inset-0"
          />
        ) : null}
        <span className="relative h-1.5 w-1.5 rounded-full bg-[var(--color-signal)] shadow-[0_0_6px_var(--color-signal-glow)]" />
        <span className="relative">{label}</span>
      </button>
    </div>
  );
}

function ToastPill({ toast }: { toast: ToastState }) {
  const toneClass = {
    ok: "text-[var(--color-signal-dim)] border-[var(--color-signal-dim)]/40",
    warn: "text-[var(--color-warn)] border-[var(--color-warn)]/40",
    error: "text-[var(--color-alert)] border-[var(--color-alert)]/40",
    info: "text-[var(--color-chalk-soft)] border-[var(--color-rule)]",
  }[toast.tone];
  return (
    <span
      role="status"
      aria-live="polite"
      className={clsx(
        "font-seg text-[11px] uppercase tracking-[0.18em]",
        "border-l px-3 py-1",
        toneClass,
      )}
    >
      {toast.msg}
    </span>
  );
}

async function pollRun(
  runId: string,
  onTick?: (status: RunStatus) => void,
): Promise<RunStatus | null> {
  const deadline = Date.now() + POLL_DEADLINE_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    let res: Response;
    try {
      res = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
    } catch {
      continue;
    }
    if (!res.ok) continue;
    const body = (await res.json()) as RunStatus;
    if (onTick) onTick(body);
    if (body.status && body.status !== "running") return body;
  }
  return null;
}
