import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  adaptForNonResident,
  buildVars,
  cleanCity,
  groupVars,
  lastName,
  recipientTitle,
  renderSenderOnly,
  renderTemplate,
  unfilledPlaceholders,
} from "../src/modules/campaigns/templates";
import type { Legislator } from "../src/lib/legislators";

/**
 * One-click send, as reported by an advocate on 2026-10-21 (Gulfport, MS to
 * 147 Oklahoma legislators). What went wrong, and what each test pins:
 *   1. Every letter opened "Dear {{recipient_title}} {{recipient_last_name}},":
 *      the renderer didn't know those names. 198 of 205 one-click emails
 *      ever recorded came from templates using them.
 *   2. His edited letter was thrown away for the campaign template.
 *   3. The send ran inside one request; the host cut it at ~30s (60 of 147).
 *   4. Nothing was recorded until the end, so the 60 weren't recorded and a
 *      retry would have emailed them again.
 *   5. "I'm writing as a constituent" from Mississippi to Oklahoma.
 */

const leg = (over: Partial<Legislator>): Legislator =>
  ({ id: "x", state: "OK", role: "state_senate", full_name: "Jane Q. Smith", title: null, ...over }) as Legislator;

const paul = { full_name: "Paul E.", username: "paul", street: "1 Main", city: "Gulfport", state: "MS", zip: "39501" };

describe("per-recipient fields", () => {
  it("addresses each office the way it is addressed", () => {
    expect(recipientTitle(leg({ role: "state_senate" }))).toBe("Senator");
    expect(recipientTitle(leg({ role: "state_house", state: "OK" }))).toBe("Representative");
    expect(recipientTitle(leg({ role: "state_house", state: "CA" }))).toBe("Assemblymember");
    expect(recipientTitle(leg({ role: "state_house", state: "VA" }))).toBe("Delegate");
    expect(recipientTitle(leg({ role: "mayor" }))).toBe("Mayor");
    expect(recipientTitle(leg({ role: "city_council", title: "Alderwoman" }))).toBe("Alderwoman");
    expect(recipientTitle(leg({ role: "city_council", title: "Council Member, Ward 4" }))).toBe("Council Member");
    expect(recipientTitle(leg({ role: "county_commissioner", title: "Supervisor, District 2" }))).toBe("Supervisor");
  });

  it("finds the last name under nicknames and suffixes", () => {
    expect(lastName('F.B. "Rusty" Walker, IV')).toBe("Walker");
    expect(lastName("B.J. Sellers, Jr.")).toBe("Sellers");
    expect(lastName("Ella Holmes-Hines")).toBe("Holmes-Hines");
  });

  it("the reported letter renders with no {{placeholders}} left", () => {
    const letter = "Dear {{recipient_title}} {{recipient_last_name}},\n\nMy 5-year-old daughter asked me to play catch.\n\nSincerely,\nPaul E. from the Gulf Coast";
    const out = renderTemplate(letter, buildVars(paul, leg({}), []));
    expect(out.startsWith("Dear Senator Smith,")).toBe(true);
    expect(out).toContain("My 5-year-old daughter");
    expect(unfilledPlaceholders(out)).toEqual([]);
  });

  it("flags any placeholder we can't fill", () => {
    expect(unfilledPlaceholders("Hi {{recipient_title}} {{ nickname }}")).toEqual(["recipient_title", "nickname"]);
    expect(unfilledPlaceholders("No braces here.")).toEqual([]);
  });

  it("a single compose window to many people gets a group greeting", () => {
    const out = renderTemplate("Dear {{recipient_title}} {{recipient_last_name}},", groupVars([leg({}), leg({ role: "state_house" })]));
    expect(out).toBe("Dear Senators and Representatives,");
  });
});

describe("the composer shows a template the user can edit", () => {
  it("fills the sender and keeps per-recipient fields", () => {
    const tpl = "Dear {{recipient_title}} {{recipient_last_name}},\nSincerely,\n{{full_name}}\n{{city}}, {{state}}";
    const box = renderSenderOnly(tpl, buildVars({ ...paul, city: "Poydras CDP", state: "LA" }, leg({}), []));
    expect(box).toContain("Dear {{recipient_title}} {{recipient_last_name}},");
    expect(box).toContain("Paul E.\nPoydras, LA"); // no Census "CDP" in a signature
    expect(box).not.toContain("Smith"); // never the first official's name for everyone
  });

  it("cleanCity drops only the Census label", () => {
    expect(cleanCity("Poydras CDP")).toBe("Poydras");
    expect(cleanCity("Gulfport")).toBe("Gulfport");
  });
});

