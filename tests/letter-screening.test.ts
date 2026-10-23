import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { letterThreat } from "../src/lib/letter-threats";

/**
 * Member-letter screening (owner rules 2026-10-22): block threats, harassment
 * and slurs; block letters calling for a ban on NATURAL kratom; allow limits
 * on synthetic or concentrated 7-OH (the KCPA's own position). Enforced in the
 * queue, mirrored in the composer, with the self-send buttons off until an
 * edited letter is checked.
 */
const screen = readFileSync(new URL("../src/modules/campaigns/screen-content.ts", import.meta.url), "utf8");
const queue = readFileSync(new URL("../src/modules/campaigns/send-batch-actions.ts", import.meta.url), "utf8");
const action = readFileSync(new URL("../src/modules/campaigns/components/CampaignAction.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../src/modules/campaigns/components/SendBatchPanel.tsx", import.meta.url), "utf8");

describe("threat patterns (no AI needed)", () => {
  it("catches unambiguous threats", () => {
    for (const t of ["I'm going to hurt you", "we will find you and shoot", "You deserve to die", "Watch your back, senator", "I know where you live"]) {
      expect(letterThreat(t), t).toBe(true);
    }
  });

  it("lets firm political language through", () => {
    for (const t of [
      "This bill would kill small businesses in my district.",
      "I will vote against you if you support this ban.",
      "Your position is shameful and I will campaign against it.",
      "Please shoot me an email with your position.",
    ]) {
      expect(letterThreat(t), t).toBe(false);
    }
  });
});

describe("the AI rule", () => {
  it("allows limits on synthetic / concentrated 7-OH and blocks only natural-leaf bans", () => {
    expect(screen).toMatch(/bans_natural_kratom: argues FOR banning, scheduling or criminalizing natural\/leaf kratom/);
    expect(screen).toMatch(/INCLUDING letters that support restricting or banning synthetic, " \+\s*"semi-synthetic or concentrated 7-OH products while protecting natural leaf/);
  });

  it("blocks only at high confidence, and an outage never stops a member", () => {
    expect(screen).toMatch(/clamp01\(data\?\.confidence\) >= 0\.7/);
    expect(screen).toMatch(/catch \{\s*return \{ block: false, category: "ok", message: "" \}; \/\/ outage/);
    // the no-AI threat check runs first
    expect(screen.indexOf("if (letterThreat(text))")).toBeLessThan(screen.indexOf("completeStructured<{ category"));
  });
});

describe("wiring", () => {
  it("the queue screens a member's own letter before anything is stored", () => {
    const body = queue.slice(queue.indexOf("export async function enqueueCampaignSend"));
    const check = body.indexOf("await screenMemberLetter(");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(body.indexOf('.from("campaign_send_batches")'));
  });

  it("the composer shows the result, disables send, and locks the self-send buttons", () => {
    expect(action).toMatch(/blockedReason=\{letterBlocked \? screen\.message : null\}/);
    expect(panel).toMatch(/disabled=\{pending \|\| selectedIds\.length === 0 \|\| !!blockedReason\}/);
    expect(action.match(/disabled=\{externalLocked\}/g)).toHaveLength(3);
  });

  it("Connect-first: the self-send options start closed", () => {
    expect(action).toMatch(/<details className="mt-6 rounded-lg border border-zinc-800 bg-zinc-950\/40">/);
    expect(action).not.toMatch(/open=\{!gmailConnected\}/);
  });
});
