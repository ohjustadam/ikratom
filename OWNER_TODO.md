# Owner to-do

What only the owner can do, and nothing else. Every line says how it was
checked and when, so a session can re-check it instead of re-asking.
Sessions: verify before adding, delete a line the moment it is done, and put
anything that is not owner-only in `STATE_OF_PLAY.md` instead.

_Last verified: 2026-10-17 against `main` at f2ecac3, from a cloud session._

---

## Do

1. **Decide the crawl block before 2026-11-02.** On that date CI goes red on
   purpose (`tests/robots-cost-control.test.ts`, `NOTICE_DAYS = 14`), so the
   lapse is a choice rather than a surprise. On 2026-11-16
   `COST_CONTROL_EXPIRES_AT` in `src/lib/crawl-policy.ts` lets crawlers back
   onto the cost-controlled routes. Since it was set, R2 snapshots
   (#990, #994, #996) and anonymous Cloudflare caching (#967, #969) took
   most public reads off Supabase and Netlify. The choice is to let it lapse or
   extend it, and extending it is a `src/` change, so it costs one build.
   _Checked: both dates read from the files on `main`._

2. **Pick the bill-embeddings provider (Mistral recommended), then dispatch it
   once.** The cloud path exists, but `Bill embeddings` has **zero runs ever**,
   so bill similarity still depends on your PC (`bill_embeddings` is
   `system: "local-box"` in `scripts/lib/cron-pager-registry.mjs`). Turning it
   on means running Actions → Bill embeddings with `refresh=true` and
   `provider=mistral` once, then uncommenting its `schedule:`. The
   first run rewrites every vector, which is why it waits for your word.
   _Checked: GitHub Actions run list for `bill-embeddings.yml`._

3. **Close PR #991 (the Oct 11 weekly update) or publish it from
   `/admin/whats-new` instead.** It adds a markdown note under `src/`, so
   merging it is a 15-credit build for something the database now serves for
   free. _Checked: PR file list._

4. **Point the Supabase connector at the production project** (claude.ai →
   Settings → Connectors). It still sees only `wxwoyjbgldtmvmiewhfq`, the
   paused pre-lifeboat project, so no session here can read production.
   _Checked: connector `list_projects`, 2026-10-17._

5. **Delete the leftover branches in one GitHub pass:**
   `work/tablet-nav`, `mfa-email-recovery`, `p7-schema-standing-badge`,
   `security-hardening`. None has an open PR. They are 2–4 months old and
   `main` has moved past every file they touch, so do not merge them.
   Sessions cannot delete refs (403).
   _Checked: `git ls-remote` and the open-PR list. Note: no merge-tree
   proof exists for these four; the only proof was for `work/tablet-nav`
   in September. If you want any of the 2FA-recovery work
   (`mfa-email-recovery`, July), say so before deleting it._

6. **Run `npm run docs:schema` on your machine.** `docs/SCHEMA.md` was last
   generated 2026-08-25. Migrations 0250 to 0271 have landed since, so sessions
   that read it get the old schema. The script needs database credentials,
   which no cloud session has. Commit the result (`docs/` is free).
   _Checked: the file's header._

7. **Decide PR #824 (the futurize restyle).** It has been a draft since
   2026-07-17 and is far behind `main`. Either take it into a new session
   or close it. _Checked: open-PR list._

8. **Optional cleanup of dead AI keys.** In the hourly run, `CEREBRAS_API_KEY`
   answers 402 (off the free tier), `AI_GATEWAY_API_KEY` (Vercel) answers 401,
   and `GH_MODELS_TOKEN` returns a non-JSON body. The router drops each one and
   carries on, so nothing is broken. Removing them only quiets the logs.
   _Checked: news-enrich job log, 2026-10-17 20:39 UTC._

## Needs your eyes (can't be checked from a cloud session)

- **The North Dakota special-session meeting dated 20 October** at
  `/admin/meetings`, approve or reject. It sits in the admin UI, and the
  production database can't be reached from a cloud session.
- **Do you publish notes from `/admin/whats-new`?** The October note shipped
  as a markdown file (`src/content/patch-notes/2026-10-08-update.md`, #971),
  which is the path the database flow was built to replace. If the admin
  page isn't working for you, say so and a session can fix it.
- **Whatever your local `private/OWNER_TODO.md` or `private/PLAN_OF_ACTION.md`
  holds.** Those files are gitignored, so no cloud session can see them. Fold
  anything still open into this file, so one list holds everything.

## Done since the 2026-09-21 list (verified, nothing to do)

- **Migration `0250_patch_notes.sql` is applied.** The 2026-10-11
  self-review logs a `patch_note.publish` admin action, which can only happen
  once the `patch_notes` table exists. Migrations up to 0271 have shipped since.
- **Enrichment is unblocked.** `GEMINI_API_KEY_2` and `NVIDIA_API_KEY` are set.
  The latest hourly run enriched 12 of 12 items, served by Groq, Gemini,
  NVIDIA and Cloudflare. `GEMINI_API_KEY_3` is empty and no longer needed.
- **Netlify connector reconnected.** Read access works again.
- **Eleven of the twelve queued branches are gone.** `work/tablet-nav`
  is the one left, listed above.
- **PR #856 (`--webpack`) is closed** (2026-10-08) and its branch is deleted.
- **The weekly self-review works.** It has posted every Sunday since 2026-09-20
  on issue #929, and the latest is 2026-10-11.
- **Credits are fine.** 260.5 of 1000 on 2026-10-14, on track for about 459 by
  the 2026-11-05 reset. _From CI's `Netlify credit budget` check._

## Never

- Never re-open or merge #856. It restores `next build --webpack`, which ran
  the Netlify build out of memory and froze the site.
- Never paste an API key into chat. Keys go in GitHub → Settings → Secrets,
  or in the Netlify env.
