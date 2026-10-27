import Link from "@/components/Link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserLegislators, ROLE_SHORT, type UserCivicProfile } from "@/lib/legislators";
import { groupForViewer } from "@/modules/coalitions/moderation";
import { PLACEHOLDER_PREVIEW, type ResourceRow } from "@/modules/coalitions/resources";
import { EmailOfficialButton } from "@/modules/compose/EmailOfficialButton";
import { fillGroupTemplate } from "@/modules/compose/letter-templates";
import { httpUrlOrNull } from "@/modules/compose/send-links";
import { ReportButton } from "@/modules/reports/components/ReportButton";
import { CopyTemplateButton } from "../../ResourcesClient";

/**
 * One pinned resource (migration 0293). A template is sent to the member's
 * OWN officials through the shared composer, which fills in their name, city
 * and each official's greeting; it is never a hand-rolled mailto. Members
 * only, plus a read-only view for a site moderator opening a report.
 */
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false } };

export default async function GroupResourcePage({ params }: { params: Promise<{ slug: string; resourceId: string }> }) {
  const { slug, resourceId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(resourceId)) notFound();
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) notFound();
  const viewer = await groupForViewer(sb, slug, user.id);
  if (!viewer) notFound();
  const c = viewer.group;

  const { data } = await sb.from("coalition_resources")
    .select("id, kind, title, note, url, subject, body, created_by, created_at")
    .eq("id", resourceId).eq("coalition_id", c.id).maybeSingle();
  if (!data) notFound();
  const r = data as ResourceRow;
  const template = r.kind === "template" && r.body ? { subject: r.subject ?? r.title, body: r.body } : null;

  // The member's own officials, from their profile's districts (their own row).
  let officials: Awaited<ReturnType<typeof getUserLegislators>> = [];
  let hasState = false;
  let copyText = "";
  if (template && !viewer.moderator) {
    const { data: prof } = await sb.from("profiles")
      .select("full_name, state, congressional_district, state_senate_district, state_house_district, city, county")
      .eq("id", user.id).maybeSingle();
    hasState = !!prof?.state;
    // The viewer's own letter, for pasting into a testimony portal: their own details, never shown to anyone else.
    copyText = fillGroupTemplate(template.body, { my_name: prof?.full_name, my_city: prof?.city, my_state: prof?.state });
    if (prof?.state) officials = (await getUserLegislators(sb, prof as UserCivicProfile)).filter((o) => o.email || httpUrlOrNull(o.website));
  }
  const link = r.kind === "link" ? httpUrlOrNull(r.url) : null;

  return (
    <div className="mx-auto max-w-3xl px-4 pb-10 pt-4 sm:px-6 sm:pt-8">
      <Link href={`/coalitions/${c.slug}#resources`} className="text-xs text-zinc-500 hover:text-emerald-400">← {c.name}</Link>
      <h1 className="mt-1 text-xl font-bold text-zinc-50">{r.kind === "template" ? "✍️" : "🔗"} {r.title}</h1>
      {r.note && <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-400">{r.note}</p>}
      {viewer.moderator && (
        <p className="mt-3 rounded-md border border-amber-700/40 bg-amber-950/20 p-3 text-xs text-amber-200">
          Moderator view (read-only). You aren&apos;t a member of this group.
        </p>
      )}

      {link && (
        <a href={link} target="_blank" rel="noopener noreferrer nofollow ugc"
          className="mt-4 inline-flex min-h-11 items-center break-all rounded-md border border-zinc-700 px-3 text-sm text-emerald-300 hover:border-emerald-500">
          {link} ↗
        </a>
      )}

      {template && (
        <>
          <pre className="mt-4 whitespace-pre-wrap break-words rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 font-sans text-sm text-zinc-200">
            <strong className="block text-zinc-400">Subject: {fillGroupTemplate(template.subject, PLACEHOLDER_PREVIEW)}</strong>
            {"\n"}{fillGroupTemplate(template.body, PLACEHOLDER_PREVIEW)}
          </pre>
          <p className="mt-1 text-[11px] text-zinc-500">Your name, city and each official&apos;s name are filled in for you. Fill in each ___ before you send. Prefer a hearing&apos;s testimony form? Copy the text and paste it there.</p>
          {!viewer.moderator && (
            <section className="mt-5">
              <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-zinc-300">Send it to your officials</h2>
              {officials.length > 0 ? (
                <ul className="space-y-2">
                  {officials.map((o) => (
                    <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 p-3">
                      <span className="text-sm text-zinc-200">
                        <span className="text-xs text-zinc-500">{ROLE_SHORT[o.role] ?? o.title ?? ""}</span> {o.full_name}
                      </span>
                      <EmailOfficialButton variant="button" source="group_template" template={template}
                        official={{ id: o.id, name: o.full_name, role: o.role, title: o.title ?? null, state: o.state, email: o.email, website: o.website }} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-zinc-400">
                  {hasState ? "We couldn't match your officials yet." : "Add your address to see your officials."}{" "}
                  <Link href="/account/profile" className="text-emerald-400 underline">Update your profile</Link>
                </p>
              )}
              <div className="mt-3"><CopyTemplateButton text={copyText} /></div>
            </section>
          )}
        </>
      )}

      {!viewer.moderator && r.created_by !== user.id && (
        <div className="mt-6"><ReportButton targetType="group_resource" targetId={r.id} label="Report this resource" /></div>
      )}
    </div>
  );
}
