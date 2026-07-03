// Shared types for the in-admin "Auto-resolve queue" feature. Kept out of the
// "use server" actions file so the client panel can import them (a "use server"
// module may only export async functions).

export type QueueKind = "campaigns" | "intel";

/** keep = leave the item untouched in the queue. */
export type ProposedAction = "approve" | "reject" | "supersede" | "keep";

export type PlanItem = {
  id: string;
  title: string;
  subtitle: string; // e.g. "FL · duplicate" or "MI · bill enacted"
  action: ProposedAction; // the AI/heuristic proposal (admin can override)
  reason: string;
  confidence: "high" | "medium" | "low";
  source: "duplicate" | "bill-status" | "ai" | "cap"; // how the proposal was reached
};

export type AnalyzeResult = { ok: true; items: PlanItem[] } | { ok: false; error: string };

export type Decision = { id: string; action: ProposedAction; reason?: string };

export type ApplyResult =
  | { ok: true; approved: number; rejected: number; superseded: number }
  | { ok: false; error: string };
