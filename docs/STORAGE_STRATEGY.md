# Storage strategy — free tier, then beyond

> Owner directive 2026-05-15: "we may need a larger storage option that is free to supplement our library if we are able."

This doc captures what we use today, what bites first, and the no-cost-now / one-upgrade-when-needed plan.

## Today (Phase 1)

| Surface | Bucket / table | Limit | Status |
|---|---|---|---|
| Research-paper uploads (PDF / text / md) | Supabase Storage · `research-uploads` (private) | **1 GB total** (free tier) | Wired in via migration 0145 + `/research/submit` upload mode |
| Briefings PDFs | Supabase Storage · public | 1 GB total | Shared with above |
| Avatars / images | Supabase Storage · public | 1 GB total | Shared |
| Sync artifacts / cache | Supabase Postgres rows (binary as bytea or url-refs) | 500 MB DB | Comfortable headroom |

**The pinch point will be `research-uploads`.** A 10 MB peer-reviewed PDF every other day fills the 1 GB cap in ~6 months. Briefings + avatars will eat into it further.

## What hits the cap first

A back-of-envelope:

- Research papers uploaded: 100 × 5 MB = 500 MB
- Briefing PDFs published: 40 × 2 MB = 80 MB
- Avatars (200 active users): 200 × 100 KB = 20 MB
- Open-access PDF mirrors of papers we link to (not yet built): potentially 200 × 5 MB = 1 GB on its own

**Verdict:** comfortable for the next 3–6 months; deliberate cap-management or migration needed after.

## Free-tier options when we outgrow Supabase Storage

| Provider | Free tier | Egress | What we'd move there |
|---|---|---|---|
| **Cloudflare R2** (recommended) | **10 GB storage** + 1M Class A ops + 10M Class B ops / month | **FREE egress** (this is the killer feature) | Research-paper uploads + any new mirror cache. PDFs are read-once-by-many — free egress means we can serve them direct without a CDN bill. |
| Backblaze B2 | 10 GB storage + 1 GB egress / day | $0.01/GB after 1GB/day | Briefings (read patterns are bursty but predictable) |
| MEGA | 20 GB | Pay-walled API for direct access | Cold-only — admin manual backups |
| GitHub Releases | ~2 GB / release, unlimited releases | Free | Public domain documents, public datasets, anything we'd want CDN'd anyway |
| GitLab Releases | Similar to GitHub | Free | Mirror redundancy |
| IPFS / Web3.Storage | Theoretically unlimited | Pinning gateway fees | Defensive copies only — not for primary serving |

## Recommended migration plan when we hit ~80% of Supabase 1 GB

1. **Phase 2: Cloudflare R2** as primary for `research-uploads`.
   - Sign up free account (no credit card required for free tier)
   - Create bucket `ikratom-research-uploads`
   - Add R2 keys to Vercel env: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET`
   - Swap `submit-actions.ts` storage call from Supabase Storage to R2 (S3-compatible — use `@aws-sdk/client-s3`)
   - Issue signed URLs the same way; R2's signed URL TTL matches Supabase's
   - Migration: write a one-off script that streams existing Supabase files into R2 + updates `research_papers.uploaded_storage_path` to the new R2 key
2. **Phase 3: Backblaze B2 mirror** for cold-storage backup of everything in R2.
3. **GitHub Releases** for permanent public artifacts (kratom advocacy whitepaper, the Sanctuary Vision PDF when we publish it, etc.)

**Implementation cost when we trigger:** ~half a day of dev work. Schema doesn't change — only the storage backend behind the URL changes.

## Operational guardrails (regardless of provider)

- **Hard cap on uploaded file size:** 10 MB enforced server-side in `submitResearchPaperUpload` already. Don't relax without thinking.
- **MIME allowlist:** PDF / plain text / markdown only. Already enforced.
- **Per-user folder isolation:** RLS prefix-checks `${userId}/` so users can't read each other's uploads.
- **Deletion on paper-removal:** when `research_papers` row is soft-deleted (is_active=false), the file stays until quarterly admin sweep. We don't hard-delete because legal sometimes needs the original — but the bucket lifecycle policy could be configured to auto-delete after 180 days if disk pressure grows.
- **Monitor:** add a `/admin/storage-health` page (Phase 2) showing current bucket usage + alert at 80%.

## Decision

For now: **keep Supabase 1 GB free tier and ride it.** Wire up the `/admin/storage-health` surface so we get a heads-up at 80%, then migrate research-uploads to Cloudflare R2 (still free, 10× capacity, free egress) when that alert fires.

No change to product behavior — users won't notice the swap.
