# Owner to-do

What only the owner can do, and nothing else. Every line says how it was
checked and when, so a session can re-check it instead of re-asking.
Sessions: verify before adding, delete a line the moment it is done, and put
anything that is not owner-only in `STATE_OF_PLAY.md` instead.

_Last verified: 2026-10-23 against `main` at 38fd7c1, from the owner's machine.
Every item under "Do" was re-checked that day; how is under each one. The
crawl block and bill embeddings moved to "Done"._

---

## Do

1. **Add two keys to Netlify production — ON HOLD (your call,
   2026-10-23). Sessions: don't re-ask until it's lifted.** `BREVO_API_KEY` and
   `NVIDIA_API_KEY` are GitHub secrets, so the cron jobs have them, but neither
   is among Netlify production's 51 environment variables. The website reads
   `BREVO_API_KEY` in `src/lib/email/providers.ts` (without it only the Resend
   lane can send) and `NVIDIA_API_KEY` in `src/app/pitch/efficiency/page.tsx`.
   Both values are already in your local `.env.local`. Netlify → Project
   configuration → Environment variables → add each one for all contexts. The
   site picks them up on its next build.
   _Checked: key names from the Netlify env API, 2026-10-23._

2. **Close PRs #991 and #1001 (the Oct 11 and Oct 18 weekly updates), or
   publish them from `/admin/whats-new` instead.** Each adds one markdown note
   under `src/content/patch-notes/`, so merging it is a 15-credit build for
   something the database now serves for free.
   _Checked: both still open, one file each, 2026-10-23._

3. **Point the Supabase connector at the production project** (claude.ai →
   Settings → Connectors). It still sees only `wxwoyjbgldtmvmiewhfq`, the
   paused pre-lifeboat project, so no session here can read production.
   _Checked: connector `list_projects`, 2026-10-23. It returns that one
   project, status `INACTIVE`._

4. **Delete the leftover branches in one GitHub pass:**
   `work/tablet-nav`, `mfa-email-recovery`, `p7-schema-standing-badge`,
   `security-hardening`. None has an open PR. They are 2–4 months old and
   `main` has moved past every file they touch, so do not merge them.
   Sessions cannot delete refs (403).
   _Checked: `git ls-remote`, 2026-10-23, all four still exist. Note: no
   merge-tree proof exists for these four; the only proof was for
   `work/tablet-nav` in September. If you want any of the 2FA-recovery work
   (`mfa-email-recovery`, July), say so before deleting it._

5. **Decide PR #824 (the futurize restyle).** It has been a draft since
   2026-07-17 and is far behind `main`. Either take it into a new session
   or close it. _Checked: open-PR list, 2026-10-23._

6. **Optional: AI keys.**
   - Dead keys, removable to quiet the logs: in the hourly run
     `CEREBRAS_API_KEY` answers 402 (off the free tier),
     `AI_GATEWAY_API_KEY` (Vercel) answers 401, and `GH_MODELS_TOKEN` returns a
     non-JSON body. The router drops each one and carries on, so nothing is
     broken. _Checked: news-enrich job log, 2026-10-17 20:39 UTC._
   - The Gemini key is out of credits (402) on the website and in GitHub
     Actions. The site's AI moved to Groq's `gpt-oss-120b` and bill embeddings
     moved to Cloudflare, so nothing is down. A fresh free key from
     https://aistudio.google.com/apikey, saved as `GEMINI_API_KEY` in Netlify
     and in GitHub secrets, gives both a working backup provider again.
     _Reported 2026-10-23 by the session that fixed the site router (#1015)._

## Needs your eyes (can't be checked from a cloud session)

- **Do you publish notes from `/admin/whats-new`?** The October note shipped
  as a markdown file (`src/content/patch-notes/2026-10-08-update.md`, #971),
  which is the path the database flow was built to replace. If the admin
  page isn't working for you, say so and a session can fix it.
- **Whatever your local `private/OWNER_TODO.md` or `private/PLAN_OF_ACTION.md`
  holds.** Those files are gitignored, so no cloud session can see them.
  Anything there that is safe for a public repo should also be listed here,
  so one list holds everything.

## Done since the 2026-09-21 list (verified, nothing to do)

- **2026-10-23, re-checked from the owner's machine:**
  - **The crawl block now runs to 2027-01-16** (#1011, live since
    2026-10-21). `COST_CONTROL_EXPIRES_AT` in `src/lib/crawl-policy.ts`
    reads `Date.UTC(2027, 0, 16)`. CI goes red on purpose 14 days before
    (`NOTICE_DAYS`), so the next decision is due by 2027-01-02.
  - **Bill embeddings run daily in the cloud**, on Cloudflare's free model
    (#1013). Mistral was ruled out because its vectors are 1,024 wide and the
    table holds 768. Scheduled runs succeeded on 2026-10-22 and 2026-10-23,
    and the cron registry lists `bill_embeddings` as `github-actions`.
  - **`docs/SCHEMA.md`** was regenerated from production on 2026-10-23
    (migrations through 0275), by a session on the owner's machine. Sessions
    there can re-run `npm run docs:schema`, so it is no longer an owner item.
  - **Credits:** on track for about 576 of 1000 by the 2026-11-05 reset.
    _From `npm run credits`._
- **2026-10-21: every review queue at zero.** Meetings, campaigns and intel
  were each read against their sources; the ND meeting was among them.
  Local-rep requests: Derma, MS verified by hand and closed (status
  `fulfilled`, re-read 2026-10-23).
  - Auto-resolve no longer rejects on "couldn't confirm" (#1002).
  - The intel ticker is live (#1003).
  - Roster pages must now show the requested state (#1005).
- **Migration `0250_patch_notes.sql` is applied.** The 2026-10-11
  self-review logs a `patch_note.publish` admin action, which can only happen
  once the `patch_notes` table exists. Migrations up to 0275 have shipped since.
- **Enrichment is unblocked.** `GEMINI_API_KEY_2` and `NVIDIA_API_KEY` are set.
  On 2026-10-17 the hourly run enriched 12 of 12 items, served by Groq,
  Gemini, NVIDIA and Cloudflare. Gemini has since run out of credits (item 6).
  `GEMINI_API_KEY_3` is empty and no longer needed.
- **Netlify connector reconnected.** Read access works again.
- **Eleven of the twelve queued branches are gone.** `work/tablet-nav`
  is the one left, listed above.
- **PR #856 (`--webpack`) is closed** (2026-10-08) and its branch is deleted.
- **PR #999 (the cloud docs refresh) is merged** (2026-10-21). It created this
  file.
- **The weekly self-review works.** It has posted every Sunday since 2026-09-20
  on issue #929, and the latest is 2026-10-18 (checked 2026-10-23).

## Never

- Never re-open or merge #856. It restores `next build --webpack`, which ran
  the Netlify build out of memory and froze the site.
- Never paste an API key into chat. Keys go in GitHub → Settings → Secrets,
  or in the Netlify env.
