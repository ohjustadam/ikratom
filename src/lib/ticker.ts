/**
 * The site-wide intel ticker's content (owner ask 2026-10-21: "highlight pieces
 * of intel... a message scrolling across the screen like the news reel at the
 * bottom of the news channels"). Pure, so tests pin the ordering and filters;
 * /api/ticker supplies the rows and IntelTicker renders the crawl.
 *
 * Order is by what a visitor should act on first: breaking (critical) alerts,
 * then fresh campaigns ("take action" is how people start using the service),
 * then upcoming meetings, then other alerts. Off-topic headlines (news
 * roundups that merely mention kratom in a list) are dropped, and an alert that
 * spawned a campaign shows once, as the action.
 */

export type TickerItem = {
  kind: "breaking" | "action" | "meeting" | "alert";
  label: string;
  text: string;
  href: string;
};

type CampaignRow = { slug: string; title: string; state: string | null; created_at: string };
type AlertRow = { id: string; title: string; locality: string | null; severity: string; created_at: string };
type MeetingRow = { id: string; locality: string | null; state: string | null; body_name: string | null; meeting_at: string };

export const TICKER_LIMITS = { campaignDays: 14, alertDays: 10, meetingDays: 21, max: 14 } as const;

const ON_TOPIC = /kratom|7-?oh\b|7-hydroxy|mitragyn/i;
const DAY = 86_400_000;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const place = (loc: string | null | undefined) => (!loc || loc === "FED" || loc === "ALL" ? "Federal" : loc);
const clip = (s: string, n = 110) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function buildTicker(
  rows: { campaigns: CampaignRow[]; alerts: AlertRow[]; meetings: MeetingRow[] },
  now = Date.now(),
): TickerItem[] {
  const seen = new Set<string>();
  const once = (title: string) => {
    const k = norm(title);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  };

  const actions: TickerItem[] = [];
  for (const c of rows.campaigns) {
    if (now - Date.parse(c.created_at) > TICKER_LIMITS.campaignDays * DAY || !once(c.title)) continue;
    actions.push({ kind: "action", label: "Take action", text: `${place(c.state)}: ${clip(c.title)}`, href: `/campaigns/${c.slug}` });
  }

  const breaking: TickerItem[] = [];
  const alerts: TickerItem[] = [];
  for (const a of rows.alerts) {
    if (now - Date.parse(a.created_at) > TICKER_LIMITS.alertDays * DAY || !ON_TOPIC.test(a.title) || !once(a.title)) continue;
    const item = { text: `${place(a.locality)}: ${clip(a.title)}`, href: `/alerts/${a.id}` };
    if (a.severity === "critical") breaking.push({ kind: "breaking", label: "Breaking", ...item });
    else alerts.push({ kind: "alert", label: "Alert", ...item });
  }

  const meetings: TickerItem[] = [];
  for (const m of rows.meetings) {
    const at = Date.parse(m.meeting_at);
    if (at < now || at - now > TICKER_LIMITS.meetingDays * DAY) continue;
    const day = new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
    meetings.push({ kind: "meeting", label: "Upcoming", text: `${day} · ${place(m.locality ?? m.state)}: ${clip(m.body_name || "public meeting on kratom", 70)}`, href: `/meetings/${m.id}` });
  }

  return [...breaking, ...actions, ...meetings, ...alerts].slice(0, TICKER_LIMITS.max);
}
