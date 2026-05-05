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

export const metadata = { title: "Account" };

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ gmail_error?: string; gmail_connected?: string }>;
}) {
  const sp = await searchParams;
  const { profile, email } = await getProfile();
  const notifPrefs = await getNotificationPrefs();
  const gmailStatus = await getGmailStatus();
  const blocked = await listBlockedUsers();

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">Your account</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Civic info is used to autofill emails to your legislators. We never share this publicly.
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
