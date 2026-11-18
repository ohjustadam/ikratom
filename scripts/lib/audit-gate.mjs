// CI's npm audit gate: fail on any high or critical advisory in production
// dependencies, except a short, dated list of advisories we have checked and
// that have NO patched release yet. Plain `npm audit --audit-level=high` has no
// way to say "this one, until a fix exists", so one unpatchable advisory turned
// the required check red on every PR (2026-11-18: picomatch, every version).
//
// Each exception carries its reason and an expiry. When it expires the gate
// goes red again, which forces someone to look: drop it if a patch shipped,
// otherwise re-check and extend it.

export const ALLOW = [
  {
    id: "GHSA-fc5q-39xc-vjpf",
    until: "2026-12-31",
    why:
      "picomatch ReDoS (<= 4.0.7, no patched release as of 2026-11-18). Reached only " +
      "in production deps through @rollup/plugin-commonjs and @rollup/pluginutils, " +
      "build-time tools that match our own file paths, never member input.",
  },
];

const BLOCKING = new Set(["high", "critical"]);

/** Judge an `npm audit --json` report. Pure, so the test can feed it faults. */
export function judgeAudit(report, allow = ALLOW, today = new Date().toISOString().slice(0, 10)) {
  if (!report || typeof report !== "object" || report.error) {
    return { ok: false, blocking: [], allowed: [], problem: `npm audit returned no report: ${JSON.stringify(report?.error ?? report).slice(0, 200)}` };
  }
  const counts = report.metadata?.vulnerabilities;
  if (!counts || typeof counts.total !== "number") {
    return { ok: false, blocking: [], allowed: [], problem: "npm audit report has no metadata.vulnerabilities counts" };
  }

  const seen = new Map();
  for (const vuln of Object.values(report.vulnerabilities ?? {})) {
    for (const via of vuln?.via ?? []) {
      if (via && typeof via === "object" && BLOCKING.has(via.severity) && via.url) {
        seen.set(via.url, { id: via.url.split("/").pop(), name: via.name, severity: via.severity, title: via.title });
      }
    }
  }

  // Guard the guard: counts say high/critical exist but we found none, so the
  // report shape changed and passing would be vacuous.
  const highCount = (counts.high ?? 0) + (counts.critical ?? 0);
  if (highCount > 0 && seen.size === 0) {
    return { ok: false, blocking: [], allowed: [], problem: `audit counts ${highCount} high/critical but no advisory could be read; report format changed?` };
  }

  const blocking = [];
  const allowed = [];
  for (const adv of seen.values()) {
    const rule = allow.find((a) => a.id === adv.id);
    if (rule && today <= rule.until) allowed.push({ ...adv, until: rule.until, why: rule.why });
    else blocking.push({ ...adv, expired: rule ? rule.until : null });
  }
  return { ok: blocking.length === 0, blocking, allowed, problem: null };
}
