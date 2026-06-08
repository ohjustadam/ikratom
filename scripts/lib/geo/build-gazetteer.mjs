/**
 * Build the authoritative US gazetteer JSON used by scripts/lib/geo-resolver.mjs.
 *
 * Source: US Census Bureau national gazetteer files (public domain, authoritative):
 *   https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/
 *     2023_Gaz_counties_national.zip   (~3,143 counties/parishes/boroughs)
 *     2023_Gaz_place_national.zip      (~32k incorporated places + CDPs)
 *
 * To refresh (rare — only when Census publishes a new vintage):
 *   1. Download + extract both .zip into scripts/lib/geo/_raw/  (PowerShell:
 *      Expand-Archive). _raw/ is gitignored — only the JSON output is committed.
 *   2. node scripts/lib/geo/build-gazetteer.mjs
 *
 * Output (committed): us-counties.json, us-places.json
 *   { "<normalized name>": ["ST", ...] }   // every state the name exists in
 * County keys keep the "county"/"parish"/... word; place keys are the bare name.
 */
import fs from "node:fs";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const RAW = path.join(HERE, "_raw");

function norm(s) {
  return String(s ?? "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase().replace(/\s+/g, " ").trim();
}

function readGaz(file) {
  const txt = fs.readFileSync(path.join(RAW, file), "utf8");
  return txt.split(/\r?\n/).slice(1).filter((l) => l.trim());
}

// ── Counties (NAME e.g. "Reno County", "Orleans Parish", "Baltimore city") ──
const counties = {};
for (const line of readGaz("2023_Gaz_counties_national.txt")) {
  const c = line.split("\t");
  const st = (c[0] || "").trim();
  const name = norm(c[3]);
  if (!st || !name) continue;
  (counties[name] ??= new Set()).add(st);
}

// ── Places: strip the Census LSAD type suffix to get the bare place name ──
function stripPlaceType(raw) {
  let nm = String(raw ?? "");
  nm = nm.replace(/\([^)]*\)/g, " "); // drop "(balance)" etc.
  nm = nm.replace(/\b(metropolitan|consolidated|unified|metro)\s+government\b/gi, " ");
  nm = nm.replace(/\s+(city and borough|city|town|village|borough|cdp|municipality|comunidad|zona urbana|plantation|gore|grant|township|reservation)\s*$/i, "");
  return nm.trim();
}
const places = {};
for (const line of readGaz("2023_Gaz_place_national.txt")) {
  const c = line.split("\t");
  const st = (c[0] || "").trim();
  const name = norm(stripPlaceType(c[3]));
  if (!st || !name || name.length < 2) continue;
  (places[name] ??= new Set()).add(st);
}

function serialize(obj) {
  const out = {};
  for (const k of Object.keys(obj).sort()) out[k] = [...obj[k]].sort();
  return out;
}
fs.writeFileSync(path.join(HERE, "us-counties.json"), JSON.stringify(serialize(counties)));
fs.writeFileSync(path.join(HERE, "us-places.json"), JSON.stringify(serialize(places)));

console.log(`counties: ${Object.keys(counties).length}  places: ${Object.keys(places).length}`);
const check = (label, set) => console.log(`  ${label}: [${[...(set || [])].join(", ")}]`);
console.log("SANITY (the exact bug cases):");
check("reno county", counties["reno county"]);          // expect KS
check("reno (place)", places["reno"]);                  // expect NV (+ maybe others)
check("normal (place)", places["normal"]);              // expect IL (+ maybe AL)
check("bloomington (place)", places["bloomington"]);    // expect IL, IN, MN, ...
check("nassau county", counties["nassau county"]);      // expect NY, FL (NOT CT)
check("lawrence county", counties["lawrence county"]);  // many states, NOT TX
check("sterling heights", places["sterling heights"]);  // expect MI
check("grant county", counties["grant county"]);        // many incl WA (NOT DC)
