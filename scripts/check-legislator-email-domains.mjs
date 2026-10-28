/**
 * check-legislator-email-domains.mjs — find official emails that can never
 * be delivered, before a member's letter bounces off them.
 *
 * Why (Paul, 2026-10-28): one of his ~198 letters bounced with "address not
 * found" because Rep. Scheuren was stored as @pahousegop.gov, a domain that
 * does not exist. A sweep found 18 such addresses, mostly typos copied from
 * county directories (yahoo.con, gmail.con, coffeecoutytn.gov).
 *
 * For every email domain on `legislators` it asks DNS (over HTTPS, so it works
 * from any runner) whether the domain can receive mail (an MX record, or an A
 * record as the SMTP fallback). For a domain that cannot:
 *   - a provable typo is corrected: a TLD slip (.con/.cmo -> .com, .go -> .gov,
 *     .ogr -> .org) or exactly one known-good domain from our own data within
 *     two letters of it; the correction must itself accept mail;
 *   - otherwise the address is cleared, so the letter flow offers the
 *     official's other contact routes instead of a bounce.
 * Every change is recorded in the row's verified_sources_md with the old
 * value, so it can be reviewed and reversed.
 *
 * Dry run by default; --apply writes. Writes scraper_runs telemetry.
 *   node --env-file=.env.local scripts/check-legislator-email-domains.mjs [--apply]
 */

import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const SOURCE = "check_legislator_email_domains";

const TLD_FIXES = { con: "com", cmo: "com", ocm: "com", go: "gov", gvo: "gov", ogr: "org", rog: "org", ne: "net" };

export function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

/** The one correction we would trust for a dead domain, or null. */
export function proposeFix(dead, goodDomains) {
  const tld = dead.split(".").pop();
  if (TLD_FIXES[tld]) return dead.replace(/\.[a-z]+$/, `.${TLD_FIXES[tld]}`);
  const near = goodDomains.filter((g) => g !== dead && Math.abs(g.length - dead.length) <= 2 && editDistance(g, dead) <= 2);
  return near.length === 1 ? near[0] : null;
}

async function doh(name, type) {
  const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, {
    headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(10000),
  });
  const j = await r.json();
  return { status: j.Status, n: (j.Answer ?? []).filter((a) => a.type === (type === "MX" ? 15 : 1)).length };
}

/** true = accepts mail, false = cannot, null = lookup failed (never act on it). */
async function acceptsMail(domain) {
  try {
    const mx = await doh(domain, "MX");
    if (mx.n > 0) return true;
    if (mx.status === 3) return false;
    const a = await doh(domain, "A");
    return a.n > 0 ? true : mx.status === 0 ? false : null;
  } catch { return null; }
}

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const t0 = new Date();
  const today = t0.toISOString().slice(0, 10);
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("legislators").select("id, state, full_name, email, verified_sources_md")
      .like("email", "%@%").not("email", "like", "http%").order("id").range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  const domains = [...new Set(rows.map((r) => r.email.split("@").pop().trim().toLowerCase()))];
  const verdict = new Map();
  for (let i = 0; i < domains.length; i += 8) {
    await Promise.all(domains.slice(i, i + 8).map(async (d) => verdict.set(d, await acceptsMail(d))));
  }
  const good = domains.filter((d) => verdict.get(d) === true);
  const dead = domains.filter((d) => verdict.get(d) === false);

  let fixed = 0, cleared = 0;
  for (const d of dead) {
    let fix = proposeFix(d, good);
    if (fix && !good.includes(fix) && (await acceptsMail(fix)) !== true) fix = null;
    for (const r of rows.filter((x) => x.email.split("@").pop().trim().toLowerCase() === d)) {
      const next = fix ? `${r.email.split("@")[0]}@${fix}` : null;
      const note = fix
        ? `Email corrected ${today}: "${r.email}" has a domain that cannot receive mail; "${fix}" can.`
        : `Email removed ${today}: "${r.email}" has a domain that cannot receive mail.`;
      console.log(`${fix ? "FIX  " : "CLEAR"} ${r.state} ${r.full_name}: ${r.email}${next ? ` -> ${next}` : ""}`);
      if (fix) fixed++; else cleared++;
      if (APPLY) {
        const md = [r.verified_sources_md, `- ${note}`].filter(Boolean).join("\n");
        const { error } = await sb.from("legislators").update({ email: next, verified_sources_md: md }).eq("id", r.id);
        if (error) console.error(`  update failed: ${error.message}`);
      }
    }
  }
  const unknown = domains.filter((d) => verdict.get(d) === null).length;
  const notes = `${domains.length} domains · ${dead.length} cannot receive mail · ${fixed} emails corrected · ${cleared} cleared · ${unknown} lookups failed`;
  console.log(`\n${APPLY ? "" : "DRY RUN · "}${notes}`);
  if (APPLY) {
    await sb.from("scraper_runs").insert({
      source: SOURCE, started_at: t0.toISOString(), finished_at: new Date().toISOString(),
      status: "success", rows_updated: fixed + cleared, notes,
    });
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/check-legislator-email-domains.mjs")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
