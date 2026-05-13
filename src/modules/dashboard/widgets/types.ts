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
  | "saved_searches"
  | "activity_radar"
  | "policy_pulse"
  | "badges"
  | "whats_new"
  | "welcome_explore"
  | "bop_watch"
  | "invite";

/**
 * One-click layout presets — apply via CockpitCustomizer's Preset row.
 * Each preset is a curated DEFAULT_WIDGETS variation that emphasizes a
 * particular use mode.
 */
export type PresetId = "strike" | "intel" | "lounge";

export type WidgetSlot = {
  id: WidgetId;
  visible: boolean;
};

/**
 * Default catalog: order + initial visibility. whats_new pinned first
 * (only renders when there's content). Briefing second — at-a-glance
 * "what needs me right now." Order reflects priority: announcements →
 * status → personal proof → action → social → monitoring.
 */
// Reorganized per ROADMAP.md audit (2026-05-12) into priority bands.
//
//   P0 (top — blockers + actions)
//     profile_completion gates the one-click experience; renders FIRST when firing
//     whats_new auto-hides when empty
//     briefing is the at-a-glance status
//     active_campaigns is THE primary CTA — moved up from old slot 7
//     my_battles closes the loop on prior action
//
//   P1 (mid — personal radar)
//     my_reps + rep_coverage = the action target
//     saved_searches + activity_radar = signal tracking
//     bop_watch = early warning
//
//   P2 (bottom — identity, growth, utility)
//     scoreboard / badges / streak = self-stats
//     invite = growth
//     welcome_explore = first-time discovery (auto-hides once used)
export const DEFAULT_WIDGETS: WidgetSlot[] = [
  // P0 — blockers + primary action
  { id: "profile_completion", visible: true },
  { id: "whats_new", visible: true },
  { id: "briefing", visible: true },
  { id: "active_campaigns", visible: true },
  { id: "my_battles", visible: true },
  // P1 — personal radar
  { id: "my_reps", visible: true },
  { id: "rep_coverage", visible: true },
  { id: "saved_searches", visible: true },
  { id: "policy_pulse", visible: true },
  { id: "activity_radar", visible: true },
  { id: "bop_watch", visible: true },
  // P2 — identity, growth, utility
  { id: "scoreboard", visible: true },
  { id: "badges", visible: true },
  { id: "invite", visible: true },
  { id: "welcome_explore", visible: true },
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
  activity_radar: {
    title: "Activity radar",
    description: "Real-time platform activity — recent threads, campaigns, advocate actions.",
  },
  policy_pulse: {
    title: "Live policy pulse",
    description: "Last-24h policy events: live broadcasts, critical alerts, new meetings, bill actions. Your state highlighted.",
  },
  badges: {
    title: "Mission patches",
    description: "Earned badges from your platform activity.",
  },
  whats_new: {
    title: "What's new",
    description: "Platform updates and announcements from the team.",
  },
  welcome_explore: {
    title: "Welcome / Explore",
    description: "First-time tour cards for Community, DMs, and Campaigns. Hides itself once you've used any of those.",
  },
  bop_watch: {
    title: "BoP Watch",
    description: "Daily monitoring of every state Board of Pharmacy for kratom rulemaking — the administrative path to a ban.",
  },
  invite: {
    title: "Invite friends",
    description: "Your personal /i/CODE share link + funnel counts. Full hub at /account/invite.",
  },
};

/**
 * Preset definitions. Strike = action-heavy. Intel = info-heavy.
 * Lounge = social/light.
 */
export const PRESETS: Record<PresetId, { label: string; description: string; widgets: WidgetSlot[] }> = {
  strike: {
    label: "Strike Mode",
    description: "Action-heavy — briefing, battles, campaigns, reps front-and-center.",
    widgets: [
      { id: "whats_new", visible: true },
      { id: "briefing", visible: true },
      { id: "profile_completion", visible: true },
      { id: "rep_coverage", visible: true },
      { id: "active_campaigns", visible: true },
      { id: "my_battles", visible: true },
      { id: "my_reps", visible: true },
      { id: "scoreboard", visible: true },
      { id: "badges", visible: true },
      { id: "saved_searches", visible: false },
      { id: "activity_radar", visible: false },
      { id: "bop_watch", visible: false },
      { id: "invite", visible: false },
      { id: "streak", visible: false },
    ],
  },
  intel: {
    label: "Intel Mode",
    description: "Info-heavy — briefing, radar, monitors. For tracking the field.",
    widgets: [
      { id: "whats_new", visible: true },
      { id: "briefing", visible: true },
      { id: "activity_radar", visible: true },
      { id: "bop_watch", visible: true },
      { id: "saved_searches", visible: true },
      { id: "active_campaigns", visible: true },
      { id: "profile_completion", visible: true },
      { id: "rep_coverage", visible: true },
      { id: "my_battles", visible: false },
      { id: "my_reps", visible: false },
      { id: "scoreboard", visible: false },
      { id: "badges", visible: false },
      { id: "streak", visible: false },
    ],
  },
  lounge: {
    label: "Lounge Mode",
    description: "Light + social. Radar at top, scoreboard, less of a war-room feel.",
    widgets: [
      { id: "whats_new", visible: true },
      { id: "activity_radar", visible: true },
      { id: "scoreboard", visible: true },
      { id: "badges", visible: true },
      { id: "saved_searches", visible: true },
      { id: "active_campaigns", visible: true },
      { id: "briefing", visible: false },
      { id: "my_battles", visible: false },
      { id: "my_reps", visible: false },
      { id: "rep_coverage", visible: false },
      { id: "profile_completion", visible: true },
      { id: "bop_watch", visible: false },
      { id: "invite", visible: false },
      { id: "streak", visible: false },
    ],
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
