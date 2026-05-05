/**
 * iKratom service worker — minimal offline support.
 *
 * Strategy:
 *  - /_next/static/* (immutable hashed assets) → cache-first, indefinite
 *  - Public pages (/, /campaigns, /forum, /news, /bills, /library, /legislators, etc.)
 *      → network-first, fall back to cache, then to /offline
 *  - Auth/dynamic routes → network-only (we never cache user-specific data)
 *  - Cross-origin requests → bypass entirely
 *
 * Bumping CACHE_NAME below invalidates all clients on next activate.
 */

const CACHE_NAME = "ikratom-v1";
const OFFLINE_URL = "/offline";

// Routes that must NEVER be cached (user-specific or auth-sensitive)
const SKIP_CACHE_PATHS = [
  "/api/",
  "/auth/",
  "/admin",
  "/dashboard",
  "/account",
  "/onboarding",
  "/messages",
  "/notifications",
  "/forgot",
  "/reset-password",
  "/login",
  "/profile/",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Pre-cache the offline fallback so it's available even on first hit
      await cache.add(new Request(OFFLINE_URL, { cache: "reload" })).catch(() => {});
    })(),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop old caches
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle same-origin GETs
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Skip auth/dynamic routes
  if (SKIP_CACHE_PATHS.some((p) => url.pathname === p || url.pathname.startsWith(p))) {
    return;
  }

  // Skip RSC payload requests (Next.js internal data fetches)
  if (req.headers.get("rsc") || url.searchParams.has("_rsc")) return;

  // Cache-first for immutable Next.js static assets
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Cache-first for icon/manifest (small, semi-stable)
  if (url.pathname === "/icon" || url.pathname === "/apple-icon" || url.pathname === "/manifest.webmanifest") {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Network-first for HTML pages (so users get fresh content when online,
  // cached content when offline, /offline as last resort)
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Everything else: network-first short fallback
  event.respondWith(networkFirst(req));
});

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, res.clone());
    }
    return res;
  } catch (e) {
    return Response.error();
  }
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    // Only cache successful, non-partial responses
    if (res.ok && res.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch {
    const cached = await caches.match(req);
    if (cached) return cached;
    // Final fallback: offline page (only for navigation requests)
    if (req.mode === "navigate") {
      const offline = await caches.match(OFFLINE_URL);
      if (offline) return offline;
    }
    return Response.error();
  }
}
