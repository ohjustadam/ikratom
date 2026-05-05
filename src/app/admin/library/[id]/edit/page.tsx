import { notFound, redirect } from "next/navigation";
import { getCreatorContext } from "@/modules/admin/actions";
import { createClient } from "@/lib/supabase/server";
import { LibraryItemForm } from "@/modules/library/components/LibraryItemForm";

export const metadata = { title: "Edit library item" };

export default async function EditLibraryItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getCreatorContext();
  if (!ctx.ok) redirect("/dashboard");

  const { id } = await params;
  const supabase = await createClient();
  const { data: item } = await supabase.from("library_items").select("*").eq("id", id).single();
  if (!item) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <a href={`/library/${id}`} className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Back to item
      </a>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">Edit library item</h1>
      </header>
      <LibraryItemForm initial={item} />
    </div>
  );
}
