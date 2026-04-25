// Source-of-truth for which sport the UI is currently rendering. The N5
// decision: read from the sidebar's hardcoded sport list (NBA active, MLB
// paused, NFL soon) rather than the DB. The DB has its own `sports.is_active`
// flag but that requires the user to run `pnpm db:seed`, and we want the page
// to render NBA correctly even before that's done. If the user later un-pauses
// MLB, they flip a single line in `sidebar.tsx` and everything follows.

import type { SportSlug } from "@ohsboard/types";

export type SportStatus = "active" | "paused" | "soon";

export interface SportNavItem {
  slug: SportSlug;
  name: string;
  status: SportStatus;
}

export const SPORTS: readonly SportNavItem[] = [
  { slug: "nba", name: "NBA", status: "active" },
  { slug: "mlb", name: "MLB", status: "paused" },
  // NFL is "soon" and not in the SportSlug union, so kept out of this list.
];

export function getActiveSport(): SportNavItem {
  const active = SPORTS.find((s) => s.status === "active");
  if (active) return active;
  // Fallback: if every sport is paused, show the first paused one rather
  // than crash. The board will likely render empty.
  const fallback = SPORTS[0];
  if (!fallback) {
    // SPORTS is a const array with at least one entry — but guard for the
    // type-checker since `find`/index access return `T | undefined`.
    throw new Error("active-sport: SPORTS list is empty");
  }
  return fallback;
}
