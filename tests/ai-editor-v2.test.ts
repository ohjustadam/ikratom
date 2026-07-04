import { describe, it, expect } from "vitest";
import { parseProposal, parseRead } from "../src/modules/admin/ai-editor-protocol";
import {
  ENTITIES, validateChanges, coerceField, isValidEntityId, summarizeDiff,
} from "../src/modules/admin/entity-edit";

const UUID = "123e4567-e89b-42d3-a456-426614174000";

describe("ai-editor protocol", () => {
  it("parses and strips a trailing PROPOSE line", () => {
    const [p, rest] = parseProposal(
      `I'll fix the status.\nPROPOSE: {"tool":"edit_entity","args":{"type":"bill","id":"${UUID}","changes":{"status":"enacted"}},"summary":"Set SB 891 to enacted"}`,
    );
    expect(p?.tool).toBe("edit_entity");
    expect((p?.args as { type: string }).type).toBe("bill");
    expect(p?.summary).toBe("Set SB 891 to enacted");
    expect(rest).toBe("I'll fix the status.");
  });

  it("returns null for malformed PROPOSE JSON but still strips it", () => {
    const [p, rest] = parseProposal(`Answer.\nPROPOSE: {not json}`);
    expect(p).toBeNull();
    expect(rest).toBe("Answer.");
  });

  it("ignores PROPOSE mentioned mid-text (only trailing counts)", () => {
    const [p, rest] = parseProposal("A PROPOSE: {} in the middle.\nFinal words.");
    expect(p).toBeNull();
    expect(rest).toContain("Final words.");
  });

  it("parses a trailing READ line", () => {
    const [r, rest] = parseRead(`Checking the queue.\nREAD: {"tool":"list_pending","args":{"queue":"intel"}}`);
    expect(r?.tool).toBe("list_pending");
    expect(rest).toBe("Checking the queue.");
  });

  it("rejects READ with array args", () => {
    const [r] = parseRead(`x\nREAD: {"tool":"find","args":[1,2]}`);
    expect(r).toBeNull();
  });
});

describe("entity-edit whitelist", () => {
  it("rejects unknown entity types", () => {
    const v = validateChanges("profiles" as never, UUID, { is_admin: true });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toContain("Unknown entity type");
  });

  it("rejects non-whitelisted columns (no escape hatch)", () => {
    const v = validateChanges("campaign", UUID, { created_by: "someone-else" });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toContain("not editable");
  });

  it("rejects review_state edits on campaigns (moderation must use moderate_campaign)", () => {
    const v = validateChanges("campaign", UUID, { review_state: "auto_active" });
    expect(v.ok).toBe(false);
  });

  it("rejects moderation_status edits on alerts", () => {
    const v = validateChanges("alert", UUID, { moderation_status: "approved" });
    expect(v.ok).toBe(false);
  });

  it("accepts a valid bill status edit", () => {
    const v = validateChanges("bill", UUID, { status: "enacted", active: "false" });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.patch.status).toBe("enacted");
      expect(v.patch.active).toBe(false);
    }
  });

  it("rejects an invalid enum value", () => {
    const v = validateChanges("bill", UUID, { status: "totally-made-up" });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toContain("must be one of");
  });

  it("enforces text length caps", () => {
    const v = validateChanges("campaign", UUID, { title: "x".repeat(301) });
    expect(v.ok).toBe(false);
  });

  it("requires a UUID id for uuid tables and 2-letter code for states", () => {
    expect(validateChanges("bill", "not-a-uuid", { status: "dead" }).ok).toBe(false);
    expect(validateChanges("state", "OKLAHOMA", { notes: "x" }).ok).toBe(false);
    expect(validateChanges("state", "OK", { notes: "x" }).ok).toBe(true);
  });

  it("rejects empty and oversized change sets", () => {
    expect(validateChanges("bill", UUID, {}).ok).toBe(false);
    const big: Record<string, unknown> = {};
    for (let i = 0; i < 11; i++) big[`f${i}`] = "v";
    expect(validateChanges("bill", UUID, big).ok).toBe(false);
  });

  it("coerces dates to ISO and rejects garbage", () => {
    const def = { kind: "date" } as const;
    const [ok, v] = coerceField(def, "2026-08-01");
    expect(ok).toBe(true);
    expect(String(v)).toMatch(/^2026-08-01T/);
    expect(coerceField(def, "not a date")[0]).toBe(false);
  });

  it("every editable column is also a display column (inspect shows what edit touches)", () => {
    for (const def of Object.values(ENTITIES)) {
      for (const col of Object.keys(def.editable)) {
        expect(def.displayCols).toContain(col);
      }
    }
  });

  it("id validation helper", () => {
    expect(isValidEntityId("bill", UUID)).toBe(true);
    expect(isValidEntityId("state", "OK")).toBe(true);
    expect(isValidEntityId("state", UUID)).toBe(false);
  });

  it("summarizes diffs compactly", () => {
    const s = summarizeDiff({ status: { from: "passed_chamber", to: "enacted" } });
    expect(s).toBe('status: "passed_chamber" → "enacted"');
  });
});
