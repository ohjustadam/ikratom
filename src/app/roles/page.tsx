import Link from "@/components/Link";
import { RoleTag } from "@/components/RoleTag";
import { PowerUserBadge } from "@/components/PowerUserBadge";
import { BADGES } from "@/modules/badges/catalog";
import { CALL_BADGES } from "@/modules/calls/call-badges";
import { GROUP_BADGES } from "@/modules/coalitions/home";

export const metadata = {
  alternates: { canonical: "/roles" },
  title: "Roles & badges",
  description:
    "What Members, Advocate Leaders, Admins and the Owner can do on iKratom, how to become a leader, and what every badge and mark means.",
};

/**
 * /roles: public, static. Every claim here was checked against the real gates
 * (permissions.ts catalog, forum-permissions.ts, getCreatorContext) on
 * 2026-11-17. Change the code and this page together.
 */
type Tier = { name: string; tag: "leader" | "admin" | null; who: string; can: string[]; how: string };

const TIERS: Tier[] = [
  {
    name: "Member", tag: null,
    who: "Everyone who signs up. Full access to take action from day one.",
    can: [
      "Follow bills, officials and campaigns in all 50 states",
      "Email or call your own officials in one click, from city hall to Congress",
      "Post in the forum and the Lounge, join or start groups, send private messages",
      "Share your story and send tips",
    ],
    how: "Automatic when you create a free account.",
  },
  {
    name: "Advocate Leader", tag: "leader",
    who: "Members who show up, keep it nonpartisan, and help others.",
    can: [
      "Everything a member can do, plus:",
      "Write campaigns (an admin checks each one before it goes live) and schedule waves on them",
      "Approve held forum posts, hide spam and abuse, lock and pin threads, review reports",
      "Approve members' stories and add local officials",
      "Sign people up in person with Field signup",
    ],
    how: "Invited by the owner (see below).",
  },
  {
    name: "Admin", tag: "admin",
    who: "A small team that helps run the platform.",
    can: [
      "Approve and publish campaigns, and fix bills, officials and the calendar",
      "Moderate everywhere, including correcting a post (it then says it was edited by a moderator)",
      "Run the data syncs and help members who are locked out",
    ],
    how: "Appointed by the owner, usually after time as a leader.",
  },
  {
    name: "Owner", tag: "admin",
    who: "The person responsible for the platform. Exactly one.",
    can: ["Everything an admin can do", "The only one who gives or removes roles and permissions"],
    how: "Not a role you apply for. The owner's tag reads Admin, like any admin's.",
  },
];

const RARITY: Record<string, string> = { common: "border-zinc-700", rare: "border-emerald-700/60", epic: "border-amber-600/60", legendary: "border-red-600/60" };

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-12 text-xl font-bold">{children}</h2>;
}

