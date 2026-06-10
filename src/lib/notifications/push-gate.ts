// push-gate.ts — shared "may I push to this user right now?" gate (TS).
//
// Mirror of scripts/lib/push-gate.mjs (the .mjs version is used by the
// direct-send cron scripts; this TS version is used by the in-app fanout
// path). Keep the two in sync. Honours the per-user anti-disturb prefs from
// migrations 0176/0177: dnd_enabled (hard mute), quiet_hours_start/end
// (local-time window, may wrap midnight), timezone (IANA zone of the window).
//
// Suppressed pushes are HELD, not dropped — the in-app notification still
// lands; only the device buzz is withheld until the next allowed moment.

export type PushGatePrefs = {
  dnd_enabled?: boolean | null;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
  timezone?: string | null;
};

// Minutes-since-midnight "now" in the given IANA zone, or null if unusable.
function minutesNowInTz(nowMs: number, tz: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(nowMs));
    let hh = 0;
    let mm = 0;
    for (const p of parts) {
      if (p.type === "hour") hh = parseInt(p.value, 10);
      else if (p.type === "minute") mm = parseInt(p.value, 10);
    }
    if (hh === 24) hh = 0; // some engines emit 24 for midnight
    if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
    return hh * 60 + mm;
  } catch {
    return null; // invalid time zone string
  }
}

// "HH:MM" / "HH:MM:SS" → minutes-since-midnight, or null if malformed.
function toMinutes(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function isWithinQuietHours(nowMs: number, prefs: PushGatePrefs): boolean {
  const s = prefs.quiet_hours_start;
  const e = prefs.quiet_hours_end;
  const tz = prefs.timezone;
  if (!s || !e || !tz) return false; // no window or no zone → not quiet
  const start = toMinutes(s);
  const end = toMinutes(e);
  if (start === null || end === null || start === end) return false;
  const cur = minutesNowInTz(nowMs, tz);
  if (cur === null) return false;
  return start < end ? cur >= start && cur < end : cur >= start || cur < end;
}

// True if a push MAY be delivered to this user right now.
export function canPushUser(prefs: PushGatePrefs | null | undefined, nowMs: number): boolean {
  if (!prefs) return true;
  if (prefs.dnd_enabled) return false;
  if (isWithinQuietHours(nowMs, prefs)) return false;
  return true;
}

export type DigestPrefs = PushGatePrefs & {
  digest?: string | null;
  last_push_at?: string | null;
};

function weekdayIndexInTz(nowMs: number, tz: string): number | null {
  try {
    const w = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(new Date(nowMs));
    return ({ Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 } as Record<string, number>)[w] ?? null;
  } catch {
    return null;
  }
}

/**
 * Digest cadence (PR-J — wires the long-dead digest enum). "Due" semantics,
 * not a fixed window: a daily user is due once their local 9am boundary has
 * passed AND they haven't been pushed since that boundary; weekly uses
 * Monday 9am local as the boundary. Because it's boundary-based, quiet
 * hours / DND / rate-cap that cover 9am only DELAY the digest to the next
 * allowed hour — never skip it (the fixed-window version silently starved
 * users whose quiet hours overlapped the window). last_push_at is the
 * "already delivered since the boundary" marker — any push counts, incl.
 * the direct-send daily brief, which is deliberate: one buzz per boundary.
 * Boundary epoch is computed from the current UTC offset (DST edge ≤1h —
 * irrelevant at digest granularity). Unusable timezone fails open.
 */
export function digestDue(prefs: DigestPrefs | null | undefined, nowMs: number): boolean {
  const d = prefs?.digest;
  if (d !== "daily" && d !== "weekly") return true;
  const tz = prefs?.timezone || "UTC";
  const cur = minutesNowInTz(nowMs, tz);
  if (cur === null) return true; // unusable tz → fail open to instant
  let minutesSinceBoundary = cur - 9 * 60;
  if (d === "weekly") minutesSinceBoundary += (weekdayIndexInTz(nowMs, tz) ?? 0) * 1440;
  if (minutesSinceBoundary < 0) return false; // boundary not reached yet
  // Floor to the minute so the boundary is stable across evaluations within
  // the same minute (sub-minute jitter could re-fire a digest whose push
  // landed inside the boundary minute). Known accepted edges: DST fall-back
  // can produce one extra weekly buzz per year, and a quiet window spanning
  // 9am→midnight defers that day's digest entirely (due-ness resets daily).
  const boundaryMs = Math.floor(nowMs / 60_000) * 60_000 - minutesSinceBoundary * 60_000;
  const last = prefs?.last_push_at ? Date.parse(prefs.last_push_at) : 0;
  return !(last >= boundaryMs);
}
