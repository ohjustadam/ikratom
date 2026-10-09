import { describe, it, expect } from "vitest";
import { parseNdacoDirectory, parseKacoDirectory, parseCtasCsv, parseCsv, parseScacCountyPage, scacCountyLinks, nameKey, decodeEntities, COUNTY_DIRECTORIES } from "../scripts/lib/county-directories.mjs";

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

// Trimmed from kaco.org (2026-10-09): one magistrate, one judge/executive.
const ky = (county: string, name: string, title: string, tel: string) => `<div class="pt-2 pb-4 col-12 col-lg-6 contact_county_1 contact-county"> <div class="row"> <div class="col-12 py-1 official-county-name"> <span class="title-county-name-all fs-xl" style="display: none;">${county}</span> </div> <div class="col-12 official-name"> <h3>${name} </h3> </div> <div class="col-12 official-title"> ${title} </div> <div class="col-12"> 2999 Melson Ridge Rd. </div> <div class="col-12"> Columbia, KY 42728 </div> <div class="col-12"> <a href="tel:${tel}">${tel}</a> </div> </div> </div>`;

describe("parseKacoDirectory", () => {
  const rows = parseKacoDirectory(ky("Adair County", "Sammy Baker", "County Magistrate", "270-378-1536") + ky("Adair County", "Larry Russell", "County Judge/Executive", "270-384-4703"));

  it("reads county, name, title and phone; magistrates sit on the fiscal court", () => {
    expect(rows[0]).toEqual({ county: "Adair County", full_name: "Sammy Baker", title: "County Magistrate", phone: "270-378-1536", email: null, role: "county_commissioner" });
  });

  it("the County Judge/Executive is the county executive", () => {
    expect(rows[1].role).toBe("county_executive");
  });

  it("never carries the mailing address (often a home address)", () => {
    expect(JSON.stringify(rows)).not.toMatch(/Melson|42728/);
  });
});

describe("parseCtasCsv (Tennessee)", () => {
  // Header + rows exactly as the CTAS exports return them (2026-10-09).
  const comm = 'County,Name,Title,Address,City,"Zip Code",Fax,"Email Address"\r\n'
    + 'Anderson,"Ebony Capshaw","County Commissioner","125 Spellman Ave","Oak Ridge",37830,,ecapshaw@andersoncountytn.gov\r\n'
    + 'Davidson,"Jane ""JJ"" Doe","Metro Councilmember","1 Public Sq, Suite 204",Nashville,37201,,\r\n';
  const exec = 'County,Name,Title,Address,City,"Zip Code",Fax,"Main Phone","Email Address"\n'
    + 'Anderson,"Theresa Frank","County Mayor","100 North Main Street, Room 208",Clinton,37716-3687,"(865) 457-6270","(865) 457-5400",tfrank@andersoncountytn.gov\n';

  it("reads quoted fields with commas and doubled quotes", () => {
    expect(parseCsv(comm)[1]).toMatchObject({ County: "Davidson", Name: 'Jane "JJ" Doe', Address: "1 Public Sq, Suite 204" });
  });

  it("maps commissioners and mayors, never the address or fax", () => {
    const rows = [...parseCtasCsv(comm), ...parseCtasCsv(exec)];
    expect(rows[0]).toEqual({ county: "Anderson County", full_name: "Ebony Capshaw", title: "County Commissioner", phone: null, email: "ecapshaw@andersoncountytn.gov", role: "county_commissioner" });
    expect(rows[2]).toMatchObject({ county: "Anderson County", full_name: "Theresa Frank", role: "county_executive", phone: "(865) 457-5400" });
    expect(JSON.stringify(rows)).not.toMatch(/Spellman|457-6270/);
  });
});

describe("parseScacCountyPage (South Carolina)", () => {
  const row = (name: string, pos: string, phone: string) =>
    `<tr class="odd"> <td>${name}</td> <td>${pos}</td> <td>${phone}</td> <td><span>1458 Moultrie Dr, Aiken, SC, 29803-5824</span> </td> </tr>`;
  const page = `<h1 class="title">Aiken County</h1><table><thead><tr><th>Name</th><th>Position</th><th>Phone</th><th>Address</th></tr></thead><tbody>`
    + row("Gary Bunker", "Council Chairman", "(803) 645-8388")
    + row("Jane Roe", "Council Vice Chairwoman", "(803) 555-0100")
    + row("Landon Ball", "County Council", "(706) 799-4768")
    + row("Sam Supe", "Supervisor/Chairman", "(843) 555-0101")
    + row("Kelly Clerk", "Clerk to Council", "(803) 555-0102")
    + row("Ron Road", "Road Maintenance Supervisor", "(803) 555-0103")
    + row("Ella Chair", "Elections Commission Chairman", "(803) 555-0104")
    + `</tbody></table>`;
  const rows = parseScacCountyPage(page);

  it("keeps council seats, including the council-supervisor form", () => {
    expect(rows.map((r) => r.full_name)).toEqual(["Gary Bunker", "Jane Roe", "Landon Ball", "Sam Supe"]);
    expect(rows.every((r) => r.county === "Aiken County")).toBe(true);
  });

  it("drops staff, the clerk to council and the elections commission", () => {
    expect(JSON.stringify(rows)).not.toMatch(/Kelly Clerk|Ron Road|Ella Chair/);
  });

  it("never carries the address", () => {
    expect(JSON.stringify(rows)).not.toMatch(/Moultrie|29803/);
  });

  it("finds one link per county on the index page", () => {
    const idx = '<a href="/county/abbeville-county/directory">A</a><a href="/county/aiken-county/directory">B</a><a href="/county/aiken-county/directory">dup</a>';
    expect(scacCountyLinks(idx)).toEqual([
      "https://www.sccounties.org/county/abbeville-county/directory",
      "https://www.sccounties.org/county/aiken-county/directory",
    ]);
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
