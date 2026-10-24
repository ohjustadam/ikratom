import { createClient } from "@/lib/supabase/server";

/**
 * The officials-turnover items no single source could settle (migration 0277):
 * seats whose listed incumbent disagrees with our roster, and chambers whose
 * seat list or handover day could not be proven. The jobs never guess; these
 * are the leftovers, each with the reason it stopped.
 */
export async function TurnoverReview() {
  const sb = await createClient();
  const [seatsRes, calRes] = await Promise.all([
    sb.from("seat_elections").select("id, state, office, district, incumbent_name, review_reason, election_date")
      .eq("status", "needs_review").order("state").limit(100),
    sb.from("term_calendar").select("state, office, cycle_year, seats_up, seat_list_status, new_term_starts, rule_evidence")
      .gt("seats_up", 0).or("seat_list_status.eq.unverified,new_term_starts.is.null").order("state").limit(100),
  ]);
  const seats = seatsRes.data ?? [];
  const chambers = calRes.data ?? [];
  if (seats.length === 0 && chambers.length === 0) return null;

  return (
    <section className="mb-8 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Officials turnover: needs a second source</h2>
      <p className="mt-1 text-[11px] text-zinc-500">
        From the seat watch (scripts/sync-seat-watch.mjs). Nothing here was guessed or applied.
      </p>
      {seats.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-zinc-300">
          {seats.map((s) => (
            <li key={s.id}>
              <span className="font-mono text-zinc-400">{s.state} {s.office} {s.district}</span> · {s.incumbent_name}: {s.review_reason}
            </li>
          ))}
        </ul>
      )}
      {chambers.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-zinc-400">
          {chambers.map((c) => (
            <li key={`${c.state}-${c.office}-${c.cycle_year}`}>
              <span className="font-mono">{c.state} {c.office}</span> · {c.seats_up} seats up ·{" "}
              {c.seat_list_status === "unverified" ? "seat list unverified" : "seat list ok"} ·{" "}
              {c.new_term_starts ? `takes office ${c.new_term_starts}` : `handover day unproven (${c.rule_evidence})`}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
