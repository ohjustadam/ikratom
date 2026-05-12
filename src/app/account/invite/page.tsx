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

      <footer className="mt-10 rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-xs text-zinc-500">
        <p className="font-semibold text-zinc-200">A note on privacy</p>
        <p className="mt-1">
          We don&apos;t scan your contacts, sync friend lists, or auto-send messages
          on your behalf. Every share opens a draft you edit and send yourself. We
          do log which signed-up accounts came from your link so we can credit you
          — but the people you DIDN&apos;T invite don&apos;t exist to us.
        </p>
      </footer>
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
