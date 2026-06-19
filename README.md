# iKratom

The advocate's toolbelt. A nonpartisan political action platform for the kratom community.

## Setup

1. Install deps:
   ```
   npm install
   ```

2. Create `.env.local` from the example:
   ```
   cp .env.local.example .env.local
   ```
   Fill in values from the accounts checklist below.

3. Run the database migration in Supabase:
   - Open your Supabase project → SQL Editor
   - Paste the contents of `supabase/migrations/0001_init.sql`
   - Run it. (Or use the Supabase CLI: `supabase db push`)

4. Start dev server:
   ```
   npm run dev
   ```

## Accounts you need (all free)

| Service | Why | Sign up |
| --- | --- | --- |
| GitHub | Source control | github.com |
| Vercel | Hosting | vercel.com |
| Supabase | DB + auth | supabase.com |
| LegiScan | Bill tracking API | legiscan.com/legiscan |
| OpenStates | Legislator contacts API | openstates.org |
| Google Cloud | Civic Information API (address → reps) | console.cloud.google.com |
| Anthropic | AI personalization (later) | console.anthropic.com |

## v1 Roadmap

- [x] Project scaffold + schema
- [ ] Auth (signup / login / profile)
- [ ] OK legislator seed (manual or LegiScan sync)
- [ ] First campaign created in DB
- [ ] One-click mailto: action UI
- [ ] Action log
- [ ] Deploy to Vercel

Future (flagged off): forum, library (videos/books/TTS), news scraping, AI personalization, medical board recruitment, multistate expansion.

## License

iKratom is **source-available, not open source.** This repository is
public for transparency and to run continuous integration on free
infrastructure tiers — that is *not* a grant to reuse the code.

You may read the source and fork it to submit contributions back to the
project. You may **not** mirror, redistribute, redeploy, or stand up a
competing/look-alike instance, and you may **not** use the code to train
AI models, without prior written permission. The "iKratom" name and brand
are reserved trademarks and are not licensed.

Full terms govern in [`LICENSE.md`](./LICENSE.md). Licensing inquiries:
ohjustadam@proton.me.

