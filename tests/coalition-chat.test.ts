import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Live group chat (B4 e, migration 0291). The realtime + RLS pitfalls that
 * bit the Lounge (AGENTS.md 1 and 2), @handle only, the ONE report system,
 * and a throttle on every write. The live RLS proof is tests/sql/coalition-chat.sql
 * (`npm run test:db`).
 */
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const client = read("src/app/coalitions/[slug]/chat/GroupChat.tsx");
const page = read("src/app/coalitions/[slug]/chat/page.tsx");
const actions = read("src/modules/coalitions/chat-actions.ts");
const sql = read("supabase/migrations/0291_coalition_chat.sql");

describe("group chat realtime", () => {
  it("attaches the JWT before subscribing (pitfall 1)", () => {
    const auth = client.indexOf("supabase.realtime.setAuth(session.access_token)");
    expect(auth).toBeGreaterThan(-1);
    expect(auth).toBeLessThan(client.indexOf("supabase.channel("));
    expect(auth).toBeLessThan(client.indexOf("channel.subscribe("));
  });

  it("filters on the group and has REPLICA IDENTITY FULL for deletes (pitfall 2)", () => {
    expect(client).toMatch(/filter = `coalition_id=eq\.\$\{coalitionId\}`/);
    expect(client).toMatch(/event: "DELETE", schema: "public", table: "coalition_chat_messages", filter/);
    expect(sql).toMatch(/alter table public\.coalition_chat_messages replica identity full/);
    expect(sql).toMatch(/alter publication supabase_realtime add table public\.coalition_chat_messages/);
  });
});

describe("group chat privacy", () => {
  it("is members-only by RLS, with explicit grants and no UPDATE", () => {
    expect(sql).toMatch(/enable row level security/);
    expect(sql).toMatch(/for select to authenticated\s+using \(public\.is_coalition_member\(coalition_id\) or public\.is_admin\(auth\.uid\(\)\)\)/);
    expect(sql).toMatch(/with check \(user_id = auth\.uid\(\) and public\.is_coalition_member\(coalition_id\)\)/);
    expect(sql).toMatch(/revoke all on public\.coalition_chat_messages from anon, authenticated/);
    expect(sql).toMatch(/grant select, insert, delete on public\.coalition_chat_messages to authenticated/);
    expect(sql).not.toMatch(/grant[^;]*update[^;]*coalition_chat_messages to authenticated/i);
  });

  it("renders @handle only, never a real name or email", () => {
    for (const src of [client, page]) {
      expect(src).toMatch(/publicHandle\(/);
      expect(src).not.toMatch(/full_name|\.email\b/);
    }
    expect(page).toMatch(/get_public_profiles/);
  });

  it("404s anyone who isn't a member or a site moderator", () => {
    expect(page).toMatch(/if \(!user\) notFound\(\)/);
    expect(page).toMatch(/if \(!viewer\) notFound\(\)/);
    expect(page).toMatch(/viewer\.moderator \?/);
  });
});

describe("group chat moderation", () => {
  it("puts the shared ReportButton on every line but your own", () => {
    expect(client).toMatch(/import \{ ReportButton \} from "@\/modules\/reports\/components\/ReportButton"/);
    expect(client).toMatch(/m\.user_id !== me\.id && \(\s*<ReportButton targetType="group_chat_message" targetId=\{m\.id\}/);
  });

  it("rate-limits every write and counts deleted rows", () => {
    expect(actions).toMatch(/checkRateLimit\(`coalition:chat:\$\{user\.id\}`, 10, 60\)/);
    expect(actions).toMatch(/checkRateLimit\(`coalition:chat:day:\$\{user\.id\}`, 300, 86_400\)/);
    expect(actions).toMatch(/\.delete\(\)\.eq\("id", id\)\.select\("id"\)/);
    expect(actions).not.toMatch(/fanoutPushNotifications|notifications"\)\.insert/);
  });

  it("a reported chat line opens in its group", async () => {
    const { targetHref } = await import("@/modules/reports/types");
    expect(targetHref("group_chat_message", "c1")).toBe("/coalitions/go/chat/c1");
    const go = read("src/app/coalitions/go/[kind]/[id]/route.ts");
    expect(go).toMatch(/"chat"\]\.includes\(kind\)/);
    expect(go).toMatch(/path = `chat\?m=\$\{id\}#m-\$\{id\}`/);
  });
});
