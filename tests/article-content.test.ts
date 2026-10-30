import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  extractArticleContent,
  isAkamaiBlockPage,
  isAkamaiBlockExcerpt,
} from "../scripts/lib/article-content.mjs";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/news-block-page/${name}`, import.meta.url), "utf8");

describe("Akamai 'Access Denied' block pages are never saved as the story", () => {
  // Real pages captured 2026-10-29: the 403 body plain fetch gets from
  // wwltv.com (every character entity-encoded), and what headless Chromium
  // renders for king5.com. The Chromium one is what was being stored.
  const fetched = fixture("akamai-403-fetch.html");
  const rendered = fixture("akamai-403-chromium.html");
  const article = fixture("infoworld-access-denied-article.html");

  it("recognises the block page in both forms and extracts nothing", () => {
    for (const html of [fetched, rendered]) {
      expect(isAkamaiBlockPage(html)).toBe(true);
      expect(extractArticleContent(html, "https://www.king5.com/article/x")).toEqual({ paragraphs: [], media: [] });
    }
  });

  it("keeps a real article that says 'access denied' in its title and text", () => {
    expect(isAkamaiBlockPage(article)).toBe(false);
    const { paragraphs } = extractArticleContent(article, "https://www.infoworld.com/article/4237168/x.html");
    expect(paragraphs.length).toBe(4);
    expect(paragraphs.some((p: string) => /access denied/i.test(p))).toBe(true);
  });

  it("needs the Access Denied title AND the Akamai reference, not either alone", () => {
    const titled = '<html><head><title>Access Denied</title></head><body><p>You do not have access to this member-only story, please sign in to keep reading it.</p></body></html>';
    expect(isAkamaiBlockPage(titled)).toBe(false);
    // An article quoting an Akamai reference keeps its own title.
    const quoted = article.replace("</article>", "<p>The error read: Reference #18.296e2617.1793329570.27d2487</p></article>");
    expect(isAkamaiBlockPage(quoted)).toBe(false);
  });

  it("matches the exact shape the block page was stored in, nothing looser", () => {
    expect(isAkamaiBlockExcerpt([
      "Reference #18.6f6d3e17.1792585322.be2155c6",
      "https://errors.edgesuite.net/18.6f6d3e17.1792585322.be2155c6",
    ])).toBe(true);
    expect(isAkamaiBlockExcerpt([
      "Reference #18.6f6d3e17.1792585322.be2155c6",
      "Lawmakers in Louisiana restricted three kratom-related substances on Tuesday after two student deaths.",
    ])).toBe(false);
    expect(isAkamaiBlockExcerpt(["Access denied, the agency said, to records about the kratom seizure."])).toBe(false);
    expect(isAkamaiBlockExcerpt([])).toBe(false);
    expect(isAkamaiBlockExcerpt(null)).toBe(false);
  });
});

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

describe("extractArticleContent — self-hosted publisher video", () => {
  // Gray TV / Arc "Powa" pattern: no iframe — a schema.org VideoObject with a
  // direct MP4 contentUrl + thumbnail. This is what KWCH (and ~180 Gray locals)
  // serve, so we must surface it as a native <video>.
  const ldVideo = (contentUrl: string, thumb: string) =>
    `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "VideoObject",
      name: "Kratom banned in Kansas starting July 1",
      contentUrl,
      thumbnailUrl: [thumb],
    })}</script>`;
  const page = (head: string, body: string) =>
    `<html><head><meta property="og:image" content="https://cdn.pub.com/lead.jpg">${head}</head><body><article>${body}</article></body></html>`;

  it("extracts a VideoObject contentUrl MP4 + poster as a video_file", () => {
    const html = page(
      ldVideo("https://d1l66zlxaqpl1u.cloudfront.net/wp-gray/x/file_1280x720.mp4", "https://gtv-cdn.com/thumb.jpg"),
      para(1) + para(2),
    );
    const { media } = extractArticleContent(html, "https://www.kwch.com/2026/06/13/story/");
    const vf = media.filter((m: { type: string }) => m.type === "video_file");
    expect(vf.length).toBe(1);
    expect(vf[0].url).toContain(".mp4");
    expect(vf[0].poster).toBe("https://gtv-cdn.com/thumb.jpg");
  });

  it("extracts an og:video:secure_url MP4 (both meta orders)", () => {
    const html = page(
      `<meta property="og:video:secure_url" content="https://cdn.pub.com/clip.mp4">`,
      para(1) + para(2),
    );
    const { media } = extractArticleContent(html, "https://pub.com/s");
    expect(media.filter((m: { type: string }) => m.type === "video_file").length).toBe(1);
  });

  it("ignores HLS (.m3u8) and non-https — native <video> can't play them reliably", () => {
    const html = page(
      ldVideo("https://cdn.pub.com/stream.m3u8", "https://cdn.pub.com/t.jpg") +
        `<meta property="og:video" content="http://insecure.pub.com/clip.mp4">`,
      para(1) + para(2),
    );
    const { media } = extractArticleContent(html, "https://pub.com/s");
    expect(media.filter((m: { type: string }) => m.type === "video_file").length).toBe(0);
  });

  it("does NOT emit a video_file when og:video is a YouTube embed URL", () => {
    const html = page(
      `<meta property="og:video" content="https://www.youtube.com/embed/abcdefghij0">`,
      para(1) + para(2),
    );
    const { media } = extractArticleContent(html, "https://pub.com/s");
    expect(media.filter((m: { type: string }) => m.type === "video_file").length).toBe(0);
  });

  it("extracts an inline WordPress core/video block (<video src>) from the body", () => {
    const html = page(
      "",
      para(1) +
        `<figure class="wp-block-video"><video controls poster="https://cdn.pub.com/p.jpg" src="https://cdn.pub.com/clip.mp4"></video></figure>` +
        para(2),
    );
    const { media } = extractArticleContent(html, "https://pub.com/s");
    const vf = media.filter((m: { type: string }) => m.type === "video_file");
    expect(vf.length).toBe(1);
    expect(vf[0].url).toBe("https://cdn.pub.com/clip.mp4");
    expect(vf[0].poster).toBe("https://cdn.pub.com/p.jpg");
  });

  it("extracts inline <video><source> and keeps only one source per clip", () => {
    const html = page(
      "",
      para(1) +
        `<video controls><source src="https://cdn.pub.com/a.webm" type="video/webm"><source src="https://cdn.pub.com/a.mp4" type="video/mp4"></video>` +
        para(2),
    );
    const { media } = extractArticleContent(html, "https://pub.com/s");
    expect(media.filter((m: { type: string }) => m.type === "video_file").length).toBe(1);
  });

  it("survives pathologically deep JSON-LD without throwing (stack-guard)", () => {
    // Build the nested JSON by string concat (NOT JSON.stringify, which would
    // itself overflow). Whether JSON.parse rejects it (caught) or it parses and
    // the depth-capped walk bails, extractArticleContent must never throw.
    const depth = 8000;
    const deep = '{"child":'.repeat(depth) + '{"@type":"Thing"}' + "}".repeat(depth);
    const html = page(`<script type="application/ld+json">${deep}</script>`, para(1) + para(2));
    expect(() => extractArticleContent(html, "https://pub.com/s")).not.toThrow();
  });
});
