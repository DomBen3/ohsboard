import { notFound } from "next/navigation";
import { SportBoard, SportPaused } from "@/components/sport-board";
import { SPORTS } from "@/lib/active-sport";

export const dynamic = "force-dynamic";

interface SportPageProps {
  params: Promise<{ sport: string }>;
}

export default async function SportPage({ params }: SportPageProps) {
  const { sport: slug } = await params;
  const item = SPORTS.find((s) => s.slug === slug);
  if (!item) notFound();
  if (item.status === "paused") return <SportPaused sport={item} />;
  return <SportBoard sport={item} />;
}
