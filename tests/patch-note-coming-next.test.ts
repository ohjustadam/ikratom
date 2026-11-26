import { describe, it, expect } from "vitest";
import { comingNextSection } from "../src/lib/patch-note-coming-next";

describe("comingNextSection", () => {
  const note = [
    "Intro line.",
    "",
    "## ⚡ Faster",
    "",
    "- State pages load faster.",
    "",
    "## 🔜 Coming next",
    "",
    "These aren't here yet.",
    "",
    "- **Photos, safety first.** Every photo gets a report button.",
    "",
    "Spot something off? Send it from the Feedback tab.",
  ].join("\r\n");

  it("returns the section with its heading, without the sign-off or earlier sections", () => {
    const out = comingNextSection(note)!;
    expect(out.startsWith("## 🔜 Coming next")).toBe(true);
    expect(out).toContain("Every photo gets a report button.");
    expect(out).not.toContain("Spot something off");
    expect(out).not.toContain("State pages load faster");
    expect(out).not.toContain("\r");
  });

  it("stops at the next top-level heading", () => {
    const md = "## Coming next\n\n- A\n\n## Something else\n\n- B";
    expect(comingNextSection(md)).toBe("## Coming next\n\n- A");
  });

  it("is null when there is no section, or it is empty", () => {
    expect(comingNextSection("## New\n\n- A")).toBeNull();
    expect(comingNextSection("## Coming next\n\nSpot something off? Tell us.")).toBeNull();
    expect(comingNextSection(null)).toBeNull();
    expect(comingNextSection("")).toBeNull();
  });
});
