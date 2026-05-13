import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { InviteFriends } from "@/components/InviteFriends";
import { renderQrSvg } from "@/modules/partners/qr";
import { getMyInviteSummary, listMyInvitees, buildInviteUrl } from "@/modules/invite/actions";

export const metadata = { title: "Invite friends" };
export const dynamic = "force-dynamic";

/**
 * /account/invite — every user's invite hub.
 *
 * Surfaces:
 *   - Your personal /i/CODE link with copy button
 *   - QR code (same SVG renderer the partner kit uses) for offline sharing
 *   - 11-platform share buttons via the shared InviteFriends component
 *   - Funnel stats: total signed-up, total who've taken first action
 *   - Recent invitees list (public-safe fields only)
 */
export default async function InvitePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/account/invite");

  const summary = await getMyInviteSummary();
  if (!summary?.invite_code) {
    // Trigger backfills missing codes but defensive UI just in case.
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold">Invite friends</h1>
        <p className="mt-4 text-sm text-zinc-400">
          We&apos;re setting up your invite code. Refresh this page in a moment.
        </p>
      </div>
    );
  }

  const inviteUrl = await buildInviteUrl(summary.invite_code);
  const qrSvg = await renderQrSvg(inviteUrl, { size: 280 });
  const invitees = await listMyInvitees(25);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/account" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Account
      </a>

      <header className="mt-2 mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          Grow the platform
        </p>
        <h1 className="mt-2 text-3xl font-bold">Invite friends to iKratom</h1>
        <p className="mt-3 text-sm text-zinc-400">
          Every advocate who joins via your link makes the platform stronger. Lawmakers
          notice volume — the more of us emailing them, the harder we are to ignore.
          When someone signs up through your link, we credit you on this page.
        </p>
      </header>

      {/* Funnel stats */}
      <section className="mb-8 grid gap-4 sm:grid-cols-3">
        <Stat label="Friends joined" value={summary.total_signups} />
        <Stat
          label="Took first action"
          value={summary.total_with_first_action}
          accent={summary.total_with_first_action > 0 ? "ok" : "neutral"}
        />
        <Stat
          label="Conversion"
          value={
            summary.total_signups > 0
              ? `${Math.round((summary.total_with_first_action / summary.total_signups) * 100)}%`
              : "—"
          }
          sub="joined → action"
        />
      </section>

      {/* QR + share buttons side by side on desktop */}
      <section className="mb-8 grid gap-6 sm:grid-cols-5">
        {/* QR */}
        <div className="sm:col-span-2">
          <div className="rounded-lg border border-zinc-800 bg-white p-3">
            <div
              className="aspect-square w-full"
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
          </div>
          <p className="mt-2 text-center text-[11px] text-zinc-500">
            Print + post at events, shows, or your shop counter.
          </p>
        </div>

        {/* Share area */}
        <div className="sm:col-span-3">
          <p className="text-xs uppercase tracking-wider text-zinc-500">
            Your invite link
          </p>
          <p className="mt-1 font-mono text-sm text-zinc-200 break-all">
            {inviteUrl}
          </p>
          <div className="mt-4">
            <InviteFriends inviteUrl={inviteUrl} />
          </div>
        </div>
      </section>

      {/* Invitees list */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">
          Friends you&apos;ve brought in
          <span className="ml-2 text-xs font-normal text-zinc-500">
            (most recent {invitees.length})
          </span>
        </h2>
        {invitees.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 p-8 text-center text-sm text-zinc-500">
            <p>No invitees yet.</p>
            <p className="mt-1 text-xs">
              Once someone signs up through your link, they&apos;ll show here. We
              only display their public username + state — never email or other PII.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-zinc-900 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/40">
            {invitees.map((iv) => (
              <li key={iv.invitee_id} className="flex items-center gap-3 p-3 text-sm">
                <a
                  href={`/profile/${iv.invitee_id}`}
                  className="font-medium text-zinc-100 hover:text-emerald-400 hover:underline"
                >
                  {iv.username ?? "(private profile)"}
                </a>
                {iv.state && (
                  <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
                    {iv.state}
                  </span>
                )}
                <span className="grow" />
                {iv.first_action_at ? (
                  <span className="rounded bg-emerald-950/40 px-1.5 py-0.5 text-[10px] text-emerald-300">
                    ✓ Took action {timeAgo(iv.first_action_at)}
                  </span>
                ) : iv.signed_up_at ? (
                  <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400">
                    Joined {timeAgo(iv.signed_up_at)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Privacy disclosure — explicit, line-by-line on what we do / don't do.
          Owner principle: "we must keep our safety and autonomy." */}
      <section className="mt-10 rounded-lg border border-emerald-700/30 bg-emerald-950/10 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-emerald-300">
          🔒 Your contacts. Your friends. Your business.
        </h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-bold uppercase text-emerald-300">What stays private</p>
            <ul className="mt-2 space-y-1.5 text-xs text-zinc-300">
              <li>✅ Your phone book — never sent to our servers</li>
              <li>✅ Who you message — invisible to us; we only see who clicks</li>
              <li>✅ Your social media friends — we don&apos;t connect to any platform&apos;s friend list, ever</li>
              <li>✅ Your draft messages — composed in your phone, edited by you, sent by you</li>
              <li>✅ Who you didn&apos;t invite — doesn&apos;t exist to us</li>
            </ul>
          </div>
          <div>
            <p className="text-xs font-bold uppercase text-emerald-300">What we track</p>
            <ul className="mt-2 space-y-1.5 text-xs text-zinc-300">
              <li>📊 When someone signs up via your link, we credit you here</li>
              <li>📊 How many of your invitees took their first advocacy action</li>
              <li>📊 Aggregate platform-share counts (no PII) — to know which deep links actually work</li>
            </ul>
          </div>
        </div>
        <div className="mt-4 rounded border border-zinc-800 bg-zinc-950/60 p-3 text-[11px] text-zinc-400">
          <p className="font-semibold text-zinc-200">Why no &ldquo;connect Facebook friends&rdquo; button?</p>
          <p className="mt-1">
            Because that button would be a lie. Facebook removed third-party access to friend lists
            in 2014. Twitter/X moved friend-list access to a $100+/month paid tier. Instagram, TikTok,
            and Snapchat never offered it. Any &ldquo;sync your social friends&rdquo; flow you see
            in any other app today is either gated behind paid API access or is repurposing different
            data than you think. We won&apos;t pretend to do something we can&apos;t do safely.
          </p>
          <p className="mt-2">
            What works without any of that: your phone&apos;s native share sheet shows every messaging
            app you have installed (Messenger, WhatsApp, Signal, Discord, Snapchat, Instagram DMs,
            etc.) plus your AirDrop / Quick Share recipients. One tap, you pick who. We never see.
          </p>
        </div>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  accent = "neutral",
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: "ok" | "neutral";
}) {
  const tone = accent === "ok" ? "text-emerald-300" : "text-zinc-100";
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <p className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={`mt-1 text-3xl font-bold ${tone}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[10px] text-zinc-500">{sub}</p>}
    </div>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
