// Re-export shim. Implementation moved to ./schedule/mlb-statsapi.ts as part
// of the per-sport schedule dispatcher (PRD §7). Kept here so anything that
// imports from "./statsapi" keeps working; new code should import from
// "./schedule" directly.
export {
  fetchExpectedMlbGames,
  matchExpectedGame,
  type ExpectedGame,
} from "./schedule/mlb-statsapi";
