import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { validateResource, STARTER_TEMPLATE, PLACEHOLDER_PREVIEW, TEMPLATE_PLACEHOLDERS } from "@/modules/coalitions/resources";
import { fillGroupTemplate } from "@/modules/compose/letter-templates";

/**
 * Pinned resources + testimony templates (B4 h, migration 0293). A template
 * goes through the shared composer, never a hand-rolled mailto; links are
 * http(s) only. The live RLS proof is tests/sql/coalition-resources.sql.
 */
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const page = read("src/app/coalitions/[slug]/r/[resourceId]/page.tsx");
const list = read("src/app/coalitions/[slug]/Resources.tsx");
const form = read("src/app/coalitions/[slug]/ResourcesClient.tsx");
const modal = read("src/modules/compose/ComposeModal.tsx");
const sql = read("supabase/migrations/0293_coalition_resources.sql");

describe("validateResource mirrors the table", () => {
  it("accepts a link and a template", () => {
    expect(validateResource({ kind: "link", title: "Hearing page", url: "https://example.org/x" }).ok).toBe(true);
    expect(validateResource({ kind: "template", title: "Testimony", body: "Dear {{official_greeting}}" }).ok).toBe(true);
  });
  it("refuses anything but http(s) links", () => {
    for (const url of ["javascript:alert(1)", "data:text/html,x", "example.org", "https://has space.org"]) {
      expect(validateResource({ kind: "link", title: "Bad link", url }).ok).toBe(false);
    }
    expect(sql).toMatch(/url ~\* '\^https\?:\/\/\[\^\[:space:\]\]\+\$'/);
  });
  it("needs a title, and a body for a template", () => {
    expect(validateResource({ kind: "link", title: "x", url: "https://a.org" }).ok).toBe(false);
    expect(validateResource({ kind: "template", title: "Testimony", body: "  " }).ok).toBe(false);
    expect(validateResource({ kind: "nope" as "link", title: "Testimony" }).ok).toBe(false);
  });
});

describe("a group template in the composer", () => {
  it("fills what we know and leaves ___ for the rest", () => {
    const out = fillGroupTemplate("Dear {{official_greeting}},\n\nI'm {{my_name}} from {{my_city}}. About {{meeting_date}}.", {
      official_greeting: "Senator Lee", my_name: "Sam", my_city: "",
    });
    expect(out).toBe("Dear Senator Lee,\n\nI'm Sam from ___. About ___.");
  });
  it("the starter uses only placeholders the composer fills", () => {
    const used = [...STARTER_TEMPLATE.body.matchAll(/\{\{([a-z_]+)\}\}/g)].map((m) => m[1]);
    for (const p of used) expect(TEMPLATE_PLACEHOLDERS).toContain(p);
    expect(fillGroupTemplate(STARTER_TEMPLATE.body, PLACEHOLDER_PREVIEW)).not.toMatch(/\{\{/);
  });
  it("ComposeModal takes the template and fills it per official", () => {
    expect(modal).toMatch(/template\?: \{ subject: string; body: string \} \| null;/);
    expect(modal).toMatch(/fillGroupTemplate\(template\.body, known\)/);
    expect(modal).toMatch(/official_greeting: officialGreeting\(/);
  });
  it("the template page sends through EmailOfficialButton, never a mailto", () => {
    expect(page).toMatch(/<EmailOfficialButton[^>]*source="group_template" template=\{template\}/);
    for (const src of [page, list, form]) expect(src).not.toMatch(/mailto:/);
  });
});

describe("pinned resources privacy and moderation", () => {
  it("members read, organizers write, explicit grants", () => {
    expect(sql).toMatch(/enable row level security/);
    expect(sql).toMatch(/with check \(created_by = auth\.uid\(\) and public\.is_coalition_admin\(coalition_id\)\)/);
    expect(sql).toMatch(/revoke all on public\.coalition_resources from anon, authenticated/);
    expect(sql).toMatch(/grant select, insert, update, delete on public\.coalition_resources to authenticated/);
    expect(sql).toMatch(/new\.created_by := old\.created_by/);
  });
  it("links open safely and every resource can be reported", () => {
    expect(list).toMatch(/httpUrlOrNull\(r\.url\)/);
    expect(list).toMatch(/rel="noopener noreferrer nofollow ugc"/);
    expect(list).toMatch(/r\.created_by !== userId && <ReportButton targetType="group_resource"/);
    expect(page).toMatch(/r\.created_by !== user\.id && \(/);
    expect(page).toMatch(/if \(!viewer\) notFound\(\)/);
  });
  it("a reported resource opens in its group", async () => {
    const { targetHref } = await import("@/modules/reports/types");
    expect(targetHref("group_resource", "r1")).toBe("/coalitions/go/resource/r1");
    expect(read("src/app/coalitions/go/[kind]/[id]/route.ts")).toMatch(/path = `r\/\$\{id\}`/);
  });
});
