import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SubmitResearchForm } from "./SubmitResearchForm";

export const metadata = {
  title: "Submit research — iKratom",
  description: "Advocate leaders can paste a research-paper URL and we'll add it to the public kratom research library.",
};
export const dynamic = "force-dynamic";

/**
 * /research/submit — leader-advocate / admin entry point for adding
 * new papers to the public research library.
 *
 * Phase 1 (this PR — "no AI yet"):
 *   - Paste URL, click submit, kratom-leaf-spinner stages progress
 *     through fake AI phases (the server-side metadata fetch IS real,
 *     the AI stage is currently a TODO stub)
 *   - On done: redirect to /research/[id]
 *   - admin_notes_md flags the row for AI evaluation later
 *
 * Phase 2: replace the staged progress with real-time SSE from the
 * actual AI evaluation pipeline.
 */
export default async function SubmitResearchPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?redirect=/research/submit");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, is_owner, is_advocate_leader, full_name")
    .eq("id", user.id)
    .maybeSingle();
  const isPrivileged = !!(profile?.is_admin || profile?.is_owner || profile?.is_advocate_leader);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 lg:px-8">
      <Link href="/research" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Research library
      </Link>
      <header className="mt-2 mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
          🌿 Sanctuary
        </p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">
          Add a research paper
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-400">
          Paste a peer-reviewed kratom-related paper URL. We&apos;ll fetch its metadata, save it to the public library, and queue it for editorial review. Goal: a sanctuary of legit medical findings, autopsies, pharmacology research, ethnobotany — every claim citable, every paper readable, every admin-flagged bias visible.
        </p>
      </header>

      {!isPrivileged ? (
        <div className="rounded-lg border border-amber-700/40 bg-amber-950/15 p-5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-amber-300">
            Advocate leader access required
          </h2>
          <p className="mt-2 text-sm text-zinc-300">
            Submitting research papers is currently limited to advocate leaders + admins. We do this to keep the library trustworthy — every entry is curated, not crowdsourced spam.
          </p>
          <p className="mt-2 text-sm text-zinc-400">
            Want to help curate? Email{" "}
            <a href="mailto:ohjustadam@proton.me" className="text-emerald-400 hover:underline">
              the owner
            </a>{" "}
            with your background (medical / academic / industry / journalism) and we&apos;ll get you set up.
          </p>
          <Link
            href="/research"
            className="mt-4 inline-block rounded-md border border-zinc-700 px-4 py-2 text-sm hover:border-emerald-500 hover:text-emerald-300"
          >
            Browse the existing library →
          </Link>
        </div>
      ) : (
        <SubmitResearchForm submitterName={profile?.full_name ?? user.email ?? "you"} userId={user.id} />
      )}

      <footer className="mt-8 rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-[11px] text-zinc-400">
        <p>
          <strong className="text-zinc-200">What gets a green light:</strong>{" "}
          Peer-reviewed journals (PubMed, ScienceDirect, JPET, ACS, Wiley, Springer, Nature, Frontiers), preprint servers (bioRxiv, ChemRxiv, SSRN), recognized institutional repositories, FDA/DEA/HHS official documents, government health-agency publications.
        </p>
        <p className="mt-2">
          <strong className="text-zinc-200">What we re-route to a different surface:</strong>{" "}
          News articles → /pulse intel tip · YouTube + podcasts → /library · personal stories → /stories · advocacy organization blog posts → email an admin first.
        </p>
      </footer>
    </div>
  );
}
