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
| Netlify | Hosting (behind Cloudflare) | netlify.com |
| Supabase | DB + auth | supabase.com |
| LegiScan | Bill tracking API | legiscan.com/legiscan |
| OpenStates | Legislator contacts API | openstates.org |
| Google Cloud | Civic Information API (address → reps) | console.cloud.google.com |
| Free AI providers | Groq, Gemini, Mistral, NVIDIA and others — see `docs/AI_PROVIDERS.md` | (free tiers only) |

## Where things stand

v1 shipped long ago. For what runs where today, start at
[`STATE_OF_PLAY.md`](./STATE_OF_PLAY.md).

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

