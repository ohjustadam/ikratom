import { createClient } from "@/lib/supabase/server";

/**
 * "Welcome to the war room — here's what's at your disposal."
 *
 * Surfaces only on the first few /dashboard visits — defined as: user
 * has no campaign actions, no forum threads, no DMs sent. Once they've
 * touched any of those tools, they don't need the tutorial card and we
 * hide this widget. Frees up the cockpit for power-user widgets.
 *
 * Educates on three tools that often go unnoticed: Communities,
 * Forums, Messages. Each gets a tile with a 1-line explanation and a
 * direct link.
 */
export async function WelcomeExploreWidget({ userId }: { userId: string }) {
  const supabase = await createClient();

  const [{ count: actions }, { count: threads }, { count: dms }] = await Promise.all([
    supabase.from("campaign_actions").select("id", { count: "exact", head: true }).eq("user_id", userId),
    supabase.from("forum_threads").select("id", { count: "exact", head: true }).eq("author_id", userId),
    supabase.from("dm_messages").select("id", { count: "exact", head: true }).eq("sender_id", userId),
  ]);

  const totalActivity = (actions ?? 0) + (threads ?? 0) + (dms ?? 0);
  if (totalActivity > 0) return null; // user has used the platform — hide

  const tiles = [
    {
      href: "/forum",
      icon: "💬",
      title: "Community",
      blurb:
        "Live Lounge chat, state-specific forums, and a recent-activity feed. The social layer of the war room — meet other advocates in your state.",
      cta: "Open community →",
    },
    {
      href: "/messages",
      icon: "🔒",
      title: "Encrypted DMs",
      blurb:
        "End-to-end encrypted direct messages. Use these for private coordination — not even iKratom can read them.",
      cta: "Open messages →",
    },
    {
      href: "/campaigns",
      icon: "📣",
      title: "Take your first action",
      blurb:
        "Active campaigns — bills moving right now where your voice matters. One-click to send a personalized email to your reps.",
      cta: "See campaigns →",
    },
  ];

  return (
    <section className="rounded-xl border border-emerald-700/40 bg-emerald-950/10 p-4">
      <div className="mb-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400">welcome</p>
        <h2 className="text-base font-bold text-zinc-100">
          You&apos;re in. Three tools to know about:
        </h2>
        <p className="mt-1 text-xs text-zinc-400">
          The dashboard is your cockpit. The platform&apos;s deeper tools live one click away.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {tiles.map((t) => (
          <a
            key={t.href}
            href={t.href}
            className="block rounded-md border border-zinc-800 bg-zinc-950/60 p-3 transition hover:border-emerald-500"
          >
            <div className="mb-1 flex items-center gap-2">
              <span aria-hidden className="text-lg">
                {t.icon}
              </span>
              <h3 className="text-sm font-semibold text-zinc-100">{t.title}</h3>
            </div>
            <p className="text-xs text-zinc-400">{t.blurb}</p>
            <p className="mt-2 text-[11px] font-semibold text-emerald-400">{t.cta}</p>
          </a>
        ))}
      </div>
    </section>
  );
}
