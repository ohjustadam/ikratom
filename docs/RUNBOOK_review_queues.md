# Runbook — Intel Queue & Campaign Review moderation

**Task this answers:** "audit and approve/deny the pending intel queue + campaign reviews and clear them out."
**Read this first — do NOT re-map the schema.** Everything you need is here.

---

## 1. The two queues

| Queue | Table | "Pending" filter | Admin page | Server actions |
|---|---|---|---|---|
| **Intel queue** | `policy_alerts` | `moderation_status = 'pending'` | `/admin/intel-queue` | `approveIntelTip` / `rejectIntelTip` / `listPendingIntelTips` in `src/modules/alerts/actions.ts` |
| **Campaign reviews** | `campaigns` | `review_state = 'pending_review'` | `/admin/campaigns/pending` | `approvePendingCampaign` / `rejectPendingCampaign` / `bulkReviewCampaigns` in `src/modules/admin/campaign-review-actions.ts` |

`campaigns.review_state` ∈ `pending_review | auto_active | rejected | superseded | manual`. Column patches for a transition are the canonical `APPROVE_/REJECT_/SUPERSEDE_COLUMNS` in `scripts/lib/campaign-review-columns.mjs` (a manual approve and an auto approve MUST write identically — asserted in `tests/campaign-autoapprove.test.ts`).

### Side-effects you MUST know before writing
- **Approving a campaign** (`active` false→true) fires `campaign_notify_trigger` → inserts `notifications` inbox rows for matching users (by state/locality/prefs). Web-push is a *separate hourly cron* that **coalesces per user** (`push_min_interval`), so approving many at once does NOT spam. **No legislator emails** are sent — those are user-initiated.
- **Approving an intel tip with `action_required = true`** fires `trg_auto_campaign_on_alert` (migration `0068`) → **spawns a new `pending_review` campaign**. To publish an alert as news *without* spawning a campaign, set **`action_required = false`** in the same update (trigger returns early: line 355 `action_required <> true`; line 354 `moderation_status <> 'approved'` → rejects never spawn).
- Rejects are **reversible** and notify no one (`reactivateRejectedCampaigns`; re-approve intel). `rejected` also stops the engine re-reviving the row.

---

## 2. The automation already exists — lean on it, don't rebuild

