/**
 * community-videos.test.ts — the /videos mirror (migration 0260).
 * parseFeed turns YouTube's keyless channel RSS into rows; anything that isn't
 * a well-formed video id + title + date is dropped rather than stored.
 */
import { describe, it, expect } from "vitest";
import { parseFeed } from "../scripts/sync-community-videos.mjs";

const entry = (id: string, title: string, published: string, desc = "") => `
  <entry>
    <id>yt:video:${id}</id>
    <yt:videoId>${id}</yt:videoId>
    <title>${title}</title>
    <published>${published}</published>
    <media:group><media:description>${desc}</media:description></media:group>
  </entry>`;

describe("parseFeed", () => {
  it("reads id, title, date and description, decoding XML entities", () => {
    const xml = `<feed>${entry("66VCqeyYMo0", "Kratom &amp; 7-OH: what&#39;s &quot;different&quot;", "2026-10-03T17:03:43+00:00", "SAMHSA data &lt;b&gt;")}</feed>`;
    const [v] = parseFeed(xml);
    expect(v).toEqual({
      video_id: "66VCqeyYMo0",
      title: `Kratom & 7-OH: what's "different"`,
      published_at: "2026-10-03T17:03:43+00:00",
      description: "SAMHSA data <b>",
    });
  });

  it("drops malformed entries instead of storing them", () => {
    const xml = `<feed>${entry("short", "Bad id", "2026-10-03T00:00:00Z")}${entry("66VCqeyYMo0", "", "2026-10-03T00:00:00Z")}${entry("66VCqeyYMo1", "No date", "not-a-date")}${entry("66VCqeyYMo2", "Good", "2026-10-01T00:00:00Z")}</feed>`;
    expect(parseFeed(xml).map((v: { video_id: string }) => v.video_id)).toEqual(["66VCqeyYMo2"]);
  });

  it("caps title and description lengths to the table's checks", () => {
    const [v] = parseFeed(`<feed>${entry("66VCqeyYMo0", "t".repeat(400), "2026-10-01T00:00:00Z", "d".repeat(1500))}</feed>`);
    expect(v.title).toHaveLength(300);
    expect(v.description).toHaveLength(1000);
  });
});
