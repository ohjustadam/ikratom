# AI Toolkit — provider routing playbook

iKratom orchestrates multiple AI providers because no single model is best at everything we do, and most of what we do is bulk work that doesn't need the smartest model. This doc is the routing rulebook.

**Current status:** design + scaffolding. Implementation in `src/lib/ai/` is wired but not yet called from production paths. Migration plan: see "Rollout" at the bottom.

---

## Providers in the toolbelt

| Provider | Cost | Cap | Strength | Best for |
|---|---|---|---|---|
| **Claude** (this CLI/Desktop session) | Per-seat | Conversation budget | Reasoning, code, judgment, uniformity | Architecture, novel features, anything that has to be right the first time |
| **Gemini Flash 2.5** | Free | 15 RPM · 1,500/day | **Web grounding** (Google Search built in), structured output | Anything needing fresh facts: officials lookup, news enrichment, fact-checking |
| **Ollama** (local) | Free | ∞ (your hardware) | Privacy, no rate limit, no network | Bulk classification, translation, content rewriting, embeddings, anything sensitive |
| **Groq Cloud** | Free | 30 RPM · 14,400/day · ~500 tok/sec | Fastest inference of OSS models (Llama, Mixtral) | Fallback when Gemini hits limit; bulk where Ollama would be slow |
| **HuggingFace Inference** | Free | Slow but unmetered | Niche models, embeddings backups | Last-resort fallback |

Skipped (intentional): Cohere (less free than advertised), Together (overlaps Groq), OpenAI (paid only), Anthropic API (paid; using Claude via this seat instead).

---

## Routing rules

```ts
route(taskKind, opts) → provider
```

Decision tree:

1. **Privacy-sensitive** (chat moderation, user PII, encrypted DM analysis)
   → **Ollama only**. No data leaves the machine. Fail closed if Ollama isn't running.

2. **Needs web grounding** (current officials, current bill status, news)
   → **Gemini** (primary). Falls back to Groq + manual fetch if Gemini at limit.

3. **Bulk + no grounding** (translations, classification, summarization)
   → **Ollama** if local server is up, else **Groq**. Same prompt, swap target.

4. **Reserved for Claude** (anything that touches the codebase itself; anything where uniformity matters; novel features)
   → Claude (this seat). Don't burn it on bulk.

5. **Exploratory / one-off** (research, "what does this PDF say?", "summarize this thread")
   → Whatever's cheapest available; default Ollama.

The router is `src/lib/ai/router.ts`. Tasks declare what they need (grounding? privacy? speed?) and the router picks.

---

## Task-to-provider table

| Task | Provider | Why |
|---|---|---|
| Bill deep analysis (text → targets natural/synthetic flags) | Ollama (llama3.3:70b) | Bulk; privacy of raw bill text not critical but local is faster than rate-limited Gemini |
| Bill summary (plain English) | Ollama | Bulk, no grounding needed (we have the text) |
| Bill callout writing | Ollama | Same |
| Translation (bill → 6 langs) | Ollama (llama3.1:8b) | Already shipped; fast on small model |
| Local officials sweep (city → mayor + council) | **Gemini** | Needs Google Search grounding |
| Capital city sweep (top 10 per state) | Gemini primary, Ollama fallback | Same as above; fallback for offline |
| Forum post auto-flag (spam classifier) | Ollama (llama3.2:3b) | Privacy + speed; binary classification |
| Chat moderation pre-filter | Ollama | Privacy critical |
| News enrichment (RSS title → tags) | Ollama or Groq | Bulk; either works |
| Story submission moderation | Ollama | Privacy of submitter |
| Anything user content sees | Claude (review) → Ollama (bulk) | Claude defines voice; Ollama scales |

---

## Architecture

```
src/lib/ai/
  types.ts                 — shared types (TaskKind, ProviderName, PromptInput, StructuredOutput)
  router.ts                — route(taskKind, opts) → provider; falls back on rate-limit
  providers/
    ollama.ts              — wraps local Ollama HTTP API
    gemini.ts              — wraps Gemini REST + structured output schema
    groq.ts                — wraps Groq SDK
    claude.ts              — placeholder; not used directly (we ARE Claude)
  prompts/
    classify-flag.txt
    extract-officials.txt
    translate.txt
    summarize-bill.txt
    moderate-chat.txt
```

Provider wrappers are thin: each exposes `complete(prompt, opts) → string` and `completeStructured(prompt, schema, opts) → object`. The router picks one and calls it. Same shape, swappable.

**Failure handling:**
- Rate-limit hit → retry once on the next-best provider
- Network fail → retry with backoff (3 attempts max)
- Schema validation fail → retry once with stricter prompt
- All fail → log to `ai_job_log` table, surface in `/admin/ai-control`

---

## MCP server (future)

When implemented, `mcp-ai-router` exposes the router as MCP tools to Claude Desktop:

```
ollama_classify(prompt, labels)     → label
ollama_summarize(text, max_chars)   → string
gemini_research(question)           → grounded answer + sources
groq_fast_complete(prompt)          → string
ai_translate(text, target_lang)     → string
```

This lets the Claude session in your IDE dispatch bulk work to Gemini/Ollama/Groq without you copying prompts around. The chat is the command center; tool calls are the orchestration.

**Status:** not yet built. Will ship after `src/lib/ai/` providers are battle-tested by the in-app capital sweep + bill enrichment.

---

## In-app dashboard (`/admin/ai-control`)

When implemented, surfaces:
- Recent AI calls (provider, task, latency, success/fail)
- Per-provider rate limit state (X/15 requests this minute on Gemini)
- Queue of pending background jobs
- One-click retry for failures
- Cost ledger (Ollama: $0; Gemini: counter against free quota; Groq: same)

**Status:** designed, not yet built. Schema sketch lives in `docs/SCHEMA.md` once ai_job_log table ships.

---

## Rollout plan

1. ✅ Design doc (this file)
2. ✅ Scaffolding (`src/lib/ai/`) — providers + router, no production wiring yet
3. **Next:** smoke-test scripts (`scripts/test-ai-{ollama,gemini,groq}.mjs`) to confirm each provider works locally
4. **Then:** port the existing capital-cities sweep to use the router (low-risk; runs on demand)
5. **Then:** port bill enrichment to use the router (medium-risk; cron-triggered)
6. **Then:** add `ai_job_log` table + `/admin/ai-control` dashboard
7. **Then:** build `mcp-ai-router` MCP server for Claude Desktop integration

Each step is a separate PR. Step 4 onward gates on the prior step working in production.

---

## Cost / sustainability check

- Ollama: $0, runs on owner's hardware. Constraint: only available when machine is on. Cron-triggered jobs wait for owner to start Ollama; on-demand admin actions degrade to Groq.
- Gemini free tier: 1,500/day = 540K/year. Capital sweep = ~510 calls (51 states × 10 cities). Bill enrichment = ~5K/year. Plenty of headroom.
- Groq free tier: 30 RPM, 14,400/day. Backup only.
- HuggingFace: emergency only.

If we ever exceed free tiers, decision is the owner's: pay for Gemini, more local hardware for Ollama, or scale back. Not a today problem.
