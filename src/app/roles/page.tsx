import Link from "next/link";

export const metadata = {
  title: "Roles & how to level up · iKratom",
  description: "How iKratom accounts work — Member, Advocate Leader, Admin, Owner — what each can do, and how to earn more responsibility in the community.",
};

type Tier = {
  name: string;
  tone: string;
  who: string;
  can: string[];
  howToGet: string;
};

const TIERS: Tier[] = [
  {
    name: "Member",
    tone: "border-zinc-600/50 text-zinc-200",
    who: "Every signed-up advocate. This is you when you join.",
    can: [
      "Track bills, legislators, and campaigns",
      "One-click email + call your reps (city, county, state, federal)",
      "Take campaign actions and earn advocacy points",
      "Post in the community, send DMs, submit intel tips",
    ],
    howToGet: "Automatic — just create a free account and add your address to match your reps.",
  },
  {
    name: "Advocate Leader",
    tone: "border-sky-600/50 text-sky-300",
    who: "Trusted, active members who help lead the community.",
    can: [
      "Everything a Member can do, plus:",
      "Author advocacy campaigns (reviewed before they go live)",
      "Help organize your state's advocates",
    ],
    howToGet:
      "Granted by an admin or the owner to members who show up consistently — take actions, keep it nonpartisan and on-message, and help others. Want it? Be active and reach out.",
  },
  {
    name: "Admin",
    tone: "border-emerald-600/50 text-emerald-300",
    who: "A small, vetted team that keeps the platform running.",
    can: [
      "Moderate the community and review submissions",
      "Manage campaigns, bills, legislators, and data syncs",
      "Promote members to Advocate Leader",
    ],
    howToGet: "Appointed by the owner, usually after a track record as an Advocate Leader.",
  },
  {
    name: "Owner",
    tone: "border-amber-600/50 text-amber-300",
    who: "The steward of the platform. Exactly one.",
    can: ["Full administration", "Appoints and removes admins"],
    howToGet: "A fixed role — not something you apply for.",
  },
];

export default function RolesPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8 text-zinc-100">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">Roles</p>
      <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Roles &amp; how to level up</h1>
      <p className="mt-2 max-w-2xl text-sm text-zinc-400">
        iKratom is community-run. Everyone starts as a Member with full access to take action;
        engaged advocates can grow into leadership. Here&apos;s how it works — and how to earn more.
      </p>

      <div className="mt-8 space-y-4">
        {TIERS.map((t, i) => (
          <div key={t.name} className={`rounded-lg border bg-zinc-950/40 p-4 ${t.tone.split(" ")[0]}`}>
            <div className="flex items-baseline gap-2">
              <span className="text-zinc-600">{i + 1}.</span>
              <h2 className={`text-base font-bold ${t.tone.split(" ")[1]}`}>{t.name}</h2>
            </div>
            <p className="mt-1 text-sm text-zinc-300">{t.who}</p>
            <p className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">What they can do</p>
            <ul className="mt-1 space-y-0.5 text-sm text-zinc-300">
              {t.can.map((c, ci) => (
                <li key={ci} className="flex gap-2"><span className="text-emerald-500">·</span>{c}</li>
              ))}
            </ul>
            <p className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">How to get it</p>
            <p className="mt-1 text-sm text-zinc-400">{t.howToGet}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 rounded-lg border border-emerald-700/40 bg-emerald-950/15 p-5">
        <h2 className="text-sm font-bold text-emerald-200">Want to do more?</h2>
        <p className="mt-1 text-sm text-zinc-300">
          The fastest path to Advocate Leader is simple: take action consistently, learn the issue, and help
          your community. Start with the <Link href="/academy" className="text-emerald-400 hover:underline">Academy</Link>{" "}
          and your <Link href="/my-district" className="text-emerald-400 hover:underline">district</Link>.
        </p>
      </div>
    </div>
  );
}
