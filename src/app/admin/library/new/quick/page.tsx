import { redirect } from "next/navigation";
import { getCreatorContext } from "@/modules/admin/actions";
import { QuickAddForm } from "./QuickAddForm";

export const metadata = { title: "Add library item — quick" };

type SP = Promise<{ type?: string }>;

/**
 * /admin/library/new/quick — paste URL, AI auto-fills the rest.
 *
 * Single-input first step. Admin pastes a URL, clicks "Fetch", and
 * the enrichLibraryUrl server action returns suggested values from:
 *   - YouTube oEmbed (for YouTube URLs)
 *   - Open Graph / Twitter card meta tags (for generic articles)
 *   - AI-inferred description (when og:description missing)
 *
 * Admin then reviews + edits the auto-filled fields and saves.
 */
export default async function NewLibraryItemQuickPage({
  searchParams,
}: {
  searchParams?: SP;
}) {
  const ctx = await getCreatorContext({ require: "edit_library" });
  if (!ctx.ok) redirect("/dashboard");
  const sp = searchParams ? await searchParams : {};
  const preselectedType = sp.type ?? null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin/library/new" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Pick a different type
      </a>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">Add from URL</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Paste a URL, click <strong>Fetch</strong>, review the auto-filled fields, hit save.
        </p>
      </header>
      <QuickAddForm preselectedType={preselectedType} />
    </div>
  );
}
