import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SubmitIntelForm } from "./SubmitIntelForm";

export const metadata = { title: "Submit intel" };

/**
 * Advocate intel-submission form. Authenticated users can flag a
 * piece of news the platform might not have picked up yet — city
 * council agenda, AG presser, BoP hearing notice, etc. The post
 * lands in moderation; an admin reviews it on /admin/intel-queue
 * and approves to /pulse (which auto-spawns a campaign).
 */
export default async function SubmitIntelPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/alerts/submit");

  const { data: profile } = await supabase
    .from("profiles")
    .select("state")
    .eq("id", user.id)
    .single();

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/pulse" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Pulse
      </a>
      <header className="mt-2 mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          Field intel
        </p>
        <h1 className="mt-1 text-3xl font-bold">Did you spot something?</h1>
        <p className="mt-3 text-sm text-zinc-400">
          City council agenda dropping a kratom item? AG quoted in a
          regional paper? Local cops doing a smoke-shop sweep? Tell us —
          our scrapers catch a lot but they can&apos;t catch everything.
          Tips go through admin review (~hours) and once approved, land
          on /pulse with a one-click solidarity campaign.
        </p>
      </header>

      <div className="mb-5 rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-xs text-zinc-400">
        <p className="font-semibold text-zinc-200">What makes a great tip:</p>
        <ul className="mt-1 list-inside list-disc space-y-0.5">
          <li>A specific, actionable event (not &quot;kratom is bad in my town&quot;)</li>
          <li>A source link — newspaper, agenda PDF, agency announcement</li>
          <li>Date/time if there&apos;s a hearing or vote we should mobilize before</li>
          <li>What jurisdiction (city, county, state, federal)</li>
        </ul>
        <p className="mt-3 font-semibold text-zinc-200">What gets rejected:</p>
        <ul className="mt-1 list-inside list-disc space-y-0.5">
          <li>Editorials, opinion pieces (we&apos;re tracking events, not vibes)</li>
          <li>Unsourced rumors — &quot;I heard that…&quot;</li>
          <li>Vendor promotion / sales</li>
          <li>Personal attacks on legislators or officials</li>
        </ul>
      </div>

      <SubmitIntelForm defaultState={(profile as { state: string | null } | null)?.state ?? ""} />
    </div>
  );
}
