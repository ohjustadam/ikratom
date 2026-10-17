import { createClient } from "@/lib/supabase/server";

/**
 * Personal scoreboard — emails sent, calls made, current streak,
 * longest streak. Quick at-a-glance "what have I done?"
 *
 * Streak data comes from profiles (already populated by triggers).
 * Email + call counts come from campaign_actions filtered by user.
 */
export async function ScoreboardWidget({
  userId,
  streak,
}: {
  userId: string;
  streak: { current: number; longest: number; lastActionDate: string | null };
}) {
  const supabase = await createClient();

  const [{ count: emailsCount }, { count: callsCount }, { data: prof }] = await Promise.all([
    supabase
      .from("campaign_actions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .or("method.is.null,method.neq.call"),
    supabase
      .from("campaign_actions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("method", "call"),
    supabase.from("profiles").select("points_total").eq("id", userId).single(),
  ]);

  const emails = emailsCount ?? 0;
  const calls = callsCount ?? 0;
  const points = prof?.points_total ?? 0;

  // Hide entirely if user has done nothing — empty scoreboards demoralize.
  if (
    emails === 0 &&
    calls === 0 &&
    points === 0 &&
    streak.current === 0 &&
    streak.longest === 0
  ) {
    return null;
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="mb-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">scoreboard</p>
        <h2 className="text-sm font-bold text-zinc-100">Your record</h2>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat value={points.toLocaleString()} label="Points" tone="amber" />
        <Stat value={emails.toLocaleString()} label="Emails sent" tone="emerald" />
        <Stat value={calls.toLocaleString()} label="Calls made" tone="emerald" />
        <Stat value={streak.current.toLocaleString()} label="Current streak" tone={streak.current > 0 ? "amber" : "zinc"} suffix={streak.current === 1 ? "day" : "days"} />
        <Stat value={streak.longest.toLocaleString()} label="Longest streak" tone="zinc" suffix={streak.longest === 1 ? "day" : "days"} />
      </div>
    </section>
  );
}

function Stat({
  value,
  label,
  tone,
  suffix,
}: {
  value: string;
  label: string;
  tone: "emerald" | "amber" | "zinc";
  suffix?: string;
}) {
  const valueColor =
    tone === "emerald"
      ? "text-emerald-300"
      : tone === "amber"
      ? "text-amber-300"
      : "text-zinc-200";
  return (
    <div className="rounded-md border border-zinc-900 bg-zinc-950 p-3 text-center">
      <div className={`font-mono text-2xl font-bold ${valueColor}`}>
        {value}
        {suffix && <span className="ml-1 text-xs font-normal text-zinc-500">{suffix}</span>}
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
    </div>
  );
}
