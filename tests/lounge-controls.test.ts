import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseChatFormat, stripChatFormat, toggleWrap } from "@/lib/chat-format";
import { QUICK_REACTIONS, applyReaction, isQuickReaction, tallyReactions } from "@/lib/chat-reactions";
import { CHAT_THEMES, DEFAULT_PREFS, MAX_TEXT_SIZE, TEXT_SIZE_PX, chatStyleVars, prefsFromRow, prefsToRow, sanitizePrefs } from "@/lib/chat-prefs";
import { EDGE, MIN_H, MIN_W, clampRect, cycleSheet, defaultRect, moveRect, parseRect, resizeFromTopLeft, stepSheet } from "@/lib/chat-window";
import { mergeFresh, mergeReactionRows } from "@/lib/chat-feed";

// B8 phase 1: the Lounge's own controls (owner ask 2026-11-25).

const plain = (body: string) => parseChatFormat(body).map((s) => [s.text, s.bold, s.italic]);

describe("chat formatting", () => {
  it("reads **bold**, *italic*, _italic_ and ***both***", () => {
    expect(plain("a **b** c")).toEqual([["a ", false, false], ["b", true, false], [" c", false, false]]);
    expect(plain("*soft* and _quiet_")).toEqual([["soft", false, true], [" and ", false, false], ["quiet", false, true]]);
    expect(plain("***loud***")).toEqual([["loud", true, true]]);
    expect(plain("**very *nice* day**")).toEqual([["very ", true, false], ["nice", true, true], [" day", true, false]]);
  });

  it("leaves ordinary text alone", () => {
    for (const s of ["5 * 3 * 2", "snake_case_name", "** not bold**", "a*b*c", "@_cool_ hi", "2 ** 8", "*", "****"]) {
      expect(stripChatFormat(s)).toBe(s);
    }
  });

  it("never produces markup: tags stay literal text", () => {
    const segs = parseChatFormat("**<img src=x onerror=alert(1)>**");
    expect(segs).toEqual([{ text: "<img src=x onerror=alert(1)>", bold: true, italic: false }]);
  });

  it("strips markers for notifications", () => {
    expect(stripChatFormat("call **today**, *please*")).toBe("call today, please");
  });

  it("toolbar wraps, unwraps and stacks", () => {
    expect(toggleWrap("say hi", 4, 6, "bold")).toEqual({ text: "say **hi**", start: 6, end: 8 });
    expect(toggleWrap("say **hi**", 6, 8, "bold")).toEqual({ text: "say hi", start: 4, end: 6 });
    expect(toggleWrap("say **hi**", 6, 8, "italic").text).toBe("say ***hi***");
    expect(toggleWrap("say ***hi***", 7, 9, "italic").text).toBe("say **hi**");
    expect(toggleWrap("say ***hi***", 7, 9, "bold").text).toBe("say *hi*");
    expect(toggleWrap("x", 1, 1, "italic")).toEqual({ text: "x**", start: 2, end: 2 });
    // Spaces in the selection stay outside the markers, so it still formats.
    expect(toggleWrap("a word here", 1, 7, "bold").text).toBe("a **word** here");
  });
});

describe("quick reactions", () => {
  it("only the fixed list is allowed", () => {
    expect(isQuickReaction("👍")).toBe(true);
    expect(isQuickReaction("🍆")).toBe(false);
    expect(isQuickReaction("<b>")).toBe(false);
  });

  it("the database CHECK holds exactly the same list", () => {
    const sql = readFileSync("supabase/migrations/0336_lounge_prefs_and_reactions.sql", "utf8");
    const m = sql.match(/emoji in \(([^)]*)\)/);
    expect(m).not.toBeNull();
    const list = [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect(list).toEqual([...QUICK_REACTIONS]);
  });

  it("tallies per message in list order and marks mine", () => {
    const rows = [
      { message_id: "m1", user_id: "u2", emoji: "😂" },
      { message_id: "m1", user_id: "u1", emoji: "👍" },
      { message_id: "m1", user_id: "u2", emoji: "👍" },
      { message_id: "m2", user_id: "u2", emoji: "nope" },
    ];
    const t = tallyReactions(rows, "u1");
    expect(t.get("m1")).toEqual([{ emoji: "👍", count: 2, mine: true }, { emoji: "😂", count: 1, mine: false }]);
    expect(t.has("m2")).toBe(false);
  });

  it("applyReaction never duplicates and removes cleanly", () => {
    const r = { message_id: "m", user_id: "u", emoji: "👍" };
    const twice = applyReaction(applyReaction([], r, true), r, true);
    expect(twice).toHaveLength(1);
    expect(applyReaction(twice, r, false)).toEqual([]);
  });
});

