/**
 * A member whose mail link drops hears about it once: one in-app notice and one
 * email. Before this, the pause text sat on the batch row and reached no one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const sendTransactionalEmail = vi.fn(async (input: { to: string; tag?: string }) => ({ ok: true, id: `sent-to-${input.to}` }));
vi.mock("@/lib/email/transactional", () => ({
  sendTransactionalEmail,
  brandedHtml: (i: { headline: string }) => `<html>${i.headline}</html>`,
}));

import { LINK_PAUSE_REASONS, linkDropNoticeDue, noticeMailLinkDropped } from "@/modules/campaigns/mail-link-notice";

function fakeSupabase(email: string | null = "member@gmail.com") {
  const inserts: Record<string, unknown>[] = [];
  const sb = {
    from: () => ({ insert: (row: Record<string, unknown>) => { inserts.push(row); return Promise.resolve({ error: null }); } }),
    auth: { admin: { getUserById: async () => ({ data: { user: email ? { email } : null } }) } },
  };
  return { sb: sb as never, inserts };
}

describe("linkDropNoticeDue", () => {
  it("is due when the batch was sending, queued, or paused for another reason", () => {
    expect(linkDropNoticeDue({ status: "sending" })).toBe(true);
    expect(linkDropNoticeDue({ status: "queued", pause_reason: null })).toBe(true);
    expect(linkDropNoticeDue({ status: "paused", pause_reason: "Daily limit reached for Gmail (100/day)." })).toBe(true);
  });

  it("is not due again for a batch already paused for a dropped link", () => {
    expect(linkDropNoticeDue({ status: "paused", pause_reason: LINK_PAUSE_REASONS.disconnected })).toBe(false);
    expect(linkDropNoticeDue({ status: "paused", pause_reason: LINK_PAUSE_REASONS.revoked })).toBe(false);
  });
});

describe("noticeMailLinkDropped", () => {
  beforeEach(() => sendTransactionalEmail.mockClear());

  it("sends one in-app notice and one email, pointing at /account", async () => {
    const { sb, inserts } = fakeSupabase();
    await noticeMailLinkDropped(sb, "u1", 3);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ user_id: "u1", kind: "campaign_send_batch", link: "/account" });
    expect(String(inserts[0].body)).toContain("3 letters you queued are waiting");
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
    expect(sendTransactionalEmail.mock.calls[0][0]).toMatchObject({ to: "member@gmail.com", tag: "mail_link_dropped" });
  });

  it("says 'letter is' for one", async () => {
    const { sb, inserts } = fakeSupabase();
    await noticeMailLinkDropped(sb, "u1", 1);
    expect(String(inserts[0].body)).toContain("1 letter you queued is waiting");
  });

  it("still leaves the in-app notice when the account has no email", async () => {
    const { sb, inserts } = fakeSupabase(null);
    await noticeMailLinkDropped(sb, "u1", 2);
    expect(inserts).toHaveLength(1);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });
});
