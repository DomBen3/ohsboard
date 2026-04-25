import { SportBoard } from "@/components/sport-board";
import { getActiveSport } from "@/lib/active-sport";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const active = getActiveSport();
  return <SportBoard sport={active} />;
}
