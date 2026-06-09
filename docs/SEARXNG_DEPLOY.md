# Self-hosted SearXNG + Ollama — the keyless long-tail officials finder

This is the **free, keyless, ungated** replacement for Gemini's Google-Search
grounding in local-officials lookup (see `private/LOCAL_REPS_DEGEMINI_PLAN.md`).

- **SearXNG** _finds_ the official `.gov` roster page (no API key, no quota).
- **Ollama** (local LLM) _extracts_ the officials from that fetched page.
- If either is unreachable, the batch scripts queue the locality and move on —
  they **never** fall back to Gemini.

Tier 1 (Legistar webapi) needs none of this and runs everywhere; SearXNG+Ollama
only covers the long tail (small towns/counties not on Legistar).

---

## 1. One-command SearXNG (Docker Desktop on Windows)

```powershell
git clone https://github.com/searxng/searxng-docker.git
cd searxng-docker
# Generate a secret key (any random string works):
#   In searxng/settings.yml set:  server.secret_key: "<random>"
#   and ENABLE JSON output (off by default):
#       search:
#         formats:
#           - html
#           - json
docker compose up -d
```

Default bind is `http://localhost:8080`. Verify JSON works:

```powershell
curl "http://localhost:8080/search?q=tulsa+oklahoma+city+council&format=json"
```

> **Critical:** SearXNG ships with JSON **disabled**. If you skip the
> `formats: [html, json]` edit, `&format=json` returns HTTP 403.

## 2. Ollama (local LLM extractor)

Already on the owner box. Defaults to `http://localhost:11434`. Pull a model
the extractor can use (70B if the box has the RAM, else an 8B is fine):

```powershell
ollama pull llama3.3:70b   # used by scripts/lib/ai-router.mjs callOllama()
```

If Ollama is down, the extractor falls back through the free-tier cloud
providers already configured (`GROQ_API_KEY`, `CEREBRAS_API_KEY`) — still no
Gemini grounding, still keyless search.

## 3. Point the batch at it

Set on the machine that runs the officials batch (owner `.env.local`, or as
**self-hosted GitHub Actions runner** secrets):

```
SEARXNG_URL=http://localhost:8080
OLLAMA_URL=http://localhost:11434      # default; only needed if non-standard
```

Then drain the long tail:

```powershell
node --env-file=.env.local scripts/auto-fulfill-pending-local-reps.mjs
node --env-file=.env.local scripts/seed-bill-officials.mjs --all-municipal
```

## 4. Cloud vs self-hosted (why the split exists)

| Runner | Reaches localhost SearXNG/Ollama? | What it does |
|---|---|---|
| **Owner box / self-hosted GH runner** | ✅ yes | Legistar **+** SearXNG/Ollama long tail |
| **GitHub-hosted cloud cron** (`ubuntu-latest`) | ❌ no | Legistar only; long tail **queued** |
| **Vercel (live admin button / reverify)** | ❌ no | Legistar only; rest queued for batch |

So the cloud crons do the deterministic Legistar coverage (a big share) and
leave the rest queued; run the batch scripts where SearXNG/Ollama are reachable
to fill the remainder. To let a **cloud** runner reach your box, expose SearXNG
via a Cloudflare quick tunnel and set `SEARXNG_URL` to the tunnel URL (adds a
URL, **not** an API key):

```powershell
cloudflared tunnel --url http://localhost:8080
# → use the printed https://*.trycloudflare.com as SEARXNG_URL
```

## 5. What uses it

- `scripts/lib/officials-extract.mjs` — `findAndExtractOfficials()` (the shared
  Legistar→SearXNG/Ollama resolver)
- `scripts/auto-fulfill-pending-local-reps.mjs`, `scripts/seed-bill-officials.mjs`,
  `scripts/extract-news-officials.mjs` (via `officials-slate.mjs`)

`scripts/discover-legistar-tenants.mjs` only probes `webapi.legistar.com`
(public) and needs **neither** SearXNG nor Ollama — it runs fine on the cloud
cron.
