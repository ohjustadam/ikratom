import {
  headlineCounts,
  type PatchNoteFigure,
  type PatchNoteItem,
} from "@/lib/patch-note-items";

/**
 * Layout D, top half: the number tiles. The first two come from the items, so
 * they can never disagree with the ledger below; the rest are the note's own
 * figures (patch_note_figures), the data that kept updating on its own.
 */
const fmt = (n: number) => n.toLocaleString("en-US");

function Tile({
  big,
  label,
  detail,
  hero = false,
}: {
  big: string;
  label: string;
  detail?: string | null;
  hero?: boolean;
}) {
  return (
    <div
      className={`grid content-start gap-1 rounded-xl border p-4 ${
        hero ? "border-emerald-500/50 bg-emerald-500/10" : "border-zinc-800 bg-zinc-950/40"
      }`}
    >
      <span className="text-3xl font-bold leading-none tracking-tight tabular-nums text-zinc-50">
        {big}
      </span>
      <span className="text-sm text-zinc-300">{label}</span>
      {detail && <span className="text-xs text-zinc-500">{detail}</span>}
    </div>
  );
}

export default function Scoreboard({
  items,
  figures,
}: {
  items: PatchNoteItem[];
  figures: PatchNoteFigure[];
}) {
  const c = headlineCounts(items);
  const split = [c.new && `${c.new} new`, c.fix && `${c.fix} fixed`, c.faster && `${c.faster} faster`]
    .filter(Boolean)
    .join(" · ");

  return (
    <section aria-label="This update by the numbers" className="grid grid-cols-1 gap-2.5 min-[420px]:grid-cols-2 lg:grid-cols-3">
      <Tile hero big={fmt(c.total)} label="changes you can see" detail={split} />
      {c.memberReports > 0 && (
        <Tile big={fmt(c.memberReports)} label="started with a member report" detail="You told us, we fixed it" />
      )}
      {figures.map((f) => (
        <Tile key={f.key} big={fmt(f.value)} label={f.label} detail={f.detail} />
      ))}
    </section>
  );
}
