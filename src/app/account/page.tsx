import { getProfile } from "@/modules/auth/actions";
import { ProfileForm } from "@/modules/auth/components/ProfileForm";
import { getGmailStatus } from "@/modules/auth/actions-gmail";
import { GmailConnect } from "@/modules/auth/components/GmailConnect";
import { E2EFingerprint } from "@/modules/auth/components/E2EFingerprint";
import { BlockedUsersList } from "@/modules/auth/components/BlockedUsersList";
import { DangerZone } from "@/modules/auth/components/DangerZone";
import { listBlockedUsers } from "@/modules/dm/block-actions";
import { getNotificationPrefs } from "@/modules/notifications/actions";
import { NotificationPrefsForm } from "@/modules/notifications/components/NotificationPrefsForm";
import { getPushVapidPublicKey } from "@/modules/auth/actions-push";
import { PushSubscribe } from "@/modules/auth/components/PushSubscribe";
import { ReplayTourButton } from "./ReplayTourButton";
import { getDiscordLink } from "@/modules/auth/actions-discord";
import { DiscordConnect } from "@/modules/auth/components/DiscordConnect";

export const metadata = { title: "Account" };

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{
    gmail_error?: string;
    gmail_connected?: string;
    discord_error?: string;
    discord_connected?: string;
  }>;
}) {
  const sp = await searchParams;
  const { profile, email } = await getProfile();
  const notifPrefs = await getNotificationPrefs();
  const gmailStatus = await getGmailStatus();
  const blocked = await listBlockedUsers();
  const vapidPublicKey = await getPushVapidPublicKey();
  const discordLink = await getDiscordLink();

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">Your account</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Civic info is used <strong className="text-zinc-200">only</strong> to match
          you to your specific legislators so emails go to the right offices.
          Other users see your <span className="text-zinc-200">city + state</span>, never
          your street address. We don&apos;t sell or share this with advocacy orgs.
        </p>
      </header>

      <ProfileForm profile={profile} email={email} />

      <header className="mb-6 mt-12">
        <h2 className="text-2xl font-bold">Email integration</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Connect your email account to enable true one-click batch sending.
        </p>
      </header>
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <GmailConnect
          status={gmailStatus}
          flashError={sp.gmail_error ?? null}
          flashConnected={sp.gmail_connected === "1"}
        />
      </div>

      <header className="mb-6 mt-12">
        <h2 className="text-2xl font-bold">Discord</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Link your Discord to be recognized across the iKratom community network.
        </p>
      </header>
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <DiscordConnect
          link={discordLink}
          flashError={sp.discord_error ?? null}
          flashConnected={sp.discord_connected === "1"}
        />
      </div>

      <header className="mb-6 mt-12">
        <h2 className="text-2xl font-bold">Security</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Two-factor authentication and sign-in protections.
        </p>
      </header>
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <a
          href="/account/security"
          className="inline-flex items-center gap-2 rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium hover:border-emerald-500 hover:text-emerald-400"
        >
          Manage 2FA →
        </a>
        <p className="mt-3 text-xs text-zinc-500">
          Add an authenticator app for a second sign-in step. Required for admin and
          advocate-leader accounts.
        </p>
      </div>

      <header className="mb-6 mt-12">
        <h2 className="text-2xl font-bold">Verified vendor</h2>
        <p className="mt-1 text-sm text-zinc-400">
          For business owners — get verified to send advocacy emails as your shop or brand,
          in addition to as yourself.
        </p>
      </header>
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <a
          href="/account/vendor"
          className="inline-flex items-center gap-2 rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium hover:border-emerald-500 hover:text-emerald-400"
        >
          Manage vendor status →
        </a>
        <p className="mt-3 text-xs text-zinc-500">
          Apply to be verified, view approval status, and see your business representation.
        </p>
      </div>

      <header className="mb-6 mt-12">
        <h2 className="text-2xl font-bold">Privacy</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Your direct messages are end-to-end encrypted by default. No setup needed.
        </p>
      </header>
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <E2EFingerprint />
      </div>

      <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <h3 className="mb-3 text-sm font-semibold">Blocked users</h3>
        <BlockedUsersList blocked={blocked} />
      </div>

      <header className="mb-6 mt-12">
        <h2 className="text-2xl font-bold">Notifications</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Pick which campaigns you want to hear about, how often, and how they reach you.
        </p>
      </header>
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <NotificationPrefsForm initial={notifPrefs} />
      </div>

      <div className="mt-4 rounded-lg border border-emerald-700/40 bg-emerald-950/10 p-5">
        <h3 className="mb-1 text-sm font-semibold text-emerald-300">🎭 Your character</h3>
        <p className="mb-3 text-xs text-zinc-400">
          Optional fields that power AI tailoring on legislator emails — your kratom
          story, what&apos;s at stake for you, advocate type, video clip URL, profile
          visibility.
        </p>
        <a
          href="/account/character"
          className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400"
        >
          Edit your character →
        </a>
      </div>

      <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <h3 className="mb-1 text-sm font-semibold">My templates</h3>
        <p className="mb-3 text-xs text-zinc-500">
          See every active campaign rendered with your info filled in — so you know
          what gets sent before you click send.
        </p>
        <a
          href="/dashboard/templates"
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:border-emerald-500"
        >
          Preview templates →
        </a>
      </div>

      <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <h3 className="mb-1 text-sm font-semibold">Email tone presets</h3>
        <p className="mb-3 text-xs text-zinc-500">
          Save up to 5 named templates you can pick from when sending campaign actions.
        </p>
        <a
          href="/account/email-presets"
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:border-emerald-500"
        >
          Manage email presets →
        </a>
      </div>

      <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <h3 className="mb-1 text-sm font-semibold">Mission patches</h3>
        <p className="mb-3 text-xs text-zinc-500">
          Earned badges from your platform activity.
        </p>
        <a
          href="/account/badges"
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:border-emerald-500"
        >
          View badges →
        </a>
      </div>

      <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <h3 className="mb-1 text-sm font-semibold">Saved searches</h3>
        <p className="mb-3 text-xs text-zinc-500">
          Custom alert rules. Get notified when a new bill matches your criteria.
        </p>
        <a
          href="/account/saved-searches"
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:border-emerald-500"
        >
          Manage saved searches →
        </a>
      </div>

      <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <h3 className="mb-1 text-sm font-semibold">Invite friends</h3>
        <p className="mb-3 text-xs text-zinc-500">
          Your share link with QR + 11-platform share buttons. See who joined and
          who&apos;s taken action through your link.
        </p>
        <a
          href="/account/invite"
          className="rounded-md border border-emerald-700/40 bg-emerald-950/20 px-3 py-1.5 text-xs text-emerald-300 hover:border-emerald-500"
        >
          Open invite hub →
        </a>
      </div>

      <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <h3 className="mb-1 text-sm font-semibold">Cockpit tour</h3>
        <p className="mb-3 text-xs text-zinc-500">
          Replay the first-time walkthrough on your dashboard.
        </p>
        <ReplayTourButton />
      </div>

      <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <h3 className="mb-1 text-sm font-semibold">Push notifications</h3>
        <p className="mb-3 text-xs text-zinc-500">
          Get a browser/phone alert the moment a hostile bill drops in your state,
          or when a wave you joined is firing.
        </p>
        <PushSubscribe vapidPublicKey={vapidPublicKey} />
      </div>

      <header className="mb-6 mt-12">
        <h2 className="text-2xl font-bold">Your data</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Export everything we have on you, or permanently delete your account.
        </p>
      </header>
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <DangerZone />
      </div>
    </div>
  );
}
