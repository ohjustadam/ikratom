/**
 * census-geo.mjs — keyless US geography from the Census Bureau's published
 * reference files, for the "spider web": when kratom lands on one town's
 * agenda, know its county and the counties around it.
 *
 *   countyForPlace("NY", "Clifton Park")  -> "Saratoga County, NY"
 *   neighborCounties("Saratoga County, NY") -> ["Albany County, NY", ...]
 *
 * Sources (no key, no quota; fetched once per process and cached on disk for 7 days):
 *   national_places.txt       places AND county subdivisions (NY/New England
 *                             "towns" are subdivisions, absent from place-only lists)
 *   county_adjacency2024.txt  every county's neighbours, "Name County, ST" form
 * Names come back in the exact "<Name> County, ST" shape municipal_meetings and
 * legislators.locality use, so they can be compared and queued directly.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PLACES_URL = "https://www2.census.gov/geo/docs/reference/codes/files/national_places.txt";
const ADJ_URL = "https://www2.census.gov/geo/docs/reference/county_adjacency/county_adjacency2024.txt";
const CACHE_DIR = path.join(os.tmpdir(), "ikratom-census");
const WEEK = 7 * 86_400_000;

async function cachedText(url) {
  const file = path.join(CACHE_DIR, path.basename(url));
  try {
    if (Date.now() - fs.statSync(file).mtimeMs < WEEK) return fs.readFileSync(file, "utf8");
  } catch { /* not cached yet */ }
  const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`census ${path.basename(url)} -> ${r.status}`);
  const text = await r.text();
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(file, text); } catch { /* cache is optional */ }
  return text;
}

const SUFFIX = /\s+(city|town|village|borough|township|CDP|municipality|plantation|charter township|city and borough|consolidated government.*|metro(politan)? government.*|unified government.*)$/i;
const norm = (s) => String(s ?? "").replace(/,\s*[A-Z]{2}$/, "").replace(SUFFIX, "").trim().toLowerCase();

let _places = null, _adj = null;

async function places() {
  if (_places) return _places;
  _places = new Map(); // "ST|place" -> county name (first listed county)
  const lines = (await cachedText(PLACES_URL)).split(/\r?\n/).slice(1);
  for (const line of lines) {
    const [st, , , name, , , county] = line.split("|");
    if (!st || !name || !county) continue;
    const key = `${st}|${norm(name)}`;
    if (!_places.has(key)) _places.set(key, county.split(",")[0].trim());
  }
  return _places;
}

async function adjacency() {
  if (_adj) return _adj;
  _adj = new Map(); // "Name County, ST" -> [neighbour names]
  const lines = (await cachedText(ADJ_URL)).split(/\r?\n/).slice(1);
  for (const line of lines) {
    const [a, aId, b, bId] = line.split("|");
    if (!a || !b || aId === bId) continue;
    if (!_adj.has(a)) _adj.set(a, []);
    _adj.get(a).push(b);
  }
  return _adj;
}

/** County containing a town ("Clifton Park" or "Clifton Park, NY"), as "Saratoga County, NY", or null. */
export async function countyForPlace(state, place) {
  const st = String(state ?? "").toUpperCase();
  const county = (await places()).get(`${st}|${norm(place)}`);
  return county ? `${county}, ${st}` : null;
}

/** Counties bordering a county ("Saratoga County, NY"), same format; [] if unknown. */
export async function neighborCounties(county) {
  return (await adjacency()).get(county) ?? [];
}
