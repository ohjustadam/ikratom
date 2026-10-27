/**
 * Banned-state safe mode (migration 0275) for coordinated waves. A wave fires
 * unattended from the template snapshotted when it was created, so the rules the
 * composer applies with the member watching are applied by fireDueWaves itself:
 * officials outside the member's state get no home, current-use lines go to the
 * past tense, and a line that can't be reworded stops that member's copy.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email/user-send", () => {
  class EmailTokenRevokedError extends Error {
    provider = "gmail";
  }
  return {
    getEmailIntegration: vi.fn(async () => ({ provider: "gmail", account_email: "member@gmail.com" })),
    sendOnUserBehalf: vi.fn(async () => undefined),
    markEmailIntegrationRevoked: vi.fn(async () => undefined),
    EmailTokenRevokedError,
  };
});

import { sendOnUserBehalf } from "@/lib/email/user-send";
import { fireDueWaves } from "@/modules/waves/fire";
import { hidesHomeFrom, waveLetter } from "@/modules/waves/safe-mode";

const SUBJECT = "Constituent input on kratom policy in {{state}}";
const BODY = [
  "Dear {{recipient_title}} {{recipient_last_name}},",
  "",
  "My name is {{full_name}} and I am a constituent in {{city}}, {{state}} {{zip}}. As a {{state}} resident who relies on kratom, I urge you to protect adult access.",
  "",
  "Sincerely,",
  "{{full_name}}",
  "{{city}}, {{state}} {{zip}}",
].join("\n");

describe("waveLetter", () => {
  it("leaves the template alone when safe mode is off", () => {
    expect(waveLetter({ subject: SUBJECT, body: BODY }, { safeMode: false, hideHome: true })).toEqual({
      ok: true,
      subject: SUBJECT,
      body: BODY,
    });
  });

  it("hides the home and rewords current use for out-of-state officials", () => {
    const r = waveLetter({ subject: SUBJECT, body: BODY }, { safeMode: true, hideHome: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.subject).toBe("Input on kratom policy");
    expect(r.body).not.toMatch(/\{\{(city|state|zip)\}\}|constituent/);
    expect(r.body).toContain("As an advocate who relied on kratom");
    expect(r.body).toContain("Dear {{recipient_title}} {{recipient_last_name}},");
  });

  it("keeps the home for the member's own officials but still rewords", () => {
    const r = waveLetter({ subject: SUBJECT, body: BODY }, { safeMode: true, hideHome: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.subject).toBe(SUBJECT);
    expect(r.body).toContain("{{city}}, {{state}} {{zip}}");
    expect(r.body).toContain("who relied on kratom");
  });

  it("refuses a line it can't reword safely", () => {
    const r = waveLetter(
      { subject: "Kratom", body: "My daily kratom use is responsible." },
      { safeMode: true, hideHome: false },
    );
    expect(r).toEqual({ ok: false, reason: "safe_mode_use_admission", phrases: ["My daily kratom use"] });
  });
});

describe("hidesHomeFrom", () => {
  const member = { state: "LA", city: "Baton Rouge", county: "East Baton Rouge" };
  const base = { campaignState: null, campaignLocality: null, member, targetState: "LA" };

  it("hides when the campaign or the official is in another state", () => {
    expect(hidesHomeFrom({ ...base, campaignState: "OK" })).toBe(true);
    expect(hidesHomeFrom({ ...base, targetState: "OK" })).toBe(true);
  });

  it("keeps the home in the member's own state and locality", () => {
    expect(hidesHomeFrom({ ...base, campaignState: "LA" })).toBe(false);
    expect(hidesHomeFrom({ ...base, campaignLocality: "Baton Rouge, LA" })).toBe(false);
    expect(hidesHomeFrom({ ...base, campaignLocality: "East Baton Rouge, LA" })).toBe(false);
  });

  it("hides for another locality in the same state, and when unsure of the state", () => {
    expect(hidesHomeFrom({ ...base, campaignLocality: "Lafayette, LA" })).toBe(true);
    expect(hidesHomeFrom({ ...base, member: { ...member, state: null } })).toBe(false);
  });
});

type Rows = {
  banned: string[];
  bannedError?: boolean;
  member: { state: string; pref?: boolean | null };
  legislator?: { state: string };
  /** The campaign's own state; defaults to OK. */
  campaignState?: string | null;
  body?: string;
};

