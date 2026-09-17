# AI providers — every key, where to get it, where to put it

The platform is **free-tier only**. No code path may depend on a paid AI API
(CLAUDE.md, standing rule 2). This file is the complete list of providers the
router can use, what each one needs, and exactly where to set it.

**You never need to paste a key into a chat.** Every key below is set either in
GitHub → repository secrets, or in your local `.env.local`. Nowhere else.

---

## How the pool works

`scripts/lib/ai-router.mjs` tries providers one after another until one answers.

- **A provider with no key is skipped silently.** Adding a provider is *just*
  adding a key — no code change, no deploy.
- A `429` parks that provider for 60 seconds and the router moves on.
- A `402` (payment required) or `410` (gone) parks it for 6 hours, so a provider
  that has left the free tier costs one round-trip per run instead of hundreds.
- When every provider fails, the error says whether the pool was **empty** (you
  need to add a key) or **exhausted** (wait it out). Those used to look identical.

Scripts that need live web search (`sync-news`, `verify-bill-status-ai`,
`recheck-watchlist-meetings`, `discover-municipal-meetings`) go through
`scripts/lib/grounded-ai.mjs` instead, which needs **Gemini specifically** —
it is the only free provider with a Google Search tool. Those jobs refuse to
answer ungrounded rather than invent a date or a source.

---

## The providers

Ranked by what is worth your five minutes first.

| # | Provider | Secret name | Free tier | Get a key at |
|---|---|---|---|---|
| 1 | **Gemini** | `GEMINI_API_KEY` | 1,500 req/day, **plus** the only free grounded web search | https://aistudio.google.com/apikey |
| 2 | **Groq** | `GROQ_API_KEY` | Generous req/day, fastest in the pool | https://console.groq.com/keys |
| 3 | **Mistral** | `MISTRAL_API_KEY` | Free "Experiment" tier | https://console.mistral.ai/api-keys |
| 4 | **OpenRouter** | `OPENROUTER_API_KEY` | Routes to whatever is free right now | https://openrouter.ai/keys |
| 5 | **Cloudflare** | `CLOUDFLARE_AI_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` | 10k neurons/day | https://dash.cloudflare.com → AI → Workers AI |
| 6 | **SambaNova** | `SAMBANOVA_API_KEY` | Free tier, very fast Llama 3.3 | https://cloud.sambanova.ai/apis |
| 7 | **NVIDIA NIM** | `NVIDIA_API_KEY` | Free starter credits | https://build.nvidia.com |
| — | Cerebras | `CEREBRAS_API_KEY` | **Left the free tier** (answers 402). Kept wired in case it returns. | https://cloud.cerebras.ai |
| — | GitHub Models | `GH_MODELS_TOKEN` | **Being retired** (answers 410). Kept wired in case the brownout lifts. | https://github.com/settings/tokens |
| — | Ollama | `OLLAMA_URL` | Local only — unreachable from CI by design | your own machine |

> **`GH_MODELS_TOKEN`, not `GITHUB_MODELS_TOKEN`.** GitHub Actions refuses to
> create any secret whose name starts with `GITHUB_`. The router accepts either
> name, but the *secret* must be `GH_MODELS_TOKEN`.

### Extra Gemini keys multiply your quota

Gemini's free limits are **per Google Cloud project**, not per account. A second
project under the same account is free and has its own fresh allowance.

```
GEMINI_API_KEY      primary
GEMINI_API_KEY_2    second free project
GEMINI_API_KEY_3    third   ( … up to GEMINI_API_KEY_9 )
GEMINI_API_KEYS     or one comma-separated list instead
```

The router and the grounded path both rotate across all of them and park only
the *exhausted key*, not the whole provider. This is the cheapest way to unblock
grounded work: each extra key is a new project, no billing, no card.

---

## Where to set them

### 1. Scheduled jobs (GitHub Actions) — this is the one that matters

Add each as a **repository secret**:

> GitHub → your repo → **Settings** → **Secrets and variables** → **Actions**
> → **New repository secret**
>
> Direct link: `https://github.com/ohjustadam/ikratom/settings/secrets/actions`

Name it exactly as the **Secret name** column above. That is all — the workflows
already read every secret in that list at **workflow level**, so every job and
every step inherits it. You do not need to edit any YAML to add a key.

Workflows carrying the pool:

```
.github/workflows/cron-hourly.yml
.github/workflows/cron-daily.yml
.github/workflows/cron-weekly.yml
.github/workflows/cron-nightly-cloud.yml
.github/workflows/cron-grounded-queues.yml
.github/workflows/cron-localreps-cloud.yml
```

`tests/ai-provider-wiring.test.ts` fails CI if a workflow runs an AI script
without exposing the full pool, so this cannot silently rot again.

### 2. Local development

Put the same names in `.env.local` (gitignored, never committed):

```bash
GEMINI_API_KEY=...
GROQ_API_KEY=...
MISTRAL_API_KEY=...
```

Scripts read it via `node --env-file=.env.local scripts/<name>.mjs`.

### 3. Netlify (the website itself)

**Nothing to do.** No AI provider key is needed at build or request time — all
model calls happen in scheduled jobs. Do not add these to Netlify.

---

## Changing the order without a deploy

Optional repository **variable** (not a secret):

> Settings → Secrets and variables → Actions → **Variables** tab → `AI_PROVIDER_ORDER`

```
AI_PROVIDER_ORDER=groq,mistral,openrouter
```

Providers named there are tried first, in that order; everything else keeps its
default position behind them. Unknown or unconfigured names are ignored. Use it
to demote a provider that has gone flaky without touching code.

---

## Checking what is actually live

```bash
node --env-file=.env.local scripts/test-ai-providers.mjs
```

Every cron script that makes many AI calls now prints a per-provider
`ok / fail` summary at the end of its run, so a GitHub Actions log answers
"which providers answered today?" directly. A run where nothing answered says so
in one line rather than leaving you to count failures.
