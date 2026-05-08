# Prompts library

Reusable prompt templates for AI-driven tasks. Each prompt has:
- **Purpose** — what task it solves
- **Inputs** — the variables the caller must provide
- **Output** — expected schema (for `runAiStructured`) or shape
- **Provider notes** — which model/provider works best
- **Tested with** — what we've actually run it through

Edit prompts here, not inline in code, so they're version-controlled
and reviewable in PRs. Code imports the prompts via dynamic file read
(see `src/lib/ai/prompts.ts`).

## Catalog

| File | Task kind | Used by |
|---|---|---|
| `bill-summary.md` | `bill_summary` | `src/modules/bills/enrich.ts` (cron) + `scripts/enrich-bills.mjs` (local) |
| `bill-deep-analysis.md` | `bill_deep_analysis` | `scripts/enrich-bills-deep.mjs` (local only — needs llama3.3:70b) |
| `translate.md` | `translate` | `src/modules/translations/server.ts` (cron-callable) + `scripts/translate-content.mjs` (local) |
| `local-officials.md` | `officials_lookup` | `src/lib/ai/suggest-officials.ts` (admin-triggered, Gemini grounding) |
| `chat-moderation.md` | `moderate_chat` | (future) lounge automod |

## Conventions

- Always include a "return ONLY the JSON, nothing else" line in
  structured prompts — most providers respect it; Ollama needs it
  most aggressively.
- Anchor with concrete examples in the system prompt for the kratom
  domain (natural-leaf vs synthetic 7-OH distinction is the canonical
  trap; show the model how to handle it).
- Cap input size in code, not in the prompt — the prompt should assume
  trusted, length-bounded input.
- For grounding tasks (local officials), explicitly tell the model NOT
  to fabricate. Cite sources in the output schema if applicable.

## When to write a new prompt vs reuse

Reuse if your task fits an existing schema — same output shape, same
domain framing. Write new if:
- Output schema is materially different
- The task is in a different domain (e.g. legal vs civic)
- The prompt evolves enough you need to A/B test versions
