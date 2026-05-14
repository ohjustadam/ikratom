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
import { getDiscordLink } from "@/modules/auth/actions-discord";
import { DiscordConnect } from "@/modules/auth/components/DiscordConnect";

export const metadata = { title: "Account" };

/**
 * /account — settings hub.
 *
 * Reorganized per ROADMAP.md (2026-05-12): the previous 17-section
 * vertical scroll is now grouped into 6 anchored sections with a
 * sticky sidebar so settings are scannable + jump-linkable. All the
 * existing inline forms + sub-page links are preserved; only the
 * ordering + grouping + nav affordance changed.
 *
 * Groups (sidebar order):
 *   1. Identity           — Profile, Character, Vendor status
 *   2. Security & privacy — 2FA link, E2E fingerprint, Blocked users
 *   3. Notifications      — In-app prefs + Push subscribe (merged)
 *   4. Integrations       — Gmail + Discord
 *   5. Advocacy tools     — Templates, Email presets, Saved searches
 *   6. Recognition & growth — Badges, Invite friends
 *   7. Your data          — Export + delete (Danger Zone — at the end intentionally)
 */
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
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">Your account</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Civic info is used <strong className="text-zinc-200">only</strong> to match
          you to your specific legislators so emails go to the right offices. We
          don&apos;t sell or share with advocacy orgs.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
        {/* ── Sticky sidebar nav ───────────────────────────────── */}
        <nav className="lg:sticky lg:top-24 lg:self-start">
          <ul className="flex flex-wrap gap-1 lg:flex-col lg:gap-0 text-sm">
            <SideLink href="#identity" emoji="🪪">Identity</SideLink>
            <SideLink href="#security-privacy" emoji="🔒">Security &amp; privacy</SideLink>
            <SideLink href="#notifications" emoji="🔔">Notifications</SideLink>
            <SideLink href="#integrations" emoji="🔌">Integrations</SideLink>
            <SideLink href="#advocacy" emoji="📣">Advocacy tools</SideLink>
            <SideLink href="#growth" emoji="📈">Recognition &amp; growth</SideLink>
            <SideLink href="#data" emoji="⚠">Your data</SideLink>
          </ul>
        </nav>

        {/* ── Sections ──────────────────────────────────────────── */}
        <div className="space-y-12">
          {/* 1. Identity */}
          <Section id="identity" title="Identity" intro="Who you are on the platform.">
            <ProfileForm profile={profile} email={email} />

            <LinkCard
              href="/account/character"
              accent
              title="🎭 Your character"
              body="Optional fields that power AI tailoring on legislator emails — your kratom story, what's at stake, advocate type, video clip URL, profile visibility."
              cta="Edit your character"
            />

            <LinkCard
              href="/account/vendor"
              title="Verified vendor"
              body="Get verified to send advocacy emails as your shop or brand in addition to as yourself."
              cta="Manage vendor status"
            />
          </Section>

          {/* 2. Security & privacy */}
          <Section
            id="security-privacy"
            title="Security & privacy"
            intro="Two-factor auth, encryption status, blocklist."
          >
            <LinkCard
              href="/account/security"
              title="Two-factor authentication"
              body="Add an authenticator app for a second sign-in step. Required for admin + leader accounts. Manage trusted devices, sessions, backup codes."
              cta="Manage 2FA"
            />

            <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
              <h3 className="mb-3 text-sm font-semibold">Direct-message encryption</h3>
              <p className="mb-3 text-xs text-zinc-500">
                Your DMs are end-to-end encrypted by default. No setup needed.
              </p>
              <E2EFingerprint />
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
              <h3 className="mb-3 text-sm font-semibold">Blocked users</h3>
              <BlockedUsersList blocked={blocked} />
            </div>
          </Section>

          {/* 3. Notifications */}
          <Section
            id="notifications"
            title="Notifications"
            intro="Pick which campaigns reach you, where, and how often. In-app + push live together here."
          >
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
              <h3 className="mb-3 text-sm font-semibold">In-app preferences</h3>
              <NotificationPrefsForm initial={notifPrefs} />
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
              <h3 className="mb-1 text-sm font-semibold">Push notifications</h3>
              <p className="mb-3 text-xs text-zinc-500">
                Browser/phone alert the moment a hostile bill drops in your state,
                or when a wave you joined fires.
              </p>
              <PushSubscribe vapidPublicKey={vapidPublicKey} />
            </div>
          </Section>

          {/* 4. Integrations */}
          <Section
            id="integrations"
            title="Integrations"
            intro="Connect outside accounts so iKratom can act on your behalf when you tell it to."
          >
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
              <h3 className="mb-3 text-sm font-semibold">Gmail (one-click batch sending)</h3>
              <GmailConnect
                status={gmailStatus}
                flashError={sp.gmail_error ?? null}
                flashConnected={sp.gmail_connected === "1"}
              />
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
              <h3 className="mb-3 text-sm font-semibold">Discord</h3>
              <DiscordConnect
                link={discordLink}
                flashError={sp.discord_error ?? null}
                flashConnected={sp.discord_connected === "1"}
              />
            </div>
          </Section>

          {/* 5. Advocacy tools */}
          <Section id="advocacy" title="Advocacy tools" intro="Streamline how you take action.">
            <LinkCard
              href="/account/templates"
              title="My templates"
              body="See every active campaign rendered with your info filled in — so you know what gets sent before you click."
              cta="Preview templates"
            />

            <LinkCard
              href="/account/email-presets"
              title="Email tone presets"
              body="Save up to 5 named templates you can pick from when sending campaign actions."
              cta="Manage email presets"
            />

            <LinkCard
              href="/account/saved-searches"
              title="Saved searches"
              body="Custom alert rules. Get notified when a new bill matches your criteria."
              cta="Manage saved searches"
            />
          </Section>

          {/* 6. Recognition & growth */}
          <Section
            id="growth"
            title="Recognition & growth"
            intro="Your badges + the link you use to bring others in."
          >
            <LinkCard
              href="/account/invite"
              accent
              title="Invite friends"
              body="Your share link with QR + 11-platform share buttons. See who joined and who's taken action through your link."
              cta="Open invite hub"
            />

            <LinkCard
              href="/account/badges"
              title="Mission patches"
              body="Earned badges from your platform activity."
              cta="View badges"
            />
          </Section>

          {/* 7. Your data — Danger Zone last on purpose */}
          <Section
            id="data"
            title="Your data"
            intro="Export everything we have on you, or permanently delete your account."
          >
            <div className="rounded-lg border border-red-900/40 bg-red-950/10 p-5">
              <DangerZone />
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

