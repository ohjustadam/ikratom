/**
 * Pull signed/effective dates out of legislative-action strings.
 *
 * OpenStates returns action descriptions like:
 *   "Signed by Governor 5/15/2026; effective 7/1/2026"
 *   "Approved by Governor on 03/12/2026; takes effect July 1 2026"
 *   "Public Act No. 26-99; effective Jan 1 2027"
 *   "Effective date: January 1, 2027"
 *   "act shall take effect upon passage"
 *   "signed by gov 4/22/26"
 *
 * We parse these into ISO YYYY-MM-DD when we can, leave null otherwise.
 * Pure functions, no DB calls. Used by the daily cron after sync to
 * populate bills.signed_at + bills.effective_date.
 */

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

/** Normalize 2-digit year. 26 → 2026 (assume current century for ≤ now+10). */
function expandYear(y: number): number {
  if (y >= 1900) return y;
  if (y < 100) {
    // 26 → 2026 if reasonable; 70 → 1970 if too far in the future
    const thisYear = new Date().getUTCFullYear();
    const candidate = 2000 + y;
    if (candidate <= thisYear + 10) return candidate;
    return 1900 + y;
  }
  return y;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function toIso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const fullY = expandYear(y);
  if (fullY < 1900 || fullY > 2100) return null;
  return `${fullY}-${pad2(m)}-${pad2(d)}`;
}

/**
 * Match a date in any of these forms anywhere in the string and return ISO:
 *   - 5/15/2026 / 5-15-2026 / 5.15.2026
 *   - May 15, 2026 / May 15 2026 / 15 May 2026
 *   - 2026-05-15
 *   - 5/15/26
 *
 * Returns the FIRST match. Caller should pre-trim to the relevant
 * sub-phrase to avoid grabbing an unrelated date.
 */
export function findDateInString(s: string): string | null {
  if (!s) return null;
  const text = s.toLowerCase();

  // ISO: 2026-05-15
  const iso = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    const r = toIso(parseInt(iso[1]), parseInt(iso[2]), parseInt(iso[3]));
    if (r) return r;
  }

  // Numeric: M/D/YYYY or M/D/YY
  const num = text.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
  if (num) {
    const m = parseInt(num[1]);
    const d = parseInt(num[2]);
    const y = parseInt(num[3]);
    const r = toIso(y, m, d);
    if (r) return r;
  }

  // Named month: "May 15, 2026" / "May 15 2026"
  const named = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{2,4})\b/);
  if (named) {
    const m = MONTHS[named[1]];
    const d = parseInt(named[2]);
    const y = parseInt(named[3]);
    if (m) {
      const r = toIso(y, m, d);
      if (r) return r;
    }
  }

  // Day-first: "15 May 2026"
  const dayFirst = text.match(/\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{2,4})\b/);
  if (dayFirst) {
    const d = parseInt(dayFirst[1]);
    const m = MONTHS[dayFirst[2]];
    const y = parseInt(dayFirst[3]);
    if (m) {
      const r = toIso(y, m, d);
      if (r) return r;
    }
  }

  return null;
}

export type BillDateExtract = {
  signedAt: string | null;
  effectiveDate: string | null;
  /** True for "act shall take effect upon passage" — effective_date should be set to signed_at when known. */
  effectiveOnPassage: boolean;
};

/**
 * Pull signed + effective dates out of one or more action description
 * strings. Caller passes any combination of: the bill's `last_action`,
 * the action history descriptions, the bill summary, etc.
 *
 * Strategy: find sub-phrases that anchor on "signed by", "approved by",
 * "effective", "takes effect" — extract the nearest date.
 */
export function extractBillDates(strings: (string | null | undefined)[]): BillDateExtract {
  const result: BillDateExtract = {
    signedAt: null,
    effectiveDate: null,
    effectiveOnPassage: false,
  };

  const cleaned = strings
    .filter((s): s is string => !!s)
    .map((s) => s.toLowerCase());

  for (const text of cleaned) {
    // ── Signed / approved by governor ──────────────────────
    if (!result.signedAt) {
      // Match "signed by ... <date>" or "approved by ... <date>"
      const m = text.match(/\b(?:signed|approved)\s+(?:by\s+)?(?:the\s+)?(?:gov(?:ernor)?|president)?[^.]{0,80}/i);
      if (m) {
        const d = findDateInString(m[0]);
        if (d) result.signedAt = d;
      }
    }

    // ── Effective date phrase ──────────────────────────────
    if (!result.effectiveDate) {
      // Common patterns:
      //   "effective date: <date>"
      //   "effective <date>"
      //   "takes effect <date>"
      //   "shall take effect <date>"
      const m = text.match(/\b(?:effective(?:\s+date)?(?:\s*:)?|takes?\s+effect|shall\s+take\s+effect)[^.]{0,100}/i);
      if (m) {
        // Special-case: "upon passage" / "on passage" / "immediately"
        if (/\bupon\s+passage\b|\bon\s+passage\b|\bimmediately\b/i.test(m[0])) {
          result.effectiveOnPassage = true;
        } else {
          const d = findDateInString(m[0]);
          if (d) result.effectiveDate = d;
        }
      }
    }

    // ── "Act shall take effect [date]" — sometimes in bill body ─
    if (!result.effectiveDate && /\bact\s+(?:shall\s+)?take\s+effect\b/i.test(text)) {
      const m = text.match(/\bact\s+(?:shall\s+)?take\s+effect[^.]{0,100}/i);
      if (m) {
        if (/\bupon\s+passage\b|\bon\s+passage\b|\bimmediately\b/i.test(m[0])) {
          result.effectiveOnPassage = true;
        } else {
          const d = findDateInString(m[0]);
          if (d) result.effectiveDate = d;
        }
      }
    }
  }

  // If "upon passage" + we know signed date, infer effective = signed.
  if (result.effectiveOnPassage && result.signedAt && !result.effectiveDate) {
    result.effectiveDate = result.signedAt;
  }

  return result;
}
