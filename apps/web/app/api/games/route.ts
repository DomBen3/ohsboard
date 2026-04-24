import { loadMlbGames } from "@/lib/games";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const games = await loadMlbGames();
  return NextResponse.json({ games });
}
