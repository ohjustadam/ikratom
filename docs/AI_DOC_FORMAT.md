# Markdown vs HTML for AI-consumed documentation

> The question: "I saw HTML may be better than .md for certain AI learning and memory aspects. Is this something we should look at improving?"

Short answer: **mostly no, but with one specific exception.**

## Where Markdown is actually fine for AI

For our `CLAUDE.md`, `AGENTS.md`, `ROADMAP.md`, `ARCHITECTURE.md`, etc. — Markdown is the right choice and switching to HTML would be a regression:

- Modern LLMs (GPT-4, Claude 3.5+, Gemini 1.5+) are trained on massive Markdown corpora (GitHub, StackOverflow, Wikipedia which serializes as MD). They parse it natively.
- Markdown's whitespace structure (headings, lists, code fences) maps cleanly to attention patterns. Adding `<h2>` / `<p>` / `<ul>` tags doesn't help and slightly bloats the token count.
- Humans edit our docs. Markdown wins on author ergonomics by an order of magnitude.

If anyone tells you "switch your docs to HTML for better AI comprehension," they're usually:
1. Confusing AI **training** data (which mixes both) with AI **inference** (where format barely matters)
2. Talking about RAG/retrieval systems where structured tags help chunk boundaries (a real edge case, see below)

## The one place HTML helps

**Retrieval-Augmented Generation (RAG) systems** that ingest your docs and answer questions against them. If we ever build something like "ask iKratom about kratom policy" with a vector store on top of our content, HTML can outperform Markdown for chunking:

- `<article>`, `<section>`, `<nav>`, `<aside>` tell the chunker exactly where a semantic unit starts and ends.
- `<table>` with proper `<th>` cells preserves column relationships across embeddings (Markdown tables often get split mid-row).
- Microdata / JSON-LD inside HTML lets the chunker know "this section is a `LegislativeAct`" vs "this is a `NewsArticle`."

For the content we serve users via `/research`, `/briefings`, `/news`, etc.: we already render to HTML via Next.js. Search engines + Google's AI summarizers parse the rendered HTML, not our source MD.

## What we should actually do

| Doc type | Current | Recommendation |
|---|---|---|
| `CLAUDE.md` / `AGENTS.md` / `ROADMAP.md` | MD | **Keep MD.** Humans edit them; AI parses them fine. |
| `docs/*.md` (technical refs) | MD | **Keep MD.** Same reasoning. |
| `src/content/briefings/*.md` (published content) | MD → rendered HTML by Next | **Keep MD source.** The rendered HTML is what AI/Google parse. |
| `src/content/patch-notes/*.md` | MD → rendered HTML by Next | **Keep MD source.** |
| Schema documentation for AI consumers | MD | **Add JSON-LD** in the rendered HTML head where it helps (e.g. `<script type="application/ld+json">` on `/research/[id]` so the page advertises itself as a `ScholarlyArticle` to AI crawlers and Google). |

## What WOULD measurably help

If we want AI consumers (ChatGPT, Perplexity, Claude.ai with web search) to cite us correctly:

1. **JSON-LD structured data** on key pages — `/research/[id]`, `/bills/[id]`, `/alerts/[id]`, `/meetings/[id]`. ~50 lines of code per template; instant SEO + AI-summary wins.
2. **Robots.txt explicit `Allow` for AI crawlers we want indexing us** (vs the current `Disallow` for some — see `src/app/robots.ts`).
3. **Sitemap with `<news:news>` and `<lastmod>`** so AI crawlers don't re-fetch unchanged pages.
4. **OpenGraph + Twitter cards** — already done on key pages (`/meetings/[id]`, `/alerts/[id]`, `/states/[code]`).

So if the goal is "AI cites us better when someone asks about kratom policy" — the lift isn't MD→HTML, it's **JSON-LD on the rendered HTML pages we already serve**.

## TL;DR

- Keep docs in Markdown. AI parses them fine.
- Add JSON-LD to public content pages when we want AI search engines to extract and cite our data structurally.
- The "HTML is better for AI" claim usually conflates training corpora vs RAG chunking vs inference. For our use case, none of those apply at the doc-source level.
