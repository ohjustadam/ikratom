import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { threadTitle, AUTO_TITLE_MAX } from "@/modules/coalitions/thread-title";
import { DIGEST_KINDS, SECTIONS, dedupeByLink } from "../scripts/lib/digest-sections.mjs";

/** Every `kind: "coalition_…"` literal the app writes to notifications. */
function groupKindsInCode(): string[] {
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name)) {
        for (const m of readFileSync(p, "utf8").matchAll(/kind:\s*"(coalition_[a-z_]+)"/g)) found.add(m[1]);
      }
    }
  };
  walk(join(process.cwd(), "src"));
  return [...found].sort();
}

describe("group notices reach every channel", () => {
  const kinds = groupKindsInCode();

  it("finds the group kinds (the scan is not vacuous)", () => {
    expect(kinds).toEqual(expect.arrayContaining(["coalition_discussion", "coalition_event", "coalition_join_request", "coalition_action"]));
  });

  it("every group kind the app writes is in the email digest", () => {
    for (const k of kinds) expect(DIGEST_KINDS, k).toContain(k);
  });

  it("every group kind except join requests is muted by the Your groups toggle (0327)", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/0327_notify_groups.sql"), "utf8");
    const line = sql.split("\n").find((l) => l.includes("then 'groups'")) ?? "";
    for (const k of kinds) {
      if (k === "coalition_join_request") expect(line).not.toContain(`'${k}'`);
      else expect(line, k).toContain(`'${k}'`);
    }
    expect(sql).toContain("when 'groups' then not np.notify_groups");
  });

  it("the digest keeps different threads apart and folds repeats of one thread", () => {
    const group = SECTIONS.find((s: { title: string }) => s.title === "Your groups");
    expect(group?.dedupe).toBe("link");
    const items = [
      { title: "New reply in OK Advocates", body: "Hearing Tuesday", link: "/coalitions/ok/t/1" },
      { title: "New reply in OK Advocates", body: "Hearing Tuesday", link: "/coalitions/ok/t/1" },
      { title: "New reply in OK Advocates", body: "Call-in day", link: "/coalitions/ok/t/2" },
    ];
    expect(dedupeByLink(items).map((i: { link: string }) => i.link)).toEqual(["/coalitions/ok/t/1", "/coalitions/ok/t/2"]);
  });
});

describe("threadTitle (posting without a title)", () => {
  it("keeps a typed title", () => {
    expect(threadTitle("Hearing on HB 123", "body", false)).toBe("Hearing on HB 123");
  });
  it("uses the first non-empty line when the title is blank", () => {
    expect(threadTitle("", "\n\n  Who can make the Tuesday hearing?  \nMore here", false)).toBe("Who can make the Tuesday hearing?");
  });
  it("cuts a long first line at a word, under the cap", () => {
    const long = "We need ten people to call the committee chair before Thursday's vote, and here is the script to use";
    const t = threadTitle("", long, false)!;
    expect(t.endsWith("…")).toBe(true);
    expect(t.length).toBeLessThanOrEqual(AUTO_TITLE_MAX);
    expect(long.startsWith(t.slice(0, -1))).toBe(true);
  });
  it("names a photo-only post, and refuses an empty one", () => {
    expect(threadTitle("", "", true)).toBe("📷 A photo for the group");
    expect(threadTitle("", "ok", false)).toBeNull();
  });
});

// ---- group chat @mentions, against an in-memory database --------------------

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
const inserted: Row[] = [];
const pushed = vi.fn<(...args: unknown[]) => Promise<object>>(async () => ({}));

function from(table: string) {
  let rows = [...(db[table] ?? [])];
  const q = {
    select: () => q,
    eq: (c: string, v: unknown) => { rows = rows.filter((r) => r[c] === v); return q; },
    neq: (c: string, v: unknown) => { rows = rows.filter((r) => r[c] !== v); return q; },
    in: (c: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes(r[c])); return q; },
    or: () => q,
    maybeSingle: async () => ({ data: rows[0] ?? null }),
    insert: async (r: Row[]) => { inserted.push(...r); return { error: null }; },
    then: (ok: (v: { data: Row[] }) => unknown) => Promise.resolve({ data: rows }).then(ok),
  };
  return q;
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ from }) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));
vi.mock("@/modules/notifications/push-fanout", () => ({ fanoutPushNotifications: (...a: unknown[]) => pushed(...a) }));

describe("group chat @mentions", () => {
  beforeEach(() => {
    inserted.length = 0;
    pushed.mockClear();
    db.profiles = [
      { id: "me", username: "sender" },
      { id: "u-in", username: "amy" },
      { id: "u-out", username: "bob" },
    ];
    db.coalitions = [{ id: "g1", slug: "ok-advocates", name: "OK Advocates" }];
    db.coalition_members = [
      { coalition_id: "g1", user_id: "me" },
      { coalition_id: "g1", user_id: "u-in" },
    ];
    db.user_blocks = [];
  });

  it("notifies the mentioned member, never a non-member, and pushes at once", async () => {
    const { notifyGroupChatMentions } = await import("@/modules/chat/mentions");
    const n = await notifyGroupChatMentions({
      senderId: "me", senderUsername: "sender", coalitionId: "g1", body: "@amy @bob can you make Tuesday?",
    });
    expect(n).toBe(1);
    expect(inserted).toEqual([
      expect.objectContaining({
        user_id: "u-in", kind: "mention",
        title: "@sender mentioned you in OK Advocates chat",
        link: "/coalitions/ok-advocates/chat",
      }),
    ]);
    expect(pushed).toHaveBeenCalledWith(expect.anything(), { userIds: ["u-in"], kinds: ["mention"], instant: true });
  });

  it("does nothing for a message with no mention, or a self-mention", async () => {
    const { notifyGroupChatMentions } = await import("@/modules/chat/mentions");
    expect(await notifyGroupChatMentions({ senderId: "me", senderUsername: "sender", coalitionId: "g1", body: "hi all" })).toBe(0);
    expect(await notifyGroupChatMentions({ senderId: "me", senderUsername: "sender", coalitionId: "g1", body: "@sender note to self" })).toBe(0);
    expect(inserted).toEqual([]);
  });

  it("the Lounge keeps its own title and link", async () => {
    const { notifyLoungeMentions } = await import("@/modules/chat/mentions");
    await notifyLoungeMentions({ senderId: "me", senderUsername: "sender", messageId: "m1", body: "@bob hello" });
    expect(inserted).toEqual([
      expect.objectContaining({ user_id: "u-out", title: "@sender mentioned you in the Lounge", link: "/?lounge=m1" }),
    ]);
  });
});
