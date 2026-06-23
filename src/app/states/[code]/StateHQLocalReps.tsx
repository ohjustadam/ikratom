import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getTrustTier } from "@/modules/auth/trust-tier";

/**
 * "Your local reps" — the FIRST thing an advocate should see on the State HQ
 * (owner ask 2026-06-22). Answer-first: who represents YOU here + one-click
 * contact. When we can't show reps yet, it degrades into a tiered call-to-
 * action keyed to the viewer's account status (anon → sign up; logged-in but
 * profile incomplete → complete it; address set but no match → request sync)
 * so the empty state is itself an activation step, never a dead end.
 *
 * Legislators are public officials (full_name/contact is public record) — this
 * is the viewer's OWN reps shown privately, so publicHandle does not apply.
 */
export async function StateHQLocalReps({ state, stateName }: { state: string; stateName: string }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const cta = (title: string, body: string, href: string, label: string) => (
    <section id="your-reps" className="mb-6 rounded-lg border border-emerald-700/40 bg-emerald-950/10 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-emerald-300">📍 Your local reps</h2>
      <p className="mt-2 text-sm font-medium text-zinc-100">{title}</p>
      <p className="mt-1 text-xs text-zinc-400">{body}</p>
      <Link href={href} className="mt-3 inline-block rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400">
        {label}
      </Link>
    </section>
  );

  if (!user) {
    return cta(
      "See the legislators who represent YOU in " + stateName,
      "Create a free account and add your address — we'll show your exact state + federal reps, where each stands on kratom, and a one-click way to contact them.",
      "/login",
      "Create your free account →",
    );
  }

  const { data: prof } = await supabase
    .from("profiles")
    .select("state, state_senate_district, state_house_district, congressional_district")
    .eq("id", user.id)
    .single();

  if (!prof?.state) {
    return cta(
      "Add your address to unlock your reps",
      "Your profile doesn't have a state yet. Set it (two minutes) and " + stateName + "'s — or your own state's — reps, stances, and contacts light up.",
      "/account",
      "Complete your profile →",
    );
  }

  if (prof.state !== state) {
    return cta(
      `You're set up in ${prof.state}, not ${stateName}`,
      `This is the ${stateName} HQ. Your own reps live on your home-state HQ — or update your address if you've moved.`,
      `/states/${prof.state}#your-reps`,
      `Go to your ${prof.state} reps →`,
    );
  }

  const districts = [prof.state_senate_district, prof.state_house_district, prof.congressional_district].filter(Boolean);
  const { data: reps } = districts.length
    ? await supabase
        .from("legislators")
        .select("id, full_name, role, district, party, email, phone")
        .eq("state", state)
        .eq("active", true)
        .in("role", ["state_senate", "state_house", "us_senate", "us_house"])
        .or(districts.map((d) => `district.eq.${d}`).join(","))
        .limit(12)
    : { data: [] as Array<{ id: string; full_name: string; role: string; district: string | null; party: string | null; email: string | null; phone: string | null }> };

  if (!reps || reps.length === 0) {
    return cta(
      "We don't have your district reps matched yet",
      "Your address is set but we couldn't match your districts to current legislators. Request a sync and we'll pull them in.",
      "/account#districts",
      "Request a data sync →",
    );
  }

  return (
    <section id="your-reps" className="mb-6 rounded-lg border border-emerald-700/40 bg-emerald-950/10 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-emerald-300">📍 Your local reps in {stateName}</h2>
      <p className="mt-1 text-xs text-zinc-500">The legislators who answer to you. Contact them in one click — your voice is the one they're elected to weigh.</p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {reps.map((r) => (
          <li key={r.id} className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="flex flex-wrap items-baseline gap-1.5 text-[11px]">
              <Link href={`/legislators/${r.id}`} className="text-sm font-semibold text-zinc-100 hover:text-emerald-400">{r.full_name}</Link>
              {r.party && <span className="text-zinc-500">({r.party})</span>}
              <span className="text-zinc-500">· {r.role.replace(/_/g, " ")}{r.district ? ` · dist ${r.district}` : ""}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-2 text-xs">
              {r.email && <a href={`mailto:${r.email}`} className="text-emerald-400 hover:underline">✉ email</a>}
              {r.phone && <a href={`tel:${r.phone}`} className="text-zinc-400 hover:underline">📞 {r.phone}</a>}
              <Link href={`/legislators/${r.id}/briefing`} className="text-zinc-400 hover:underline">📋 briefing</Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
