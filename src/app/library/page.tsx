import { createClient } from "@/lib/supabase/server";
import { LibraryBrowser } from "./LibraryBrowser";
import { getCreatorContext } from "@/modules/admin/actions";

export const metadata = { title: "Library" };

export default async function LibraryPage() {
  const supabase = await createClient();
  const { data: items } = await supabase
    .from("library_items")
    .select("id, type, title, description, cover_image_url, author, source_org, duration_seconds, tags, featured, published_at")
    .eq("active", true)
    .order("featured", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);

  const ctx = await getCreatorContext();

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Kratom library</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Videos, books, podcasts, and articles. Curated for advocates and curious newcomers alike.
          </p>
        </div>
        {ctx.ok && (
          <a
            href="/admin/library/new"
            className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
          >
            + Add item
          </a>
        )}
      </header>

      <LibraryBrowser items={items ?? []} />
    </div>
  );
}
