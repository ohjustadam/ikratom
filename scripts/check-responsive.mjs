#!/usr/bin/env node
/**
 * check-responsive.mjs — the guard for the class of bug nothing else catches.
 *
 * WHY THIS EXISTS (2026-08-25). Two real defects shipped or nearly shipped
 * while `tsc`, 1092 unit tests and a green production build all passed:
 *
 *   1. The header's desktop nav switched on at md (768px) but rendered ~766px
 *      wide. Every page scrolled sideways by up to 122px on a tablet.
 *   2. A briefing's figure sat 23.4px below its heading while every prose
 *      section sat at 11.2px — the spacing "looked off" and nothing could say why.
 *
 * Both are GEOMETRY. They only exist once a real engine lays the page out, so
 * no amount of type-checking or jsdom testing sees them. This does.
 *
 * WHAT IT ASSERTS, per page per width:
 *   ① the PAGE never scrolls horizontally        — catches (1) and any regression
 *   ② exactly ONE nav surface is visible          — catches 0 (no nav at all,
 *     the failure mode when a breakpoint is moved in one file but not its
 *     matched set) and 2 (both navs at once)
 *   ③ on briefings, the gap under h2/h3 is a SINGLE value — catches (2), and
 *     makes "uniform formatting" an assertion rather than a preference
 *
 * DELIBERATELY NOT IN `npm run verify`. That has to stay ~9s; this needs a
 * production build and a live server. Run it before a release, and in CI as
 * its own job.
 *
 *   npm run build
 *   npx next start -p 3003 &
 *   npm run check:responsive
 *
 * Env: BASE_URL (default http://localhost:3003), WIDTHS (comma list).
 * Exit 0 = clean, 1 = at least one assertion failed, 2 = could not run.
 */
import { chromium } from "playwright-chromium";

const BASE = (process.env.BASE_URL || "http://localhost:3003").replace(/\/+$/, "");
const WIDTHS = (process.env.WIDTHS || "375,768,1024,1280").split(",").map((w) => parseInt(w.trim(), 10));

/** Pages worth guarding: one of each layout shape, not every route. */
const PAGES = [
  { path: "/", name: "home" },
  { path: "/briefings", name: "briefings index" },
  { path: "/briefings/7-oh-scheduling-2026", name: "briefing detail", briefing: true },
  { path: "/whats-new", name: "changelog" },
  { path: "/campaigns", name: "campaigns" },
  { path: "/forum", name: "forum" },
];

/**
 * Runs INSIDE the page. Returns raw measurements only — all judgement happens
 * in node, so a failure message can explain itself.
 */
function measure() {
  const de = document.documentElement;
  const shown = (el) =>
    !!el && getComputedStyle(el).display !== "none" && el.getBoundingClientRect().width > 0;

  // Detect nav surfaces STRUCTURALLY, never by Tailwind class name. An earlier
  // version matched "lg:flex"/"lg:hidden" and reported "NO navigation" against
  // any build using a different breakpoint — a false alarm that would have
  // trained everyone to ignore this check the next time the breakpoint moved.
  const header = document.querySelector("header");
  // Desktop nav = a visible <nav> in the header carrying several links.
  const desktopNav = header
    ? [...header.querySelectorAll("nav")].find(
        (n) => shown(n) && n.querySelectorAll("a").length >= 3,
      )
    : null;
  // Mobile/tablet surface = the hamburger that opens the full-screen menu.
  // Match its label EXACTLY: HeaderNav's desktop dropdown triggers are labelled
  // "Open <group> menu", so a loose /menu/i test matches those too and reports
  // "BOTH navs visible" on every desktop page.
  const mobileCluster = header
    ? [...header.querySelectorAll("button")].find(
        (b) => shown(b) && /^open menu$/i.test((b.getAttribute("aria-label") || "").trim()),
      )
    : null;

  // Elements that stick out past the viewport, ignoring anything inside a
  // container that is INTENTIONALLY scrollable (wide figures, wide tables).
  const bleeding = [];
  document.querySelectorAll("body *").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.right > de.clientWidth + 1) {
      const scroller = el.closest('[class*="overflow-x-auto"], .k7-scroll');
      if (!scroller) {
        bleeding.push(
          el.tagName.toLowerCase() + (el.className ? "." + String(el.className).split(" ")[0] : ""),
        );
      }
    }
  });

  // Gap between a heading and whatever follows it, for briefing pages.
  const headingGaps = [];
  document.querySelectorAll(".briefing-md h2, .briefing-md h3").forEach((h) => {
    if (!shown(h)) return;
    const n = h.nextElementSibling;
    if (!n || !shown(n)) return;
    headingGaps.push({
      level: h.tagName,
      next: n.tagName + (n.className ? "." + String(n.className).split(" ")[0] : ""),
      gap: Math.round((n.getBoundingClientRect().top - h.getBoundingClientRect().bottom) * 10) / 10,
    });
  });

  return {
    viewport: de.clientWidth,
    pageOverflowPx: de.scrollWidth - de.clientWidth,
    bleeding: [...new Set(bleeding)].slice(0, 6),
    desktopNavShown: shown(desktopNav),
    mobileClusterShown: shown(mobileCluster),
    headingGaps,
  };
}

