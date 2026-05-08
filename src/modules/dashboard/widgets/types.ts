/**
 * Widget catalog. Adding a new widget = adding an entry here + writing
 * its server component. The cockpit shell renders whichever widgets the
 * user has visible, in their saved order; unknown ids are skipped
 * (forward-compatible across deploys).
 *
 * Order in this file is the DEFAULT for new users. Once a user
 * customizes, their `user_dashboard_layouts.widgets` overrides this.
 */

export type WidgetId =
  | "briefing"
  | "streak"
  | "my_reps"
  | "profile_completion"
  | "active_campaigns"
  | "rep_coverage"
  | "scoreboard"
  | "my_battles"
  | "saved_searches";

export type WidgetSlot = {
  id: WidgetId;
  visible: boolean;
};

/**
 * Default catalog: order + initial visibility. Briefing pinned first
 * because it's the at-a-glance "what needs me right now" surface.
 * Order reflects priority: status → personal proof → action → social →
 * monitoring tools.
 */
export const DEFAULT_WIDGETS: WidgetSlot[] = [
  { id: "briefing", visible: true },
  { id: "profile_completion", visible: true },
  { id: "rep_coverage", visible: true },
  { id: "scoreboard", visible: true },
  { id: "active_campaigns", visible: true },
  { id: "my_battles", visible: true },
  { id: "my_reps", visible: true },
  { id: "saved_searches", visible: true },
  { id: "streak", visible: false }, // hidden by default — scoreboard supersedes
];

/**
 * Widget metadata for the customize panel — title + 1-line description
 * shown when the user is configuring their layout.
 */
export const WIDGET_META: Record<WidgetId, { title: string; description: string }> = {
  briefing: {
    title: "Today's briefing",
    description: "At-a-glance: hostile bills, upcoming waves, unread alerts.",
  },
  streak: {
    title: "Action streak",
    description: "Your current + longest streak of days with at least one action sent.",
  },
  my_reps: {
    title: "My reps",
    description: "Your federal + state legislators, with one-click email/call.",
  },
  profile_completion: {
    title: "Profile completion",
    description: "Banner urging you to fill in address details (only shows when incomplete).",
  },
  active_campaigns: {
    title: "Active campaigns",
    description: "Live campaigns matching your state + federal scope.",
  },
  rep_coverage: {
    title: "Local rep coverage",
    description: "Request iKratom add your city/county officials when they're missing.",
  },
  scoreboard: {
    title: "Personal scoreboard",
    description: "Emails sent, calls made, current + longest streak.",
  },
  my_battles: {
    title: "My battles",
    description: "Bills you've taken action on, with current status (committee → vote → enacted/dead).",
  },
  saved_searches: {
    title: "Saved searches",
    description: "Custom alerts: get notified when a new bill matches your criteria.",
  },
};

/**
 * Reconcile a stored layout (which might be empty, partial, or contain
 * stale ids) with the current default catalog. Always returns the full
 * widget set in some order, with stored visibility honored where
 * present and unknown ids dropped.
 */
export function reconcileLayout(stored: unknown): WidgetSlot[] {
  if (!Array.isArray(stored)) return DEFAULT_WIDGETS;
  const validIds = new Set<WidgetId>(DEFAULT_WIDGETS.map((w) => w.id));
  const seen = new Set<WidgetId>();
  const out: WidgetSlot[] = [];

  for (const item of stored) {
    if (typeof item !== "object" || item === null) continue;
    const id = (item as { id?: unknown }).id;
    if (typeof id !== "string" || !validIds.has(id as WidgetId)) continue;
    if (seen.has(id as WidgetId)) continue;
    seen.add(id as WidgetId);
    const visible = (item as { visible?: unknown }).visible !== false;
    out.push({ id: id as WidgetId, visible });
  }

  // Append any DEFAULT widgets not present (newly-added widgets after a deploy)
  for (const def of DEFAULT_WIDGETS) {
    if (!seen.has(def.id)) out.push(def);
  }

  return out;
}
