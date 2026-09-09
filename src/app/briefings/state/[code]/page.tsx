import { redirect } from "next/navigation";
import { STATE_NAMES } from "@/lib/state-names";

/**
 * /briefings/state/[code] — FOLDED into the State HQ (2026-06-22, see
 * private/STATE_HUB_SPEC.md). The per-state briefing now lives as a section on
 * /states/[code] (narrative + Kokoro Listen) alongside the live, actionable
 * sections (your reps, legal status, bills, officials, news). This route
 * redirects there, preserving the launch-broadcast link (/briefings/state/OK)
 * and any printed/shared links.
 */
/**
 * Static. This is a pure redirect with no data reads at all, so force-dynamic
 * was buying a server invocation per hit to compute a constant. The state list
 * is fixed and small, so every one of them prerenders at build.
 */
export function generateStaticParams() {
  return Object.keys(STATE_NAMES).map((code) => ({ code }));
}

export default async function StateBriefingRedirect({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  redirect(`/states/${code.toUpperCase()}#briefing`);
}
