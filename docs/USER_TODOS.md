# User TODO list — what only you can do

Persistent record of action items that require your login / account
access. Synced with the chat answer of 2026-05-12. Strike through
when done.

## 🟢 Free, high leverage

- [ ] **GitHub fine-grained PAT — add `Contents: Read+Write` +
      `Pull Requests: Read+Write` permissions** to the existing
      `GIST_TOKEN` or a new `IKRATOM_BOT_TOKEN`.
      - Where: github.com/settings/tokens?type=beta
      - Why: lets the AI open PRs directly when a fix is identified
        (failed cron jobs, dependency bumps, lint errors).

- [ ] **Brave Search API key (free, 2k req/mo)**.
      - Where: api-dashboard.search.brave.com
      - Add as `BRAVE_API_KEY` in Vercel + GitHub Actions secrets.
      - Why: backup grounded-search backend when Gemini quota tightens.

- [ ] **OpenSecrets API key (free, instant)**.
      - Where: opensecrets.org/api/admin/index.php
      - Add as `OPENSECRETS_API_KEY`.
      - Why: donor mapping → Tier 5 adversary intelligence from the
        NY intel roadmap.

- [ ] **Sentry free-tier account + Next.js wizard install**.
      - Where: sentry.io (already have `@sentry/nextjs` installed).
      - Add `SENTRY_DSN` + `SENTRY_AUTH_TOKEN` to Vercel + GitHub.
      - Why: known-broken pipeline detection; AI can investigate
        issues via Sentry MCP.

- [ ] **Enable repo auto-merge in GitHub**.
      - Where: github.com/ohjustadam/ikratom/settings → General →
        "Allow auto-merge".
      - Why: PRs auto-merge on green CI; eliminates manual
        squash-each-time.

- [ ] **Optional: OpenAI API key ($5 free credit)**.
      - Where: platform.openai.com
      - Add as `OPENAI_API_KEY`.
      - Why: GPT-4o as a fallback in self-critique loops; not
        required.

## 🟡 Paid but worth it (~$30–60/mo total)

- [ ] **Browserbase Starter ($39/mo)** — single biggest force-
      multiplier on our scraping reach.
      - Where: browserbase.com → Starter plan.
      - Add `BROWSERBASE_API_KEY` + `BROWSERBASE_PROJECT_ID` to
        Vercel + GitHub.
      - Why: Cloudflare-protected pharmacy boards + state legislatures
        that defeat our Playwright become 1-line bypass. Pairs with
        Stagehand (item 10 below).

- [ ] **Tavily Pro ($30/mo) — or stay on free 1k calls/mo**.
      - Where: tavily.com
      - Add `TAVILY_API_KEY`.
      - Why: focused web search with reranked + citation-attached
        results. Alternative to Gemini grounding.

- [ ] **Anthropic API direct key ($5 starter credit)**.
      - Where: console.anthropic.com
      - Add `ANTHROPIC_API_KEY`.
      - Why: Claude Sonnet directly for legal-quality bill summaries
        and self-critique passes. We currently route through
        Gemini/Groq/etc.

## 🔵 Public open-source projects to evaluate (decisions, not signups)

These don't need accounts; just decisions on which to pull into the
pipeline. Listed in priority order.

1. **Stagehand** (`browserbase/stagehand`) — AI-driven Playwright.
   Replaces brittle CSS-selector scrapers with "extract X from this
   page" instructions. 8k★, MIT. Pairs with Browserbase.

2. **Skyvern** (`Skyvern-AI/skyvern`) — browser agent that beats
   CAPTCHAs + handles complex login flows. 12k★, AGPL.

3. **Crawl4AI** (`unclecode/crawl4ai`) — async LLM-optimized
   scraping returning clean markdown. 17k★, MIT. Drop-in for our
   `extractArticleBody()` helper.

4. **Firecrawl** (`mendable/firecrawl`) — hosted OR self-hosted,
   sites → LLM-ready markdown with sitemap crawling. 25k★. Free
   tier is 500 pages/mo.

5. **LangGraph** (LangChain Inc) — multi-agent orchestration.
   Useful when a self-healing cron agent needs to coordinate
   read-log → draft-fix → open-PR. 14k★, MIT.

6. **Letta** (`letta-ai/letta`) — long-term memory for agents.
   Briefing-generator remembers what it learned about each state
   across runs. 18k★, Apache 2.

7. **Langfuse** (`langfuse/langfuse`) — LLM observability.
   Self-hostable. Traces every AI call for prompt refinement.
   10k★, MIT.

8. **OpenWebUI** (`open-webui/open-webui`) — ChatGPT-style UI over
   local Ollama for admin queries. 100k★, BSD.

9. **AnythingLLM** (`Mintplex-Labs/anything-llm`) — RAG over our
   briefings + bills with clean admin UI. 35k★, MIT.

10. **pyopenstates** — OpenStates' official Python SDK with retries,
    pagination, vote-roll-call handling. Worth porting our hand-rolled
    OpenStates calls.

## Decisions pending (no action yet, just reference)

- [ ] Once #1 and Browserbase are live → rewrite our existing BoP
      Playwright adapter to use Stagehand. ~3 hour rewrite, 100x more
      maintainable.
- [ ] When stance back-fill admin surface is built (next block),
      review the AI-drafted kratom stances for NY's ~40 active
      legislators and flip them champion/sympathetic/neutral/hostile.

---

Last updated: 2026-05-12 by Claude in session.
