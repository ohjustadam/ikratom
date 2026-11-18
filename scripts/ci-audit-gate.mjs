// Runs `npm audit --omit=dev --json` and applies scripts/lib/audit-gate.mjs.
// Used by CI's required "npm audit (high+)" job. Exit 1 = a high or critical
// advisory that is not on the dated exception list (or an unreadable report).
import { execFileSync } from "node:child_process";
import { judgeAudit } from "./lib/audit-gate.mjs";

let raw;
try {
  raw = execFileSync("npm", ["audit", "--omit=dev", "--json"], { encoding: "utf8", shell: process.platform === "win32", maxBuffer: 64 * 1024 * 1024 });
} catch (err) {
  raw = err.stdout; // npm audit exits non-zero whenever anything is found
}

let report;
try {
  report = JSON.parse(raw);
} catch {
  report = { error: `unparseable npm audit output: ${String(raw).slice(0, 200)}` };
}

const r = judgeAudit(report);
const c = report.metadata?.vulnerabilities ?? {};
console.log(`npm audit (prod): ${c.critical ?? "?"} critical, ${c.high ?? "?"} high, ${c.moderate ?? "?"} moderate`);
for (const a of r.allowed) console.log(`  allowed until ${a.until}: ${a.id} ${a.name} (${a.severity}) — ${a.why}`);
for (const b of r.blocking) console.log(`  BLOCKING: ${b.id} ${b.name} (${b.severity}) ${b.title ?? ""}${b.expired ? ` — exception expired ${b.expired}` : ""}`);
if (r.problem) console.log(`  BLOCKING: ${r.problem}`);
process.exit(r.ok ? 0 : 1);
