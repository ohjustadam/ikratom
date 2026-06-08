import { describe, it, expect } from "vitest";
import { renderMarkdown, __testing__ } from "../markdown";

const { sanitize, decodeEntities } = __testing__;

describe("renderMarkdown — happy paths", () => {
  it("renders bold + italic", () => {
    const out = renderMarkdown("**bold** and *italic*");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<em>italic</em>");
  });

  it("renders links with safety attrs", () => {
    const out = renderMarkdown("[click](https://example.com)");
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
  });

  it("renders gfm tables", () => {
    const md = "| a | b |\n|---|---|\n| 1 | 2 |";
    const out = renderMarkdown(md);
    expect(out).toContain("<table>");
    expect(out).toContain("<th>a</th>");
    expect(out).toContain("<td>1</td>");
  });

  it("preserves code blocks as text only", () => {
    const out = renderMarkdown("`<script>alert(1)</script>`");
    // Inside a code element, the < and > are escaped by marked
    expect(out).toContain("&lt;script&gt;");
    expect(out).not.toContain("<script>");
  });

  it("allows mailto + tel + relative anchors", () => {
    expect(renderMarkdown("[a](mailto:foo@bar.com)")).toContain('href="mailto:foo@bar.com"');
    expect(renderMarkdown("[a](tel:+15551234567)")).toContain('href="tel:+15551234567"');
    expect(renderMarkdown("[a](/internal/page)")).toContain('href="/internal/page"');
  });
});

describe("sanitize — XSS vectors", () => {
  it("strips <script> with content", () => {
    expect(sanitize("<p>x</p><script>alert(1)</script>")).not.toContain("alert(1)");
  });

  it("strips inline event handlers via on*", () => {
    const out = sanitize('<a href="https://x.com" onclick="alert(1)">click</a>');
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("alert(1)");
  });

  it("rejects javascript: href", () => {
    const out = sanitize('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toContain("javascript:");
  });

  it("rejects data: href", () => {
    const out = sanitize('<a href="data:text/html,<script>alert(1)</script>">x</a>');
    expect(out).not.toContain("data:");
  });

  it("rejects javascript: with HTML-entity obfuscation", () => {
    // 'r' is &#114; — without decoding, the regex would let it through
    const out = sanitize('<a href="javasc&#114;ipt:alert(1)">click</a>');
    expect(out).not.toContain("alert");
    expect(out).not.toContain("javascript");
    expect(out).not.toContain("javasc&#114;ipt");
  });

  it("strips <iframe>", () => {
    const out = sanitize('<iframe src="https://evil.com"></iframe>');
    expect(out).not.toContain("iframe");
  });

  it("strips <svg> with embedded handlers", () => {
    const out = sanitize('<svg onload="alert(1)"><script>x</script></svg>');
    expect(out).not.toContain("svg");
    expect(out).not.toContain("alert");
  });

  it("strips disallowed tags but keeps inner text", () => {
    const out = sanitize("<marquee>hello</marquee>");
    expect(out).toContain("hello");
    expect(out).not.toContain("marquee");
  });

  it("strips uppercase event attrs (oNcLiCk)", () => {
    const out = sanitize('<a href="https://x" oNcLiCk="alert(1)">click</a>');
    expect(out).not.toMatch(/onclick/i);
  });

  it("rejects http: src on images (HTTPS-only)", () => {
    const out = sanitize('<img src="http://insecure.com/cat.jpg" alt="cat">');
    expect(out).not.toContain('src="http:');
  });

  it("rejects data: src on images", () => {
    const out = sanitize('<img src="data:text/html,xss" alt="x">');
    expect(out).not.toContain('src="data:');
  });

  it("allows https: src on images and adds referrerpolicy", () => {
    const out = sanitize('<img src="https://example.com/cat.jpg" alt="cat">');
    expect(out).toContain('src="https://example.com/cat.jpg"');
    expect(out).toContain('referrerpolicy="no-referrer"');
    expect(out).toContain('loading="lazy"');
  });

  it("strips HTML comments (no IE conditional comment XSS)", () => {
    const out = sanitize("<!-- <script>alert(1)</script> --><p>ok</p>");
    expect(out).not.toContain("alert");
    expect(out).toContain("<p>ok</p>");
  });

  it("forces target=_blank + rel=noopener on every anchor", () => {
    const out = sanitize('<a href="https://x.com">x</a>');
    expect(out).toMatch(/rel="noopener noreferrer"/);
    expect(out).toMatch(/target="_blank"/);
  });
});

describe("decodeEntities", () => {
  it("decodes hex entities", () => {
    expect(decodeEntities("&#x72;")).toBe("r");
  });
  it("decodes decimal entities", () => {
    expect(decodeEntities("&#114;")).toBe("r");
  });
  it("decodes named entities", () => {
    expect(decodeEntities("&amp;&lt;&gt;&quot;")).toBe('&<>"');
  });
});

describe("sanitize — advanced bypass attempts", () => {
  const hasNoExec = (out: string) => {
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/<iframe/i);
    expect(out).not.toMatch(/\son[a-z]+\s*=/i); // no on*= event handlers
    expect(out).not.toMatch(/javascript:/i);
    expect(out).not.toMatch(/vbscript:/i);
  };

  it("neutralizes nested / mutation script tags", () => {
    hasNoExec(sanitize("<scr<script>ipt>alert(1)</script>"));
    hasNoExec(sanitize("<<script>script>alert(1)</script>"));
  });

  it("drops unquoted event handlers + bad src on allowed tags", () => {
    const out = sanitize("<img src=x onerror=alert(1)>");
    hasNoExec(out);
    expect(out).not.toContain('src="x"');
  });

  it("drops a handler with no space before it", () => {
    hasNoExec(sanitize('<a href="https://x.com" title="t"onmouseover="alert(1)">x</a>'));
  });

  it("rejects vbscript: and leading-whitespace javascript: schemes", () => {
    expect(sanitize('<a href="vbscript:msgbox(1)">x</a>')).not.toContain("vbscript:");
    expect(sanitize('<a href="   javascript:alert(1)">x</a>')).not.toMatch(/javascript:/i);
  });

  it("rejects double-encoded javascript: scheme", () => {
    const out = sanitize('<a href="&amp;#106;avascript:alert(1)">x</a>');
    expect(out).not.toMatch(/javascript:/i);
  });

  it("strips event handlers on allowed interactive tags (details / summary)", () => {
    hasNoExec(sanitize('<details ontoggle="alert(1)" open><summary onclick="alert(2)">s</summary>x</details>'));
  });

  it("drops attrs not on the per-tag allowlist (autofocus / formaction)", () => {
    const out = sanitize('<a href="https://x.com" autofocus formaction="javascript:alert(1)">x</a>');
    expect(out).not.toContain("autofocus");
    expect(out).not.toContain("formaction");
    expect(out).toContain('href="https://x.com"');
  });

  it("preserves spaces in alt/title (control-char strip must not eat normal text)", () => {
    const out = sanitize('<img src="https://x.com/a.jpg" alt="my cat photo" title="a-b c">');
    expect(out).toContain('alt="my cat photo"');
    expect(out).toContain('title="a-b c"');
  });
});
