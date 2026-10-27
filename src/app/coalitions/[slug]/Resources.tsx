import Link from "@/components/Link";
import { createClient } from "@/lib/supabase/server";
import { httpUrlOrNull } from "@/modules/compose/send-links";
import { ReportButton } from "@/modules/reports/components/ReportButton";
import type { ResourceRow } from "@/modules/coalitions/resources";
import { PinResourceForm, RemoveResourceButton } from "./ResourcesClient";

/**
 * Pinned resources + testimony templates (migration 0293). Members only
 * (RLS). A link opens in a new tab; a template opens its page, where each
 * member sends it to their own officials through the shared composer.
 */
export async function Resources({ coalitionId, slug, isOrganizer, userId }: {
  coalitionId: string; slug: string; isOrganizer: boolean; userId: string;
}) {
  const sb = await createClient();
  const { data } = await sb.from("coalition_resources")
    .select("id, kind, title, note, url, subject, body, created_by, created_at")
    .eq("coalition_id", coalitionId).order("created_at", { ascending: false }).limit(30);
  const rows = (data ?? []) as ResourceRow[];
  if (rows.length === 0 && !isOrganizer) return null;

  return (
    <section id="resources" className="mb-6 scroll-mt-20">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-zinc-300">📌 Pinned resources</h2>
      {rows.length === 0 && (
        <p className="mb-3 text-sm text-zinc-400">
          Pin what members keep asking for: the hearing page, the testimony portal, a fact sheet, or a letter template they can send in two taps.
        </p>
      )}
      <ul className="mb-3 space-y-2">
        {rows.map((r) => {
          const href = r.kind === "link" ? httpUrlOrNull(r.url) : `/coalitions/${slug}/r/${r.id}`;
          return (
            <li key={r.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
              <div className="flex items-start gap-3">
                <span aria-hidden className="text-xl">{r.kind === "template" ? "✍️" : "🔗"}</span>
                <div className="min-w-0 flex-1">
                  {href && r.kind === "link" ? (
                    <a href={href} target="_blank" rel="noopener noreferrer nofollow ugc"
                      className="break-words font-semibold text-emerald-300 hover:underline">{r.title} ↗</a>
                  ) : (
                    <Link href={href ?? "#"} className="break-words font-semibold text-emerald-300 hover:underline">{r.title}</Link>
                  )}
                  {r.note && <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-zinc-400">{r.note}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                    {r.kind === "template" && (
                      <Link href={`/coalitions/${slug}/r/${r.id}`}
                        className="flex min-h-10 items-center rounded-md bg-emerald-500 px-3 font-semibold text-zinc-950 hover:bg-emerald-400">
                        Use this template
                      </Link>
                    )}
                    {isOrganizer && <RemoveResourceButton id={r.id} slug={slug} />}
                    {r.created_by !== userId && <ReportButton targetType="group_resource" targetId={r.id} label="Report" />}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {isOrganizer && rows.length < 30 && <PinResourceForm coalitionId={coalitionId} slug={slug} />}
    </section>
  );
}
