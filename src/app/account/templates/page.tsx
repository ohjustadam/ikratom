import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buildVars, renderTemplate, missingFullName } from "@/modules/campaigns/templates";

export const metadata = { title: "My templates" };
export const dynamic = "force-dynamic";

/**
 * /account/templates — preview every active campaign template with
 * the user's profile substituted in. Lets users see exactly what
 * their email will say before they click send on a campaign.
 *
 * Read-only for v1. Per-campaign override editor lives on the
 * campaign page itself (CampaignAction component already has the
 * edit-message-before-send affordance).
 *
 * Re-homed from /dashboard/templates to /account/templates so the
 * "Advocacy tools" group in /account links stay inside the
 * /account/* tree (no breadcrumb confusion when arriving from the
 * Account sidebar). Legacy /dashboard/templates redirects here.
 */
export default async function TemplatesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/account/templates");

  const [{ data: profile }, { data: campaigns }] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, username, street, city, state, zip, kratom_story, kratom_years, advocate_type, lose_if_banned")
      .eq("id", user.id)
      .single(),
    supabase
      .from("campaigns")
      .select("id, slug, title, blurb, state, target_locality, subject_template, body_template, created_at")
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const noName = missingFullName(profile as { full_name: string | null } | null);
  const noStory = !((profile as { kratom_story?: string | null } | null)?.kratom_story ?? "").trim();

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/account#advocacy" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Account · Advocacy tools
      </a>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">My templates</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Every active campaign, rendered with your info filled in. This is what
          gets sent if you click send today. To customize the message for a specific
          campaign, click through and use the &ldquo;Edit message&rdquo; button on the
          campaign page.
        </p>
      </header>

      {/* Profile completeness nudges */}
      {(noName || noStory) && (
        <div className="mb-6 rounded-md border border-amber-700/40 bg-amber-950/10 p-4 text-sm">
          <p className="font-semibold text-amber-300">⚡ Strengthen your impact</p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-zinc-300">
            {noName && (
              <li>
                <a href="/account" className="text-emerald-400 hover:underline">
                  Add your real name
                </a>{" "}— without it, emails sign as your username, which staffers triage as low-priority.
              </li>
            )}
            {noStory && (
              <li>
                <a href="/account/character" className="text-emerald-400 hover:underline">
                  Write your kratom story
                </a>{" "}— AI tailoring will use it to write in your voice instead of stock template language.
              </li>
            )}
          </ul>
        </div>
      )}

      {(campaigns?.length ?? 0) === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-12 text-center text-sm text-zinc-500">
          <p className="text-3xl">📨</p>
          <p className="mt-2">No active campaigns right now.</p>
          <p className="mt-1 text-[11px] text-zinc-600">
            Templates appear here as new campaigns ship.
          </p>
        </div>
      ) : (
        <ul className="space-y-4">
          {(campaigns ?? []).map((c) => {
            const vars = buildVars(profile as Parameters<typeof buildVars>[0], null, []);
            const subject = renderTemplate(c.subject_template, vars);
            const body = renderTemplate(c.body_template, vars);
            return (
              <li key={c.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {c.state ? (
                        <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-bold uppercase text-zinc-400">
                          {c.state}
                        </span>
                      ) : (
                        <span className="rounded bg-purple-950/40 px-1.5 py-0.5 text-[10px] font-bold uppercase text-purple-300">
                          Federal
                        </span>
                      )}
                      {c.target_locality && (
                        <span className="text-[11px] text-zinc-500">📍 {c.target_locality}</span>
                      )}
                    </div>
                    <h2 className="mt-1 font-semibold leading-snug">{c.title}</h2>
                  </div>
                  <a
                    href={`/campaigns/${c.slug}`}
                    className="shrink-0 rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-emerald-500"
                  >
                    Open campaign →
                  </a>
                </div>
                <details className="mt-3 rounded-md border border-zinc-900 bg-zinc-950">
                  <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase tracking-wider text-zinc-400 hover:text-emerald-400">
                    Preview email
                  </summary>
                  <div className="border-t border-zinc-900 p-3">
                    <p className="text-[11px] uppercase tracking-wider text-zinc-500">Subject</p>
                    <p className="mt-1 font-medium text-zinc-200">{subject}</p>
                    <p className="mt-3 text-[11px] uppercase tracking-wider text-zinc-500">Body</p>
                    <pre className="mt-1 max-h-72 overflow-y-auto whitespace-pre-wrap rounded border border-zinc-900 bg-zinc-950 p-3 font-sans text-xs leading-relaxed text-zinc-300">
{body}
                    </pre>
                    <p className="mt-2 text-[10px] text-zinc-600">
                      Per-recipient values like <span className="font-mono">{"{{recipient_title}}"}</span>{" "}
                      and <span className="font-mono">{"{{recipient_last_name}}"}</span> get filled in
                      per legislator at send time.
                    </p>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