export default function RolesPage() {
  const patches = Object.values(BADGES).filter((b) => b.id !== "bipartisan_outreach");
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 text-zinc-100 sm:px-6 lg:px-8">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">Roles &amp; badges</p>
      <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Who does what here</h1>
      <p className="mt-2 max-w-2xl text-sm text-zinc-400">
        iKratom is run by and for advocates. Everyone appears by @username only; nobody&apos;s real name or
        email is ever shown to other members. Here&apos;s what each role can do and what the little marks mean.
      </p>

      <div className="mt-8 space-y-4">
        {TIERS.map((t) => (
          <section key={t.name} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
            <h3 className="flex items-center gap-1 text-base font-bold">{t.name}<RoleTag role={t.tag} /></h3>
            <p className="mt-1 text-sm text-zinc-300">{t.who}</p>
            <ul className="mt-2 space-y-0.5 text-sm text-zinc-300">
              {t.can.map((c) => <li key={c} className="flex gap-2"><span className="text-emerald-500">·</span>{c}</li>)}
            </ul>
            <p className="mt-2 text-sm text-zinc-500">{t.how}</p>
          </section>
        ))}
      </div>

      <H2>Becoming an Advocate Leader</H2>
      <p className="mt-2 text-sm text-zinc-300">
        Take action often, keep it nonpartisan, and help the people around you. The owner invites leaders. To
        keep the leader tools out of throwaway accounts, the role turns on only when your account has:
      </p>
      <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-zinc-300">
        <li>a confirmed email address,</li>
        <li>your full name and mailing address on your profile (private: used only to sign your own letters),</li>
        <li>been around for two days.</li>
      </ul>
      <p className="mt-2 text-sm text-zinc-300">
        Two-step sign-in (2FA) is strongly recommended, so a stolen password isn&apos;t enough to use your account. It
        won&apos;t hold up the role.
      </p>
      <p className="mt-2 text-sm text-zinc-300">
        If you&apos;re invited before all that&apos;s done, you get a checklist, and the role turns on by itself the moment
        it is. Then a two-minute walkthrough and a short promise to follow the rules. The{" "}
        <Link href="/how-it-works/for-leaders" className="text-emerald-400 hover:underline">leader playbook</Link> shows the tools.
      </p>

      <H2>Badges and marks</H2>
      <dl className="mt-4 space-y-4 text-sm">
        <div><dt className="font-semibold">Role tags <RoleTag role="leader" /> <RoleTag role="admin" /></dt>
          <dd className="mt-1 text-zinc-400">Beside an @username in the forum, the Lounge, groups, walls and profiles, so you know who can help moderate.</dd></div>
        <div><dt className="flex items-center gap-2 font-semibold">Academy checkmark <PowerUserBadge /></dt>
          <dd className="mt-1 text-zinc-400">Earned only by passing the <Link href="/academy" className="text-emerald-400 hover:underline">Academy</Link> final exam. It can&apos;t be bought or farmed.</dd></div>
      </dl>

      <h3 className="mt-6 text-sm font-bold uppercase tracking-wider text-zinc-400">Mission patches</h3>
      <p className="mt-1 text-sm text-zinc-400">Awarded automatically as you act. Yours are on your account&apos;s Badges page.</p>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {patches.map((b) => (
          <li key={b.id} className={`rounded-md border bg-zinc-950/40 px-3 py-2 text-sm ${RARITY[b.rarity]}`}>
            <span className="mr-1">{b.emoji}</span><span className="font-semibold">{b.name}</span>
            <span className="block text-xs text-zinc-400">{b.description}</span>
          </li>
        ))}
      </ul>

      <h3 className="mt-6 text-sm font-bold uppercase tracking-wider text-zinc-400">Call badges</h3>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {Object.entries(CALL_BADGES).map(([k, b]) => (
          <li key={k} className="rounded-md border border-zinc-700 bg-zinc-950/40 px-3 py-2 text-sm">
            <span className="mr-1">{b.emoji}</span><span className="font-semibold">{b.title}</span>
            <span className="block text-xs text-zinc-400">{b.desc}</span>
          </li>
        ))}
      </ul>

      <h3 className="mt-6 text-sm font-bold uppercase tracking-wider text-zinc-400">Group badges</h3>
      <p className="mt-1 text-sm text-zinc-400">A group earns these together from the letters its members send. Counts only, never names.</p>
      <p className="mt-2 text-sm text-zinc-300">
        {GROUP_BADGES.map((g) => `${g.icon} ${g.name} (${g.min.toLocaleString()} letters)`).join(" · ")}
      </p>

      <h3 className="mt-6 text-sm font-bold uppercase tracking-wider text-zinc-400">Other marks</h3>
      <ul className="mt-2 space-y-1 text-sm text-zinc-400">
        <li><span className="text-zinc-200">&quot;Member&quot;</span> instead of an @username: that person keeps their profile private.</li>
        <li><span className="text-zinc-200">&quot;Advocate from OK&quot;</span>: a member who hasn&apos;t picked a username yet.</li>
        <li><span className="text-emerald-400">✓ Friends</span> on a profile: you&apos;re connected.</li>
        <li><span className="text-zinc-200">&quot;Edited by a moderator&quot;</span> on a post: an admin corrected it.</li>
      </ul>
    </div>
  );
}
