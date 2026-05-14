import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import { listStateStances } from "@/modules/admin/stance-actions";
import { StanceList } from "./StanceList";

export const metadata = { title: "Legislator kratom stance review" };
export const dynamic = "force-dynamic";

/**
 * /admin/stance?state=NY — review + flip AI-drafted legislator stances.
 *
 * Drafts come from scripts/draft-legislator-stance.mjs. Admin reviews
 * each row and clicks champion/sympathetic/neutral/hostile/unknown.
 * One-click save with optimistic UI feedback. Edit rationale + evidence
 * URL inline.
 *
 * Currently filtered to state. Default NY since that's the model state.
 */
export default async function StanceReviewPage({
  searchParams,
}: {
  searchParams?: Promise<{ state?: string; filter?: string }>;
}) {
  const ctx = await getAdminContext();
  if (!ctx.ok) redirect("/dashboard");
  const sp = (await searchParams) ?? {};
  const state = (sp.state ?? "NY").toUpperCase();
  const filter = sp.filter ?? "all"; // all | drafted | undrafted

  const { legs, stances } = await listStateStances(state);

  // Filter by stance state
  const visible = legs.filter((l) => {
    const s = stances.get(l.id);
    if (filter === "drafted") return !!s;
    if (filter === "undrafted") return !s;
    return true;
  });

  // Counts by stance
  const counts = { champion: 0, sympathetic: 0, neutral: 0, hostile: 0, unknown: 0, none: 0 };
  for (const l of legs) {
    const s = stances.get(l.id);
    if (!s) counts.none++;
    else counts[s.stance as keyof typeof counts] = (counts[s.stance as keyof typeof counts] ?? 0) + 1;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin/intel-health" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Intel Health
      </a>

      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">Stance review · {state}</h1>
        <p className="mt-2 text-sm text-zinc-400">
          AI-drafted legislator kratom stances. Click a stance to confirm or
          flip. Expand a row to edit rationale + evidence URL. Drafts come
          from <code className="rounded bg-zinc-900 px-1 text-emerald-300">scripts/draft-legislator-stance.mjs</code>.
        </p>
      </header>

      {/* Stats band */}
      <section className="mb-6 grid grid-cols-3 gap-3 sm:grid-cols-6">
        <Stat label="Champions" value={counts.champion} tone="emerald" />
        <Stat label="Sympathetic" value={counts.sympathetic} tone="emerald-soft" />
        <Stat label="Neutral" value={counts.neutral} tone="zinc" />
        <Stat label="Hostile" value={counts.hostile} tone="red" />
        <Stat label="Unknown" value={counts.unknown} tone="zinc" />
        <Stat label="No draft" value={counts.none} tone="amber" />
      </section>

      {/* Filter pills */}
      <nav className="mb-4 flex flex-wrap gap-2 text-xs">
        <a
          href={`?state=${state}&filter=all`}
          className={`rounded px-3 py-1.5 ${filter === "all" ? "bg-emerald-600 text-zinc-950" : "border border-zinc-800 bg-zinc-950/40 hover:border-emerald-500"}`}
        >
          All ({legs.length})
        </a>
        <a
          href={`?state=${state}&filter=drafted`}
          className={`rounded px-3 py-1.5 ${filter === "drafted" ? "bg-emerald-600 text-zinc-950" : "border border-zinc-800 bg-zinc-950/40 hover:border-emerald-500"}`}
        >
          Drafted ({stances.size})
        </a>
        <a
          href={`?state=${state}&filter=undrafted`}
          className={`rounded px-3 py-1.5 ${filter === "undrafted" ? "bg-emerald-600 text-zinc-950" : "border border-zinc-800 bg-zinc-950/40 hover:border-emerald-500"}`}
        >
          No draft ({counts.none})
        </a>
      </nav>

      {/* Rows with checkbox + bulk-approve panel (client component) */}
      {visible.length === 0 ? (
        <p className="rounded-md border border-zinc-800 bg-zinc-950/40 p-6 text-sm text-zinc-500">
          No legislators match this filter.
        </p>
      ) : (
        <StanceList
          legs={visible.map((l) => ({ id: l.id, full_name: l.full_name, role: l.role, district: l.district }))}
          stanceEntries={[...stances.entries()].filter(([id]) => visible.some((l) => l.id === id))}
        />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "zinc",
}: {
  label: string;
  value: number;
  tone?: "emerald" | "emerald-soft" | "zinc" | "red" | "amber";
}) {
  const tones: Record<string, string> = {
    emerald: "border-emerald-700 bg-emerald-900/30 text-emerald-300",
    "emerald-soft": "border-emerald-900 bg-emerald-950/20 text-emerald-400",
    zinc: "border-zinc-800 bg-zinc-950/40 text-zinc-300",
    red: "border-red-900 bg-red-950/30 text-red-300",
    amber: "border-amber-900 bg-amber-950/20 text-amber-300",
  };
  return (
    <div className={`rounded-md border p-3 ${tones[tone]}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider opacity-80">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}
