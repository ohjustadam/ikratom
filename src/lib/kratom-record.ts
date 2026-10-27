/**
 * "Your legislators' kratom record" (owner yes, B11, 2026-10-21): before the
 * Nov 3 election, what each sitting state legislator DID on kratom bills.
 *
 * RECORDS, NOT ENDORSEMENTS. This shows facts from the official record only:
 * the bill (in the legislature's own title), whether they sponsored it, how
 * they voted, and what became of it. It deliberately does not label bills or
 * people "pro" or "anti":
 *   - bills.kratom_relevance is an AI guess and some are wrong (2026-10-21:
 *     "anti" bills whose text never mentions kratom);
 *   - only 57 of ~460 kratom bills are human-verified;
 *   - pinning an unverified label on a named person is a standing prohibition
 *     (memory: stance-neutral-tracker-decision).
 * Voters read the record and decide. Pure, so tests pin the grouping.
 */

/**
 * Which of the two neutral axes a bill's text addresses (natural leaf, 7-OH),
 * read from bills.substance_targeting. Optional: /record does not load it.
 * This describes the BILL, never the person; the person's part is only what
 * the record shows (sponsored, voted).
 */
export type Axis = "natural_leaf" | "seven_oh";
export type AxisSignal = { stance: string | null; confidence: string | number | null };
export type RecordBill = {
  id: string; state: string; bill_number: string; title: string | null; status: string | null; session_id: string | null;
  leaf?: AxisSignal | null; seven_oh?: AxisSignal | null;
};
export type VoteRow = { legislator_id: string; vote_text: string | null; vote_value: string | null; vote_date: string | null; motion: string | null; bill: RecordBill };
export type SponsorRow = { legislator_id: string; classification: string | null; bill: RecordBill };

export type RecordEntry = {
  billKey: string;
  billNumber: string;
  title: string;
  status: string | null;
  billId: string;
  sponsored: "primary" | "cosponsor" | null;
  votes: { vote: string; date: string | null; motion: string | null }[];
  axes: Axis[];
};

/** Only a confident "this bill bans / restricts / schedules / protects X" counts as addressing X. */
const ADDRESSES = new Set(["bans", "restricts", "schedules", "preserves"]);
const addresses = (s: AxisSignal | null | undefined) =>
  !!s && ADDRESSES.has(String(s.stance ?? "")) && Number(s.confidence ?? 0) >= 0.8;

export function billAxes(b: RecordBill): Axis[] {
  const out: Axis[] = [];
  if (addresses(b.leaf)) out.push("natural_leaf");
  if (addresses(b.seven_oh)) out.push("seven_oh");
  return out;
}

/**
 * One real bill can exist as several rows: SB 891 (OK) appears three times
 * with different session ids (memory: ikratom-bill-frankenstein-records). Group
 * on number + title, so a reused number with a DIFFERENT title stays separate.
 */
export const billKey = (b: RecordBill) =>
  `${b.state}|${b.bill_number.replace(/\s+/g, " ").toUpperCase()}|${(b.title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80)}`;

/** "Yea"/"aye"/"yes" → "Yes", and so on. Unknown values pass through as recorded. */
export function voteLabel(text: string | null, value: string | null): string {
  const t = `${value ?? ""} ${text ?? ""}`.toLowerCase();
  if (/\b(yea|aye|yes)\b/.test(t)) return "Yes";
  if (/\b(nay|no)\b/.test(t)) return "No";
  if (/absent|excused|not voting|nv\b|abstain/.test(t)) return "Did not vote";
  return (text || value || "Recorded").trim();
}

const STATUS_WORD: Record<string, string> = {
  enacted: "became law", passed: "passed", vetoed: "vetoed", dead: "died", failed: "failed",
  introduced: "introduced", committee: "in committee", in_committee: "in committee",
  in_chamber: "on a chamber floor", passed_chamber: "passed one chamber", engrossed: "passed one chamber",
};
export const statusWord = (s: string | null) => (s ? STATUS_WORD[s.toLowerCase()] ?? s : "status unknown");

/** Per legislator: their kratom bills, newest activity first. */
export function buildRecords(votes: VoteRow[], sponsors: SponsorRow[]): Map<string, RecordEntry[]> {
  const out = new Map<string, Map<string, RecordEntry>>();
  const entry = (legId: string, b: RecordBill) => {
    const byBill = out.get(legId) ?? new Map<string, RecordEntry>();
    out.set(legId, byBill);
    const k = billKey(b);
    let e = byBill.get(k);
    if (!e) {
      e = { billKey: k, billNumber: b.bill_number, title: (b.title ?? "").trim(), status: b.status, billId: b.id, sponsored: null, votes: [], axes: [] };
      byBill.set(k, e);
    }
    for (const a of billAxes(b)) if (!e.axes.includes(a)) e.axes.push(a);
    return e;
  };
  for (const s of sponsors) {
    const e = entry(s.legislator_id, s.bill);
    const primary = /primary|author|chief/i.test(s.classification ?? "");
    if (primary || !e.sponsored) e.sponsored = primary ? "primary" : "cosponsor";
  }
  for (const v of votes) {
    const e = entry(v.legislator_id, v.bill);
    const vote = voteLabel(v.vote_text, v.vote_value);
    if (!e.votes.some((x) => x.date === v.vote_date && x.motion === v.motion && x.vote === vote)) {
      e.votes.push({ vote, date: v.vote_date, motion: v.motion });
    }
  }
  const result = new Map<string, RecordEntry[]>();
  for (const [legId, byBill] of out) {
    const list = [...byBill.values()];
    for (const e of list) e.votes.sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
    list.sort((a, b) => String(b.votes[0]?.date ?? "").localeCompare(String(a.votes[0]?.date ?? "")) || a.billNumber.localeCompare(b.billNumber));
    result.set(legId, list);
  }
  return result;
}

/** What the person did on one bill, in plain words: "Primary sponsor · Voted Yes (Third Reading, 2025-06-02)". */
export function recordFact(e: RecordEntry): string {
  const parts: string[] = [];
  if (e.sponsored) parts.push(e.sponsored === "primary" ? "Primary sponsor" : "Co-sponsor");
  const v = e.votes[0];
  if (v) {
    const when = [v.motion, v.date].filter(Boolean).join(", ");
    const more = e.votes.length > 1 ? ` (+${e.votes.length - 1} more vote${e.votes.length > 2 ? "s" : ""})` : "";
    parts.push(`Voted ${v.vote}${when ? ` (${when})` : ""}${more}`);
  }
  return parts.join(" · ") || "On the record";
}

/** Entries filed under each axis the bill addresses; a bill addressing neither lands in `other`. */
export function recordByAxis(entries: RecordEntry[]): Record<Axis | "other", RecordEntry[]> {
  return {
    natural_leaf: entries.filter((e) => (e.axes ?? []).includes("natural_leaf")),
    seven_oh: entries.filter((e) => (e.axes ?? []).includes("seven_oh")),
    other: entries.filter((e) => (e.axes ?? []).length === 0),
  };
}
