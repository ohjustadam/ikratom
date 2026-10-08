import { describe, it, expect } from "vitest";
import {
  kratomRelevance,
  extractArticleBody,
  countKratomHits,
  hasKratomKeyword,
} from "../scripts/lib/kratom-keywords.mjs";

describe("kratomRelevance — subject vs passing mention", () => {
  it("treats a kratom explainer headline as the subject", () => {
    const r = kratomRelevance({
      title: "What Is Kratom? Substance Linked To Brandon Clarke Arrest Draws Attention",
      summary: "",
      body: "Kratom is an herbal extract that comes from the leaves of a tree...",
    });
    expect(r.subject).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(0.9);
  });

  it("rejects an NBA-death article that only mentions a kratom charge in passing", () => {
    const body =
      "Memphis Grizzlies forward Brandon Clarke died at 29. The team confirmed his " +
      "passing in a statement. Clarke was a key rotation player who averaged double " +
      "digits. He had been arrested a month earlier on a charge that police said " +
      "involved possession of kratom, a detail that drew little attention at the time. " +
      "Teammates and coaches shared tributes throughout the day.";
    const r = kratomRelevance({ title: "Brandon Clarke cause of death: What we know", body });
    expect(r.subject).toBe(false);
    expect(r.hits).toBe(1);
  });

  it("rejects an article with no kratom keyword anywhere (sports scheduling)", () => {
    const r = kratomRelevance({
      title: "Vols to host Florida State in 2026 SEC/ACC Challenge",
      body: "UT Sports brought to you by Amy Shrader, and Re/Max Real Estate.",
    });
    expect(r.subject).toBe(false);
    expect(r.score).toBe(0);
  });

  it("rejects a redistricting article (no kratom in the real body)", () => {
    const r = kratomRelevance({
      title: "McMaster calls S.C. lawmakers back to work on congressional maps",
      body: "COLUMBIA, S.C. - State lawmakers have adjourned for the session but are " +
        "not heading home just yet. Gov. Henry McMaster is calling them back to redraw maps.",
    });
    expect(r.subject).toBe(false);
  });

  it("accepts kratom named in the lede even when the headline omits it", () => {
    const r = kratomRelevance({
      title: "Magnolia Mornings: Feb 19",
      body: "Lawmakers in Jackson advanced a bill to regulate kratom this week. " +
        "The measure would set a 21-and-over age limit on the herbal supplement.",
    });
    expect(r.subject).toBe(true);
    expect(r.leadHit).toBe(true);
  });

  it("rejects deep body mentions when kratom is absent from headline AND lede (recirc-rail defense)", () => {
    // Several kratom mentions buried below the lede look identical to a
    // "trending/related" widget once HTML is stripped — this is exactly how
    // the redistricting / sports-death false positives survived. Not subject.
    const filler = "Other local news filled the rest of the morning briefing. ".repeat(20);
    const r = kratomRelevance({
      title: "Around the State: Tuesday roundup",
      body: filler +
        "Trending: City council weighs kratom ordinance. Supporters said kratom helps with " +
        "pain; opponents pointed to 7-OH products. The kratom debate continues next month.",
    });
    expect(r.subject).toBe(false);
    expect(r.hits).toBeGreaterThanOrEqual(3);
  });
});

describe("extractArticleBody — recirculation widget stripping", () => {
  it("drops a kratom keyword that lives only in a trending/related rail", () => {
    const html = `
      <html><body>
        <article>
          <h1>McMaster calls S.C. lawmakers back to work on congressional maps</h1>
          <p>COLUMBIA, S.C. - State lawmakers have adjourned for the session.</p>
        </article>
        <div class="trending-stories">
          <ul><li><a href="/x">City council weighs kratom ban downtown</a></li></ul>
        </div>
        <aside class="most-read"><a href="/y">7-OH products pulled from shelves</a></aside>
      </body></html>`;
    const body = extractArticleBody(html);
    expect(hasKratomKeyword(body)).toBe(false);
    expect(countKratomHits(body)).toBe(0);
  });

  it("keeps a kratom keyword that lives in the real article body", () => {
    const html = `
      <html><body>
        <article>
          <h1>City council votes on kratom ordinance</h1>
          <p>The council voted 5-2 to restrict kratom sales to those over 21.</p>
        </article>
        <div class="related"><a href="/z">Local basketball roundup</a></div>
      </body></html>`;
    const body = extractArticleBody(html);
    expect(hasKratomKeyword(body)).toBe(true);
    expect(kratomRelevance({ title: "City council votes on kratom ordinance", body }).subject).toBe(true);
  });
});

describe("countKratomHits / hasKratomKeyword sanity", () => {
  it("does not match substrings without a word boundary", () => {
    expect(hasKratomKeyword("kratomgate scandal")).toBe(false);
  });
  it("matches relatives and counts each occurrence", () => {
    expect(countKratomHits("kratom and mitragynine and 7-OH and tianeptine")).toBe(4);
  });
});
