// Single-flight mutex for scrape runs. If a scrape is already running,
// concurrent callers receive the active runId instead of starting another.
let activeRunId: string | null = null;

export function tryClaim(runId: string): boolean {
  if (activeRunId) return false;
  activeRunId = runId;
  return true;
}

export function release(runId: string): void {
  if (activeRunId === runId) activeRunId = null;
}

export function getActive(): string | null {
  return activeRunId;
}
