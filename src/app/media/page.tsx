import type { Metadata } from "next";
import Link from "@/components/Link";
import { unstable_cache } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { PressReplyButton } from "@/modules/press/PressReplyButton";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Media Persuasion | iKratom",
  description: "Answer the reporters and researchers who write about kratom, from your own mailbox.",
};

type Row = {
  id: string;
  kind: "reporter" | "researcher";
  name: string | null;
  outlet: string | null;
  news_items: { id: string; title: string; published_at: string | null } | null;
  research_papers: { id: string; title: string; publication_year: number | null } | null;
};

// Names and outlets only. Addresses go out one at a time through getPressContact.
const getContacts = unstable_cache(
  async () => {
    const { data } = await createServiceRoleClient()
      .from("press_contacts")
      .select(
        "id, kind, name, outlet, news_items(id, title, published_at), research_papers(id, title, publication_year)",
      )
      .order("found_at", { ascending: false })
      .limit(120);
    return (data ?? []) as unknown as Row[];
  },
  ["media-persuasion"],
  { revalidate: 3600, tags: ["media-persuasion"] },
);

function Piece({ row }: { row: Row }) {
  const story = row.news_items;
  const paper = row.research_papers;
  const href = story ? `/news/${story.id}` : `/research/${paper?.id}`;
  const when = story?.published_at?.slice(0, 10) ?? paper?.publication_year;
  return (
    <li className="rounded-lg border border-zinc-800 p-4">
      <Link href={href} className="font-semibold text-zinc-100 hover:text-emerald-300">
        {story?.title ?? paper?.title}
      </Link>
      <p className="mt-1 text-xs text-zinc-500">
        {[row.name, row.outlet, when].filter(Boolean).join(" · ")}
      </p>
      <div className="mt-3">
        <PressReplyButton
          contactId={row.id}
          source={row.kind === "reporter" ? "media_reporter" : "media_researcher"}
          label={row.kind === "reporter" ? "✉ Reply to the writer" : "✉ Write to the researcher"}
        />
      </div>
    </li>
  );
}

export default async function MediaPersuasionPage() {
  const rows = await getContacts();
  const stories = rows.filter((r) => r.news_items);
  const papers = rows.filter((r) => r.research_papers);
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold">Media Persuasion</h1>
      <p className="mt-2 text-sm text-zinc-400">
        The people writing about kratom, with the addresses they printed themselves. Your reply
        goes out from your own mailbox, in your own words.
      </p>
      <p className="mt-3 rounded-lg border border-amber-700/40 bg-amber-950/20 p-3 text-sm text-amber-200">
        Please be kind. Some of these stories are about a family&apos;s loss. Say what you know,
        offer a source, and thank them. One honest note does more than a hundred angry ones.
      </p>
      {rows.length === 0 && (
        <p className="mt-8 text-sm text-zinc-500">Nothing here yet. New stories are checked every night.</p>
      )}
      {stories.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Reporters</h2>
          <ul className="mt-3 space-y-3">{stories.map((r) => <Piece key={r.id} row={r} />)}</ul>
        </section>
      )}
      {papers.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Researchers</h2>
          <ul className="mt-3 space-y-3">{papers.map((r) => <Piece key={r.id} row={r} />)}</ul>
        </section>
      )}
    </main>
  );
}
