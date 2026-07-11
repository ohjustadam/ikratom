/**
 * The course-earned power-user checkmark. Shown next to @username for advocates
 * who passed the iKratom Academy final exam (profiles.power_user_at). It is NOT
 * points-based — you can only get it by passing, so it can't be farmed.
 */
export function PowerUserBadge({ size = "sm" }: { size?: "sm" | "md" }) {
  const dim = size === "md" ? "h-5 w-5 text-[13px]" : "h-4 w-4 text-[10px]";
  return (
    <span
      title="Academy-certified power user"
      aria-label="Academy-certified power user"
      className={`inline-flex ${dim} shrink-0 items-center justify-center rounded-full bg-emerald-500 font-bold text-zinc-950 align-middle`}
    >
      ✓
    </span>
  );
}
