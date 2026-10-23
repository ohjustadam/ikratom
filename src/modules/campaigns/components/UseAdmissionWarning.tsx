"use client";

import { rewordUseAdmissions, findUseAdmissions } from "@/lib/use-admission";

/**
 * Banned-state safe mode: flags lines that say the writer uses kratom now and
 * offers past-tense wording. A warning, never a block — the member decides.
 */
export function UseAdmissionWarning({
  stateName,
  subject,
  body,
  onFix,
}: {
  stateName: string;
  subject: string;
  body: string;
  onFix: (subject: string, body: string) => void;
}) {
  const phrases = findUseAdmissions(`${subject}\n${body}`);
  if (phrases.length === 0) return null;
  const fixedSubject = rewordUseAdmissions(subject);
  const fixedBody = rewordUseAdmissions(body);
  const canFix = fixedSubject !== subject || fixedBody !== body;
  const leftover = findUseAdmissions(`${fixedSubject}\n${fixedBody}`);

  return (
    <div className="mt-1 rounded border border-amber-800/50 bg-amber-950/20 px-2 py-1.5 text-xs text-amber-100">
      <p>
        🛡️ This letter says you use kratom now ({phrases.map((p) => `“${p}”`).join(", ")}). Sent from{" "}
        {stateName}, that is a written statement in your name. Past tense, about life before the ban, makes the
        same point.
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        {canFix && (
          <button type="button" onClick={() => onFix(fixedSubject, fixedBody)} className="rounded bg-amber-700 px-2 py-0.5 font-semibold text-white hover:bg-amber-600">
            Reword it for me
          </button>
        )}
        {leftover.length > 0 && (
          <span className="text-amber-200/80">Reword {leftover.map((p) => `“${p}”`).join(", ")} yourself.</span>
        )}
      </div>
    </div>
  );
}
