import { redirect } from "next/navigation";

// /events folded into the one Community Calendar (/calendar) — owner decision
// 2026-06-12. /calendar is a superset (town halls + hearings via
// legislator_events, plus elections, bills, sessions, meetings). This redirect
// keeps every old /events link + the admin create-event flow working.
export const dynamic = "force-dynamic";

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const sp = await searchParams;
  const state = sp?.state ? String(sp.state).toUpperCase() : "";
  redirect(`/calendar${/^[A-Z]{2}$/.test(state) ? `?state=${state}` : ""}`);
}
