/**
 * Plain anchor with `download` so the browser honors the
 * `Content-Disposition: attachment; filename=…` header from the CSV
 * endpoint without any extra JS. Style matches the scoreboard's secondary
 * button language (subtle border, brass-on-hover) so it sits unobtrusively
 * next to the matchup banner.
 */
export function DownloadCsvButton({ gameId }: { gameId: string }) {
  return (
    <a
      href={`/api/games/${gameId}/csv`}
      download
      className="inline-flex items-center gap-1.5 border border-[var(--color-rule)] bg-[var(--color-ink-raised)] px-3 py-1.5 font-display text-[10px] uppercase tracking-[0.22em] text-[var(--color-chalk-soft)] transition-colors hover:border-[var(--color-brass)] hover:text-[var(--color-brass)]"
      aria-label="Download CSV of this game's odds history"
    >
      <svg
        viewBox="0 0 12 14"
        className="h-3 w-2.5"
        fill="currentColor"
        aria-hidden
      >
        <path d="M5 0h2v6h3l-4 5-4-5h3z" />
        <path d="M0 12h12v2H0z" />
      </svg>
      <span>CSV</span>
    </a>
  );
}