describe("lounge prefs", () => {
  it("sanitizes anything into valid settings", () => {
    expect(sanitizePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(sanitizePrefs({ keepOpen: "yes", textSize: 99, theme: "neon", easyFont: true })).toEqual({
      ...DEFAULT_PREFS, textSize: MAX_TEXT_SIZE, easyFont: true,
    });
    expect(sanitizePrefs({ textSize: -3 }).textSize).toBe(0);
  });

  it("round-trips through the table row", () => {
    const p = { keepOpen: true, textSize: 2, easyFont: true, highContrast: false, theme: "paper" as const };
    expect(prefsFromRow(prefsToRow(p))).toEqual(p);
    expect(prefsFromRow(null)).toEqual(DEFAULT_PREFS);
  });

  it("matches the table's CHECK constraints", () => {
    const sql = readFileSync("supabase/migrations/0336_lounge_prefs_and_reactions.sql", "utf8");
    const themes = [...sql.match(/theme in \(([^)]*)\)/)![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect(themes).toEqual([...CHAT_THEMES]);
    expect(sql).toContain(`text_size between 0 and ${MAX_TEXT_SIZE}`);
  });

  it("high contrast overrides the theme, and size follows the step", () => {
    const v = chatStyleVars({ ...DEFAULT_PREFS, theme: "ocean", highContrast: true, textSize: 3 });
    expect(v["--lc-bg"]).toBe("#000000");
    expect(v["--lc-size"]).toBe(`${TEXT_SIZE_PX[3]}px`);
  });
});

describe("chat window geometry", () => {
  const vp = { vw: 1280, vh: 800 };

  it("starts in the bottom-right corner, on screen", () => {
    const r = defaultRect(vp);
    expect(r.x + r.w).toBeLessThanOrEqual(vp.vw - EDGE);
    expect(r.y + r.h).toBeLessThanOrEqual(vp.vh - EDGE);
    expect(r.x).toBeGreaterThan(vp.vw / 2);
  });

  it("can't be dragged off screen", () => {
    const r = moveRect(defaultRect(vp), 5000, 5000, vp);
    expect(r.x + r.w).toBe(vp.vw - EDGE);
    expect(r.y + r.h).toBe(vp.vh - EDGE);
    const l = moveRect(r, -9000, -9000, vp);
    expect([l.x, l.y]).toEqual([EDGE, EDGE]);
  });

  it("resizes from the top-left corner, keeping the bottom-right fixed", () => {
    const r = defaultRect(vp);
    const big = resizeFromTopLeft(r, -100, -50, vp);
    expect([big.x + big.w, big.y + big.h]).toEqual([r.x + r.w, r.y + r.h]);
    expect(big.w).toBe(r.w + 100);
    const small = resizeFromTopLeft(r, 2000, 2000, vp);
    expect([small.w, small.h]).toEqual([MIN_W, MIN_H]);
    expect(small.x + small.w).toBe(r.x + r.w);
  });

  it("re-clamps a stored window on a smaller screen", () => {
    const r = clampRect({ x: 1200, y: 700, w: 900, h: 900 }, { vw: 400, vh: 600 });
    expect(r.w).toBeLessThanOrEqual(400 - 2 * EDGE);
    expect(r.x).toBeGreaterThanOrEqual(EDGE);
  });

  it("rejects junk from storage", () => {
    expect(parseRect(null)).toBeNull();
    expect(parseRect("{oops")).toBeNull();
    expect(parseRect(JSON.stringify({ x: 1, y: 2, w: "3", h: 4 }))).toBeNull();
    expect(parseRect(JSON.stringify({ x: 1, y: 2, w: 3, h: 4 }))).toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });

  it("phone sheet: tap cycles, swipe steps and stops at the ends", () => {
    expect([cycleSheet("short"), cycleSheet("half"), cycleSheet("tall")]).toEqual(["half", "tall", "short"]);
    expect(stepSheet("tall", "up")).toBe("tall");
    expect(stepSheet("short", "down")).toBe("short");
    expect(stepSheet("half", "down")).toBe("short");
  });
});

describe("reopen merge", () => {
  const m = (id: string, t: string) => ({ id, created_at: t });

  it("fresh history wins for its window; later realtime arrivals are kept", () => {
    const current = [m("a", "1"), m("gone", "2"), m("b", "3"), m("late", "9")];
    expect(mergeFresh([m("a", "1"), m("b", "3")], current).map((x) => x.id)).toEqual(["a", "b", "late"]);
    expect(mergeFresh([], current)).toBe(current);
  });

  it("fresh reactions replace those of the messages they cover", () => {
    const cur = [{ message_id: "a", n: 1 }, { message_id: "z", n: 2 }];
    expect(mergeReactionRows([{ message_id: "a", n: 3 }], cur, ["a", "b"])).toEqual([{ message_id: "z", n: 2 }, { message_id: "a", n: 3 }]);
  });
});

describe("no raw HTML in the chat", () => {
  it("nothing under src/modules/chat uses dangerouslySetInnerHTML", () => {
    const dir = "src/modules/chat";
    const files = readdirSync(dir).filter((f) => /\.(tsx?|mjs)$/.test(f));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      expect(readFileSync(path.join(dir, f), "utf8"), f).not.toMatch(/dangerouslySetInnerHTML|innerHTML\s*=/);
    }
  });
});
