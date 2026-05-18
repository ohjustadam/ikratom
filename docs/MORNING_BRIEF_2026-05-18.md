---
title: Morning brief — May 18, 2026
---

# Morning brief — 2026-05-18

Lean-style overnight run. Three substantive PRs shipped + four backfills run unattended. Burned a fraction of the prior session's context budget.

## Shipped (3 PRs)

- **#359** Form 990 finances for kratom-policy 501(c) orgs
  - New table `nonprofit_990_filings`; ProPublica Nonprofit Explorer scraper
  - AKA: 10 years of revenue/expenses/officer-comp backfilled
  - GKC: 1 year backfilled
  - Surfaces as a table on `/intel/actors`
  - Weekly cron wired
  - Closes one of the admin-only intel-gaps items: 501(c)(4)s don't disclose donors, but DO disclose totals via 990s

- **#360** Municipal-prohibition cluster (26 bills · 10 states)
  - New cluster pattern catches city + county kratom-ban ordinances
  - Previously 168 active anti/pro bills were unclustered; this names a chunk of them as a coordinated local-level operation
  - Particularly active in MS counties; pattern is local ordinances propagating across state lines

- **#361** Federal LDA lobbying overlap on cluster detail pages
  - On each `/intel/operations/[slug]`, lists Senate LDA filings (`is_kratom_relevant=true`) whose `dt_posted` falls within the cluster's active window
  - Shows registrant, client, lobbyists, disclosed income
  - "Who lobbied federally while this state operation was spreading"

## Backfill deltas (unattended, in-flight or done)

| Metric | Before | After |
|---|---|---|
| `bill_sponsors` total | 505 | **648** (+143) |
| `news_items.bill_id` linked | 370 | **420** (+50) |
| `bill_cluster_members` | 437 | **463** |
| Explicit hostile stances | 20 | **58** (+38) — nationwide, was NY-only |
| Sympathetic | 36 | **49** |
| Champions | 8 | **13** |
| Neutral | 11 | **13** |
| Form 990 filings | 0 | **11** |

The AI news↔bill correlation backlog (500 rows) is still running in background. Will land more links by tomorrow's UTC tick.

## What's now visible to users that wasn't before

- `/intel/actors` shows a 990 finances table (10 years AKA, 1 year GKC)
- `/intel/operations/[slug]` shows federal LDA filings overlapping each operation's active window
- The municipal_prohibition cluster appears in the operations list with 26 bills · 10 states
- Threat matrix populated with 58 explicit hostile stances across multiple states (was 20 — mostly NY)

## Lean-style notes

Followed the new usage rules:
- 3 medium-effort PRs vs the prior 8-small-PRs pattern
- Skipped browser preview verify; trusted `npm run verify` (336 tests + typecheck)
- Terse commits (2–4 lines)
- Concise PR bodies (1–3 sentences)
- Backfills fired in background early so they cost no marginal context

## Owner action items

None blocking. Production cron picks up the new weekly 990 job automatically once #359 lands on main.