/** A just-enough PostgREST stand-in for fireDueWaves. */
function fakeDb(r: Rows) {
  const updates: { table: string; patch: Record<string, unknown> }[] = [];
  const wave = {
    id: "w1", campaign_id: "c1", title: "Wave", scheduled_at: "2026-10-27T12:00:00Z", fired_at: null, active: true,
    subject_template_snapshot: SUBJECT, body_template_snapshot: r.body ?? BODY,
    target_legislator_ids_snapshot: ["l1"], target_roles_snapshot: [],
  };
  const campaign = {
    id: "c1", slug: "kcpa", state: r.campaignState === undefined ? "OK" : r.campaignState, target_locality: null, target_roles: ["state_senate"],
    target_legislator_ids: ["l1"], subject_template: SUBJECT, body_template: BODY, active: true,
  };
  const legislator = {
    id: "l1", state: r.legislator?.state ?? "OK", role: "state_senate", district: "5", full_name: "Jane Q. Smith",
    party: null, email: "jane@oksenate.gov", phone: null, office_address: null, website: null, level: "state",
    locality: null, body: null, title: null,
  };
  const profile = {
    full_name: "Pat Doe", street: "1 Bayou Rd", city: "Baton Rouge", county: null, state: r.member.state, zip: "70801",
    congressional_district: null, state_senate_district: null, state_house_district: null,
    banned_state_safe_mode: r.member.pref ?? null,
  };

  function from(table: string) {
    let op: "select" | "update" | "insert" = "select";
    let head = false;
    let patch: Record<string, unknown> = {};
    const run = () => {
      if (op === "update") {
        updates.push({ table, patch });
        return { data: null, error: null };
      }
      switch (table) {
        case "campaign_waves": return { data: [wave], error: null };
        case "state_status":
          return r.bannedError
            ? { data: null, error: { message: "state_status unavailable" } }
            : { data: r.banned.map((state) => ({ state })), error: null };
        case "legislators": return { data: [legislator], error: null };
        case "campaign_wave_signups":
          return head ? { data: null, count: 1, error: null } : { data: [{ id: "s1", user_id: "u1" }], error: null };
        default: return { data: [], error: null };
      }
    };
    const one = () =>
      table === "profiles" ? { data: profile, error: null }
      : table === "campaigns" ? { data: campaign, error: null }
      : { data: { sent_count: 0, failed_count: 0 }, error: null };
    const b: Record<string, unknown> = {
      select: (_cols: string, o?: { head?: boolean }) => { head = !!o?.head; return b; },
      update: (p: Record<string, unknown>) => { op = "update"; patch = p; return b; },
      insert: () => Promise.resolve({ error: null }),
      eq: () => b, is: () => b, lte: () => b, order: () => b, limit: () => b, in: () => b,
      single: () => Promise.resolve(one()),
      maybeSingle: () => Promise.resolve(one()),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    };
    return b;
  }
  return { client: { from } as never, updates };
}

const sent = () => vi.mocked(sendOnUserBehalf).mock.calls.map((c) => c[0]);

describe("fireDueWaves with banned-state safe mode", () => {
  beforeEach(() => vi.mocked(sendOnUserBehalf).mockClear());

  it("a Louisiana member's letter to Oklahoma names no home and uses the past tense", async () => {
    const db = fakeDb({ banned: ["LA"], member: { state: "LA" } });
    const out = await fireDueWaves(db.client);
    expect(out.sentTotal).toBe(1);
    const [mail] = sent();
    expect(mail.subject).toBe("Input on kratom policy");
    expect(mail.body).not.toMatch(/Baton Rouge|\bLA\b|70801|constituent/);
    expect(mail.body).toContain("As an advocate who relied on kratom");
    expect(mail.body).toContain("Dear Senator Smith,");
    expect(mail.body).toContain("Sent via iKratom");
  });

  it("keeps the home on a letter to the member's own legislator, still in the past tense", async () => {
    const db = fakeDb({ banned: ["LA"], member: { state: "LA" }, legislator: { state: "LA" }, campaignState: "LA" });
    await fireDueWaves(db.client);
    const [mail] = sent();
    expect(mail.body).toContain("Baton Rouge, LA 70801");
    expect(mail.body).toContain("who relied on kratom");
  });

  it("hides the home when the campaign has no state but the official is elsewhere", async () => {
    const db = fakeDb({ banned: ["LA"], member: { state: "LA" }, legislator: { state: "OK" }, campaignState: null });
    await fireDueWaves(db.client);
    expect(sent()[0].body).not.toMatch(/Baton Rouge|70801/);
  });

  it("safe mode switched off sends the template as written", async () => {
    const db = fakeDb({ banned: ["LA"], member: { state: "LA", pref: false } });
    await fireDueWaves(db.client);
    const [mail] = sent();
    expect(mail.subject).toBe("Constituent input on kratom policy in LA");
    expect(mail.body).toContain("Baton Rouge, LA 70801");
    expect(mail.body).toContain("relies on kratom");
  });

  it("a member outside a banned state is untouched", async () => {
    const db = fakeDb({ banned: ["LA"], member: { state: "TX" } });
    await fireDueWaves(db.client);
    expect(sent()[0].body).toContain("relies on kratom");
  });

  it("skips the member's copy, and sends nothing, when a line can't be reworded", async () => {
    const db = fakeDb({ banned: ["LA"], member: { state: "LA" }, body: "Dear {{recipient_title}},\n\nMy daily kratom use is responsible." });
    const out = await fireDueWaves(db.client);
    expect(sent()).toHaveLength(0);
    expect(out.sentTotal).toBe(0);
    expect(db.updates.some((u) => u.table === "campaign_wave_signups" && u.patch.send_status === "skipped" && u.patch.send_error === "safe_mode_use_admission")).toBe(true);
  });

  it("sends nothing at all when the banned-state list can't be read", async () => {
    const db = fakeDb({ banned: [], bannedError: true, member: { state: "LA" } });
    const out = await fireDueWaves(db.client);
    expect(sent()).toHaveLength(0);
    expect(out.errors).toEqual([{ wave_id: "(safe-mode)", reason: "state_status unavailable" }]);
    expect(db.updates).toEqual([]);
  });
});
