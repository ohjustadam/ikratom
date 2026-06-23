import { redirect } from "next/navigation";

/**
 * /briefings/state/[code] — FOLDED into the State HQ (2026-06-22, see
 * private/STATE_HUB_SPEC.md). The per-state briefing now lives as a section on
 * /states/[code] (narrative + Kokoro Listen) alongside the live, actionable
 * sections (your reps, legal status, bills, officials, news). This route
 * redirects there, preserving the launch-broadcast link (/briefings/state/OK)
 * and any printed/shared links.
 */
export const dynamic = "force-dynamic";

export default async function StateBriefingRedirect({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  redirect(`/states/${code.toUpperCase()}#briefing`);
}
