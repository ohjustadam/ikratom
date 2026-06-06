// push-gate.mjs — shared "may I push to this user right now?" gate.
//
// Honours the per-user anti-disturb preferences added in migrations 0176/0177:
//   dnd_enabled        — hard mute; never push
//   quiet_hours_start  — local-time window start (e.g. 22:00)
//   quiet_hours_end    — local-time window end   (e.g. 07:00; wraps midnight)
//   timezone           — IANA zone the window is expressed in
//
// Used by every push delivery path (the fanout cron mirrors this in TS at
// src/lib/notifications/push-gate.ts — keep the two in sync). Suppressed
// pushes are HELD, not dropped: the in-app notification still lands in the
// inbox; only the device buzz is withheld.

// Minutes-since-midnight "now" in the given IANA zone, or null if unusable.
function minutesNowInTz(nowMs, tz) {
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
function toMinutes(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t));
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function isWithinQuietHours(nowMs, prefs) {
  if (!prefs) return false;
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
export function canPushUser(prefs, nowMs) {
  if (!prefs) return true;
  if (prefs.dnd_enabled) return false;
  if (isWithinQuietHours(nowMs, prefs)) return false;
  return true;
}

// Fetch the gate prefs for a set of users → Map<user_id, prefs>.
export async function loadPushPrefs(sb, userIds) {
  const map = new Map();
  if (!userIds || userIds.length === 0) return map;
  const { data } = await sb
    .from("notification_preferences")
    .select("user_id, dnd_enabled, quiet_hours_start, quiet_hours_end, timezone")
    .in("user_id", userIds);
  for (const p of data ?? []) map.set(p.user_id, p);
  return map;
}

// Stamp last_push_at for users we actually pushed, so the fanout cron's
// per-user rate-cap also accounts for these direct-send paths (no double buzz).
export async function recordPush(sb, userIds) {
  const ids = Array.from(new Set(userIds ?? []));
  if (ids.length === 0) return;
  await sb
    .from("notification_preferences")
    .update({ last_push_at: new Date().toISOString() })
    .in("user_id", ids);
}
