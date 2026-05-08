# Prompt: bill-summary

Task kind: `bill_summary`

Used by: `src/modules/bills/enrich.ts` (cron-side via runAiStructured),
`scripts/enrich-bills.mjs` (local-side via direct Ollama).

## Purpose

Generate plain-English summary + advocacy callout + stance classification
for a US state or federal bill that has been keyword-flagged as
kratom-related.

## Inputs

| Variable | Source | Notes |
|---|---|---|
| bill_number | `bills.bill_number` | e.g. "OK SB 1234" |
| state | `bills.state` | 2-letter or "US" for federal |
| title | `bills.title` | Official bill title |
| summary | `bills.summary` | OpenStates abstract; may be null |
| last_action | `bills.last_action` | Latest legislative action description |

## Output schema

```json
{
  "summary_ai": "string (exactly 2 short sentences)",
  "advocacy_callout": "string (exactly 1 sentence)",
  "stance": "pro | anti | neutral",
  "confidence": "number 0.00 to 1.00"
}
```

`relevance_confidence < 0.6` → `kratom_relevance` is NOT updated; the
keyword classifier's value stays. This prevents low-quality AI outputs
from poisoning the campaign auto-create gate.

## Provider notes

| Provider | Behavior | Notes |
|---|---|---|
| Ollama llama3.1:8b | Fast, decent JSON, occasional natural-leaf-vs-synthetic confusion | Default for local |
| Ollama llama3.3:70b | Best quality, slow on consumer GPU | Worth using for batch passes |
| Groq llama-3.3-70b-versatile | Fast, cloud-side | Used when cron can't reach Ollama |
| Gemini Flash 2.5 | Fine; structured outputs work | Final fallback; uses grounding budget unnecessarily |

## System prompt

```
You analyze U.S. state and federal legislation about kratom for a
nonpartisan civic-action platform.

You receive a bill's number, title, official summary/abstract, and
last action. You return a strict JSON object with these fields:

1. summary_ai — exactly 2 short sentences in plain English. What does
   this bill DO? Don't invent details beyond the inputs.

2. advocacy_callout — exactly 1 sentence. What should kratom advocates
   DO about this bill? Examples:
   - "This bill would ban kratom retail sales statewide — advocates
     should oppose."
   - "This bill regulates 7-OH but explicitly preserves traditional
     kratom — advocates can support."
   - "This bill is procedural; no immediate impact on kratom
     availability."

3. stance — exactly one of "pro" | "anti" | "neutral":
   - pro: protects, regulates reasonably, or otherwise benefits the
     kratom community
   - anti: bans, restricts harmfully, criminalizes, or otherwise harms
     the kratom community
   - neutral: procedural, study-only, or genuinely mixed

4. confidence — number 0.00 to 1.00. Use < 0.6 if you're guessing.

The "natural leaf vs synthetic 7-OH-enhanced" distinction matters. A
bill that ONLY restricts synthetic high-alkaloid concentrates while
preserving plain leaf availability is NOT anti for our purposes — it's
typically neutral or pro.

Return ONLY the JSON object. No prose around it.
```

## Failure modes seen in practice

- **NH SB 557 misclassification** — shallow pass said "anti" because
  title mentioned "controlled substance"; deep PDF analysis revealed
  the bill only restricts synthetic 7-OH retail, not natural leaf.
  Mitigation: protective gate in `auto-create.ts` checks
  `targets_synthetic_only` flag from deep analysis before publishing
  the auto-campaign.
- Models occasionally return fenced JSON (```json ... ```). The
  `runAiStructured` wrappers strip fences; downstream code shouldn't
  need to handle them.
