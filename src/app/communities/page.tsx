import { createClient } from "@/lib/supabase/server";
import {
  listActiveExternalCommunities,
  type ExternalCommunity,
} from "@/modules/external-communities/actions";
import { CATEGORY_LABELS, type ExtCategory } from "@/modules/external-communities/labels";

export const metadata = { title: "Kratom communities" };
export const dynamic = "force-dynamic";

// Order categories appear in. Anything not listed here falls to the end.
const CATEGORY_ORDER: ExtCategory[] = [
  "facebook", "reddit", "discord", "podcast", "telegram", "youtube", "other",
];

const CATEGORY_NOTES: Partial<Record<ExtCategory, string>> = {
  facebook:
    "FB is where most kratom advocates already live. iKratom doesn't try to replace that — we just give you a place to take coordinated action when something drops, and share back to your group.",
};

export default async function CommunitiesPage() {
  // Show admin "manage" link only to admins.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  let isAdmin = false;
  if (user) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("is_admin, is_owner")
      .eq("id", user.id)
      .single();
    isAdmin = !!(prof?.is_admin || prof?.is_owner);
  }

  const rows = await listActiveExternalCommunities();

  // Group by category
  const grouped = new Map<ExtCategory, ExternalCommunity[]>();
  for (const r of rows) {
    const arr = grouped.get(r.category) ?? [];
    arr.push(r);
    grouped.set(r.category, arr);
  }

  const orderedCategories = [
    ...CATEGORY_ORDER.filter((c) => grouped.has(c)),
    ...[...grouped.keys()].filter((c) => !(CATEGORY_ORDER as string[]).includes(c)),
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <header className="mb-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
              Find your people
            </p>
            <h1 className="mt-2 text-4xl font-bold sm:text-5xl">
              The kratom community lives in a lot of places
            </h1>
          </div>
          {isAdmin && (
            <a
              href="/admin/external-communities"
              className="shrink-0 rounded-md border border-emerald-700/50 bg-emerald-950/20 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:border-emerald-500"
            >
              ✎ Manage
            </a>
          )}
        </div>
        <p className="mt-3 max-w-2xl text-lg text-zinc-400">
          iKratom is the war room for organized advocacy work. But the conversations,
          friendships, and informal coordination happen across the platforms below
          too. Use them. Bring people back here when there&apos;s an action to take.
        </p>
      </header>

      {orderedCategories.length === 0 ? (
        <p className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-8 text-center text-sm text-zinc-500">
          No communities listed yet.
          {isAdmin && (
            <>
              {" "}
              <a href="/admin/external-communities" className="text-emerald-400 hover:underline">Add some →</a>
            </>
          )}
        </p>
      ) : (
        orderedCategories.map((cat) => (
          <Section
            key={cat}
            title={CATEGORY_LABELS[cat] ?? cat}
            items={grouped.get(cat) ?? []}
            note={CATEGORY_NOTES[cat]}
            isAdmin={isAdmin}
          />
        ))
      )}

      <section className="mt-10 rounded-lg border border-emerald-700/40 bg-emerald-950/20 p-6">
        <h2 className="text-lg font-bold text-emerald-300">Know a community we should list?</h2>
        <p className="mt-2 text-sm text-zinc-300">
          We curate this page manually to keep it actually useful (no spam vendors, no dead Discord servers).
          Send a suggestion to <a href="mailto:ohjustadam@proton.me" className="text-emerald-400 hover:underline">ohjustadam@proton.me</a>.
        </p>
      </section>
    </div>
  );
}

function Section({
  title, items, note, isAdmin,
}: {
  title: string;
  items: ExternalCommunity[];
  note?: string;
  isAdmin: boolean;
}) {
  return (
    <section className="mb-10">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
        {title}
      </h2>
      {note && <p className="mb-3 text-xs text-zinc-400">{note}</p>}
      <ul className="grid gap-3 sm:grid-cols-2">
        {items.map((c) => (
          <li key={c.id} className="relative">
            <a
              href={c.href}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 transition hover:border-emerald-500"
            >
              <div className="font-semibold text-zinc-100">{c.name}</div>
              {c.description && (
                <p className="mt-1 text-sm text-zinc-400">{c.description}</p>
              )}
              <p className="mt-2 truncate font-mono text-[10px] text-zinc-600">{c.href}</p>
            </a>
            {isAdmin && (
              <a
                href={`/admin/external-communities#row-${c.id}`}
                className="absolute right-2 top-2 rounded bg-zinc-900/80 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:text-emerald-300"
                title="Edit / archive / delete (admin)"
              >
                ✎
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
