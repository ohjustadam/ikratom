import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import BriefAudioButton from "@/app/brief/BriefAudioButton";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "California kratom war room — AB 1088 / AB 2365 action plan · iKratom",
  description:
    "California is moving to restrict kratom and 7-OH. AB 1088 (the ban) hits the Senate Health Committee June 17. Here's the situation, the science, and exactly how to fight — oppose AB 1088, support AB 2365.",
};

/**
 * /california — curated WAR-ROOM action page for the active CA fight.
 * Complements (does not duplicate) the full /states/CA data hub: this page
 * is opinionated — situation briefing + the AB1088-oppose / AB2365-support
 * action plan + browser-native audio playback. Bill/news data is live.
 */
export default async function CaliforniaPage() {
  const supabase = await createClient();
  const [billsRes, campaignRes, newsRes, banRes] = await Promise.all([
    supabase
      .from("bills")
      .select("id, bill_number, title, status, kratom_relevance")
      .eq("state", "CA")
      .in("bill_number", ["AB 1088", "AB 2365"]),
    supabase.from("campaigns").select("slug, active").eq("slug", "stop-ca-ab1088").maybeSingle(),
    supabase
      .from("news_items")
      .select("id, title, source_name, url, published_at")
      .eq("state", "CA").eq("active", true)
      .order("published_at", { ascending: false }).limit(6),
    supabase
      .from("bills")
      .select("locality")
      .eq("state", "CA").in("scope", ["county", "municipal"])
      .eq("verification_status", "confirmed").eq("active", true),
  ]);
  const bills = (billsRes.data ?? []) as Array<{ id: string; bill_number: string; title: string | null; status: string | null; kratom_relevance: string | null }>;
  const ab1088 = bills.find((b) => b.bill_number === "AB 1088");
  const ab2365 = bills.find((b) => b.bill_number === "AB 2365");
  const campaignLive = campaignRes.data?.active === true;
  const news = newsRes.data ?? [];
  const localBans = (banRes.data ?? []).map((b) => b.locality).filter(Boolean);

  const script =
    "California kratom war room. California is actively moving to restrict kratom and 7-hydroxymitragynine. " +
    "Assembly Bill 1088 would cap alkaloids at two percent — an effective ban on most products — and it heads to the Senate Health Committee on June 17th in Sacramento. " +
    "Assembly Bill 2365 is the protective bill that would regulate kratom sensibly instead of banning it. " +
    "State regulators have also sued a Southern California manufacturer and seized products, and San Diego already has a local ban. " +
    "Here is how to fight: oppose AB 1088 by contacting the Senate Health Committee and submitting an official position letter before the June 17th hearing, and support AB 2365. " +
    "Every letter and call counts. This is the moment.";

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <p className="text-xs font-semibold uppercase tracking-widest text-red-400">🐻 California · war room</p>
      <h1 className="mt-1 text-4xl font-bold text-zinc-100">California is the front line</h1>
      <p className="mt-2 text-sm text-zinc-400">
        The state is moving to restrict kratom &amp; 7-OH. Here&apos;s the situation, the science, and exactly how to push back —
        in the next few weeks, before <strong className="text-zinc-200">AB 1088</strong> reaches a floor vote.
      </p>

      <div className="mt-4"><BriefAudioButton script={script} /></div>

      {/* ACTION PLAN — the point of the page */}
      <section className="mt-8 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border-2 border-red-700/50 bg-red-950/20 p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-red-300">🚫 Oppose — the ban</p>
          <h2 className="mt-1 text-lg font-bold text-zinc-100">AB 1088</h2>
          <p className="mt-1 text-xs text-zinc-400">
            Caps alkaloids at 2% — an effective ban on most kratom products.
            <strong className="text-red-200"> Senate Health Committee hearing June 17, 11am (Sacramento).</strong>
          </p>
          <div className="mt-3 flex flex-col gap-2 text-sm">
            {campaignLive ? (
              <Link href="/campaigns/stop-ca-ab1088" className="rounded-md bg-red-500 px-3 py-2 text-center font-semibold text-zinc-950 hover:bg-red-400">
                ✊ Take action — oppose AB 1088
              </Link>
            ) : (
              <span className="rounded-md border border-red-700/50 bg-red-950/30 px-3 py-2 text-center text-xs text-red-200">
                Opposition campaign is being finalized — check back shortly.
              </span>
            )}
            <a href="https://calegislation.lc.ca.gov/Advocates/faces/submitnote.xhtml" target="_blank" rel="noopener noreferrer" className="rounded-md border border-red-700/40 px-3 py-2 text-center text-xs text-red-200 hover:border-red-400">
              ✍ Submit an official position letter ↗
            </a>
            {ab1088 && <Link href={`/bills/${ab1088.id}`} className="text-center text-[11px] text-zinc-500 hover:text-emerald-400">bill detail + status ({ab1088.status}) →</Link>}
          </div>
        </div>

        <div className="rounded-lg border-2 border-emerald-700/50 bg-emerald-950/20 p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">✅ Support — the protection</p>
          <h2 className="mt-1 text-lg font-bold text-zinc-100">AB 2365</h2>
          <p className="mt-1 text-xs text-zinc-400">
            The sensible-regulation alternative — keeps legal access with age limits + testing instead of prohibition.
          </p>
          <div className="mt-3 flex flex-col gap-2 text-sm">
            <a href="https://calegislation.lc.ca.gov/Advocates/faces/submitnote.xhtml" target="_blank" rel="noopener noreferrer" className="rounded-md border border-emerald-700/40 px-3 py-2 text-center text-xs text-emerald-200 hover:border-emerald-400">
              ✍ Submit a support letter ↗
            </a>
            {ab2365 && <Link href={`/bills/${ab2365.id}`} className="text-center text-[11px] text-zinc-500 hover:text-emerald-400">bill detail + status ({ab2365.status}) →</Link>}
          </div>
        </div>
      </section>

      {/* Situation briefing */}
      <section className="mt-8">
        <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-300">The situation</h2>
        <ul className="mt-2 space-y-1.5 text-sm text-zinc-300">
          <li>• <strong>State enforcement is live:</strong> regulators sued a Southern CA kratom manufacturer and seized products statewide; the ABC declared kratom/7-OH illegal on alcohol-licensed premises.</li>
          <li>• <strong>Local bans are spreading:</strong> {localBans.length > 0 ? `${localBans.join(", ")} already restrict kratom locally.` : "San Diego already bans kratom locally."}</li>
          <li>• <strong>The legislative fight</strong> is AB 1088 (ban) vs AB 2365 (protect) — both in committee now.</li>
          <li>• <strong>You&apos;re not alone:</strong> the <a href="https://7hopealliance.org/save-7-oh-in-ca/" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">7-HOPE Alliance</a> is organizing opposition letters + June 17 testimony.</li>
        </ul>
      </section>

      {/* Recent CA news */}
      {news.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-300">Latest California coverage</h2>
          <ul className="mt-2 space-y-2">
            {news.map((n) => (
              <li key={n.id}>
                <a href={n.url} target="_blank" rel="noopener noreferrer" className="block rounded-md border border-zinc-800 bg-zinc-950/50 p-3 hover:border-emerald-500">
                  <p className="text-sm font-medium text-zinc-100 line-clamp-2">{n.title}</p>
                  <p className="mt-1 text-[11px] text-zinc-500">{n.source_name} · {n.published_at ? new Date(n.published_at).toLocaleDateString() : ""}</p>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-10 flex flex-wrap gap-2 text-xs">
        <Link href="/states/CA" className="rounded border border-zinc-800 bg-zinc-950/40 px-3 py-1.5 hover:border-emerald-500">📊 Full CA data hub</Link>
        <Link href="/banned" className="rounded border border-zinc-800 bg-zinc-950/40 px-3 py-1.5 hover:border-emerald-500">🚫 Banned tracker</Link>
        <Link href="/calendar?state=CA" className="rounded border border-zinc-800 bg-zinc-950/40 px-3 py-1.5 hover:border-emerald-500">📅 CA calendar</Link>
        <Link href="/signup" className="rounded border border-emerald-600 bg-emerald-950/30 px-3 py-1.5 font-semibold text-emerald-300 hover:bg-emerald-950/50">Join the fight →</Link>
      </footer>
    </main>
  );
}
