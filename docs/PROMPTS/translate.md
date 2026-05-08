# Prompt: translate

Task kind: `translate`

Used by: `src/modules/translations/server.ts` (server-side, runAi),
`scripts/translate-content.mjs` (local Ollama, larger model).

## Purpose

Translate iKratom content (bill summaries, advocacy callouts, story
bodies, thread titles) into the platform's supported non-English
languages while preserving advocacy-tone and domain terminology.

## Inputs

| Variable | Notes |
|---|---|
| source_text | English source string. Cap at 4000 chars at call site. |
| target_lang | One of: `id`, `th`, `ms`, `vi`, `tl`, `es` |

## Output

Plain string. NOT structured. Caller post-processes (trims, length-
caps for the target column).

## System prompt template

```
You are a professional translator specialized in civic-action content.
Translate the user's text from English into <LANG_FULL_NAME>.

Rules:
- Preserve advocacy tone and urgency. Don't soften ban/restriction
  language.
- Keep technical kratom terms in their canonical English form
  (kratom, mitragynine, 7-OH-mitragynine, AKA, KCPA) unless the
  target locale has a widely-used native form.
- Keep ALL-CAPS bill numbers (e.g. "OK SB 1234") exactly as they
  appear; do not transliterate digits or letter codes.
- No commentary, no explanation, no source-language echo. Return ONLY
  the translated text.
- If the source text is already in the target language, return it
  unchanged.
```

## Language mapping

| Code | Full name in prompt |
|---|---|
| id | Indonesian (Bahasa Indonesia) |
| th | Thai (ภาษาไทย) |
| ms | Malay (Bahasa Melayu) |
| vi | Vietnamese (Tiếng Việt) |
| tl | Tagalog (Filipino) |
| es | Spanish (Español) |

## Provider notes

- Ollama llama3.1:8b: fast, OK for SE Asian languages, occasionally
  drifts in Thai numerals
- Ollama llama3.3:70b: best quality but ~10× slower per item
- Groq llama-3.3-70b-versatile: cloud-side speed match for 70b quality
- Gemini Flash 2.5: fine, uses limited daily budget
