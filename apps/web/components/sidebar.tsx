import clsx from "clsx";

interface SportNavItem {
  slug: string;
  name: string;
  active: boolean;
}

const sports: SportNavItem[] = [
  { slug: "mlb", name: "MLB", active: true },
  { slug: "nba", name: "NBA", active: false },
  { slug: "nfl", name: "NFL", active: false },
];

export function Sidebar() {
  return (
    <aside className="w-52 shrink-0 border-r border-[var(--color-rule)] bg-[var(--color-ink-soft)] flex flex-col">
      <div className="px-5 pt-6 pb-8">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-[26px] leading-none font-black uppercase tracking-tight text-[var(--color-chalk)]">
            Ohs
          </span>
          <span className="font-display text-[26px] leading-none font-black uppercase tracking-tight text-[var(--color-signal)]">
            board
          </span>
        </div>
        <div className="mt-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-[var(--color-chalk-dim)]">
          <span className="signal-dot h-1.5 w-1.5 rounded-full" />
          <span>Live · Book</span>
        </div>
      </div>

      <div className="px-5 pb-2 text-[10px] uppercase tracking-[0.28em] text-[var(--color-chalk-dimmer)]">
        League
      </div>
      <nav className="flex flex-col gap-px px-2">
        {sports.map((sport) => (
          <SportLink key={sport.slug} sport={sport} />
        ))}
      </nav>

      <div className="mt-auto px-5 pb-6">
        <div className="border-t border-[var(--color-rule)] pt-4">
          <div className="text-[10px] uppercase tracking-[0.28em] text-[var(--color-chalk-dimmer)]">
            Source
          </div>
          <div className="mt-1 font-display text-sm uppercase tracking-[0.08em] text-[var(--color-chalk-soft)]">
            DraftKings
          </div>
          <div className="mt-3 text-[10px] uppercase tracking-[0.28em] text-[var(--color-chalk-dimmer)]">
            Agent
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-signal)] shadow-[0_0_6px_var(--color-signal-glow)]" />
            <span className="font-seg text-xs text-[var(--color-chalk-soft)]">
              Self-heal · GPT-5
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}

function SportLink({ sport }: { sport: SportNavItem }) {
  const base =
    "group relative flex items-center gap-3 px-3 py-2.5 font-display text-sm uppercase tracking-[0.14em] transition-colors";
  if (!sport.active) {
    return (
      <div
        className={clsx(
          base,
          "cursor-not-allowed text-[var(--color-chalk-dimmer)]",
        )}
        title="Coming soon"
      >
        <span className="h-1.5 w-1.5 rounded-full border border-[var(--color-chalk-dimmer)]" />
        <span className="flex-1">{sport.name}</span>
        <span className="font-seg text-[9px] uppercase tracking-[0.2em] text-[var(--color-chalk-dimmer)]">
          Soon
        </span>
      </div>
    );
  }
  return (
    <a
      href={`/${sport.slug}`}
      className={clsx(
        base,
        "bg-[var(--color-ink-raised)] text-[var(--color-chalk)] shadow-[inset_2px_0_0_0_var(--color-signal)]",
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-signal)] shadow-[0_0_6px_var(--color-signal-glow)]" />
      <span className="flex-1">{sport.name}</span>
      <svg
        viewBox="0 0 8 12"
        className="h-3 w-2 text-[var(--color-chalk-dim)] opacity-0 transition-opacity group-hover:opacity-100"
        fill="currentColor"
      >
        <path d="M0 0 L8 6 L0 12 Z" />
      </svg>
    </a>
  );
}
