#!/usr/bin/env node
const args = process.argv.slice(2);
const state = args[0];
const billNumber = args[1];
if (!state || !billNumber) { console.error("Usage: dump-openstates-bill.mjs STATE BILL_NUMBER"); process.exit(1); }

const url = new URL("https://v3.openstates.org/bills");
url.searchParams.set("jurisdiction", state.toLowerCase());
url.searchParams.set("q", billNumber);
for (const inc of ["abstracts", "sources", "actions", "sponsorships", "versions", "documents"]) {
  url.searchParams.append("include", inc);
}
url.searchParams.set("per_page", "5");

const res = await fetch(url.toString(), { headers: { "X-API-Key": process.env.OPENSTATES_API_KEY } });
const data = await res.json();
const norm = (s) => s.replace(/\s+/g, "").toUpperCase();
const match = data.results?.find((b) => norm(b.identifier) === norm(billNumber));
if (!match) { console.error("not found"); process.exit(1); }

console.log("title:", match.title);
console.log("\n--- abstracts ---");
for (const a of match.abstracts ?? []) console.log(`  [${a.note ?? "?"}] ${(a.abstract ?? "").slice(0, 240)}…`);
console.log("\n--- versions ---");
for (const v of match.versions ?? []) console.log(`  ${v.date} | ${v.note} | ${(v.links ?? []).map(l => l.media_type).join(",")}`);
console.log("\n--- documents ---");
for (const d of match.documents ?? []) console.log(`  ${d.date} | ${d.note} | ${(d.links ?? []).map(l => l.media_type).join(",")}`);
console.log("\n--- actions ---");
for (const a of match.actions ?? []) console.log(`  ${a.date} | ${a.organization?.name ?? ""} | ${(a.classification ?? []).join(",")} | ${a.description}`);
console.log("\n--- sources ---");
for (const s of match.sources ?? []) console.log(`  ${s.url}`);
