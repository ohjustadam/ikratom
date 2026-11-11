/**
 * Replying to feedback from /admin/feedback (owner ask 2026-11-10: "I can view
 * them and get notifications. I just can't respond."). Pins who a reply can
 * reach, the guard rails (admin check, rate limit, audit, length cap), that
 * mail and push go through the shared senders, and the migration's RLS/grants.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { table: string; op: string; payload?: unknown; filters: [string, unknown][] };
const calls: Call[] = [];
const state: { report: Record<string, unknown> | null; notifErr: { message: string } | null } = {
  report: null,
  notifErr: null,
};

function from(table: string) {
  const call: Call = { table, op: "select", filters: [] };
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b,
    insert: (p: unknown) => {
      call.op = "insert";
      call.payload = p;
      calls.push(call);
      return b;
    },
    update: (p: unknown) => {
      call.op = "update";
      call.payload = p;
      calls.push(call);
      return b;
    },
    eq: (k: string, v: unknown) => {
      call.filters.push([k, v]);
      return b;
    },
    maybeSingle: async () => ({ data: state.report, error: null }),
    single: async () => ({ data: { id: "reply-1" }, error: null }),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(
        table === "notifications" && call.op === "insert" ? { error: state.notifErr } : { data: null, error: null },
      ).then(res, rej),
  });
  return b;
}

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ from }) }));
vi.mock("@/modules/admin/actions", () => ({ getAdminContext: vi.fn(async () => ({ ok: true, userId: "admin-1" })) }));
vi.mock("@/lib/audit", () => ({ recordAdminAction: vi.fn(async () => undefined) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock("@/lib/email/router", () => ({
  sendEmail: vi.fn(async () => ({ ok: true, provider: "brevo", id: "m1" })),
}));
vi.mock("@/modules/notifications/push-fanout", () => ({
  fanoutPushNotifications: vi.fn(async () => ({ sent: 1 })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { getAdminContext } from "@/modules/admin/actions";
import { recordAdminAction } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { sendEmail } from "@/lib/email/router";
import { fanoutPushNotifications } from "@/modules/notifications/push-fanout";
import { replyToFeedback } from "@/modules/feedback/reply-actions";
import {
  REPLY_MAX,
  cleanReplyBody,
  deliveryLabel,
  findReplyEmail,
  normalizeContactEmail,
  replyEmail,
  replyNotification,
  replyRoute,
} from "@/modules/feedback/reply";

const ID = "2e15022d-0000-4000-8000-000000000001";
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const writes = (table: string, op: string) => calls.filter((c) => c.table === table && c.op === op);

beforeEach(() => {
  calls.length = 0;
  state.report = null;
  state.notifErr = null;
  vi.clearAllMocks();
});

describe("who a reply reaches", () => {
  it("normalizes the widget email and rejects junk", () => {
    expect(normalizeContactEmail("  Sam@Example.COM ")).toBe("sam@example.com");
    expect(normalizeContactEmail("")).toBeNull();
    expect(normalizeContactEmail(null)).toBeNull();
    expect(normalizeContactEmail("not an email")).toBe("invalid");
    expect(normalizeContactEmail(`${"a".repeat(250)}@x.io`)).toBe("invalid");
  });

  it("prefers the widget field, else the first address in their own message", () => {
    expect(findReplyEmail({ contact_email: "field@example.com", message: "me: other@example.com" })).toBe(
      "field@example.com",
    );
    expect(findReplyEmail({ message: "Can't sign up. Reach me at sam.doe+k@mail.example.org." })).toBe(
      "sam.doe+k@mail.example.org",
    );
    expect(findReplyEmail({ message: "no address here @ all" })).toBeNull();
  });

  it("routes members to the site, anonymous senders to email, and refuses with neither", () => {
    expect(replyRoute({ user_id: "u1", message: "x@example.com" })).toEqual({ channel: "site", userId: "u1" });
    expect(replyRoute({ user_id: null, message: "x@example.com" })).toEqual({ channel: "email", to: "x@example.com" });
    expect(replyRoute({ user_id: null, message: "hi" }).channel).toBeNull();
  });
});

describe("what a reply says", () => {
  it("caps and trims the body", () => {
    expect(cleanReplyBody("  \r\n ")).toEqual({ error: "Write a reply first." });
    expect("error" in cleanReplyBody("x".repeat(REPLY_MAX + 1))).toBe(true);
    expect(cleanReplyBody(" Thanks!\r\nFixed. ")).toEqual({ body: "Thanks!\nFixed." });
  });

  it("links the notification to the report on /feedback with a short preview", () => {
    const n = replyNotification(ID, "a ".repeat(200));
    expect(n.kind).toBe("feedback_reply");
    expect(n.link).toBe(`/feedback#r-${ID}`);
    expect(n.body.length).toBeLessThanOrEqual(140);
  });

  it("emails as the team, quotes their message and says how to answer", () => {
    const m = replyEmail({
      reportMessage: "Signup failed",
      reportDate: "2026-11-09T12:56:00Z",
      body: "Fixed now, try again.",
      siteUrl: "https://www.ikratom.org",
    });
    expect(m.text).toContain("> Signup failed");
    expect(m.text).toContain("Fixed now, try again.");
    expect(m.text).toContain("replying to this email");
    expect(m.text).toContain("November 9, 2026");
  });

  it("labels delivery for the thread", () => {
    expect(deliveryLabel({ channel: "email", status: "sent", detail: "via brevo" })).toBe("Emailed · via brevo");
    expect(deliveryLabel({ channel: "site", status: "failed", detail: null })).toBe("On the site · not delivered");
  });
});

describe("replyToFeedback", () => {
  it("refuses non-admins before touching anything", async () => {
    vi.mocked(getAdminContext).mockResolvedValueOnce({ ok: false, reason: "not_admin" } as never);
    expect(await replyToFeedback({ id: ID, body: "hi" })).toEqual({ error: "Admins only." });
    expect(calls).toHaveLength(0);
    expect(getAdminContext).toHaveBeenCalledWith({ require: "moderate_feedback" });
  });

  it("checks the id, the body and the rate limit", async () => {
    expect(await replyToFeedback({ id: "nope", body: "hi" })).toEqual({ error: "Invalid id." });
    expect("error" in (await replyToFeedback({ id: ID, body: "x".repeat(REPLY_MAX + 1) }))).toBe(true);
    vi.mocked(checkRateLimit).mockResolvedValueOnce(false);
    expect("error" in (await replyToFeedback({ id: ID, body: "hi" }))).toBe(true);
    expect(checkRateLimit).toHaveBeenCalledWith("feedback-reply:admin-1", 20, 3600);
    expect(calls).toHaveLength(0);
  });

  it("answers a member on the site: notification, instant push lane, no email", async () => {
    state.report = { id: ID, user_id: "member-1", message: "bug", contact_email: null, created_at: "2026-11-09T00:00:00Z" };
    const r = await replyToFeedback({ id: ID, body: "Thanks, fixed.", resolve: true });
    expect(r).toMatchObject({ ok: true, delivered: true });

    const [note] = writes("notifications", "insert");
    expect(note.payload).toMatchObject({ user_id: "member-1", kind: "feedback_reply", link: `/feedback#r-${ID}` });
    expect(fanoutPushNotifications).toHaveBeenCalledWith(expect.anything(), {
      userIds: ["member-1"],
      kinds: ["feedback_reply"],
      instant: true,
    });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(writes("feedback_replies", "insert")[0].payload).toMatchObject({
      report_id: ID,
      author_id: "admin-1",
      channel: "site",
      sent_to: null,
      status: "pending",
    });
    expect(writes("feedback_replies", "update")[0].payload).toMatchObject({ status: "sent" });
    expect(writes("feedback_reports", "update")[0].payload).toMatchObject({ status: "resolved", resolved_by: "admin-1" });
    expect(recordAdminAction).toHaveBeenCalledWith({
      action: "feedback.reply",
      targetId: ID,
      details: { channel: "site", status: "sent", resolved: true, length: 14 },
    });
  });

  it("emails an anonymous sender at the address they gave, Reply-To support@", async () => {
    state.report = {
      id: ID,
      user_id: null,
      message: "Can't create an account. sam@example.com",
      contact_email: null,
      created_at: "2026-11-09T00:00:00Z",
    };
    const r = await replyToFeedback({ id: ID, body: "Fixed, please try again." });
    expect(r).toMatchObject({ ok: true, delivered: true, detail: "via brevo" });
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "sam@example.com", replyTo: "support@ikratom.org", tag: "feedback_reply" }),
    );
    const sent = vi.mocked(sendEmail).mock.calls[0][0];
    expect(sent.fromEmail).toBeUndefined();
    expect(writes("notifications", "insert")).toHaveLength(0);
    expect(writes("feedback_replies", "insert")[0].payload).toMatchObject({ channel: "email", sent_to: "sam@example.com" });
    expect(writes("feedback_reports", "update")).toHaveLength(0);
  });

  it("records a failed email and does not resolve the report", async () => {
    state.report = { id: ID, user_id: null, message: "x", contact_email: "sam@example.com", created_at: "2026-11-09T00:00:00Z" };
    vi.mocked(sendEmail).mockResolvedValueOnce({ ok: false, tried: [{ provider: "brevo", error: "500" }] } as never);
    const r = await replyToFeedback({ id: ID, body: "hello", resolve: true });
    expect(r).toMatchObject({ ok: true, delivered: false, detail: "brevo failed" });
    expect(writes("feedback_replies", "update")[0].payload).toMatchObject({ status: "failed" });
    expect(writes("feedback_reports", "update")).toHaveLength(0);
  });

  it("refuses a report nobody can be reached at, without saving anything", async () => {
    state.report = { id: ID, user_id: null, message: "hi", contact_email: null, created_at: "2026-11-09T00:00:00Z" };
    expect("error" in (await replyToFeedback({ id: ID, body: "hello" }))).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("guard rails in the source", () => {
  const action = read("src/modules/feedback/reply-actions.ts");
  const mine = read("src/modules/feedback/mine.ts");
  const providers = read("src/lib/email/providers.ts");
  const sql = read("supabase/migrations/0320_feedback_replies.sql");

  it("never sends push or mail directly, and never uses the owner's address", () => {
    expect(action).not.toMatch(/sendPush\(|web-push|sendTransactionalEmail|OWNER_EMAIL/);
  });

  it("passes Reply-To through every platform provider", () => {
    expect(providers.match(/msg\.replyTo \?/g)).toHaveLength(4);
  });

  it("shows members the reply text and date, never who wrote it", () => {
    expect(mine).toContain('.eq("user_id", user.id)');
    expect(mine).not.toMatch(/author_id|sent_to/);
  });

  it("gives the new table RLS and explicit grants, nothing for anon", () => {
    expect(sql).toMatch(/alter table public\.feedback_replies enable row level security/);
    expect(sql).toMatch(/revoke all on public\.feedback_replies from anon, authenticated/);
    expect(sql).toMatch(/grant select on public\.feedback_replies to authenticated/);
    expect(sql).toMatch(/to service_role/);
    expect(sql).toMatch(/using \(public\.is_admin\(auth\.uid\(\)\)\)/);
  });

  it("puts replies in the member email digest", () => {
    expect(read("scripts/send-email-notifications.mjs")).toMatch(/kinds: \["feedback_reply"\]/);
  });
});
