import { HeaderShareButton } from "./HeaderShareButton";
import { InviteFriends } from "./InviteFriends";
import { getMyInviteSummary, buildInviteUrl } from "@/modules/invite/actions";

/**
 * Server-rendered wrapper that picks the right share payload based on
 * auth state, then hands it to the client-side HeaderShareButton modal
 * trigger.
 *
 *   Signed-in:  user's personal /i/CODE invite link → attributed share
 *   Signed-out: generic homepage URL → unattributed but functional
 *
 * The modal contents are passed through as children so we don't have
 * to ship the auth check into the client bundle.
 */
export async function HeaderShare() {
  const summary = await getMyInviteSummary();
  let inviteUrl: string;
  let isPersonal: boolean;
  if (summary?.invite_code) {
    inviteUrl = await buildInviteUrl(summary.invite_code);
    isPersonal = true;
  } else {
    inviteUrl = (process.env.APP_URL ?? "https://www.ikratom.org").replace(/\/+$/, "");
    isPersonal = false;
  }

  return (
    <HeaderShareButton>
      <p className="text-xs text-zinc-400">
        {isPersonal
          ? "Your personal invite link — anyone who signs up through it gets credited to you on your /account/invite page."
          : "Spread the word. Anyone who joins helps push back on hostile rulemaking. Sign in first if you want credit for invites you bring in."}
      </p>
      <div className="mt-3">
        <InviteFriends inviteUrl={inviteUrl} compact />
      </div>
      {isPersonal && (
        <p className="mt-3 text-center text-xs">
          <a href="/account/invite" className="text-emerald-400 hover:underline">
            Open full invite hub →
          </a>
        </p>
      )}
    </HeaderShareButton>
  );
}
