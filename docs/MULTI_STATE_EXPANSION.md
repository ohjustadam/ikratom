# Multi-state expansion checklist

Current state (2026-05-13): NY was the model state with hand-built /
heavily-iterated intel coverage. This doc maps every NY-specific asset
to its multi-state status and the work remaining.

## ✅ Already generalized (works for all 50 + DC)

| System | Mechanism |
|---|---|
| **News ingestion** | `sync-news-rss.mjs` pulls Google News RSS per state via state-name queries. All 50 + DC + federal. |
| **News classification** | `classify-news-policy.mjs` runs against every news_items row regardless of state. |
| **Bill tracking** | `sync-bills-via-legiscan.mjs` covers every active anti/pro bill across all 50 states (paid via LegiScan). |
| **Board of Pharmacy** | `scrape-bop.mjs` + `scrape-bop-browser.mjs` (Playwright for TLS-blocked) cover all 50 + DC. |
| **State briefings** | `generate-state-briefing.mjs --all-states` produces one briefing per state daily. |
| **Municipal meetings** | CivicPlus / Granicus / Legistar / BoardDocs adapters + Gemini-grounded discovery cover ~10k US agencies. |
| **Per-state landing pages** | `/states/[code]` aggregates bills + meetings + alerts + campaigns + briefing per state. |
| **Per-state push** | `push-critical-alerts.mjs` + `push-state-news.mjs` + `push-bill-actions-to-actors.mjs` filter by user's state column. |
| **Federal scope** | `verify-bill-status-ai.mjs` covers federal too; FDA/DEA picked up via `news_break` classification. |

## 🟡 Partially generalized

| System | Status | Next step |
|---|---|---|
| **Legislator stance drafting** | Script accepts `--state XX`. Daily cron now runs `--priority-only` (10 states). Owner reviews drafts at `/admin/stance`. | Once priority queue is drained, switch cron to `--all-states` (run weekly to refresh, daily for new candidates only). |
| **Committee scraping** | NY has `scrape-ny-committees.mjs` (Assembly + Senate HTML scrape, custom selectors per chamber). Other states have committees from OpenStates API but those rosters can be stale. | Build `scrape-committees-via-openstates.mjs` as the generic fallback — OpenStates has committee data via API for all states. Use `is_kratom_relevant` flag to mark Health / Judiciary / Codes / Consumer Protection committees. |

## ❌ Still NY-only or missing entirely

| System | Why it's NY-only | Path to fix |
|---|---|---|
| **`scrape-ny-committees.mjs`** | Hand-coded HTML scrape against `nyassembly.gov` + `nysenate.gov`. Each state's legislative site has different URL structure + HTML. | Replace with OpenStates API call. |
| **Hand-curated legislator phone numbers / district offices** | LegiScan provides primary contact, but local district offices often missing for non-priority states. | Acceptable; missing fields render as "(not listed)". Owner can fill in via `/admin/legislators` per-leg edit when needed. |
| **Per-state campaign templates** | `target_legislator_ids` on campaigns currently empty for non-NY states (no stance data = nobody to target as hostile). | After stance drafts populate for priority states (above), auto-create state-scoped campaigns from `policy_alerts` will gain targeting. |
| **NY-style "153 stance drafts to review" workflow** | UI at `/admin/stance` exists but admin needs to review each. | Bulk-review batched approval flow could speed this — group similar (e.g. all "neutral committee membership only") for one-click batch approval. |

## 🔧 Recently fixed (don't re-investigate)

- ✅ **Notifications firing for stale news** — fixed across all surfaces in PRs #199–205. Real-event-date freshness gate applied to push pipelines, /pulse, /states/[code], /alerts/[id], /dashboard widget.
- ✅ **News pipeline cron cadence** — was running effective ~2.5h, now :00 + :30 each hour (PR #201).
- ✅ **seed-bill-officials cron erroring** — was failing on one bill with malformed locality field (whole title pasted in). Script now validates locality format and skips gracefully (PR pending).

## 🎯 The "real-time intel network" mental model

For the platform to feel real-time across every state, three things must be true PER STATE:

1. **Coverage exists** — at least one active bill OR one upcoming municipal meeting OR one Board of Pharmacy item OR one approved alert in the last 30 days. (Audit: `/admin/intel-health/states`)
2. **Targeting works** — at least one champion + one hostile legislator stance per chamber so campaigns route correctly. (Audit: `/admin/stance/coverage`)
3. **Local advocates exist** — at least 3 registered users in the state so push fanout has reach. (Audit: same `/admin/intel-health/states` page — "red" tiles)

A state passes all three = "live network node." A state fails one = degraded but usable. A state fails all three = blind spot.

Current snapshot (run `/admin/intel-health/states` to refresh):
- Live nodes: NY (and shrinking few others)
- Recruitment + intel-gathering priority: per the red tiles
