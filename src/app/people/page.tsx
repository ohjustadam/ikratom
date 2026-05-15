import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PeopleBrowser } from "./PeopleBrowser";

export const metadata = {
  title: "People of interest — every named opponent, ally, expert, and journalist tracked across kratom policy",
  description: "Browseable directory of every stakeholder we've editorial-curated across active kratom bills. Filter by role, state, or search by name.",
};
export const dynamic = "force-dynamic";

/**
 * /people — aggregated directory of every bill_stakeholders row across
 * every bill. Editorial curation gold that was only discoverable
 * per-bill before. This page makes it browsable: filter by role
 * (ally / expert / opponent / journalist / affected / community),
 * filter by state, search by name.
 *
 * Use cases:
 *   - Organizer in MS wants to find every documented kratom journalist
 *     across all states to pitch a story
 *   - Repeal coalition in AL wants to find experts already engaged in
 *     other banning states who could write letters of support
 *   - User browsing the takeback hub wants to see the whole opposition
 *     map in one view
 *
 * Performance: stakeholders table is small (34 rows as of 2026-05-15),
 * trivially renders all in one page with client-side filtering.
 */
type Row = {
  id: string;
  name: string;
  title: string | null;
  organization: string | null;
  role_type: string;
  reasoning: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  twitter_handle: string | null;
  linkedin_url: string | null;
  bill_id: string;
  bill: {
    state: string;
    bill_number: string;
    title: string | null;
    status: string | null;
    kratom_relevance: string | null;
  } | null;
};

export default async function PeoplePage() {
  const sb = await createClient();
  const { data } = await sb
    .from("bill_stakeholders")
    .select(`
      id, name, title, organization, role_type, reasoning,
      email, phone, website, twitter_handle, linkedin_url, bill_id,
      bill:bills (state, bill_number, title, status, kratom_relevance)
    `)
    .order("role_type", { ascending: true });

  const rows = (data ?? []) as unknown as Row[];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <Link href="/" className="text-xs text-zinc-500 hover:text-emerald-400">← Home</Link>
      <header className="mt-2 mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-violet-300">
          🧠 People of interest
        </p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">
          Every named stakeholder in the kratom-policy fight.
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-zinc-400">
          Editorial-curated directory of allies (legislators most likely to carry KCPA), opponents (sponsors of restrictive bills + state agencies pushing schedule decisions), experts (academic + medical voices), journalists (covering the policy beat), and affected business owners. All extracted from per-bill research, aggregated here so you can browse the whole map at once.
        </p>
        <p className="mt-3 max-w-3xl text-[11px] text-zinc-500">
          {rows.length} {rows.length === 1 ? "person" : "people"} tracked across {new Set(rows.map(r => r.bill?.state).filter(Boolean)).size} states.{" "}
          Each entry links to the bill it was curated for; the &quot;reasoning&quot; field explains why we flagged them. Submit corrections via the intel-tip form on any bill page.
        </p>
      </header>

      <PeopleBrowser rows={rows} />

      <footer className="mt-10 rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-[11px] text-zinc-400">
        <p>
          <strong className="text-zinc-200">How this directory grows.</strong>{" "}
          Each time we curate takeback intel for a banning state or research a moving bill, we add the named stakeholders to bill_stakeholders with role_type + reasoning. Going forward: every editorial pass through a state should leave the directory richer. Allies get pinged when their bill moves; opponents get tracked across the bills they sponsor.
        </p>
      </footer>
    </div>
  );
}
