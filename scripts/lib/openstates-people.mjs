/**
 * openstates-people.mjs — keyless access to the openstates/people repository.
 *
 * WHY THIS SOURCE. The OpenStates API throttles per KEY at 250 requests/day,
 * which is nowhere near enough to touch 7,500 state legislators. The same
 * project publishes its underlying roster as plain YAML on GitHub with no key
 * and no quota, and `ocd-person/<uuid>` maps 1:1 onto our
 * `legislators.openstates_id` — so it is an EXACT join, never a name guess.
 * (See memory "openstates-bulk-keyless".)
 *
 * The tar reader below was written for sync-state-executives.mjs and lived
 * inline there. It is lifted here unchanged now that term-date backfill is a
 * second consumer: one copy, so a fix to the tar walk reaches both.
 */
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";

export const PEOPLE_TARBALL =
  "https://codeload.github.com/openstates/people/tar.gz/refs/heads/main";

/**
 * Minimal streaming tar reader: walks 512-byte headers, collects the content
 * of paths matching `match`, skips everything else. Handles ustar prefix +
 * GNU 'L' longname entries. No dependencies.
 *
 * @param {string} url    .tar.gz to stream
 * @param {RegExp} match  tested against each entry's full path
 * @returns {Promise<Map<string,string>>} path -> file contents
 */
export async function collectFromTarball(url, match) {
  const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`tarball ${res.status}`);
  const gunzip = Readable.fromWeb(res.body).pipe(createGunzip());

  const files = new Map();
  let buf = Buffer.alloc(0);
  let pendingLongName = null;
  let current = null; // { name, remaining, pad, collect: Buffer[] | null, isLongName }

  for await (const chunk of gunzip) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    while (true) {
      if (current) {
        // Consume up to remaining body bytes + pad; the first `remaining`
        // consumed bytes are body, the rest is block padding.
        const take = Math.min(buf.length, current.remaining + current.pad);
        const bodyTake = Math.min(take, current.remaining);
        if (current.collect && bodyTake > 0) current.collect.push(buf.subarray(0, bodyTake));
        current.remaining -= bodyTake;
        current.pad -= take - bodyTake;
        buf = buf.subarray(take);
        if (current.remaining > 0 || current.pad > 0) break; // need more data
        if (current.isLongName) {
          pendingLongName = Buffer.concat(current.collect).toString("utf8").replace(/\0+$/, "");
        } else if (current.collect) {
          files.set(current.name, Buffer.concat(current.collect).toString("utf8"));
        }
        current = null;
        continue;
      }
      if (buf.length < 512) break;
      const header = buf.subarray(0, 512);
      buf = buf.subarray(512);
      if (header.every((b) => b === 0)) continue; // end-of-archive padding
      let name = header.subarray(0, 100).toString("utf8").replace(/\0+$/, "");
      const prefix = header.subarray(345, 500).toString("utf8").replace(/\0+$/, "");
      if (prefix) name = `${prefix}/${name}`;
      if (pendingLongName) { name = pendingLongName; pendingLongName = null; }
      const size = parseInt(header.subarray(124, 136).toString("utf8").trim() || "0", 8) || 0;
      const typeflag = String.fromCharCode(header[156]);
      const pad = (512 - (size % 512)) % 512;
      const isLongName = typeflag === "L";
      const wanted = typeflag === "0" || typeflag === "\0" ? match.test(name) : false;
      current = { name, remaining: size, pad, collect: wanted || isLongName ? [] : null, isLongName };
    }
  }
  return files;
}

/**
 * YAML dates arrive as Date objects or strings; we store plain ISO days.
 *
 * js-yaml parses an UNQUOTED YYYY-MM-DD as a JS Date, not a string. String()
 * on that yields "Sun Jan 10 2027 ..." which breaks lexical date compares AND
 * is rejected by the Postgres `date` column. Normalize everything to ISO.
 */
export function toIsoDay(v) {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

/**
 * Pick the role a person is serving RIGHT NOW from an openstates/people doc.
 *
 * This matters more than it looks. A person's `roles` list is a career, not a
 * current position: someone who moved chambers, or who was appointed to fill a
 * vacancy, carries earlier entries that DO have an end_date. Grabbing "the
 * end_date in the roles block" would hand back a term that finished years ago
 * and write it into the UI as the date this official next faces voters.
 *
 * @param {object} doc            parsed YAML
 * @param {Set<string>} wantTypes role types to accept (e.g. upper/lower)
 * @param {string} today          ISO day
 */
export function currentRole(doc, wantTypes, today) {
  if (!Array.isArray(doc?.roles)) return null;
  const eligible = doc.roles.filter((r) => {
    if (!wantTypes.has(String(r?.type ?? "").toLowerCase())) return false;
    const start = toIsoDay(r.start_date);
    const end = toIsoDay(r.end_date);
    if (start && start > today) return false; // elected but not yet sworn in
    if (end && end < today) return false;     // term already finished
    return true;
  });
  if (eligible.length === 0) return null;
  // Most recently started wins when a record overlaps (chamber switches).
  return eligible.sort((a, b) => String(toIsoDay(b.start_date) ?? "").localeCompare(String(toIsoDay(a.start_date) ?? "")))[0];
}
