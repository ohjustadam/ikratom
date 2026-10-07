/**
 * link-prefetch.test.ts — links prefetch on intent, not on sight.
 *
 * 2026-10-07: default viewport prefetch fired dozens of background requests per
 * scroll (home ~99 links, /legislators ~209). The owner tripped Cloudflare's
 * flood rule just browsing, and every prefetch of a dynamic page woke the paid
 * server function. Presence pings used a server action every 60 s, and a tab
 * from before a deploy POSTed a dead action 187 times.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

function* walk(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(tsx?|jsx?)$/.test(e.name)) yield p;
  }
}
const files = [...walk("src")].map((f) => ({ f: f.split(path.sep).join("/"), src: fs.readFileSync(f, "utf8") }));

describe("intent prefetch", () => {
  it("every Link goes through the site wrapper (scan is non-vacuous)", () => {
    const viaWrapper = files.filter(({ src }) => src.includes('from "@/components/Link"'));
    expect(viaWrapper.length).toBeGreaterThan(100);
    const direct = files.filter(({ f, src }) => f !== "src/components/Link.tsx" && /from ["']next\/link["']/.test(src)).map(({ f }) => f);
    expect(direct).toEqual([]);
  });

  it("the wrapper turns off sight prefetch and warms on hover, touch and focus", () => {
    const w = fs.readFileSync("src/components/Link.tsx", "utf8");
    expect(w).toMatch(/prefetch=\{false\}/);
    for (const ev of ["onMouseEnter", "onTouchStart", "onFocus"]) expect(w).toContain(`${ev}={(e`);
    expect(w).toMatch(/router\.prefetch\(href\)/);
  });
});

describe("presence heartbeat", () => {
  it("uses a deploy-proof route, at most every 4 minutes, and gives up on repeated failure", () => {
    const h = fs.readFileSync("src/components/PresenceHeartbeat.tsx", "utf8");
    expect(h).toMatch(/fetch\("\/api\/presence"/);
    expect(h).toMatch(/EVERY_MS = 4 \* 60_000/);
    expect(h).toMatch(/GIVE_UP_AFTER/);
    expect(h).not.toMatch(/@\/modules\/presence\/actions/);
    expect(fs.existsSync("src/app/api/presence/route.ts")).toBe(true);
  });
});

describe("wrapper behaviour", () => {
  it("never prefetches on sight; hover, touch and focus each prefetch the target", async () => {
    const { vi } = await import("vitest");
    const prefetch = vi.fn();
    vi.doMock("next/navigation", () => ({ useRouter: () => ({ prefetch }) }));
    vi.doMock("next/link", () => ({ default: function NextLinkStub() { return null; } }));
    const { default: Link } = await import("../src/components/Link");
    const el = Link({ href: "/bills", children: "Bills" }) as unknown as { props: Record<string, (e: unknown) => void> & { prefetch: unknown } };
    expect(el.props.prefetch).toBe(false);
    expect(prefetch).not.toHaveBeenCalled();
    el.props.onMouseEnter({});
    el.props.onTouchStart({});
    el.props.onFocus({});
    expect(prefetch).toHaveBeenCalledTimes(3);
    expect(prefetch).toHaveBeenCalledWith("/bills");

    // External links and protocol-relative URLs are never prefetched.
    prefetch.mockClear();
    const ext = Link({ href: "https://example.org", children: "x" }) as unknown as { props: Record<string, (e: unknown) => void> };
    ext.props.onMouseEnter({});
    const proto = Link({ href: "//evil.example", children: "x" }) as unknown as { props: Record<string, (e: unknown) => void> };
    proto.props.onMouseEnter({});
    expect(prefetch).not.toHaveBeenCalled();

    // An explicit prefetch prop is respected as written.
    const explicit = Link({ href: "/bills", prefetch: true, children: "x" }) as unknown as { props: { prefetch: unknown } };
    expect(explicit.props.prefetch).toBe(true);
    vi.doUnmock("next/navigation");
    vi.doUnmock("next/link");
  });
});
