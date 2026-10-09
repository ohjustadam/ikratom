import { describe, it, expect } from "vitest";
import { parseNdacoDirectory, nameKey, decodeEntities, COUNTY_DIRECTORIES } from "../scripts/lib/county-directories.mjs";

// Trimmed from the live page (2026-10-09): two county blocks, real markup.
const person = (pos: string, nameHtml: string, office: string, cell: string, home: string, email: string) => `
<div class="eblock" data-title="" data-position="${pos}"> <div class="cpaddr"> <div class="cpname"><strong>${nameHtml}</strong></div>
<div class="title"><i></i></div> <div class="position"><i>${pos}</i></div> </div> <div class="cphone">
<div class="phone officePhone hide${office}"><a href="tel:${office}"> ${office}</a><span class="hide">Ext &nbsp;</span>(o)</div>
<div class="cellphone" data-cellphone="${cell}"> <div class="phone cell hide${cell}"><a href="tel:${cell}">${cell}</a>&nbsp;(c)</div> </div>
<div class="homephone" data-homephone="${home}"> <div class="phone home hide${home}"><a href="tel:${home}">${home}</a>&nbsp;(h)</div> </div>
<div class="email hide${email}"><a href="mailto:${email}">${email}</a></div> </div> </div>`;
const FIXTURE = `<div class="filters" data-position="x"></div>
<div class="cdepart byPosition_county"><h3 class="toggle sprite sshow" data="show_county">Kidder County</h3> <div class="deptinfo" id="">
${person("Commissioner", 'Timothy <span class="hideCharlie">Charlie </span>Dronen', "", "701-226-0434", "701-475-2653", "")}
${person("Commission Chair", 'Darrell <span class="hide"> </span>Guthmiller', "", "701-320-2410", "701-273-4481", "guthbek@bektel.com")}
</div></div><div class="cdepart byPosition_county"><h3 class="toggle sprite sshow" data="show_county">Burleigh County</h3> <div class="deptinfo" id="">
${person("Commission Vice Chair", 'Mary <span class="hide"></span>O&#039;Neil', "701-222-6747", "701-555-0101", "701-555-0199", "moneil@nd.gov")}
</div></div>`;

describe("parseNdacoDirectory", () => {
  const rows = parseNdacoDirectory(FIXTURE);

  it("reads every person under their county", () => {
    expect(rows.map((r) => r.county)).toEqual(["Kidder County", "Kidder County", "Burleigh County"]);
  });

  it("keeps a nickname in quotes and drops the empty-nickname span", () => {
    expect(rows[0].full_name).toBe('Timothy "Charlie" Dronen');
    expect(rows[1].full_name).toBe("Darrell Guthmiller");
    expect(rows[2].full_name).toBe("Mary O'Neil");
  });

  it("takes the title from data-position", () => {
    expect(rows.map((r) => r.title)).toEqual(["Commissioner", "Commission Chair", "Commission Vice Chair"]);
  });

  it("prefers the office phone, falls back to the published cell, NEVER the home phone", () => {
    expect(rows[2].phone).toBe("701-222-6747");
    expect(rows[0].phone).toBe("701-226-0434");
    for (const r of rows) expect(r.phone).not.toMatch(/475-2653|273-4481|555-0199/);
  });

  it("reads the email when present, null when not", () => {
    expect(rows[0].email).toBeNull();
    expect(rows[1].email).toBe("guthbek@bektel.com");
  });

  it("returns nothing for a page that changed shape", () => {
    expect(parseNdacoDirectory("<html><body>Maintenance</body></html>")).toEqual([]);
  });
});

describe("nameKey", () => {
  it("matches the same person written differently", () => {
    expect(nameKey('Timothy "Charlie" Dronen')).toBe(nameKey("Timothy Dronen"));
    expect(nameKey("Michael D. Lanuto Jr.")).toBe(nameKey("Michael Lanuto"));
    expect(nameKey("Rod \"Roddy\" Schilling")).toBe(nameKey("Rod Schilling"));
  });

  it("keeps different people apart", () => {
    expect(nameKey("Ann Gill")).not.toBe(nameKey("Bob Gill"));
    expect(nameKey("Joe Schiavone")).not.toBe(nameKey("Joe Smith"));
  });
});

describe("registry", () => {
  it("every directory is https, has a parser and a full county count", () => {
    for (const [state, cfg] of Object.entries(COUNTY_DIRECTORIES)) {
      expect(state).toMatch(/^[A-Z]{2}$/);
      expect(cfg.url).toMatch(/^https:\/\//);
      expect(typeof cfg.parse).toBe("function");
      expect(cfg.counties).toBeGreaterThan(0);
    }
  });

  it("decodes entities", () => {
    expect(decodeEntities("O&#039;Neil &amp; Co&nbsp;")).toBe("O'Neil & Co ");
  });
});
