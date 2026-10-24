import Link from "@/components/Link";
import { createClient } from "@/lib/supabase/server";
import { memberChecklist, organizerChecklist, type ChecklistStep } from "@/modules/coalitions/home";
import { FinishWelcome } from "./WelcomeClient";

/**
 * The welcome checklist (migration 0284, owner pick B15c). A new member's
 * four steps (join → introduce yourself → take the group action → invite one
 * person), or the organizer's four (share the link, pin a welcome post, pick
 * the action, plan an event). Every tick is derived from what the person
 * actually did, so it can't drift; it disappears when done or closed.
 */
export async function Welcome({ coalitionId, slug, userId, isOrganizer, featuredCampaign }: {
  coalitionId: string; slug: string; userId: string; isOrganizer: boolean;
  featuredCampaign: { id: string; slug: string; set_at: string | null } | null;
}) {
  const sb = await createClient();
  const [{ data: me }, { data: pinned }] = await Promise.all([
    sb.from("coalition_members").select("joined_at, shared_link_at, welcome_done_at")
      .eq("coalition_id", coalitionId).eq("user_id", userId).maybeSingle(),
    sb.from("coalition_threads").select("id").eq("coalition_id", coalitionId)
      .not("pinned_at", "is", null).is("deleted_at", null).limit(1).maybeSingle(),
  ]);
  if (!me || me.welcome_done_at) return null;

  let steps: ChecklistStep[];
  if (isOrganizer) {
    const { count: events } = await sb.from("coalition_events").select("id", { count: "exact", head: true })
      .eq("coalition_id", coalitionId).is("cancelled_at", null);
    steps = organizerChecklist({
      slug, shared: !!me.shared_link_at, hasPinned: !!pinned, hasAction: !!featuredCampaign, hasEvent: (events ?? 0) > 0,
    });
  } else {
    const since = me.joined_at as string;
    let acts = sb.from("campaign_actions").select("id", { count: "exact", head: true })
      .eq("user_id", userId).gte("sent_at", since);
    if (featuredCampaign) acts = acts.eq("campaign_id", featuredCampaign.id);
    const [{ count: threads }, { count: posts }, { count: acted }] = await Promise.all([
      sb.from("coalition_threads").select("id", { count: "exact", head: true }).eq("coalition_id", coalitionId).eq("author_id", userId),
      sb.from("coalition_posts").select("id", { count: "exact", head: true }).eq("coalition_id", coalitionId).eq("author_id", userId),
      acts,
    ]);
    steps = memberChecklist({
      slug,
      introduced: (threads ?? 0) + (posts ?? 0) > 0,
      acted: (acted ?? 0) > 0,
      shared: !!me.shared_link_at,
      pinnedThreadId: pinned?.id ?? null,
      actionHref: featuredCampaign ? `/campaigns/${featuredCampaign.slug}` : "/campaigns",
    });
  }

  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  const pct = Math.round((done / steps.length) * 100);

  return (
    <section id="welcome" className="mb-6 rounded-xl border border-emerald-600/40 bg-emerald-950/15 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-emerald-200">{isOrganizer ? "Get your group going" : "Welcome! Your first steps"}</h2>
        <span className="text-xs text-zinc-400">{done} of {steps.length} done</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Checklist progress">
        <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>
      <ol className="mt-3 space-y-2">
        {steps.map((s, i) => (
          <li key={s.key} className="flex items-center gap-3">
            <span aria-hidden className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
              s.done ? "bg-emerald-500 text-zinc-950" : "border border-zinc-600 text-zinc-400"}`}>
              {s.done ? "✓" : i + 1}
            </span>
            <span className={`flex-1 text-sm ${s.done ? "text-zinc-500 line-through" : "text-zinc-100"}`}>
              {s.label}<span className="sr-only">{s.done ? " (done)" : ""}</span>
            </span>
            {!s.done && s.cta && (
              <Link href={s.href} className="min-h-9 shrink-0 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400">
                {s.cta}
              </Link>
            )}
          </li>
        ))}
      </ol>
      <FinishWelcome coalitionId={coalitionId} />
    </section>
  );
}
