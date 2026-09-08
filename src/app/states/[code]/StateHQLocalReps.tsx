"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { OfficialAvatar } from "@/components/OfficialAvatar";
import { EmailOfficialButton } from "@/modules/compose/EmailOfficialButton";
import type { MyRepsResult } from "@/app/api/states/[code]/my-reps/route";

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
 *
 * CLIENT-SIDE SINCE 2026-09-08, and that is the whole reason the State HQ can
 * be a static page. This used to read auth.getUser() + the viewer's profile on
 * the server, which made all 51 state pages dynamic — every crawler hit
 * re-querying Supabase against a free-tier egress cap that RESTRICTS the
 * project when exceeded. The per-viewer read moved to
 * /api/states/[code]/my-reps; crawlers don't run JS, so they never make it.
 *
 * It is FETCHED, never rendered-then-hidden. Baking one visitor's district
 * representatives into a page cached for everyone would be a disclosure bug,
 * not a caching trick.
 */
export function StateHQLocalReps({ state, stateName }: { state: string; stateName: string }) {
  const [data, setData] = useState<MyRepsResult | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/states/${state}/my-reps`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { kind: "anon" }))
      .then((d: MyRepsResult) => { if (alive) setData(d); })
      .catch(() => { if (alive) setData({ kind: "anon" }); });
    return () => { alive = false; };
  }, [state]);

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

  // Reserve the space while the one per-viewer read is in flight, so the page
  // doesn't jump once it lands.
  if (!data) {
    return (
      <section id="your-reps" className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">📍 Your local reps</h2>
        <p className="mt-2 h-4 w-2/3 animate-pulse rounded bg-zinc-800" />
      </section>
    );
  }

  if (data.kind === "anon") {
    return cta(
      "See the legislators who represent YOU in " + stateName,
      "Create a free account and add your address — we'll show your exact state + federal reps, where each stands on kratom, and a one-click way to contact them.",
      "/login",
      "Create your free account →",
    );
  }

  if (data.kind === "no-state") {
    return cta(
      "Add your address to unlock your reps",
      "Your profile doesn't have a state yet. Set it (two minutes) and " + stateName + "'s — or your own state's — reps, stances, and contacts light up.",
      "/account",
      "Complete your profile →",
    );
  }

  if (data.kind === "other-state") {
    return cta(
      `You're set up in ${data.profState}, not ${stateName}`,
      `This is the ${stateName} HQ. Your own reps live on your home-state HQ — or update your address if you've moved.`,
      `/states/${data.profState}#your-reps`,
      `Go to your ${data.profState} reps →`,
    );
  }

  if (data.kind === "no-match") {
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
      <p className="mt-1 text-xs text-zinc-500">The legislators who answer to you. Contact them in one click — your voice is the one they&apos;re elected to weigh.</p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {data.reps.map((r) => (
          <li key={r.id} className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="flex items-start gap-2.5">
              <OfficialAvatar name={r.full_name} portraitUrl={r.portrait_url} size="md" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-1.5 text-[11px]">
                  <Link href={`/legislators/${r.id}`} className="text-sm font-semibold text-zinc-100 hover:text-emerald-400">{r.full_name}</Link>
                  {r.party && <span className="text-zinc-500">({r.party})</span>}
                  <span className="text-zinc-500">· {r.role.replace(/_/g, " ")}{r.district ? ` · dist ${r.district}` : ""}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-2 text-xs">
                  <EmailOfficialButton
                    official={{ id: r.id, name: r.full_name, role: r.role, state, email: r.email, website: r.website }}
                    source="state_hq_reps"
                    variant="inline"
                    label="✉ email"
                  />
                  {r.phone && <a href={`tel:${r.phone}`} className="text-zinc-400 hover:underline">📞 {r.phone}</a>}
                  <Link href={`/legislators/${r.id}/briefing`} className="text-zinc-400 hover:underline">📋 briefing</Link>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
