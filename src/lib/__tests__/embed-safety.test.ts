import { describe, it, expect } from "vitest";
import { sanitizeLibraryEmbedHtml } from "../embed-safety";

describe("sanitizeLibraryEmbedHtml — accept happy paths", () => {
  it("accepts a standard YouTube embed", () => {
    const out = sanitizeLibraryEmbedHtml(
      '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" width="560" height="315" frameborder="0" allowfullscreen></iframe>'
    );
    expect(out).not.toBeNull();
    expect(out).toContain('src="https://www.youtube.com/embed/dQw4w9WgXcQ"');
    expect(out).toContain("allowfullscreen");
    expect(out).toContain('sandbox="allow-scripts allow-same-origin allow-presentation"');
    expect(out).toContain('referrerpolicy="strict-origin-when-cross-origin"');
  });

  it("accepts youtube-nocookie", () => {
    const out = sanitizeLibraryEmbedHtml(
      '<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"></iframe>'
    );
    expect(out).not.toBeNull();
  });

  it("accepts a vimeo embed", () => {
    const out = sanitizeLibraryEmbedHtml(
      '<iframe src="https://player.vimeo.com/video/12345" width="640" height="360"></iframe>'
    );
    expect(out).not.toBeNull();
    expect(out).toContain("vimeo.com/video/12345");
  });

  it("accepts youtube with query params", () => {
    const out = sanitizeLibraryEmbedHtml(
      '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ?start=30&rel=0"></iframe>'
    );
    expect(out).not.toBeNull();
  });
});

describe("sanitizeLibraryEmbedHtml — reject attacks", () => {
  it("rejects script tag", () => {
    expect(
      sanitizeLibraryEmbedHtml(
        '<iframe src="https://www.youtube.com/embed/abc"></iframe><script>alert(1)</script>'
      )
    ).toBeNull();
  });

  it("rejects javascript: src", () => {
    expect(
      sanitizeLibraryEmbedHtml('<iframe src="javascript:alert(1)"></iframe>')
    ).toBeNull();
  });

  it("rejects on* event handler", () => {
    expect(
      sanitizeLibraryEmbedHtml(
        '<iframe src="https://www.youtube.com/embed/abc" onload="alert(1)"></iframe>'
      )
    ).toBeNull();
  });

  it("rejects mixed-case onerror handler", () => {
    expect(
      sanitizeLibraryEmbedHtml(
        '<iframe src="https://www.youtube.com/embed/abc" OnError="alert(1)"></iframe>'
      )
    ).toBeNull();
  });

  it("rejects iframe from non-allowlist domain", () => {
    expect(
      sanitizeLibraryEmbedHtml('<iframe src="https://evil.com/x"></iframe>')
    ).toBeNull();
  });

  it("rejects iframe pointing at YouTube with attacker subdomain prefix", () => {
    expect(
      sanitizeLibraryEmbedHtml(
        '<iframe src="https://evil.com.www.youtube.com/embed/abc"></iframe>'
      )
    ).toBeNull();
  });

  it("rejects non-iframe content", () => {
    expect(sanitizeLibraryEmbedHtml("<div>hello</div>")).toBeNull();
  });

  it("rejects multiple iframes", () => {
    expect(
      sanitizeLibraryEmbedHtml(
        '<iframe src="https://www.youtube.com/embed/a"></iframe><iframe src="https://www.youtube.com/embed/b"></iframe>'
      )
    ).toBeNull();
  });

  it("rejects iframe with trailing junk", () => {
    expect(
      sanitizeLibraryEmbedHtml(
        '<iframe src="https://www.youtube.com/embed/abc"></iframe>extra<script>alert(1)</script>'
      )
    ).toBeNull();
  });

  it("rejects empty string", () => {
    expect(sanitizeLibraryEmbedHtml("")).toBeNull();
  });

  it("rejects oversized input", () => {
    expect(
      sanitizeLibraryEmbedHtml(
        '<iframe src="https://www.youtube.com/embed/abc" title="' + "a".repeat(2100) + '"></iframe>'
      )
    ).toBeNull();
  });

  it("rejects http:// (require https)", () => {
    expect(
      sanitizeLibraryEmbedHtml('<iframe src="http://www.youtube.com/embed/abc"></iframe>')
    ).toBeNull();
  });
});

describe("sanitizeLibraryEmbedHtml — strips unsafe attrs but accepts iframe", () => {
  it("drops attrs not in allowlist", () => {
    const out = sanitizeLibraryEmbedHtml(
      '<iframe src="https://www.youtube.com/embed/abc" foo="bar" data-something="x"></iframe>'
    );
    expect(out).not.toBeNull();
    expect(out).not.toContain('foo="bar"');
    expect(out).not.toContain("data-something");
  });

  it("clamps oversized width/height to default", () => {
    const out = sanitizeLibraryEmbedHtml(
      '<iframe src="https://www.youtube.com/embed/abc" width="999999" height="-50"></iframe>'
    );
    expect(out).not.toBeNull();
    expect(out).toContain('width="560"'); // default
    expect(out).toContain('height="315"'); // default
  });
});
