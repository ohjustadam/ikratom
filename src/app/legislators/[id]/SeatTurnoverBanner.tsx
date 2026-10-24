import { seatBanner, todayEastern, type SeatElection } from "@/lib/seat-turnover";

const TONE: Record<string, string> = {
  ballot: "border-sky-800/60 bg-sky-950/30 text-sky-200",
  leaving: "border-amber-800/60 bg-amber-950/30 text-amber-200",
  reelected: "border-zinc-700 bg-zinc-900/60 text-zinc-200",
};

/** "On the ballot" / "Leaving office on <date>" — from the seat_elections ledger. */
export function SeatTurnoverBanner({ seat, name }: { seat: SeatElection | null; name: string }) {
  const b = seatBanner(seat, name, todayEastern());
  if (!b) return null;
  return (
    <div role="status" className={`mb-6 rounded-lg border px-4 py-3 ${TONE[b.tone]}`}>
      <p className="text-sm font-semibold">{b.tone === "leaving" ? "⏳ " : "🗳 "}{b.title}</p>
      <p className="mt-0.5 text-xs opacity-80">{b.detail}</p>
    </div>
  );
}
