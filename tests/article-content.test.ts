import { describe, it, expect } from "vitest";
import { extractArticleContent } from "../scripts/lib/article-content.mjs";

const wrap = (body: string) =>
  `<html><head><meta property="og:image" content="https://cdn.pub.com/lead.jpg"></head><body><article>${body}</article></body></html>`;
const para = (n: number) =>
  `<p>Lead paragraph number ${n} of a kratom policy story, long enough to clear the minimum-character threshold for inclusion in the excerpt.</p>`;

describe("extractArticleContent — fair-use excerpt", () => {
  it("keeps a LEAD, never the full body (paragraph + char caps)", () => {
    const html = wrap(Array.from({ length: 40 }, (_, i) => para(i)).join(""));
    const { paragraphs } = extractArticleContent(html, "https://pub.com/s");
    expect(paragraphs.length).toBeGreaterThan(6); // longer than the old cap of 6
    expect(paragraphs.length).toBeLessThanOrEqual(10); // but bounded — not the whole 40
    const chars = paragraphs.join("").length;
    expect(chars).toBeLessThanOrEqual(2500 + 200); // cumulative char cap (+ slack for the last ¶)
  });
});

describe("extractArticleContent — publisher media embeds", () => {
  const html = wrap(
    para(1) +
      `<iframe src="https://open.spotify.com/embed/episode/4abcDEF12345?si=x"></iframe>` +
      para(2) +
      `<iframe src="https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/999&amp;color=ff5500"></iframe>` +
      `<iframe src="https://embed.podcasts.apple.com/us/podcast/foo/id12345?i=67890"></iframe>` +
      `<iframe src="https://www.youtube.com/embed/abcdefghij0"></iframe>` +
      `<a href="https://open.spotify.com/show/BAREfollowlink">Follow us on Spotify</a>`,
  );
  const { media } = extractArticleContent(html, "https://pub.com/s");
  const byType = (t: string) => media.filter((m: { type: string }) => m.type === t);

  it("extracts Spotify / SoundCloud / Apple Podcasts embeds + keeps YouTube", () => {
    expect(byType("spotify")[0]?.embed_url).toBe("https://open.spotify.com/embed/episode/4abcDEF12345");
    expect(byType("soundcloud").length).toBe(1);
    expect(byType("apple_podcast")[0]?.embed_url).toContain("embed.podcasts.apple.com");
    expect(byType("youtube").length).toBe(1);
  });

  it("ignores bare follow/profile links (only embed iframes count)", () => {
    // The footer "Follow us on Spotify" link (open.spotify.com/show/…, no /embed/)
    // must NOT attach the station's whole show to an unrelated story.
    expect(byType("spotify").length).toBe(1);
  });

  it("derives a clean public url for the apple embed (host swapped back)", () => {
    expect(byType("apple_podcast")[0]?.url).toContain("https://podcasts.apple.com/");
  });
});