| Script | Cron | What it does |
|---|---|---|
| `auto-approve-campaigns.mjs` | **hourly** (`cron-hourly.yml`) | Confidence-gated engine. APPROVE high-confidence, SUPERSEDE dupes, **ESCALATE ambiguous → human queue**, REJECT **off by default**. Modes in `site_config` (off/shadow/**live**); currently **live**. Ledger: `campaign_auto_approve_decisions`. |
| `cleanup-pending-campaigns.mjs` | daily (`cron-daily.yml`) | Topic-cluster collapse (supersede) + 45-day-stale reject + FP reject. |
| `dedupe-pending-alerts.mjs` | daily | Intel-queue cluster collapse (the national FDA/DEA 7-OH push → one bucket). |
| `reject-wrongstate-pending-alerts.mjs` | daily | Reject pending alerts whose title names a state ≠ their locality tag (geo mis-tag). |
| `cleanup-stale-active-campaigns.mjs` | daily | Retire **active** campaigns whose linked bill is dead/enacted. |
| Dedup/cluster primitives | — | `scripts/lib/topic-key.mjs` (`topicKey`, `strongTopicKey`, `federalTopicKey`, `billKey`, `normalizedTitleKey`). Bill liveness: `scripts/lib/bill-status.mjs` (`terminalStatusFromAction` → enacted/vetoed/dead). |

**Why a residue still needs a human:** the engine *escalates* anything ambiguous and reject is off, and **nothing fact-checks whether a news-derived item is already dead/enacted/hallucinated** (no bill_id to check, and it's <45d old so the age-stale sweep misses it). Off-season (summer) this is most of the queue — bills that died in spring or laws already signed.

---

## 3. Clear the queues

**In the admin site (no CLI/Claude needed):** go to **`/admin/moderation`** (the unified hub — also linked from the Admin home and from each queue page). Each queue has **✨ Auto-resolve all** = one click, full-auto: dedup → supersede, junk → reject, confident-real+live → approve, uncertain → safely rejected. "Review each first" opens the per-item preview if you want control. This is `src/modules/admin/queue-resolve-actions.ts` (`autoResolveQueue`) + `src/app/admin/_components/ResolveQueue.tsx`; grounding in prod = Gemini Google Search (SearXNG is box-only).

**Zero-click:** the nightly (`scripts/run-nightly-steps.cmd` → `clear-review-queues.mjs --ai --apply --approve`) drains both queues automatically — auto-approve is HIGH-confidence only, capped, and honors `read_only_mode`/`emergency_mode`.

**CLI (box), for a manual pass:**
```bash
node --env-file=.env.local scripts/clear-review-queues.mjs --ai                      # dry-run preview
node --env-file=.env.local scripts/clear-review-queues.mjs --ai --apply              # reject junk only
node --env-file=.env.local scripts/clear-review-queues.mjs --ai --apply --approve    # full autonomy
```

`clear-review-queues.mjs` fills the gap in §2: grounds each survivor with a keyless SearXNG search + a free-tier verdict (`aiRouter`, never Claude), auto-**rejects** the clearly stale/dead/enacted/hallucinated/wrong-geo/partisan ones (medium+ confidence, evidence-backed, reversible, audit-logged, `scraper_runs`-tracked), and **leaves genuine + ambiguous items** for the engine or a human to approve. Requires `SEARXNG_URL` (owner box `:8080`); without it every item is kept.

Then approve the few real survivors via `/admin/campaigns/pending` + `/admin/intel-queue`, or leave them for the hourly engine.

**Disposition heuristics** (what "junk" means): duplicate (same event/state, or federal push across outlets) → supersede; bill dead at sine die / already signed into law → reject (stale); event doesn't exist / premise inverted (e.g. a "ban" in a state where kratom is already banned) → reject (hallucination); local event (town/county) targeting the whole state legislature, or a state event scoped to Congress → reject (mis-targeted); frames a specific named politician → reject (nonpartisan). Neutral "evidence-based scope" solidarity templates and specific "oppose bill X" constituent templates on **live** bills are keepers.

---

## 4. Manual SQL fallback (only if the scripts can't run)

Direct writes go through the Supabase **Management API** (the MCP is often pointed at the wrong project — see AGENTS.md source-of-truth rule). Token + ref live in `.env.local` (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`). Owner profile id for `reviewed_by`/`moderated_by`: query `profiles where is_owner`. Wrap multi-statement writes in `begin; … commit;` (keeps `now()` constant so an `INSERT … SELECT … where reviewed_at = now()` reliably audit-logs exactly this run's rows). Always guard updates with `and review_state='pending_review'` / `and moderation_status='pending'`. See the 2026-07-03 audit for the exact SQL shape.

---

## 5. Make the residue self-clear (owner decisions — surface, don't flip)

- **Enable engine reject:** `campaign_auto_reject_enabled` (in `site_config`, via `setCampaignAutoApprovePolicy`, owner-only) lets the hourly engine reject the junk it currently escalates. Asymmetric risk (a wrong reject buries a real CTA) — that's why it's off; the fact-check in §3 is the safer middle path.
- **Wire `clear-review-queues.mjs --ai --apply` as a daily cron step** (add to `cron-daily.yml`, register in `check-cron-staleness.mjs` per standing rule 6) so the human queue stays near-empty with zero ongoing cost.
- **Root cause:** the news→campaign generator (`trg_auto_campaign_on_alert`, `auto-campaign-from-alert.mjs`) has no bill-liveness/geo gate — see memory `auto-campaign-pipeline-no-staleness-gate`.
