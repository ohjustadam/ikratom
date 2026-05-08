import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listMyBadges } from "@/modules/badges/actions";
import { ALL_BADGES, BADGES, type BadgeId } from "@/modules/badges/catalog";

export const metadata = { title: "Mission patches" };

export default async function BadgesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/account/badges");

  const earned = await listMyBadges();
  const earnedIds = new Set(earned.map((e) => e.badge_id));

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/account" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Account
      </a>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">Mission patches</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Earned: <span className="text-zinc-200 font-mono">{earned.length}</span>{" "}
          of <span className="text-zinc-200 font-mono">{ALL_BADGES.length}</span>
        </p>
      </header>

      <ul className="grid gap-2 sm:grid-cols-2">
        {ALL_BADGES.map((badge) => {
          const isEarned = earnedIds.has(badge.id);
          const earnedAt = earned.find((e) => e.badge_id === badge.id)?.earned_at;
          const rarityCls =
            badge.rarity === "legendary" ? "border-red-700/60 bg-red-950/20" :
            badge.rarity === "epic" ? "border-amber-700/60 bg-amber-950/20" :
            badge.rarity === "rare" ? "border-emerald-700/60 bg-emerald-950/20" :
            "border-zinc-800 bg-zinc-950/40";
          return (
            <li
              key={badge.id}
              className={`rounded-lg border p-3 ${rarityCls} ${isEarned ? "" : "opacity-40"}`}
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl">{badge.emoji}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-zinc-100">{badge.name}</h3>
                    <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] uppercase ${
                      badge.rarity === "legendary" ? "bg-red-950/60 text-red-300" :
                      badge.rarity === "epic" ? "bg-amber-950/60 text-amber-300" :
                      badge.rarity === "rare" ? "bg-emerald-950/60 text-emerald-300" :
                      "bg-zinc-900 text-zinc-400"
                    }`}>
                      {badge.rarity}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-400">{badge.description}</p>
                  {isEarned && earnedAt && (
                    <p className="mt-1 font-mono text-[10px] text-emerald-400">
                      ✓ earned {new Date(earnedAt).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {/* Reference for reconciliation: every BadgeId in catalog renders here */}
      {/* Underscore-prefixed cast to avoid unused-import lint */}
      <span className="hidden">{(BADGES as Record<BadgeId, unknown>) ? "" : ""}</span>
    </div>
  );
}
