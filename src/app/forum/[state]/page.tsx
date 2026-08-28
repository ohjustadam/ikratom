import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listNewsForState } from "@/modules/news/actions";
import { ThreadList } from "./ThreadList";
import { recordForumVisit } from "@/modules/forum/engagement-actions";
import { stateKey, type SubMode } from "@/modules/forum/engagement-keys";
import { ForumSubscribeButton } from "@/modules/forum/components/ForumSubscribeButton";

import Link from "next/link";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ state: string }>;
}) {
  const { state } = await params;
  return { title: `${state.toUpperCase()} forum` };
}

export default async function StateForumPage({
  params,
  searchParams,
}: {
  params: Promise<{ state: string }>;
  searchParams: Promise<{ tag?: string; sort?: string }>;
}) {
  const { state: raw } = await params;
  const { tag, sort } = await searchParams;
  const abbr = raw.toUpperCase();

  const supabase = await createClient();
  const { data: stateRow } = await supabase
    .from("states")
    .select("abbr, name, kratom_status")
    .eq("abbr", abbr)
    .single();

  if (!stateRow) notFound();

  // Build threads query
  let threadsQuery = supabase
    .from("forum_threads")
    .select("id, state, locality, author_id, author_state, title, body, tag, residents_only, pinned, locked, system_generated, post_count, upvote_count, helpful_count, last_activity_at, created_at")
    .eq("state", abbr);

  if (tag && tag !== "all") {
    threadsQuery = threadsQuery.eq("tag", tag);
  }

  // Sort: pinned always first, then by sort param
  threadsQuery = threadsQuery.order("pinned", { ascending: false });
  if (sort === "top") {
    threadsQuery = threadsQuery.order("upvote_count", { ascending: false });
  } else if (sort === "new") {
    threadsQuery = threadsQuery.order("created_at", { ascending: false });
  } else {
    // default: hot = recent activity
    threadsQuery = threadsQuery.order("last_activity_at", { ascending: false });
  }

  const { data: threads } = await threadsQuery.limit(100);

  // Recent state news for sidebar
  const stateNews = await listNewsForState(abbr, 5);

  // Recent state-level bills + counts (sidebar)
  const [{ data: bills }, { count: legCount }] = await Promise.all([
    supabase
      .from("bills")
      .select("id, bill_number, title, status")
      .eq("state", abbr)
      .eq("active", true)
      .order("last_action_at", { ascending: false, nullsFirst: false })
      .limit(5),
    supabase
      .from("legislators")
      .select("id", { count: "exact", head: true })
      .eq("state", abbr)
      .eq("active", true),
  ]);

  // Current user state for the "your state" affordance + new-thread eligibility
  const { data: { user } } = await supabase.auth.getUser();
  let userState: string | null = null;
  let subMode: SubMode | null = null;
  if (user) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("state")
      .eq("id", user.id)
      .single();
    userState = prof?.state ?? null;

    // Pull this user's subscription for THIS forum (if any) so the
    // header pill renders with the correct mode on first paint.
    const fkey = stateKey(abbr);
    if (fkey) {
      const { data: sub } = await supabase
        .from("forum_subscriptions")
        .select("mode")
        .eq("user_id", user.id)
        .eq("forum_key", fkey)
        .maybeSingle();
      subMode = (sub?.mode as SubMode | undefined) ?? null;
    }
  }

  // Mark this forum as visited (resets unread to 0). Best-effort —
  // anonymous + RLS reject silently noop. Don't await heavily; this
  // runs in parallel with render.
  const fkey = stateKey(abbr);
  if (fkey) await recordForumVisit(fkey);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <Link href="/forum" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← All states
      </Link>

      <header className="mt-2 mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">
            {stateRow.name}{" "}
            <span className="font-mono text-base text-zinc-500">({stateRow.abbr})</span>
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            Local war room. Status:{" "}
            <span className="font-semibold text-zinc-200">
              {stateRow.kratom_status ?? "unknown"}
            </span>
            {legCount != null && <> · {legCount} legislators on file</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {fkey && (
            <ForumSubscribeButton
              forumKey={fkey}
              initialMode={subMode}
              signedIn={!!user}
            />
          )}
          <a
            href={`/forum/${abbr}/new`}
            className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
          >
            + New thread
          </a>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ThreadList
            threads={threads ?? []}
            state={abbr}
            currentTag={tag ?? "all"}
            currentSort={sort ?? "hot"}
            userState={userState}
          />
        </div>

        <aside className="space-y-4">
          {stateNews.length > 0 && (
            <SideCard title={`${abbr} news`}>
              <ul className="space-y-3 text-sm">
                {stateNews.map((n) => (
                  <li key={n.id}>
                    <a
                      href={n.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block hover:text-emerald-400"
                    >
                      <p className="font-medium leading-tight">{n.title}</p>
                      <p className="mt-0.5 text-[11px] text-zinc-500">
                        {n.source_name ?? "Source"}
                        {n.published_at && <> · {new Date(n.published_at).toLocaleDateString()}</>}
                      </p>
                    </a>
                  </li>
                ))}
              </ul>
              <Link href="/news" className="mt-3 inline-block text-xs text-emerald-400 hover:underline">
                All kratom news →
              </Link>
            </SideCard>
          )}

          <SideCard title="Recent bills">
            {bills && bills.length > 0 ? (
              <ul className="space-y-2 text-sm">
                {bills.map((b) => (
                  <li key={b.id}>
                    <span className="font-mono text-xs text-zinc-500">{b.bill_number}</span>{" "}
                    {b.title}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-zinc-500">
                No bills indexed yet (waiting on LegiScan API).
              </p>
            )}
          </SideCard>
          <SideCard title="Quick links">
            <ul className="space-y-1.5 text-sm">
              <li>
                <a href={`/legislators?state=${abbr}`} className="text-emerald-400 hover:underline">
                  Legislators in {abbr} →
                </a>
              </li>
              <li>
                <a href={`/campaigns/${abbr.toLowerCase()}-introduce-yourself`} className="text-emerald-400 hover:underline">
                  Intro campaign →
                </a>
              </li>
              <li>
                <a href="/account" className="text-emerald-400 hover:underline">
                  Notification settings →
                </a>
              </li>
            </ul>
          </SideCard>
        </aside>
      </div>
    </div>
  );
}

function SideCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        {title}
      </h2>
      {children}
    </div>
  );
}