describe("out-of-state senders never claim to be constituents", () => {
  it("rewrites each phrasing the live templates use", () => {
    expect(adaptForNonResident("My name is {{full_name}} and I am a constituent in {{city}}, {{state}} {{zip}}."))
      .toBe("My name is {{full_name}} and I live in {{city}}, {{state}} {{zip}}.");
    expect(adaptForNonResident("My name is {{full_name}} and I'm a constituent in NY."))
      .toBe("My name is {{full_name}} and I live in {{city}}, {{state}} and follow kratom policy in NY.");
    expect(adaptForNonResident("I'm writing as a constituent regarding recent kratom-related policy activity in OK."))
      .toBe("I'm writing from {{city}}, {{state}} regarding recent kratom-related policy activity in OK.");
    expect(adaptForNonResident("Reach out to constituents like me.")).toBe("Reach out to advocates like me.");
  });

  it("leaves a neutral mention alone", () => {
    const s = "so constituents can evaluate it on its merits.";
    expect(adaptForNonResident(s)).toBe(s);
  });
});

describe("wiring", () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  const action = read("src/modules/campaigns/components/CampaignAction.tsx");
  const panel = read("src/modules/campaigns/components/SendBatchPanel.tsx");
  const drain = read("src/modules/campaigns/drain-batch.ts");
  const enqueue = read("src/modules/campaigns/send-batch-actions.ts");
  const route = read("src/app/api/cron/drain-send-batches/route.ts");
  const page = read("src/app/campaigns/[slug]/page.tsx");

  it("one-click goes through the durable queue with the user's own text", () => {
    expect(action).not.toMatch(/sendCampaignViaGmail/);
    expect(action).toMatch(/<SendBatchPanel[\s\S]*?subject=\{subject\}[\s\S]*?body=\{body\}[\s\S]*?primary/);
    expect(panel).toMatch(/enqueueCampaignSend\(\{ campaignSlug, legislatorIds: selectedIds, subject, body \}\)/);
    expect(enqueue).toMatch(/subject_template: subjectTpl/);
    expect(enqueue).toMatch(/body_template: bodyTpl/);
  });

  it("an open page drives the member's sends oldest first; the worker shares the same code", () => {
    expect(panel).toMatch(/continueMySend\(campaignSlug, batchId\)/);
    // One mailbox, one queue (Paul, 10-30: an NJ send stalled for 45 minutes
    // while he sent from the ND page). Oldest unfinished batch first, then the
    // page's own if the head made no progress.
    const slice = enqueue.slice(enqueue.indexOf("export async function continueMySend"));
    expect(slice).toMatch(/\.order\("created_at", \{ ascending: true \}\)/);
    expect(slice).toMatch(/drainBatch\(serviceClient\(\), head, deadline\)/);
    expect(slice).toMatch(/drainBatch\(serviceClient\(\), mine, deadline\)/);
    expect(route).toMatch(/drainBatch\(supabase, batch, deadline\)/);
  });

  it("each recipient is claimed before sending, so two drainers never double-send", () => {
    // Anchored to the start of a line, so a commented-out claim does not count.
    expect(drain).toMatch(/^\s*\.eq\("attempts", item\.attempts\)/m);
    expect(drain.indexOf('.eq("attempts", item.attempts)')).toBeLessThan(drain.indexOf("await sendOnUserBehalf("));
  });

  it("each letter is recorded as it goes out, never only at the end", () => {
    const send = drain.indexOf("await sendOnUserBehalf(");
    const record = drain.indexOf('from("campaign_actions").insert(');
    const loopEnd = drain.indexOf("// Recount from the item table");
    expect(record).toBeGreaterThan(send);
    expect(record).toBeLessThan(loopEnd);
  });

  it("refuses to send a letter with unfilled {{placeholders}}", () => {
    expect(enqueue).toMatch(/unfilledPlaceholders\(/);
    expect(drain).toMatch(/unfilledPlaceholders\(/);
  });

  it("the composer is sender-only and made true for out-of-area senders", () => {
    expect(page).toMatch(/renderSenderOnly\(adapt\(campaign\.body_template\), vars\)/);
  });
});

describe("no Source: line in letters (owner call 2026-10-21)", () => {
  const script = readFileSync(new URL("../scripts/auto-campaign-from-alert.mjs", import.meta.url), "utf8");
  const sql = readFileSync(new URL("../supabase/migrations/0272_no_link_lines_in_letters.sql", import.meta.url), "utf8");

  it("the generator script strips link lines from every template", () => {
    expect(script).toMatch(/body: stripLinkLines\(t\.body\)/);
    expect(script).toMatch(/Source\|More detail\|Background and platform\|Background\|Briefing/);
  });

  it("the trigger's renderer strips them too", () => {
    expect(sql).toMatch(/create or replace function public\.render_template_for_alert/);
    expect(sql).toMatch(/Source\|More detail\|Background and platform\|Background\|Briefing/);
  });
});
