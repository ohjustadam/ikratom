import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

type BillAction = {
  id: string;
  bill_id: string;
  action_date: string;
  description: string;
  chamber: string | null;
  source: string;
};

const STAGES = [
  { key: "introduced", label: "Introduced", icon: "📥" },
  { key: "in_committee", label: "In Committee", icon: "🏛️" },
  { key: "passed_chamber", label: "Passed Chamber", icon: "✓" },
  { key: "enacted", label: "Enacted", icon: "📜" },
  { key: "vetoed", label: "Vetoed", icon: "🚫" },
  { key: "dead", label: "Dead", icon: "⚰️" },
] as const;

/**
 * Per-bill timeline showing the bill's journey through the legislative
 * process: introduction → committee → vote → enactment/death.
 *
 * Mission lever: lobbyists know the planned hearing/vote calendar
 * weeks ahead. Advocates often find out after the vote. This timeline
 * surfaces both:
 *   1. What's happened so far (bill_actions history)
 *   2. The current stage (status) with visible progress bar
 *   3. Days-elapsed-in-current-stage (urgency signal)
 *
 * Renders as a vertical timeline with each bill_action as a node.
 */
export async function BillTimeline({
  billId,
  currentStatus,
}: {
  billId: string;
  currentStatus: string | null;
}) {
  const sb = await createClient();
  const { data: actions } = await sb
    .from("bill_actions")
    .select("id, bill_id, action_date, description, chamber, source")
    .eq("bill_id", billId)
    .order("action_date", { ascending: true })
    .limit(50);

  const rows = (actions ?? []) as BillAction[];
  if (rows.length === 0) return null;

  // Normalize current status to stage key
  const statusToStage: Record<string, string> = {
    introduced: "introduced",
    in_committee: "in_committee",
    committee: "in_committee",
    passed_chamber: "passed_chamber",
    passed: "passed_chamber",
    enacted: "enacted",
    signed: "enacted",
    vetoed: "vetoed",
    dead: "dead",
    failed: "dead",
  };
  const currentStageKey = currentStatus ? (statusToStage[currentStatus.toLowerCase()] ?? null) : null;
  const currentStageIdx = STAGES.findIndex((s) => s.key === currentStageKey);

  // Compute days since last action
  const lastAction = rows[rows.length - 1];
  const daysSinceLast = lastAction
    ? Math.floor((Date.now() - new Date(lastAction.action_date).getTime()) / 86_400_000)
    : null;

  return (
    <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-300">
          📅 Bill timeline
        </h2>
        {daysSinceLast !== null && (
          <span className={`text-xs ${
            daysSinceLast < 7 ? "text-emerald-400"
              : daysSinceLast < 30 ? "text-amber-400"
              : "text-zinc-500"
          }`}>
            {daysSinceLast === 0
              ? "Action today"
              : daysSinceLast === 1
              ? "Action yesterday"
              : `${daysSinceLast} days since last action`}
          </span>
        )}
      </div>

      {/* Stage tracker — visible progress bar */}
      <div className="mt-4">
        <div className="flex items-center gap-1">
          {STAGES.filter((s) => s.key !== "vetoed" && s.key !== "dead").map((stage, idx) => {
            const reached = currentStageIdx !== -1 && idx <= currentStageIdx;
            const current = idx === currentStageIdx;
            return (
              <div key={stage.key} className="flex flex-1 flex-col items-center">
                <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm transition ${
                  current ? "bg-emerald-500 text-zinc-950 ring-2 ring-emerald-300 ring-offset-2 ring-offset-zinc-950 animate-pulse"
                    : reached ? "bg-emerald-700 text-zinc-100"
                    : "bg-zinc-800 text-zinc-500"
                }`}>
                  {stage.icon}
                </div>
                <span className={`mt-1 text-[10px] font-semibold uppercase tracking-wider ${
                  current ? "text-emerald-300"
                    : reached ? "text-zinc-300"
                    : "text-zinc-600"
                }`}>
                  {stage.label}
                </span>
              </div>
            );
          })}
          {/* Death-end marker */}
          {(currentStageKey === "vetoed" || currentStageKey === "dead") && (
            <div className="flex flex-col items-center">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-700 text-sm text-zinc-100">
                {currentStageKey === "vetoed" ? "🚫" : "⚰️"}
              </div>
              <span className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-red-300">
                {currentStageKey === "vetoed" ? "Vetoed" : "Dead"}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Action history — vertical timeline */}
      <details className="mt-6 group">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-zinc-400 hover:text-emerald-400">
          Full history ({rows.length} action{rows.length === 1 ? "" : "s"}) ▾
        </summary>
        <ol className="mt-3 space-y-2 border-l-2 border-zinc-800 pl-4">
          {rows.slice().reverse().map((a) => {
            const d = new Date(a.action_date);
            const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
            return (
              <li key={a.id} className="relative -ml-[19px] pl-5">
                <span className="absolute left-0 top-1.5 h-3 w-3 rounded-full border-2 border-zinc-700 bg-zinc-950" />
                <p className="text-xs text-zinc-100">{a.description}</p>
                <p className="text-[10px] text-zinc-500">
                  {d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                  {" · "}{days === 0 ? "today" : days === 1 ? "yesterday" : `${days}d ago`}
                  {a.chamber && <> · {a.chamber}</>}
                  {" · "}{a.source}
                </p>
              </li>
            );
          })}
        </ol>
      </details>

      {/* Action-required prompt */}
      {currentStageKey && currentStageKey !== "enacted" && currentStageKey !== "vetoed" && currentStageKey !== "dead" && (
        <div className="mt-4 rounded border border-emerald-700/40 bg-emerald-950/15 p-3">
          <p className="text-xs font-semibold text-emerald-300">
            ⏰ This bill is still moving. Your voice matters NOW, not after.
          </p>
          <p className="mt-1 text-[11px] text-zinc-300">
            Lobbyists already know the next hearing date and have letters drafted.
            One-click your own:
            {" "}<Link href={`#draft-response`} className="font-semibold text-emerald-400 hover:underline">
              ✍ Draft response →
            </Link>
          </p>
        </div>
      )}
    </section>
  );
}