function SideLink({ href, emoji, children }: { href: string; emoji: string; children: React.ReactNode }) {
  return (
    <li>
      <a
        href={href}
        className="flex items-center gap-2 rounded px-3 py-1.5 text-zinc-300 hover:bg-zinc-900 hover:text-emerald-400"
      >
        <span aria-hidden>{emoji}</span>
        <span>{children}</span>
      </a>
    </li>
  );
}

function Section({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <header className="mb-4 border-b border-zinc-800 pb-2">
        <h2 className="text-xl font-bold">{title}</h2>
        <p className="mt-1 text-xs text-zinc-500">{intro}</p>
      </header>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function LinkCard({
  href,
  title,
  body,
  cta,
  accent,
}: {
  href: string;
  title: string;
  body: string;
  cta: string;
  accent?: boolean;
}) {
  const cls = accent
    ? "border-emerald-700/40 bg-emerald-950/10"
    : "border-zinc-800 bg-zinc-950/40";
  const ctaCls = accent
    ? "bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
    : "border border-zinc-700 text-zinc-200 hover:border-emerald-500";
  return (
    <div className={`rounded-lg border ${cls} p-5`}>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="my-2 text-xs text-zinc-500">{body}</p>
      <a
        href={href}
        className={`inline-flex items-center rounded-md px-3 py-1.5 text-xs font-semibold ${ctaCls}`}
      >
        {cta} →
      </a>
    </div>
  );
}
