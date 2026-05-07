# Task patterns

Recipes for common tasks. Copy-paste-friendly. New AI sessions: this file is your cookbook.

---

## Add a Postgres migration

1. Create file: `supabase/migrations/0NNN_short_topic.sql` (next number — check `ls supabase/migrations/`)
2. Open with a comment block:
   ```sql
   -- ============================================================
   -- 00NN_short_topic
   --
   -- Why this exists, what it changes, any rollback notes.
   -- ============================================================
   ```
3. **Idempotent:** prefer `create table if not exists`, `add column if not exists`, `create or replace function`, `drop policy if exists` before recreating. Re-running a migration must not error.
4. RLS on every new table: `alter table X enable row level security;` then policies.
5. Apply: `npm run db:push` (calls `scripts/db-push.mjs`, which uses Supabase Management API).
6. Commit migration file. The `_ikratom_migrations` table tracks applied migrations server-side; new env starts from blank and applies all.

---

## Add an admin-only page

1. Create route: `src/app/admin/<topic>/page.tsx`
2. Always start with the auth guard:
   ```tsx
   import { redirect } from "next/navigation";
   import { getAdminContext } from "@/modules/admin/actions";
   
   export default async function Page() {
     const ctx = await getAdminContext();
     if (!ctx.ok) redirect("/dashboard");
     // ...
   }
   ```
3. Add a card in `src/app/admin/page.tsx`:
   ```tsx
   {adminOnly && <AdminCard href="/admin/<topic>" title="..." body="..." />}
   ```
4. Need `adminOnly` (owner+admin only) vs creator-OK access? The page returns the right `ctx`, gate the card with the right flag.

---

## Add a server action

1. File: `src/modules/<domain>/actions.ts` (create if needed). First line: `"use server";`
2. Action signature returns a discriminated union:
   ```ts
   export async function doThing(input: { ... }):
     Promise<{ ok: true; ... } | { error: string }> {
   ```
3. Always:
   - Auth check (`getAdminContext()` for admin-only, `supabase.auth.getUser()` for any-user)
   - Validate inputs server-side (regex for IDs, length caps)
   - For admin mutations: `recordAdminAction({ action: "<verb.target>", targetType, targetId })`
   - For user-driven mutations: `checkRateLimit(key, max, windowSec)`
   - For pages affected: `revalidatePath("/...")`
4. Type the return so callers can `if ("error" in r) ...` cleanly.

---

## Add an RLS policy

```sql
alter table public.<t> enable row level security;

drop policy if exists "<t>_select_authed" on public.<t>;
create policy "<t>_select_authed"
  on public.<t> for select
  to authenticated
  using (<predicate>);
```

Convention: `<table>_<verb>_<who>` for policy names. Verbs: `select / insert / update / delete`. Common predicates:

- Self-only: `auth.uid() = user_id`
- Admin: `is_admin(auth.uid())`
- Self or admin: `auth.uid() = user_id or is_admin(auth.uid())`
- Public read: `to public ... using (true)`

For complex public-read with private columns: don't use column-level grants, use a `<table>_public` view that selects only safe columns.

---

## Bypass RLS for a narrow read (SECURITY DEFINER RPC)

When public users need to read a few columns from a table whose RLS would block them (e.g. author names from `profiles`), don't loosen RLS. Add a SECURITY DEFINER function:

```sql
create or replace function public.get_X(p_id uuid)
returns table (col1 text, col2 text)
language sql
security definer
stable
set search_path = public
as $$
  select col1, col2 from public.<t> where id = p_id;
$$;

grant execute on function public.get_X(uuid) to authenticated;
revoke all on function public.get_X(uuid) from public;
```

Always specify `set search_path = public` — without it, a malicious schema can shadow tables.

Call from app: `supabase.rpc("get_X", { p_id: ... })`.

---

## Add a Realtime subscription (client component)

```tsx
"use client";
import { createClient } from "@/lib/supabase/client";

useEffect(() => {
  if (typeof window === "undefined") return;
  const supabase = createClient();
  let cancelled = false;
  let activeChannel: RealtimeChannel | null = null;

  (async () => {
    // CRITICAL if table SELECT RLS is `to authenticated`:
    const { data: { session } } = await supabase.auth.getSession();
    if (cancelled) return;
    if (session) supabase.realtime.setAuth(session.access_token);

    const channel = supabase.channel(`channel-name`);
    activeChannel = channel;
    channel.on("postgres_changes", { event: "INSERT", schema: "public", table: "T", filter: "..." }, (p) => { ... });
    channel.subscribe();
  })();

  return () => {
    cancelled = true;
    if (activeChannel) supabase.removeChannel(activeChannel);
  };
}, []);
```

If you need DELETE events with a non-PK filter: `alter table T replica identity full;` in a migration. See DECISIONS.md.

---

## Add a scheduled job

**Daily** → add to `vercel.json`:
```json
{ "path": "/api/cron/<name>", "schedule": "0 12 * * *" }
```

**Hourly or sub-daily** → can't be on Vercel Hobby. Add a step to `.github/workflows/cron-hourly.yml`:
```yaml
- name: Hit /api/cron/<name>
  run: curl -fsS -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/cron/<name>"
```

Either way, the route handler:
```ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // service-role client — RLS bypass
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  // ... do work ...
  return NextResponse.json({ ok: true, ... });
}
```

---

## Add a notification (in-app + push)

Two layers:
1. **In-app:** insert into `notifications` table. RLS allows the user to read their own. The bell badge in nav reads count via `getUnreadNotificationCount()`.
2. **Push:** automatic. The hourly cron `fanoutPushNotifications()` picks up unpushed rows in the last 24h, sends to subscribed devices, marks `pushed_at`.

You don't need to call the push sender directly — just insert the row with `kind`, `title`, `body`, `link`. Fan-out is the cron's job.

---

## Add a translation for a new content type

1. Update the migration `0037_content_translations.sql`'s entity_type check constraint to allow the new type (new migration if v1 already shipped):
   ```sql
   alter table content_translations drop constraint content_translations_entity_type_check;
   alter table content_translations add constraint content_translations_entity_type_check 
     check (entity_type in ('bill_summary','bill_callout','story_body','thread_title','<new>'));
   ```
2. Update `scripts/translate-content.mjs` to fetch + translate that entity type.
3. In the page rendering the content, wrap with `<TranslatedSection>` from `src/lib/translations.ts`.

---

## Add a partner / kit format

If you want a 5th printable sheet (e.g. business card):

1. In `src/app/admin/partners/[slug]/kit/page.tsx`, add a new `<section className="kit-sheet sheet-bizcard">` with the markup.
2. In the same file's `<style>`, add `.sheet-bizcard { width: ...; height: ...; padding: ...; }` and the inner styles.
3. The `@page` CSS already breaks each sheet to its own page automatically.
4. QR target URL is shared — no new render needed; same `qrCard` SVG works.

---

## Add a new AI provider (when toolkit is implemented)

1. New file `src/lib/ai/providers/<name>.ts` exporting `complete()` and `completeStructured()` matching the shared shape.
2. Add it to the `ProviderName` union in `src/lib/ai/types.ts`.
3. Update the routing rules in `src/lib/ai/router.ts`.
4. Document in `docs/AI_TOOLKIT.md`.
5. Add a smoke test: `scripts/test-ai-<name>.mjs`.
