/**
 * The send record (B9, mig 0276) beyond campaign compose: ComposeModal,
 * GroupComposeModal and the alerts DraftResponsePanel BCC r-<nonce>@ikratom.org
 * the same way CampaignAction does. These tests pin the pieces that carry the
 * guarantee: one nonce per logged row, the server only stores a valid one, the
 * record address rides with the other BCCs without breaking the mailto cap, and
 * each surface keeps the footer and the notice.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const inserts: { table: string; row: Record<string, unknown> }[] = [];
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        inserts.push({ table, row });
        return { error: null };
      },
    }),
  }),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));
vi.mock("@/lib/ai", () => ({ completeStructured: vi.fn() }));

import { RECORD_NONCE_RE, bccCopyLine, nonceForClick, recordAddress, withRecordBcc } from "@/lib/send-record";
import { logOfficialContact } from "@/modules/compose/actions";
import { buildGmailComposeUrl, buildMailtoUrl, buildOutlookComposeUrl, mailtoWithinLimit } from "@/modules/compose/send-links";

describe("nonceForClick", () => {
  it("is null when the member opted out", () => {
    expect(nonceForClick({ keepCopy: false, logged: false, loggedNonce: null })).toBeNull();
    expect(nonceForClick({ keepCopy: false, logged: true, loggedNonce: "abcdefghijklmnop" })).toBeNull();
  });

  it("mints a valid nonce on the first click", () => {
    expect(nonceForClick({ keepCopy: true, logged: false, loggedNonce: null })).toMatch(RECORD_NONCE_RE);
  });

  it("reuses the logged nonce on every later click: one row, one record address", () => {
    for (let i = 0; i < 5; i++) {
      expect(nonceForClick({ keepCopy: true, logged: true, loggedNonce: "abcdefghijklmnop" })).toBe("abcdefghijklmnop");
    }
  });

  it("carries none when the logged row has none: a fresh one could never be matched", () => {
    expect(nonceForClick({ keepCopy: true, logged: true, loggedNonce: null })).toBeNull();
  });
});

describe("the record address rides with the other recipients", () => {
  const nonce = "abcdefghijklmnop";
  const to = "sen.smith@okhouse.gov";
  const bcc = "b@x.gov,c@x.gov";

  it("is appended to the BCC list in all three compose URLs", () => {
    const withCopy = withRecordBcc(bcc, nonce);
    for (const url of [
      buildGmailComposeUrl(to, "S", "B", withCopy),
      buildOutlookComposeUrl(to, "S", "B", withCopy),
      buildMailtoUrl(to, "S", "B", withCopy),
    ]) {
      expect(decodeURIComponent(url.replace(/\+/g, " "))).toContain(`bcc=${bcc},${recordAddress(nonce)}`);
    }
  });

  it("a single recipient with no BCC still gets the record BCC, and none without a nonce", () => {
    expect(buildGmailComposeUrl(to, "S", "B", withRecordBcc("", nonce))).toContain("bcc=r-abcdefghijklmnop%40ikratom.org");
    expect(buildGmailComposeUrl(to, "S", "B", withRecordBcc("", null))).not.toContain("bcc=");
  });

  it("is sized into the mailto cap before it is added", () => {
    // A body that fits on its own but not once the record address is added.
    let body = "x";
    while (mailtoWithinLimit(buildMailtoUrl(to, "S", body, bcc))) body += "x";
    const fits = body.slice(0, -1);
    expect(mailtoWithinLimit(buildMailtoUrl(to, "S", fits, bcc))).toBe(true);
    expect(mailtoWithinLimit(buildMailtoUrl(to, "S", fits, withRecordBcc(bcc, "a".repeat(16))))).toBe(false);
  });

  it("the copied message names the record address on its own Bcc line", () => {
    expect(bccCopyLine(nonce)).toBe("Bcc: r-abcdefghijklmnop@ikratom.org\n");
    expect(bccCopyLine(null)).toBe("");
  });
});

describe("logOfficialContact stores the nonce", () => {
  const log = (extra: Record<string, unknown>) => {
    inserts.length = 0;
    return logOfficialContact({ officialId: null, source: "compose", subject: "S", body: "B", ...extra });
  };

  it("keeps a valid nonce on the direct-send row", async () => {
    expect(await log({ recordNonce: "abcdefghijklmnop" })).toEqual({ ok: true });
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe("campaign_actions");
    expect(inserts[0].row).toMatchObject({ campaign_id: null, method: "mailto", record_nonce: "abcdefghijklmnop" });
  });

  it("drops anything that isn't a nonce rather than failing the log", async () => {
    for (const bad of ["ABCDEFGHIJKLMNOP", "short", "abcdefgh1jklmnop", 7, {}]) {
      expect(await log({ recordNonce: bad })).toEqual({ ok: true });
      expect(inserts[0].row.record_nonce).toBeNull();
    }
  });

  it("is null when the surface sent none", async () => {
    await log({});
    expect(inserts[0].row.record_nonce).toBeNull();
  });
});

describe("every surface carries the record, the notice and the footer", () => {
  const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
  const compose = src("modules/compose/ComposeModal.tsx");
  const group = src("modules/compose/GroupComposeModal.tsx");
  const draft = src("app/alerts/[id]/DraftResponsePanel.tsx");

  it.each([
    ["ComposeModal", compose],
    ["GroupComposeModal", group],
    ["DraftResponsePanel", draft],
  ])("%s mints at click, shows the notice, and logs the nonce", (_n, code) => {
    expect(code).toContain("<SendRecordNotice");
    expect(code).toMatch(/e\.currentTarget\.href = build\(withRecordBcc\(/);
    expect(code).toMatch(/recordNonce: recordNonce \?\? undefined/);
    // No email path logs without going through the record.
    expect(code).not.toMatch(/onClick=\{\(\) => logSend\("(gmail|outlook|mailto)"\)\}/);
  });

  it("the modals log one row and reuse its nonce; the contact-form flow gets no BCC", () => {
    for (const code of [compose, group]) {
      expect(code).toMatch(/loggedNonceRef\.current = recordNonce/);
      expect(code).toMatch(/nonceForClick\(\{ keepCopy: recordOn, logged: loggedRef\.current, loggedNonce: loggedNonceRef\.current \}\)/);
      expect(code).toMatch(/recordOn = keepCopy && signedIn/);
    }
    expect(compose).toMatch(/recordOn = keepCopy && signedIn && !formUrl/);
    // A signed-out visitor has no logged click for the copy to match.
    expect(compose).toMatch(/\{signedIn && <SendRecordNotice/);
    expect(group).toMatch(/\{signedIn && <SendRecordNotice/);
  });

  it("the letter still ends with the Sent via iKratom footer", () => {
    expect(compose).toMatch(/letter = withLetterFooter\(body\)/);
    expect(group).toMatch(/letter = withLetterFooter\(body\)/);
  });

  it("the draft panel sizes its mailto with the record address and keeps Copy BCC-free", () => {
    expect(draft).toMatch(/withRecordBcc\(bcc, keepCopy \? "a"\.repeat\(16\) : null\)/);
    expect(draft).toMatch(/function copyToClipboard\(\)[\s\S]*?logSend\(\);/);
  });
});
