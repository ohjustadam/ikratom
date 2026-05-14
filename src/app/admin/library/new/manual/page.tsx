import { redirect } from "next/navigation";
import { getCreatorContext } from "@/modules/admin/actions";
import { LibraryItemForm } from "@/modules/library/components/LibraryItemForm";

export const metadata = { title: "Add library item — manual" };

/**
 * /admin/library/new/manual — fall-through full-form add-to-library.
 *
 * Most library additions go through /admin/library/new/quick now (URL
 * paste + auto-fetch). This route exists for cases where:
 *   - The source has no public URL (books, original transcripts)
 *   - The URL exists but has no Open Graph tags / oEmbed support
 *   - Admin prefers full control over every field from the start
 */
export default async function NewLibraryItemManualPage() {
  const ctx = await getCreatorContext();
  if (!ctx.ok) redirect("/dashboard");

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin/library/new" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Pick a different type
      </a>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">Add library item · manual</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Full form. Every field manual.{" "}
          <span className="text-zinc-500">
            (Have a public URL?{" "}
            <a href="/admin/library/new" className="text-emerald-400 hover:underline">
              Try the auto-fill flow
            </a>{" "}
            instead.)
          </span>
        </p>
      </header>
      <LibraryItemForm />
    </div>
  );
}
