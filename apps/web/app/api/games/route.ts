import { getActiveSport } from "@/lib/active-sport";
import { loadGames } from "@/lib/games";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const active = getActiveSport();
  const games = await loadGames(active.slug);
  return NextResponse.json({ sport: active.slug, games });
}
