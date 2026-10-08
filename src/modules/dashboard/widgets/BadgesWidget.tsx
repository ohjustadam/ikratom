import { listMyBadges } from "@/modules/badges/actions";
import { BADGES, type BadgeId } from "@/modules/badges/catalog";

/**
 * Mission patches earned. Hidden when the user has 0 — encourages
 * earning the first one (first_email/first_call/first_thread are
 * intentionally easy to award on a first action).
 */
export async function BadgesWidget() {
  const earned = await listMyBadges();
  if (earned.length === 0) return null;

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40">
      <div className="flex items-end justify-between border-b border-zinc-900 px-4 py-2.5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">mission patches</p>
          <h2 className="text-sm font-bold text-zinc-100">
            Badges <span className="text-zinc-500">({earned.length}/{Object.keys(BADGES).length})</span>
          </h2>
        </div>
        <a href="/account/badges" className="text-xs text-emerald-400 hover:underline">
          all →
        </a>
      </div>
      <div className="flex flex-wrap gap-2 p-3">
        {earned.slice(0, 12).map((row) => {
          const badge = BADGES[row.badge_id as BadgeId];
          if (!badge) return null;
          const rarityCls =
            badge.rarity === "legendary"
              ? "border-red-700/60 bg-red-950/30 text-red-200"
              : badge.rarity === "epic"
              ? "border-amber-700/60 bg-amber-950/30 text-amber-200"
              : badge.rarity === "rare"
              ? "border-emerald-700/60 bg-emerald-950/30 text-emerald-200"
              : "border-zinc-700 bg-zinc-950/40 text-zinc-300";
          return (
            <span
              key={badge.id}
              title={`${badge.name} — ${badge.description}`}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${rarityCls}`}
            >
              <span>{badge.emoji}</span>
              <span className="font-mono text-[10px]">{badge.name}</span>
            </span>
          );
        })}
      </div>
    </section>
  );
}
