import { describeLastAttempt, handAddHref } from "@/lib/local-rep-attempt";

/**
 * Server-rendered "why is this still pending?" line under a request row.
 * Written by the batch resolver (scripts/auto-fulfill-pending-local-reps.mjs).
 * When retrying can't help (e.g. the city site blocks automated readers), it
 * says so and links to the hand-add form, prefilled for this locality.
 */
export function LastAttemptNote({
  state,
  locality,
  level,
  attempt,
}: {
  state: string;
  locality: string;
  level: "municipal" | "county";
  attempt: { at: string; reason: string | null; detail: string | null } | null;
}) {
  const href = handAddHref(state, locality, level);
  if (!attempt) {
    return (
      <p className="px-4 pb-3 text-[11px] text-zinc-500">
        Batch hasn&apos;t tried this one yet — it runs every ~6 hours.{" "}
        <a href={href} className="text-zinc-400 hover:text-emerald-400">Add by hand →</a>
      </p>
    );
  }
  const note = describeLastAttempt(attempt.reason, attempt.detail);
  if (!note) return null;
  const when = new Date(attempt.at).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <p className={`px-4 pb-3 text-xs ${note.needsHuman ? "text-amber-300" : "text-zinc-400"}`}>
      {note.needsHuman ? "⚠ " : "🕒 "}Last batch try {when} ET: {note.text}{" "}
      <a
        href={href}
        className={note.needsHuman ? "font-semibold text-emerald-400 hover:underline" : "text-zinc-400 hover:text-emerald-400"}
      >
        Add by hand →
      </a>
    </p>
  );
}
