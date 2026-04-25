import clsx from "clsx";
import type { AnyTeam, SportSlug } from "@/lib/teams";
import { teamLogoPath } from "@/lib/teams";

interface TeamBadgeProps {
  sport: SportSlug;
  team: AnyTeam | null;
  fallbackCode: string;
  size?: "sm" | "lg";
}

/**
 * A team logo chip: circular bezel, logo on top, city-tinted background.
 * Falls back to a generic token when the source name didn't resolve.
 */
export function TeamBadge({
  sport,
  team,
  fallbackCode,
  size = "sm",
}: TeamBadgeProps) {
  const dims = size === "sm" ? "h-7 w-7" : "h-12 w-12";
  const tint = team ? team.primaryColor : "#1a202e";

  return (
    <span
      className={clsx(
        "relative inline-flex shrink-0 items-center justify-center rounded-full ring-1 ring-[var(--color-rule)]",
        dims,
      )}
      style={{
        background: `radial-gradient(circle at 30% 25%, ${tint}33 0%, ${tint}08 45%, transparent 70%)`,
      }}
      aria-label={team?.name ?? fallbackCode}
    >
      {team ? (
        <img
          src={teamLogoPath(sport, team.abbreviation)}
          alt=""
          className={clsx(
            size === "sm" ? "h-5 w-5" : "h-9 w-9",
            "drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]",
          )}
        />
      ) : (
        <span className="font-display text-[10px] font-black uppercase tracking-tight text-[var(--color-chalk-dim)]">
          {fallbackCode.slice(0, 3)}
        </span>
      )}
    </span>
  );
}
