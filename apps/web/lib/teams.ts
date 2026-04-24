// Thin web-side re-export of the canonical MLB team reference. The data
// itself lives in @ohsboard/types so the worker uses the same lookup.

export {
  findMlbTeam as findTeam,
  findMlbTeamByAbbrev as findTeamByAbbrev,
  findMlbTeamById as findTeamById,
  MLB_TEAMS,
  type MlbTeam,
} from "@ohsboard/types";

import type { MlbTeam } from "@ohsboard/types";

export function teamLogoPath(team: MlbTeam): string {
  return `/teams/mlb/${team.abbreviation}.svg`;
}
