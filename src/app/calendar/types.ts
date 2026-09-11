/**
 * Shared shapes for /calendar.
 *
 * The page is a statically generated file (see page.tsx), so the raw snapshot
 * rows are serialized into the RSC payload and every viewer-dependent decision
 * — election geofencing, filters, month/day selection — happens in the client
 * component. These types are the contract across that boundary, which is why
 * the row shapes are declared by hand instead of inferred from the Supabase
 * client: they have to survive JSON.
 */

export type EventKind =
  | "municipal"
  | "alert"
  | "bill_action"
  | "state_session"
  | "election"
  | "townhall"
  | "bill_effective"
  | "bill_sunset"
  | "local_vote";

export type CalendarEvent = {
  kind: EventKind;
  date: Date;
  end_date?: Date | null;
  allDay?: boolean;
  scope?: string | null;
  title: string;
  body?: string | null;
  state: string | null;
  locality?: string | null;
  zoom_url?: string | null;
  livestream_url?: string | null;
  agenda_url?: string | null;
  public_comment_url?: string | null;
  in_person_address?: string | null;
  source_url?: string | null;
  detail_href?: string | null; // primary internal link (this event's own page)
  bill_href?: string | null; // secondary cross-link to the related bill
  severity?: string | null;
};

export const KIND_BADGE: Record<string, { emoji: string; label: string; cls: string }> = {
  municipal: { emoji: "🏛️", label: "City/county", cls: "bg-amber-950/30 text-amber-300 border-amber-700/40" },
  alert: { emoji: "🚨", label: "Policy alert", cls: "bg-red-950/30 text-red-300 border-red-700/40" },
  bill_action: { emoji: "📜", label: "Bill action", cls: "bg-blue-950/30 text-blue-300 border-blue-700/40" },
  state_session: { emoji: "🏛️", label: "State session", cls: "bg-emerald-950/30 text-emerald-300 border-emerald-700/40" },
  election: { emoji: "🗳️", label: "Election", cls: "bg-violet-950/30 text-violet-300 border-violet-700/40" },
  townhall: { emoji: "🎤", label: "Town hall", cls: "bg-teal-950/30 text-teal-300 border-teal-700/40" },
  bill_effective: { emoji: "⚖️", label: "Takes effect", cls: "bg-rose-950/30 text-rose-300 border-rose-700/40" },
  bill_sunset: { emoji: "⏳", label: "Expires", cls: "bg-orange-950/30 text-orange-300 border-orange-700/40" },
  local_vote: { emoji: "🗳️", label: "Local vote", cls: "bg-cyan-950/30 text-cyan-300 border-cyan-700/40" },
};

// Eastern calendar day for an instant (NOT UTC). A 9pm-ET event must land on the
// right day for US users — see memory civic-dates-anchor-eastern.
export const etYmd = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" }); // YYYY-MM-DD

export type MkHrefOpts = {
  view?: "list" | "month" | null;
  kind?: string | null;
  state?: string | null;
  month?: string | null;
  day?: string | null;
};
export type MkHref = (o?: MkHrefOpts) => string;

/* ── Raw snapshot rows (public data, identical for every viewer) ─────────── */

export type MeetingRow = {
  id: string;
  state: string | null;
  locality: string | null;
  body_name: string | null;
  meeting_at: string;
  format: string | null;
  zoom_url: string | null;
  livestream_url: string | null;
  agenda_url: string | null;
  agenda_text: string | null;
  in_person_address: string | null;
  public_comment_signup_url: string | null;
  source_url: string | null;
};

export type AlertRow = {
  id: string;
  kind: string | null;
  severity: string | null;
  title: string;
  body: string | null;
  locality: string | null;
  source_url: string | null;
  occurs_at: string | null;
  bill_id: string | null;
};

export type BillActionRow = {
  id: string;
  state: string | null;
  bill_number: string | null;
  title: string | null;
  last_action: string | null;
  last_action_at: string | null;
  kratom_relevance: string | null;
  status: string | null;
};

export type SessionRow = {
  state: string;
  current_session_id: string | null;
  current_session_start: string | null;
  current_session_end: string | null;
  capital_city: string | null;
  legislature_url: string | null;
  hearing_schedule_url: string | null;
};

export type ElectionRow = {
  scope: string | null;
  state: string | null;
  locality: string | null;
  election_type: string | null;
  title: string;
  election_date: string;
  registration_deadline: string | null;
  source_url: string | null;
};

export type TownhallRow = {
  id: string;
  state: string | null;
  locality: string | null;
  title: string;
  description: string | null;
  event_type: string;
  starts_at: string;
  venue: string | null;
  source_url: string | null;
  legislator_id: string | null;
};

export type BillDateRow = {
  id: string;
  state: string | null;
  bill_number: string | null;
  title: string | null;
  effective_date?: string | null;
  sunset_date?: string | null;
  kratom_relevance: string | null;
};

export type LocalVoteRow = {
  id: string;
  state: string | null;
  locality: string | null;
  vote_date: string;
  outcome: string | null;
  measure: string | null;
  source_url: string | null;
  policy_alert_id: string | null;
};

export type CalendarSnapshot = {
  meetings: MeetingRow[];
  alerts: AlertRow[];
  billActions: BillActionRow[];
  sessions: SessionRow[];
  elections: ElectionRow[];
  townhalls: TownhallRow[];
  billsEffective: BillDateRow[];
  billsSunset: BillDateRow[];
  localVotes: LocalVoteRow[];
};
