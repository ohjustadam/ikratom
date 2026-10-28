/**
 * LegiScan query budget — one meter for every job that calls the API.
 *
 * The free key allows 10,000 queries a CALENDAR month (LegiScan's own error,
 * October 2026: "10,001 of 10,000 ... resets November 1st"). The code had
 * assumed 30,000, so jobs were sized for three times the real allowance and
 * October ran dry on the 28th, leaving bill status and text syncs dead for the
 * rest of the month.
 *
 * How it works, with no new table: every LegiScan job counts its calls through
 * createLegiscanClient() and writes `legiscan_calls=N` into its scraper_runs
 * notes. legiscanCallsThisMonth() sums those notes, and budgetAllows() lets a
 * job start only while the month is under its ceiling:
 *   - essential (the bill-status sync members rely on): until 95% of the cap;
 *   - nonessential (sessions, topic discovery, texts, stub checks): until 70%,
 *     so they can never starve the essential sync.
 */

export const LEGISCAN_MONTHLY_CAP = 10_000;
export const CEILING = { essential: 0.95, nonessential: 0.7 };

/** `legiscan_calls=N` in a scraper_runs note, or 0. */
export function callsFromNotes(notes) {
  const m = /legiscan_calls=(\d+)/.exec(String(notes ?? ""));
  return m ? Number(m[1]) : 0;
}

/** First instant of the calendar month LegiScan counts against (UTC). */
export function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Calls the given tier may still spend this month (never negative). */
export function remainingFor(used, tier = "nonessential", cap = LEGISCAN_MONTHLY_CAP) {
  return Math.max(0, Math.floor(cap * (CEILING[tier] ?? CEILING.nonessential)) - used);
}

export function budgetAllows(used, tier = "nonessential", cap = LEGISCAN_MONTHLY_CAP) {
  return remainingFor(used, tier, cap) > 0;
}

/** Sum of every LegiScan job's recorded calls since the 1st of this month. */
export async function legiscanCallsThisMonth(sb, now = new Date()) {
  let used = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("scraper_runs")
      .select("notes")
      .gte("started_at", monthStart(now).toISOString())
      .like("notes", "%legiscan_calls=%")
      .order("started_at", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`legiscan budget read failed: ${error.message}`);
    for (const r of data ?? []) used += callsFromNotes(r.notes);
    if (!data || data.length < 1000) break;
  }
  return used;
}

/**
 * A LegiScan caller that counts. `maxCalls` stops a job mid-run before it can
 * push the month over its ceiling; the call that would cross it throws.
 */
export function createLegiscanClient(key, { maxCalls = Infinity } = {}) {
  let calls = 0;
  return {
    get calls() { return calls; },
    get exhausted() { return calls >= maxCalls; },
    async call(op, params = {}) {
      if (calls >= maxCalls) throw new Error(`LegiScan budget for this run used (${calls} calls)`);
      const u = new URL("https://api.legiscan.com/");
      u.searchParams.set("key", key);
      u.searchParams.set("op", op);
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
      calls++;
      const r = await fetch(u.toString(), { signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw new Error(`LegiScan ${op} ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const data = await r.json();
      if (data.status === "ERROR") throw new Error(`LegiScan ${op} error: ${data.alert?.message ?? "unknown"}`);
      return data;
    },
  };
}

/**
 * bill_id -> change_hash for a state's current session, from one
 * getMasterListRaw response (entries are keyed "0", "1", ... plus "session").
 */
export function changeHashesFromMasterList(masterlist) {
  const map = new Map();
  for (const [k, v] of Object.entries(masterlist ?? {})) {
    if (k === "session" || !v || v.bill_id == null) continue;
    map.set(Number(v.bill_id), String(v.change_hash ?? ""));
  }
  return map;
}

/**
 * What the sync should do with one bill, given its state's master list.
 *   "fetch"     — getBill (new to us, or LegiScan's hash moved)
 *   "unchanged" — same hash as our last sync; no query
 *   "final"     — not in the current session's list and synced before: the
 *                 session is over, nothing will change; no query
 *   "search"    — no LegiScan id and not searched in the last week
 *   "wait"      — no LegiScan id, searched recently; no query
 */
export function planBill(bill, hashes, { now = Date.now(), searchEveryDays = 7 } = {}) {
  if (!bill.legiscan_bill_id) {
    const last = bill.legiscan_searched_at ? Date.parse(bill.legiscan_searched_at) : 0;
    return now - last >= searchEveryDays * 86_400_000 ? "search" : "wait";
  }
  if (!hashes) return "fetch";
  const current = hashes.get(Number(bill.legiscan_bill_id));
  if (current === undefined) return bill.legiscan_change_hash ? "final" : "fetch";
  return current && current === bill.legiscan_change_hash ? "unchanged" : "fetch";
}
