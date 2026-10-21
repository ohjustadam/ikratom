import Link from "@/components/Link";
import { createClient } from "@/lib/supabase/server";
import { publicHandle } from "@/lib/public-handle";
import { DecideRequest, GroupActionPicker } from "./GroupGrowthClient";

/**
 * Group growth, server half (migration 0274): "this week's group action" with
 * aggregate progress, and the organizers' join-request inbox. Counts only, no
 * names, on progress; requesters show as @username.
 */

export async function GroupAction({ coalitionId, state, isAdmin }: { coalitionId: string; state: string | null; isAdmin: boolean }) {
  const sb = await createClient();
  const { data: c } = await sb
    .from("coalitions").select("featured_campaign_id, featured_note").eq("id", coalitionId).maybeSingle();
  const featuredId = (c as { featured_campaign_id: string | null } | null)?.featured_campaign_id ?? null;

  const [{ data: camp }, { data: prog }, { data: live }] = await Promise.all([
    featuredId
      ? sb.from("campaigns").select("slug, title, blurb, active").eq("id", featuredId).maybeSingle()
      : Promise.resolve({ data: null }),
    featuredId ? sb.rpc("coalition_action_progress", { p_coalition_id: coalitionId }) : Promise.resolve({ data: null }),
    isAdmin
      ? sb.from("campaigns").select("slug, title, state").eq("active", true)
          .or(state ? `state.eq.${state},state.is.null` : "state.is.null")
          .order("created_at", { ascending: false }).limit(30)
      : Promise.resolve({ data: [] }),
  ]);
  const p = (Array.isArray(prog) ? prog[0] : null) as { members_total: number; members_acted: number; letters_sent: number } | null;
  const campaign = camp as { slug: string; title: string; blurb: string | null; active: boolean } | null;
  const pct = p && p.members_total > 0 ? Math.round((p.members_acted / p.members_total) * 100) : 0;

  if (!campaign?.active && !isAdmin) return null;

  return (
    <section id="group-action" className="mb-6 rounded-lg border-2 border-emerald-600/50 bg-emerald-950/15 p-4">
      <h2 className="text-xs font-bold uppercase tracking-widest text-emerald-300">⚡ This week&apos;s group action</h2>
      {campaign?.active ? (
        <>
          <Link href={`/campaigns/${campaign.slug}`} className="mt-1 block text-lg font-bold text-zinc-100 hover:text-emerald-300">
            {campaign.title} →
          </Link>
          {(c as { featured_note: string | null } | null)?.featured_note && (
            <p className="mt-1 text-sm text-zinc-300">{(c as { featured_note: string }).featured_note}</p>
          )}
          {p && (
            <div className="mt-3">
              <div className="flex justify-between text-xs text-zinc-300">
                <span>{p.members_acted} of {p.members_total} members have acted</span>
                <span className="text-zinc-500">{p.letters_sent} letters sent</span>
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-zinc-800" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Group progress">
                <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-1 text-[11px] text-zinc-500">Counts only. Nobody sees who has or hasn&apos;t acted.</p>
            </div>
          )}
        </>
      ) : (
        <p className="mt-1 text-sm text-zinc-400">No group action picked yet. Pick one live campaign for everyone to act on together.</p>
      )}
      {isAdmin && (
        <GroupActionPicker
          coalitionId={coalitionId}
          current={campaign?.active ? campaign.slug : null}
          options={((live ?? []) as { slug: string; title: string; state: string | null }[]).map((o) => ({ slug: o.slug, title: `${o.state ?? "US"} · ${o.title}` }))}
        />
      )}
    </section>
  );
}

export async function JoinRequests({ coalitionId }: { coalitionId: string }) {
  const sb = await createClient();
  const { data } = await sb
    .from("coalition_join_requests").select("id, user_id, message, created_at")
    .eq("coalition_id", coalitionId).eq("status", "pending").order("created_at").limit(50);
  const reqs = (data ?? []) as { id: string; user_id: string; message: string | null; created_at: string }[];
  if (reqs.length === 0) return null;
  const { data: profs } = await sb.rpc("get_public_profiles", { p_ids: reqs.map((r) => r.user_id) });
  const handle = new Map(((profs ?? []) as { id: string; username: string | null; state: string | null }[]).map((p) => [p.id, publicHandle(p)]));
  return (
    <section id="join-requests" className="mb-6">
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-zinc-300">Requests to join ({reqs.length})</h2>
      <ul className="space-y-1.5">
        {reqs.map((r) => (
          <li key={r.id} className="rounded border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm">
            <span className="font-semibold text-zinc-100">{handle.get(r.user_id) ?? "@member"}</span>
            <span className="ml-2 text-[11px] text-zinc-500">{new Date(r.created_at).toLocaleDateString()}</span>
            {r.message && <p className="mt-1 whitespace-pre-wrap text-xs text-zinc-300">{r.message}</p>}
            <DecideRequest requestId={r.id} />
          </li>
        ))}
      </ul>
    </section>
  );
}
