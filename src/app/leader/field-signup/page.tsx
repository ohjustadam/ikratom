import { redirect } from "next/navigation";
import { getCreatorContext } from "@/modules/admin/actions";
import { createClient } from "@/lib/supabase/server";
import { FieldSignupForm } from "./FieldSignupForm";

export const metadata = { title: "Field signup" };
export const dynamic = "force-dynamic";

/**
 * /leader/field-signup — mobile-first signup form for leaders to use
 * on-site at events, booths, door-to-door, shop visits.
 *
 * Privacy posture (per owner spec):
 *   - Leader collects ONLY: email, first name, zip, state (optional)
 *   - NO address, no story, no sensitive info on leader's phone
 *   - Recruit gets a magic-link email; they complete profile from
 *     their OWN device
 *   - Leader sees recruit's display info post-signup but NOT
 *     sensitive fields (story, address, etc.)
 *
 * Captures the leader's own ID as profiles.referrer_id so the
 * recruit is credited back via /leader.
 */
export default async function FieldSignupPage() {
  const ctx = await getCreatorContext();
  if (!ctx.ok) redirect("/dashboard?need=leader");

  const supabase = await createClient();

  // Today's count for the leader (positive feedback loop)
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { count: todayCount } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("referrer_id", ctx.userId)
    .gte("created_at", todayStart.toISOString());

  const { count: totalCount } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("referrer_id", ctx.userId);

  return (
    <div className="mx-auto max-w-lg px-4 py-8 sm:px-6">
      <a href="/leader" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Leader workshop
      </a>
      <header className="mt-2 mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          📍 Field signup
        </p>
        <h1 className="mt-2 text-2xl font-bold">Onboard an advocate in 30 seconds</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Collect the minimum from the person in front of you. They get a magic-link
          email and finish their profile on their own device. Their sensitive info
          never lives on your phone.
        </p>
      </header>

      {/* Today's stats — a tiny dopamine hit */}
      <div className="mb-6 flex gap-3 text-center">
        <div className="flex-1 rounded-lg border border-emerald-700/40 bg-emerald-950/10 p-3">
          <div className="text-2xl font-bold text-emerald-300">{todayCount ?? 0}</div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Today</div>
        </div>
        <div className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
          <div className="text-2xl font-bold text-zinc-100">{totalCount ?? 0}</div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Lifetime</div>
        </div>
      </div>

      <FieldSignupForm />

      <div className="mt-8 rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-[11px] text-zinc-500">
        <p className="font-semibold text-zinc-300">🛡 Privacy promise to your recruits</p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>You only collect 3 fields here — email, first name, zip.</li>
          <li>Their address, story, and contact info are entered by THEM later.</li>
          <li>Their email confirms in person that they want to be on the platform — get verbal consent before submitting.</li>
          <li>If they already have an account, we&apos;ll send them a sign-in link (no duplicates).</li>
          <li>You&apos;ll see them on your <a href="/leader" className="text-emerald-400 hover:underline">/leader recruits list</a>, but never their sensitive fields.</li>
        </ul>
      </div>
    </div>
  );
}
