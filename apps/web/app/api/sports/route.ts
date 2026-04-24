import { db } from "@/lib/db";
import { sports } from "@ohsboard/db";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db.select().from(sports).orderBy(sports.id);
  return NextResponse.json({ sports: rows });
}
