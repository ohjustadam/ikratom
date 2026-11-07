import { companionMovedOn } from "@/lib/bill-status";

/** Says plainly that a bill's session is over, from the synced session flag. */
export function SessionEndedNotice({ state, lastAction }: { state: string; lastAction: string | null }) {
  const body = state === "US" ? "Congress" : "The legislature";
  return (
    <div className="mb-6 rounded-lg border border-amber-700/50 bg-amber-950/20 p-4 text-sm">
      <p className="font-semibold text-amber-300">Session ended</p>
      <p className="mt-1 text-amber-200/80">
        {companionMovedOn(lastAction)
          ? `${body} adjourned without passing this bill. A companion bill moved ahead in its place, so check that one before you write to anyone.`
          : `${body} adjourned without passing this bill, so it won't move again unless a later session picks it up. Before you write to anyone, check for a newer bill.`}
      </p>
    </div>
  );
}
