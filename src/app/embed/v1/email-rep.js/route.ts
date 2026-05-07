import { NextRequest, NextResponse } from "next/server";

/**
 * Embeddable widget for kratom shops and advocacy partners.
 *
 * Drop on any page:
 *   <script src="https://ikratom.org/embed/v1/email-rep.js"
 *           data-state="OK" data-tone="urgent"></script>
 *
 * The script:
 *  - reads data-state ("OK" / "FED" / "NY" etc.) — defaults to "FED"
 *  - reads data-tone ("urgent" | "neutral") — defaults to "neutral"
 *  - injects a self-contained card right where the script tag lives
 *  - card click opens iKratom in a new tab with referral params
 *  - tracks the host site so campaign_actions get credited to it
 *
 * Why a JS file instead of an iframe? iframes need cross-origin cookie
 * sharing for auth, which is fragile post-Chrome-third-party-cookie
 * deprecation. Click-through to a new tab keeps auth + tracking simple
 * and works in every browser including iOS Safari.
 *
 * Cache: 1 hour browser, 1 day CDN. Revisable; we'd bump the version
 * path (/v2/) for breaking changes.
 */

export const runtime = "edge";
export const dynamic = "force-static";

// Build the public URL that the widget will redirect users to.
function appUrl(req: NextRequest): string {
  return process.env.APP_URL || `https://${req.nextUrl.host}`;
}

export async function GET(req: NextRequest) {
  const target = appUrl(req);

  // Inline the script — minified-ish but readable for security review.
  // No third-party deps, no eval, no document.write. Vanilla DOM only.
  const js = `(function() {
  "use strict";
  if (window.__ikratomEmbedV1) return; // idempotent
  window.__ikratomEmbedV1 = true;

  var TARGET = ${JSON.stringify(target)};
  // Locate our own <script> tag — must be the script that's currently executing
  var scripts = document.getElementsByTagName("script");
  var self = null;
  for (var i = scripts.length - 1; i >= 0; i--) {
    var s = scripts[i];
    if (s.src && s.src.indexOf("/embed/v1/email-rep.js") !== -1) { self = s; break; }
  }
  if (!self) return;

  var stateAttr = (self.getAttribute("data-state") || "FED").toUpperCase();
  var tone = (self.getAttribute("data-tone") || "neutral").toLowerCase();
  var stateLabel = stateAttr === "FED" ? "your federal" : stateAttr;
  var host = (typeof window !== "undefined" && window.location && window.location.hostname) || "";

  // Build the deep-link URL with referral params
  var params = new URLSearchParams({
    ref: "embed",
    host: host.slice(0, 80),
    state: stateAttr,
  });
  var href = TARGET + "/?" + params.toString();

  // ── Render ──────────────────────────────────────────────────
  var container = document.createElement("div");
  container.setAttribute("data-ikratom-embed", "v1");
  container.style.cssText = [
    "all: initial",
    "display: block",
    "margin: 16px 0",
    "max-width: 480px",
    "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  ].join(";");

  var card = document.createElement("a");
  card.href = href;
  card.target = "_blank";
  card.rel = "noopener noreferrer";
  var bg = tone === "urgent" ? "#7f1d1d" : "#0a0a0a"; // red-900 / zinc-950
  var border = tone === "urgent" ? "#ef4444" : "#10b981"; // red-500 / emerald-500
  card.style.cssText = [
    "all: initial",
    "display: block",
    "padding: 20px",
    "background: " + bg,
    "border: 2px solid " + border,
    "border-radius: 8px",
    "text-decoration: none",
    "cursor: pointer",
    "transition: transform 0.15s ease",
    "font-family: inherit",
  ].join(";");
  card.onmouseover = function() { card.style.transform = "translateY(-2px)"; };
  card.onmouseout = function() { card.style.transform = "translateY(0)"; };

  var eyebrow = document.createElement("div");
  eyebrow.textContent = tone === "urgent" ? "⚠ ACTION NEEDED" : "Defend kratom access";
  eyebrow.style.cssText = [
    "all: initial",
    "display: block",
    "color: " + border,
    "font-size: 11px",
    "font-weight: 700",
    "letter-spacing: 0.1em",
    "text-transform: uppercase",
    "font-family: inherit",
  ].join(";");

  var headline = document.createElement("div");
  headline.textContent = "Tell " + stateLabel + " legislators to protect kratom";
  headline.style.cssText = [
    "all: initial",
    "display: block",
    "color: #ffffff",
    "font-size: 20px",
    "font-weight: 700",
    "line-height: 1.2",
    "margin-top: 8px",
    "font-family: inherit",
  ].join(";");

  var sub = document.createElement("div");
  sub.textContent = "Pre-written email. One click sends it to your specific reps. 30 seconds. Free, no spam.";
  sub.style.cssText = [
    "all: initial",
    "display: block",
    "color: #d4d4d8",
    "font-size: 13px",
    "line-height: 1.4",
    "margin-top: 8px",
    "font-family: inherit",
  ].join(";");

  var btn = document.createElement("div");
  btn.textContent = "Take action →";
  btn.style.cssText = [
    "all: initial",
    "display: inline-block",
    "color: " + (tone === "urgent" ? "#7f1d1d" : "#0a0a0a"),
    "background: " + border,
    "padding: 10px 16px",
    "border-radius: 6px",
    "font-weight: 700",
    "font-size: 14px",
    "margin-top: 14px",
    "font-family: inherit",
  ].join(";");

  var footer = document.createElement("div");
  footer.style.cssText = [
    "all: initial",
    "display: block",
    "color: #71717a",
    "font-size: 10px",
    "margin-top: 12px",
    "letter-spacing: 0.05em",
    "font-family: inherit",
  ].join(";");
  footer.textContent = "Powered by iKratom — the advocate's toolbelt";

  card.appendChild(eyebrow);
  card.appendChild(headline);
  card.appendChild(sub);
  card.appendChild(btn);
  card.appendChild(footer);
  container.appendChild(card);

  // Insert right where the <script> tag lives so the publisher can place it
  // anywhere in their page flow.
  if (self.parentNode) self.parentNode.insertBefore(container, self.nextSibling);
})();`;

  return new NextResponse(js, {
    status: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      // Cache 1h browser, 1d CDN. Stale-while-revalidate for resilience.
      "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
      // Anyone can pull the script — that's the whole point
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
