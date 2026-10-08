/**
 * Shared neutral-stance display for bill_stakeholders ("people of interest").
 *
 * Owner directive 2026-07-11 — STRICTLY NEUTRAL TRACKER: we never render a
 * global "ally"/"opponent" verdict on a person. We render their DOCUMENTED
 * position as facts on two independent axes (natural leaf, and 7-OH), each with
 * evidence. This is the presentational half of migration 0243; the vocabulary
 * (supportive/restrictive/neutral) is descriptive, not pro/anti.
 *
 * Pure/presentational (no client hooks) so both the server bill page and the
 * client /people browser can render it.
 */

export type StanceValue = "supportive" | "restrictive" | "neutral" | null | undefined;

const STANCE: Record<string, { label: string; cls: string }> = {
  supportive: { label: "Supportive", cls: "border-emerald-700/50 bg-emerald-950/30 text-emerald-300" },
  restrictive: { label: "Restrictive", cls: "border-rose-700/50 bg-rose-950/30 text-rose-300" },
  neutral: { label: "Neutral", cls: "border-zinc-600/50 bg-zinc-900 text-zinc-300" },
};

/**
 * Neutral, FACTUAL role labels. The old `ally`/`opponent` values carried a
 * value judgment, so they collapse to a single neutral "Policy figure" — their
 * actual position is conveyed by the stance chips, not the role tag. The other
 * roles are structural functions (not judgments) and keep their identity.
 */
const ROLE: Record<string, { emoji: string; label: string; cls: string; valueCls: string }> = {
  expert: { emoji: "🎓", label: "Expert", cls: "border-sky-700/40 bg-sky-950/15", valueCls: "text-sky-300" },
  journalist: { emoji: "📰", label: "Journalist", cls: "border-amber-700/40 bg-amber-950/15", valueCls: "text-amber-300" },
  affected: { emoji: "🏪", label: "Affected business", cls: "border-violet-700/40 bg-violet-950/15", valueCls: "text-violet-300" },
  community: { emoji: "🌐", label: "Community", cls: "border-teal-700/40 bg-teal-950/15", valueCls: "text-teal-300" },
  policy: { emoji: "🏛️", label: "Policy figure", cls: "border-zinc-700/40 bg-zinc-950/40", valueCls: "text-zinc-300" },
};

/** Collapse the retired value-laden roles into a neutral one for display+filtering. */
export function displayRole(roleType: string): string {
  return roleType === "ally" || roleType === "opponent" ? "policy" : roleType;
}

export function roleMeta(roleType: string) {
  return ROLE[displayRole(roleType)] ?? { emoji: "·", label: roleType, cls: "border-zinc-700/40 bg-zinc-950/40", valueCls: "text-zinc-300" };
}

/** Distinct neutral display roles present in a set, in a stable order. */
export function orderedDisplayRoles(roleTypes: string[]): string[] {
  const order = ["policy", "expert", "affected", "community", "journalist"];
  const present = new Set(roleTypes.map(displayRole));
  return order.filter((r) => present.has(r));
}

function AxisChip({ emoji, axis, value, url }: { emoji: string; axis: string; value: StanceValue; url?: string | null }) {
  if (!value || !STANCE[value]) return null;
  const m = STANCE[value];
  const inner = (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${m.cls}`}>
      {emoji} {axis}: {m.label}
      {url ? <span className="opacity-70">🔗</span> : null}
    </span>
  );
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" title="Source for this position" className="hover:opacity-80">
      {inner}
    </a>
  ) : (
    inner
  );
}

/**
 * The two-axis stance display. Renders only the axes that have a documented
 * value; if neither is documented, says so plainly (never invents a stance).
 */
export function StanceChips({
  leafStance,
  sevenOhStance,
  leafUrl,
  sevenOhUrl,
  summary,
}: {
  leafStance?: StanceValue;
  sevenOhStance?: StanceValue;
  leafUrl?: string | null;
  sevenOhUrl?: string | null;
  summary?: string | null;
}) {
  const hasAny = (leafStance && STANCE[leafStance]) || (sevenOhStance && STANCE[sevenOhStance]);
  if (!hasAny) {
    return <p className="mt-1 text-[10px] italic text-zinc-500">Position not yet documented.</p>;
  }
  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <AxisChip emoji="🌿" axis="Natural leaf" value={leafStance} url={leafUrl} />
        <AxisChip emoji="⚗️" axis="7-OH" value={sevenOhStance} url={sevenOhUrl} />
      </div>
      {summary ? <p className="mt-1 text-[11px] leading-snug text-zinc-400">{summary}</p> : null}
    </div>
  );
}
