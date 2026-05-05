import { redirect } from "next/navigation";
import { getCreatorContext } from "@/modules/admin/actions";
import { LibraryItemForm } from "@/modules/library/components/LibraryItemForm";

export const metadata = { title: "Add library item" };

export default async function NewLibraryItemPage() {
  const ctx = await getCreatorContext();
  if (!ctx.ok) redirect("/dashboard");

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/library" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Library
      </a>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">Add library item</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Videos, books, podcasts, articles, documents — anything that helps the kratom community learn.
        </p>
      </header>
      <LibraryItemForm />
    </div>
  );
}
