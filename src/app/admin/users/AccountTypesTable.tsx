/**
 * Account-type reference — a side-by-side of the four roles: what each can
 * do, what it requires, and how it's granted. Rendered (collapsed) on
 * /admin/users to support promote/demote decisions. Pure presentational;
 * the source of truth for capabilities is AGENTS.md + getAdminContext().
 */

type Row = {
  role: string;
  flag: string;
  tone: string; // border/text accent
  count?: number;
  who: string;
  can: string[];
  cannot: string;
  howToGet: string;
};

export function AccountTypesTable({
  counts,
}: {
  counts?: { owners: number; admins: number; leaders: number; members: number };
}) {
  const rows: Row[] = [
    {
      role: "Owner",
      flag: "profiles.is_owner",
      tone: "border-amber-600/50 text-amber-300",
      count: counts?.owners,
      who: "You. Exactly one, ever.",
      can: [
        "Everything an admin can, plus:",
        "Promote / demote admins",
        "Grant or revoke ownership",
        "Full command center (/admin/ops, checklist, AI editor)",
      ],
      cannot: "—",
      howToGet: "Fixed to the OWNER_EMAIL env var. Not grantable in the UI; a second owner is a deliberate env + DB change.",
    },
    {
      role: "Admin",
      flag: "profiles.is_admin",
      tone: "border-emerald-600/50 text-emerald-300",
      count: counts?.admins,
      who: "Trusted operators who help you run the platform.",
      can: [
        "Moderate users (lock, warn), forum + lounge",
        "Manage campaigns, legislators, bills, states",
        "Review intel + campaign queues; run syncs",
        "Promote users to Advocate Leader or Admin",
      ],
      cannot: "Promote/demote admins or touch ownership (owner-only).",
      howToGet: "Granted by the Owner here on this page (toggle the Admin role). This is the role to grant a co-helper.",
    },
    {
      role: "Advocate Leader",
      flag: "profiles.is_advocate_leader",
      tone: "border-sky-600/50 text-sky-300",
      count: counts?.leaders,
      who: "Engaged community members who author advocacy content.",
      can: [
        "Author campaigns (subject to review)",
        "Everything a User can do",
      ],
      cannot: "No moderation, no user management, no sync/admin tools.",
      howToGet: "Granted by an Admin or Owner here. A lower-trust step below Admin — good for vetting a helper before full admin.",
    },
    {
      role: "User",
      flag: "(default)",
      tone: "border-zinc-600/50 text-zinc-300",
      count: counts?.members,
      who: "Every signed-up advocate.",
      can: [
        "Read public data (bills, legislators, campaigns)",
        "Take campaign / email actions, manage own profile",
        "Post in forum + lounge, send DMs",
      ],
      cannot: "No admin, moderation, or authoring tools.",
      howToGet: "Automatic on email signup. No action needed.",
    },
  ];

  return (
    <details className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-zinc-300 hover:text-emerald-300">
        Account types — what each can do &amp; how it&apos;s granted
      </summary>
      <div className="overflow-x-auto border-t border-zinc-800 p-4">
        <div className="grid min-w-[720px] grid-cols-4 gap-3">
          {rows.map((r) => (
            <div key={r.role} className={`rounded-lg border bg-zinc-950/60 p-3 ${r.tone.split(" ")[0]}`}>
              <div className="flex items-baseline justify-between gap-2">
                <h3 className={`text-sm font-bold ${r.tone.split(" ")[1]}`}>{r.role}</h3>
                {typeof r.count === "number" && (
                  <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">{r.count}</span>
                )}
              </div>
              <p className="mt-0.5 font-mono text-[9px] text-zinc-600">{r.flag}</p>
              <p className="mt-2 text-[11px] text-zinc-300">{r.who}</p>
              <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Can</p>
              <ul className="mt-1 space-y-0.5 text-[11px] text-zinc-300">
                {r.can.map((c, i) => (
                  <li key={i} className="flex gap-1"><span className="text-emerald-500">·</span>{c}</li>
                ))}
              </ul>
              <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Can&apos;t</p>
              <p className="mt-1 text-[11px] text-zinc-400">{r.cannot}</p>
              <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">How to get it</p>
              <p className="mt-1 text-[11px] text-zinc-400">{r.howToGet}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-zinc-500">
          Thinking of adding a co-admin? Grant <strong className="text-sky-300">Advocate Leader</strong> first to vet them, then{" "}
          <strong className="text-emerald-300">Admin</strong> when you&apos;re confident — only you (Owner) can grant Admin, and
          only you can ever take it back.
        </p>
      </div>
    </details>
  );
}
