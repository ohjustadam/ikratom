import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { looksLikeSelling, sellingIssue, SELLING_MESSAGE } from "@/lib/selling";

describe("selling screen (owner, 2026-11-03: advocacy, never an advertisers' paradise)", () => {
  const pitches = [
    "Use code KRATOM20 at checkout",
    "promo code inside, 15% off this week",
    "Free shipping on every order!",
    "DM me for prices",
    "hmu to order, I've got red and green",
    "message me for the menu",
    "Check out our shop on Main St, new strains every week",
    "Visit my store for the best maeng da",
    "Our shop is running a sale all weekend",
    "Maeng da back in stock",
    "wholesale pricing available, ask me",
    "$85/kg or $25 per 250g",
    "$12 a bottle, shots are cheap",
    "Order from us and we ship nationwide",
    "link in bio",
    "Buy now before the ban",
  ];
  for (const p of pitches) {
    it(`refuses: ${p}`, () => {
      expect(looksLikeSelling(p)).toBe(true);
      expect(sellingIssue(p)).toBe(SELLING_MESSAGE);
    });
  }

  // Vendors are welcome as advocates; bill text talks about sales all day.
  const advocacy = [
    "My shop will close if HB 1784 passes. Please call your senator.",
    "The bill bans the sale of kratom to anyone under 21.",
    "Products offered for sale must carry a label and a batch number.",
    "I own a store in Tulsa and testified at the hearing on Tuesday.",
    "Vendors, consumers and advocates should all show up on the 14th.",
    "The FDA ordered a recall of 7-OH shots sold at gas stations.",
    "A kratom tax of 10% was dropped from the bill in committee.",
    "Our shop owners' group is meeting at the capitol.",
    "DM me if you want to carpool to the hearing.",
    "Message me for the hearing details.",
    "Kratom costs me about $40 a month and it replaced my opioids.",
    "This group is 100% volunteer, 0% off-topic.",
    "",
  ];
  for (const a of advocacy) {
    it(`allows: ${a || "(empty)"}`, () => {
      expect(sellingIssue(a)).toBeNull();
    });
  }
  it("treats null as empty", () => expect(sellingIssue(null)).toBeNull());
});

describe("every member-written surface runs the selling screen", () => {
  // A screen nobody calls guards nothing. Each write path must call it.
  const paths = [
    "src/modules/forum/actions.ts",
    "src/modules/chat/actions.ts",
    "src/modules/coalitions/chat-actions.ts",
    "src/modules/wall/actions.ts",
    "src/modules/profile/validate.ts",
    "src/modules/profile/photo-actions.ts",
    "src/app/api/media/upload/route.ts",
    "src/modules/stories/actions.ts",
  ];
  for (const p of paths) {
    it(p, () => {
      const src = readFileSync(p, "utf8");
      expect(src).toMatch(/from "@\/lib\/selling"/);
      expect(src).toMatch(/sellingIssue\(/);
    });
  }
  it("the forum screens both new threads and replies", () => {
    const src = readFileSync("src/modules/forum/actions.ts", "utf8");
    expect(src.match(/sellingIssue\(/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
