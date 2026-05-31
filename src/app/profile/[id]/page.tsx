import { notFound } from "next/navigation";
import { publicHandle, handleInitials } from "@/lib/public-handle";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_public_profile", { p_id: id });
  const profile = data?.[0];
  // Title uses the public handle — never the real name (leaks in the
  // browser tab + SEO/OpenGraph otherwise).
  return { title: profile?.username ? `@${profile.username}` : "Profile" };
}

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: profileRows } = await supabase.rpc("get_public_profile", { p_id: id });
  const profile = profileRows?.[0];
  if (!profile) notFound();

  // Threads they've started (public)
  const { data: threads } = await supabase
    .from("forum_threads")
    .select("id, state, title, tag, post_count, upvote_count, created_at")
    .eq("author_id", id)
    .order("created_at", { ascending: false })
    .limit(20);

  // Campaign actions count (public stat — total actions taken)
  const { count: actionCount } = await supabase
    .from("campaign_actions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", id);

  // Current viewer (for "Send message" button)
  const { data: { user: viewer } } = await supabase.auth.getUser();
  const isSelf = viewer?.id === id;

  // Public profile shows the handle only — never the real name.
  const display = publicHandle(profile);
  const initials = handleInitials(display);

  // Role priority: Owner > Admin > Leader > Shop > Medical
  const badges: { label: string; cls: string }[] = [];
  if (profile.is_owner) badges.push({ label: "Owner", cls: "bg-amber-950/40 text-amber-300" });
  else if (profile.is_admin) badges.push({ label: "Admin", cls: "bg-emerald-950/40 text-emerald-300" });
  else if (profile.is_advocate_leader) badges.push({ label: "Advocate Leader", cls: "bg-emerald-950/40 text-emerald-300" });
  if (profile.is_shop_owner) badges.push({ label: "Shop Owner", cls: "bg-purple-950/40 text-purple-300" });
  if (profile.is_medical_professional) badges.push({ label: "Medical Professional", cls: "bg-blue-950/40 text-blue-300" });

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      {/* Header card */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-6">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xl font-bold text-zinc-300">
            {initials || "?"}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold">{display}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              {(profile.city || profile.state) && (
                <span className="text-zinc-500">
                  {[profile.city, profile.state].filter(Boolean).join(", ")}
                </span>
              )}
              {profile.created_at && (
                <span className="text-zinc-500">
                  · Joined {new Date(profile.created_at).toLocaleDateString(undefined, { month: "short", year: "numeric" })}
                </span>
              )}
            </div>
            {profile.is_shop_owner && profile.shop_name && (
              <p className="mt-1 text-sm text-zinc-400">
                <span className="text-zinc-500">Shop:</span> {profile.shop_name}
              </p>
            )}
            {badges.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {badges.map((b) => (
                  <span key={b.label} className={`rounded px-2 py-0.5 text-xs font-semibold ${b.cls}`}>
                    {b.label}
                  </span>
                ))}
              </div>
            )}
          </div>
          {!isSelf && viewer && profile.public_key && (
            <a
              href={`/messages/new?to=${id}`}
              className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
            >
              Send message
            </a>
          )}
          {isSelf && (
            <a
              href="/account"
              className="rounded-md border border-zinc-700 px-4 py-2 text-sm hover:border-emerald-500"
            >
              Edit profile
            </a>
          )}
        </div>
      </div>

      {/* Public stats */}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Threads started" value={threads?.length ?? 0} />
        <Stat label="Actions taken" value={actionCount ?? 0} />
        <Stat label="Member" value={profile.created_at ? `${monthsSince(profile.created_at)} mo` : "—"} />
      </div>

      {/* Public threads */}
      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Threads
        </h2>
        {threads && threads.length > 0 ? (
          <ul className="space-y-2">
            {threads.map((t) => (
              <li key={t.id}>
                <a
                  href={`/forum/${t.state ?? "national"}/${t.id}`}
                  className="block rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 hover:border-emerald-700/50"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    {t.state && <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-zinc-300">{t.state}</span>}
                    <span className="rounded bg-zinc-900 px-1.5 py-0.5 capitalize">{t.tag}</span>
                    <span>↑ {t.upvote_count}</span>
                    <span>💬 {t.post_count}</span>
                    <span className="ml-auto">{new Date(t.created_at).toLocaleDateString()}</span>
                  </div>
                  <h3 className="mt-1 text-base font-semibold leading-tight">{t.title}</h3>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-500">No public threads yet.</p>
        )}
      </section>

      <p className="mt-12 text-xs text-zinc-600">
        iKratom protects member privacy. Address, email, and phone are never shown publicly.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-center">
      <div className="text-2xl font-bold text-zinc-100">{value}</div>
      <div className="text-xs text-zinc-500">{label}</div>
    </div>
  );
}

function monthsSince(iso: string): number {
  const then = new Date(iso);
  const now = new Date();
  return (now.getFullYear() - then.getFullYear()) * 12 + (now.getMonth() - then.getMonth());
}