async function reachable(url) {
  try {
    const r = await fetch(url, { method: "HEAD" });
    return r.ok || r.status < 500;
  } catch {
    return false;
  }
}

const failures = [];
const fail = (where, msg, detail) => failures.push({ where, msg, detail });

if (!(await reachable(BASE))) {
  console.error(`✗ Nothing served at ${BASE}`);
  console.error("  Start a PRODUCTION server first — `next dev` is not a valid target here:");
  console.error("    npm run build && npx next start -p 3003");
  process.exit(2);
}

const browser = await chromium.launch();
console.log(`Checking ${PAGES.length} pages × ${WIDTHS.length} widths against ${BASE}\n`);

for (const width of WIDTHS) {
  const ctx = await browser.newContext({
    viewport: { width, height: 900 },
    // Below the desktop breakpoint, behave like a touch device — hover-only
    // affordances that break on touch should surface here, not in the wild.
    hasTouch: width < 1024,
    isMobile: width < 768,
  });
  for (const page of PAGES) {
    const p = await ctx.newPage();
    let m;
    try {
      await p.goto(`${BASE}${page.path}`, { waitUntil: "networkidle", timeout: 45000 });
      m = await p.evaluate(measure);
    } catch (e) {
      fail(`${page.name} @${width}`, "page failed to load", e.message.slice(0, 120));
      await p.close();
      continue;
    }

    // ① no horizontal page scroll
    if (m.pageOverflowPx > 1) {
      fail(
        `${page.name} @${width}`,
        `page scrolls sideways by ${m.pageOverflowPx}px`,
        m.bleeding.length ? `widest offenders: ${m.bleeding.join(", ")}` : "no single element identified",
      );
    }

    // ② exactly one nav surface
    const surfaces = (m.desktopNavShown ? 1 : 0) + (m.mobileClusterShown ? 1 : 0);
    if (surfaces !== 1) {
      fail(
        `${page.name} @${width}`,
        surfaces === 0 ? "NO navigation visible" : "BOTH navs visible at once",
        `desktopNav=${m.desktopNavShown} mobileCluster=${m.mobileClusterShown}` +
          (surfaces === 0
            ? " — a breakpoint was moved in one file but not its matched set"
            : ""),
      );
    }

    // ③ briefings: one spacing rhythm
    if (page.briefing && m.headingGaps.length) {
      for (const level of ["H2", "H3"]) {
        const vals = [...new Set(m.headingGaps.filter((g) => g.level === level).map((g) => g.gap))];
        if (vals.length > 1) {
          const worst = m.headingGaps
            .filter((g) => g.level === level)
            .sort((a, b) => b.gap - a.gap)[0];
          fail(
            `${page.name} @${width}`,
            `${level} spacing is not uniform: ${vals.join(", ")}px`,
            `largest is ${worst.gap}px before <${worst.next}> — a block is overriding the heading's margin`,
          );
        }
      }
    }
    await p.close();
  }
  await ctx.close();
  console.log(`  ${width}px … ${failures.length ? failures.length + " issue(s) so far" : "clean"}`);
}

await browser.close();

if (!failures.length) {
  console.log("\n✓ No responsive regressions.");
  process.exit(0);
}
console.log(`\n✗ ${failures.length} responsive issue(s):\n`);
for (const f of failures) console.log(`  [${f.where}] ${f.msg}\n      ${f.detail}`);
process.exit(1);
