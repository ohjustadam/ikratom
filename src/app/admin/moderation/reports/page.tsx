import { redirect } from "next/navigation";
import Link from "@/components/Link";
import { getAdminContext } from "@/modules/admin/actions";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { publicHandle } from "@/lib/public-handle";
import { REPORT_REASONS, TARGET_LABEL, targetHref, type ReportTarget } from "@/modules/reports/types";
import { ReportResolveButtons } from "./ReportResolveButtons";

export const metadata = { title: "Member reports" };
export const dynamic = "force-dynamic";

type Row = {
  target_type: ReportTarget; target_id: string; target_owner_id: string | null; reason: string; note: string | null; created_at: string;
};

/**
 * /admin/moderation/reports — every open member report (content_reports,
 * 0288), one card per reported thing, most-reported first. Photos resolve on
 * their own page (restore/remove the photo itself); forum reports keep the
 * forum's own queue, counted here so nothing is missed.
 */
export default async function ReportsQueuePage() {
  const ctx = await getAdminContext({ require: "moderate_forum" });
  if (!ctx.ok) redirect("/dashboard");

  const svc = createServiceRoleClient();
  const [{ data }, { count: forumOpen }] = await Promise.all([
    svc.from("content_reports").select("target_type, target_id, target_owner_id, reason, note, created_at")
      .eq("status", "open").order("created_at", { ascending: false }).limit(500),
    svc.from("forum_post_reports").select("id", { count: "exact", head: true }).is("resolved_at", null),
  ]);

  const groups = new Map<string, { type: ReportTarget; id: string; owner: string | null; rows: Row[] }>();
  for (const r of (data ?? []) as Row[]) {
    const k = `${r.target_type}:${r.target_id}`;
    const g = groups.get(k) ?? { type: r.target_type, id: r.target_id, owner: r.target_owner_id, rows: [] };
    g.rows.push(r);
    groups.set(k, g);
  }
  const cards = [...groups.values()].sort((a, b) => b.rows.length - a.rows.length);
  const owners = [...new Set(cards.map((c) => c.owner).filter(Boolean))] as string[];
  const { data: profs } = owners.length
    ? await svc.from("profiles").select("id, username, state").in("id", owners)
    : { data: [] };
  const who = new Map(((profs ?? []) as { id: string; username: string | null; state: string | null }[]).map((p) => [p.id, p]));
  const reasonLabel = (id: string) => REPORT_REASONS.find((r) => r.id === id)?.label ?? id;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <Link href="/admin/moderation" className="text-xs text-zinc-500 hover:text-emerald-400">← Moderation</Link>
      <h1 className="mt-2 text-3xl font-bold">Member reports</h1>
      <p className="mt-2 text-sm text-zinc-400">
        <strong className="text-zinc-200">{cards.length}</strong> reported item{cards.length === 1 ? "" : "s"}.
        Act on the item in its own tool (open it), then mark it handled; or dismiss if nothing is wrong.
        {forumOpen ? <> Forum: <Link href="/admin/forum" className="text-emerald-400 hover:underline">{forumOpen} open forum report{forumOpen === 1 ? "" : "s"} →</Link></> : null}
      </p>
      {cards.length === 0 && <p className="mt-6 rounded-lg border border-emerald-800/40 bg-emerald-950/10 p-4 text-sm text-emerald-300">✓ No open member reports.</p>}
      <ul className="mt-6 space-y-3">
        {cards.map((c) => {
          const href = targetHref(c.type, c.id, c.owner);
          return (
            <li key={`${c.type}:${c.id}`} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p>
                  <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-300">{TARGET_LABEL[c.type]}</span>
                  {c.owner && <span className="ml-2 text-zinc-300">by {publicHandle(who.get(c.owner))}</span>}
                  <span className="ml-2 font-semibold text-amber-400">{c.rows.length} report{c.rows.length === 1 ? "" : "s"}</span>
                </p>
                {href && <a href={href} className="text-xs text-emerald-400 hover:underline" target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">Open →</a>}
              </div>
              <ul className="mt-2 space-y-1 text-xs text-zinc-400">
                {c.rows.slice(0, 8).map((r, i) => (
                  <li key={i}>• {reasonLabel(r.reason)}{r.note ? <>: <span className="whitespace-pre-line text-zinc-300">{r.note}</span></> : null}</li>
                ))}
              </ul>
              {c.type === "member_photo"
                ? <Link href="/admin/moderation/photos" className="mt-2 inline-block text-xs text-emerald-400 hover:underline">Restore or remove on the photos page →</Link>
                : <ReportResolveButtons targetType={c.type} targetId={c.id} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
