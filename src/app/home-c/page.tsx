import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export const metadata = { title: "iKratom — Take action now" };
export const dynamic = "force-dynamic";

/**
 * HOME PAGE DRAFT C — "ACTION-FIRST" direction.
 *
 * Voice: skip the explanation, put live actions on screen the moment
 * the visitor lands. Trust that they know why they're here. Pitch
 * happens after they've seen something concrete to do.
 *
 * Strengths: best for converting search-traffic — someone googling
 * "kratom ban my state" lands and is doing something within 5
 * seconds.
 * Risks: assumes the visitor knows the basics. Less educational for
 * truly new audiences.
 */
export default async function HomeC() {
  const supabase = await createClient();

  // Get the most urgent campaigns with their bill context for triage
  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id, slug, title, blurb, state, target_locality, bill_id, mobilization_type, created_at")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(8);

  const billIds = Array.from(
    new Set((campaigns ?? []).map((c) => c.bill_id).filter(Boolean) as string[]),
  );
  const billStanceById = new Map<string, string>();
  if (billIds.length > 0) {
    const { data: bills } = await supabase
      .from("bills")
      .select("id, kratom_relevance, status")
      .in("id", billIds);
    for (const b of bills ?? []) {
      billStanceById.set((b as { id: string }).id, (b as { kratom_relevance: string | null }).kratom_relevance ?? "");
    }
  }

  const ids = (campaigns ?? []).map((c) => c.id);
  const counts: Record<string, number> = {};
  if (ids.length > 0) {
    const { data: actionRows } = await supabase
      .from("campaign_actions").select("campaign_id").in("campaign_id", ids);
    for (const r of actionRows ?? []) counts[r.campaign_id] = (counts[r.campaign_id] ?? 0) + 1;
  }

  // Severity from linked alerts
  const sevByCampaign: Record<string, string> = {};
  if (ids.length > 0) {
    const { data: alerts } = await supabase
      .from("policy_alerts").select("campaign_id, severity")
      .in("campaign_id", ids).eq("moderation_status", "approved");
    for (const a of alerts ?? []) {
      const cid = (a as { campaign_id: string }).campaign_id;
      const sev = (a as { severity: string }).severity;
      sevByCampaign[cid] = sev;
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Skinny hero — get out of the way fast */}
      <section className="border-b border-zinc-800 pb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          ◉ Live policy feed · {(campaigns?.length ?? 0)} active actions
        </p>
        <h1 className="mt-3 text-3xl font-bold leading-tight sm:text-4xl">
          Pick one.<br/>
          <span className="text-zinc-400">Send it in two minutes.</span>
        </h1>
      </section>

      {/* The actual campaigns — front and center, not buried */}
      <section className="mt-6">
        {(campaigns?.length ?? 0) === 0 ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-10 text-center">
            <p className="text-3xl">📭</p>
            <p className="mt-3 text-sm text-zinc-400">
              No active campaigns right now — that&apos;s the goal, actually. The
              site stays quiet when nothing&apos;s happening; it lights up the
              moment something does.
            </p>
            <Link
              href="/signup"
              className="mt-5 inline-block rounded-md bg-emerald-500 px-5 py-2.5 font-semibold text-zinc-950 hover:bg-emerald-400"
            >
              Get notified when something hits →
            </Link>
          </div>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {(campaigns ?? []).map((c) => {
              const sev = sevByCampaign[c.id];
              const stance = c.bill_id ? billStanceById.get(c.bill_id) : null;
              const acts = counts[c.id] ?? 0;
              return (
                <li key={c.id}>
                  <Link
                    href={`/campaigns/${c.slug}`}
                    className={`block h-full rounded-lg border p-5 transition ${
                      sev === "critical"
                        ? "border-red-700/50 bg-red-950/15 hover:border-red-500"
                        : sev === "alert"
                        ? "border-amber-700/40 bg-amber-950/10 hover:border-amber-500"
                        : "border-zinc-800 bg-zinc-950/40 hover:border-emerald-500"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      {c.state && (
                        <span className="rounded bg-zinc-900 px-2 py-0.5 text-xs font-bold text-zinc-200">
                          {c.state}
                        </span>
                      )}
                      {!c.state && (
                        <span className="rounded bg-purple-950/40 px-2 py-0.5 text-xs font-bold text-purple-300">
                          Federal
                        </span>
                      )}
                      {stance === "anti" && (
                        <span className="rounded bg-red-950/40 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-300">
                          🚫 Restrictive
                        </span>
                      )}
                      {stance === "pro" && (
                        <span className="rounded bg-emerald-950/40 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-300">
                          ✅ Supportive
                        </span>
                      )}
                      {sev === "critical" && (
                        <span className="rounded bg-red-500 px-1.5 py-0.5 text-[10px] font-bold uppercase text-zinc-950 animate-pulse">
                          critical
                        </span>
                      )}
                      {acts > 0 && (
                        <span className="ml-auto text-[11px] text-zinc-500">
                          {acts.toLocaleString()} sent
                        </span>
                      )}
                    </div>
                    <h2 className="mt-3 font-semibold leading-snug">{c.title}</h2>
                    {c.blurb && (
                      <p className="mt-1 line-clamp-2 text-sm text-zinc-400">{c.blurb}</p>
                    )}
                    {c.target_locality && (
                      <p className="mt-2 text-[11px] text-zinc-500">📍 {c.target_locality}</p>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-6 text-center">
          <Link href="/campaigns" className="text-sm text-emerald-400 hover:underline">
            See all campaigns →
          </Link>
        </div>
      </section>

      {/* Tiny pitch at the bottom — only seen if user scrolls past actions */}
      <section className="mt-16 rounded-lg border border-zinc-800 bg-zinc-950/40 p-6">
        <h2 className="text-lg font-bold">What is this, exactly?</h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-300">
          A nonpartisan war room for kratom advocacy. Free forever. Every campaign
          above is a real bill or ordinance — we wrote the letters, found your reps,
          built the one-click flow. You sign in, we prefill your info, you read,
          edit, and send from your real address.
        </p>
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          <Link href="/signup" className="rounded-md bg-emerald-500 px-4 py-2 font-semibold text-zinc-950 hover:bg-emerald-400">
            Sign up free →
          </Link>
          <Link href="/how-it-works" className="rounded-md border border-zinc-700 px-4 py-2 hover:border-emerald-500">
            How it works
          </Link>
          <Link href="/pulse" className="rounded-md border border-zinc-700 px-4 py-2 hover:border-emerald-500">
            Live policy feed
          </Link>
          <Link href="/communities" className="rounded-md border border-zinc-700 px-4 py-2 hover:border-emerald-500">
            Community
          </Link>
        </div>
      </section>
    </div>
  );
}
