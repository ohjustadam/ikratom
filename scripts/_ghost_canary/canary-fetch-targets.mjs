#!/usr/bin/env node
// Ghost-server canary — measures whether the page-fetch leg of the nightly
// pipeline survives a move from the owner's residential IP to cloud egress IPs.
// (GHOST_SERVER_PLAN.md §3 "IP-reputation of the direct page-fetch leg" + §6 Stage 1.)
//
// Run the same script from each leg and compare scoreboards:
//   box (residential baseline):  node private/ghost/canary-fetch-targets.mjs
//   GitHub Actions runner:       same command in a workflow_dispatch job (Stage 1)
//   HF Space egress:             via the Space (Stage 1, optional third leg)
//
// Read-only: makes ≤12 GET requests, writes nothing anywhere.

const TARGETS = [
  // Legistar webapi — the structured backbone of local-officials lookup
  { name: 'legistar-webapi', url: 'https://webapi.legistar.com/v1/seattle/bodies?$top=1' },
  // NCSL — sync-elections.mjs source
  { name: 'ncsl-elections', url: 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates' },
  // State .gov pages
  { name: 'ok-house', url: 'https://www.okhouse.gov/' },
  { name: 'ok-senate', url: 'https://oksenate.gov/' },
  // Big-city CMS behind Akamai (San Jose/Greensboro precedent: fell only to a real browser)
  { name: 'sanjose-gov', url: 'https://www.sanjoseca.gov/' },
  { name: 'greensboro-gov', url: 'https://www.greensboro-nc.gov/' },
  // County-tier targets from the roster queue
  { name: 'allegan-county', url: 'https://www.allegancounty.org/' },
  // Local news (Fergus County roster source)
  { name: 'lewistown-news', url: 'https://www.lewistownnews.com/' },
  // National news + legislative aggregator
  { name: 'apnews', url: 'https://apnews.com/' },
  { name: 'legiscan', url: 'https://legiscan.com/' },
  // Federal
  { name: 'fda-gov', url: 'https://www.fda.gov/' },
];

const UA = 'iKratom Civic Data (contact@ikratom.org)';
const CHALLENGE_MARKERS = [
  'cf-chl', '__cf_chl', 'challenge-platform', 'cf_chl_opt', 'turnstile',
  'captcha', 'recaptcha', 'hcaptcha',
  'akamai', 'reference #18.',
  'request unsuccessful', 'access denied', 'pardon our interruption',
  'are you a robot', 'verify you are human', 'enable javascript and cookies',
];

async function probe({ name, url }) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/json;q=0.9,*/*;q=0.8' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    const body = (await res.text()).slice(0, 200000);
    const lower = body.toLowerCase();
    const markers = CHALLENGE_MARKERS.filter((m) => lower.includes(m));
    // A 200 whose body is a challenge interstitial is still a FAIL — that is
    // exactly the silent-starvation mode this canary exists to catch.
    const challenged = markers.length > 0 && body.length < 60000;
    const ok = res.ok && !challenged;
    return {
      name, status: res.status, ms: Date.now() - started, bytes: body.length,
      ok, challenged, markers: markers.slice(0, 3),
    };
  } catch (err) {
    return { name, status: 0, ms: Date.now() - started, bytes: 0, ok: false, challenged: false, error: String(err?.cause?.code || err?.name || err).slice(0, 60) };
  }
}

const leg = process.env.CANARY_LEG || (process.env.GITHUB_ACTIONS ? 'github-actions' : 'box-residential');
console.log(`ghost canary — leg: ${leg} — ${TARGETS.length} targets\n`);

const results = [];
for (const t of TARGETS) {
  const r = await probe(t);
  results.push(r);
  const flag = r.ok ? 'PASS' : r.challenged ? 'CHALLENGED' : 'FAIL';
  console.log(
    `${flag.padEnd(11)} ${r.name.padEnd(16)} HTTP ${String(r.status).padEnd(3)} ${String(r.ms).padStart(5)}ms ${String(r.bytes).padStart(7)}B` +
    (r.markers?.length ? `  markers: ${r.markers.join(',')}` : '') +
    (r.error ? `  error: ${r.error}` : '')
  );
}

const passed = results.filter((r) => r.ok).length;
// Box-residential baseline (2026-06-12): 6/11 pass. The Akamai trio (sanjose,
// greensboro, allegan) fails from EVERY non-browser client incl. the box, and
// legiscan.com's website is CF-walled (scripts use the keyed API, which passed).
// Cutover bar per plan §6 is RELATIVE: cloud leg ≥ baseline-1 on this sample.
console.log(`\nscoreboard [${leg}]: ${passed}/${results.length} pass (box-residential baseline: 6/11; cutover bar: ≥ baseline-1)`);
console.log(JSON.stringify({ leg, passed, total: results.length, results }, null, 0));
