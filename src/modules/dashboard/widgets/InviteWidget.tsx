import { getMyInviteSummary, buildInviteUrl } from "@/modules/invite/actions";

/**
 * Compact invite-friends widget for the dashboard cockpit. Shows the
 * user's invite link + funnel counts + a "Open invite hub →" link.
 * Full UX (QR, all 11 platforms, invitees list) lives at
 * /account/invite.
 *
 * Renders null if the user has no invite code yet — shouldn't happen
 * after the backfill in migration 0102 but defensive.
 */
export async function InviteWidget() {
  const summary = await getMyInviteSummary();
  if (!summary?.invite_code) return null;
  const inviteUrl = await buildInviteUrl(summary.invite_code);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <header className="flex items-baseline justify-between">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          Invite friends
        </p>
        <a
          href="/account/invite"
          className="text-[11px] text-emerald-400 hover:underline"
        >
          Open hub →
        </a>
      </header>

      <p className="mt-2 text-xs text-zinc-400">
        Volume is leverage. Every new advocate who joins through your link gets
        credited here.
      </p>

      <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5">
        <p className="min-w-0 truncate font-mono text-xs text-zinc-200">
          {inviteUrl}
        </p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div>
          <p className="text-[11px] text-zinc-500">Joined</p>
          <p className="font-bold text-zinc-100">{summary.total_signups}</p>
        </div>
        <div>
          <p className="text-[11px] text-zinc-500">Took action</p>
          <p className={`font-bold ${summary.total_with_first_action > 0 ? "text-emerald-300" : "text-zinc-100"}`}>
            {summary.total_with_first_action}
          </p>
        </div>
      </div>
    </section>
  );
}
