# Migration Plan — Off Vercel When Ready

iKratom runs on Vercel for v1 (free, fastest path to a working site). This file documents the plan to migrate to a more secure host without rewriting the app.

## Why we'd migrate

- Vercel is closed-source infrastructure. We can't audit what runs.
- Vercel has had outages and pricing surprises that hit independent projects.
- For an advocacy platform, **self-hosting** or a privacy-first provider gives stronger guarantees against state-level data requests, content takedowns, or tier-pricing pressure.

## What we keep no matter where we go

- **Supabase** — already host-portable. Self-hostable as well (Postgres + GoTrue + Realtime).
- **Next.js 16** — runs on any Node-compatible host or in Docker.
- **Database schema** — all migrations are plain SQL in `supabase/migrations/`.
- **Env vars** — documented in `.env.local.example`.

## Vercel-specific dependencies (currently zero hard ones)

| Item | Hard dep? | Note |
| --- | --- | --- |
| `@vercel/analytics` | No (not installed in iKratom) | We omitted it deliberately |
| `@vercel/speed-insights` | No (not installed) | Same |
| Vercel Image Optimization | No (we don't use `next/image` heavily yet) | Will revisit if needed |
| Vercel KV / Postgres / Blob | No | Using Supabase for everything |
| Edge Runtime | No (proxy.ts is Node, not edge) | Already portable |

**Current state: 0 hard Vercel locks.** A migration today would be drop-in.

## Migration target options (ranked by security posture)

### 1. Self-hosted on a hardened VPS (Hetzner / OVH dedicated)
**Best security.** Full control. Requires Linux/ops knowledge.
- Cost: ~$5–20/mo
- Tools: Docker + Caddy (auto-HTTPS) or nginx + certbot
- Pros: Hardware isolation, custom firewall, no provider snooping
- Cons: You are the sysadmin

### 2. Fly.io
**Strong security, low ops.** Multi-region, Docker-native, transparent.
- Cost: free tier covers small sites; ~$5/mo at scale
- Pros: True Docker, easy global deploy, no vendor-only APIs
- Cons: Some past stability hiccups

### 3. Railway / Render
**Easy migration, decent security.** Hosted PaaS.
- Cost: $5/mo+
- Pros: One-click Next.js deploy, simpler than VPS
- Cons: Still a US-based PaaS (similar trust model to Vercel, just different vendor)

### 4. Cloudflare Pages + Workers
**Best edge security + DDoS protection.** Some Next.js features need adapter work.
- Pros: Free tier, WAF + DDoS included, fast global CDN
- Cons: Server actions / Node APIs may need adjustment for Workers runtime

### Recommended path
- **v1 / launch:** Vercel (we're here now)
- **First scale:** Cloudflare in front of Vercel (gets us WAF + DDoS without leaving Vercel)
- **When ready for full self-host:** Fly.io with Dockerfile (below) — closest to Vercel UX, most portable

## Dockerfile (ready when needed)

Save as `Dockerfile` at project root. Builds a minimal production image.

```dockerfile
# syntax=docker/dockerfile:1.6
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /app/.next ./.next
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/package.json ./package.json
COPY --from=builder --chown=app:app /app/public ./public
USER app
EXPOSE 3001
CMD ["npm", "run", "start"]
```

(Don't add this file yet — we add it the day we migrate. Including it now adds noise.)

## Pre-migration checklist (when we trigger the move)

1. Add `Dockerfile` (above)
2. Confirm no Vercel-specific imports (currently: 0)
3. Snapshot Supabase DB (Settings → Database → Backups)
4. Stand up the new host with same env vars
5. Point a staging subdomain at the new host
6. Run smoke tests (auth, profile save, campaign action)
7. Cut DNS over (5 min TTL beforehand)
8. Monitor logs for 24 hours
9. Tear down Vercel project after grace period

## Vendor-lock policy going forward

When evaluating a new dependency or feature, ask:
- Does this only work on Vercel? → **Reject** unless we can polyfill
- Does this lock data into a closed format? → **Reject**
- Does this require a Vercel-only service (KV, Postgres, Blob)? → **Reject** — use Supabase or open S3-compatible
