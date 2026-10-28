/**
 * The two legislator scores in plain words. They used to read "T0·V10", which
 * nobody outside the code could decode (Paul, 2026-10-28). See
 * src/lib/legislator-threat-score.ts for how both are computed.
 */
export function ThreatScorePair({ threat, vulnerability, className = "" }: { threat: number; vulnerability: number; className?: string }) {
  return (
    <span
      className={`text-[9px] normal-case tracking-normal opacity-75 ${className}`}
      title="Risk (0–100): how much this official could hurt kratom access. Openness (0–100): how likely they are to be persuaded."
    >
      risk {threat} · openness {vulnerability}
    </span>
  );
}
