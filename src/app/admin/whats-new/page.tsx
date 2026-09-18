import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import { listPatchNotesForAdmin } from "@/modules/admin/patch-note-actions";
import PatchNoteEditor from "./PatchNoteEditor";

export const metadata = { title: "Changelog — publish patch notes" };
export const dynamic = "force-dynamic";

/**
 * /admin/whats-new — review and publish the public changelog.
 *
 * Replaces the old flow, which was: a bot opens a PR containing a markdown
 * file, you read the diff on GitHub, you squash-merge, Netlify builds. That
 * merge was a 15-credit production build, so the cheapest thing to do with a
 * draft was nothing — and seven of them queued up unmerged while /whats-new
 * went stale.
 *
 * Now the same draft is a row. Reading it, fixing the copy and pressing
 * Publish costs nothing and takes effect on the next request.
 */
export default async function AdminWhatsNewPage() {
  const ctx = await getAdminContext({ require: "edit_site_content" });
  if (!ctx.ok) redirect("/dashboard");

  const res = await listPatchNotesForAdmin();
  const rows = "ok" in res ? res.rows : [];
  const drafts = rows.filter((r) => r.status === "draft");

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Changelog</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          The daily job drafts a note from the last 24 hours of commits. Nothing
          here is public until you press Publish. Publishing is free — it does
          not deploy the site.
        </p>
        {drafts.length > 0 && (
          <p className="mt-3 rounded border border-amber-600/40 bg-amber-950/20 px-3 py-2 text-sm text-amber-300">
            {drafts.length} draft{drafts.length === 1 ? "" : "s"} waiting for review.
          </p>
        )}
      </header>

      {"error" in res && (
        <p className="rounded border border-red-900 bg-red-950/30 p-4 text-sm text-red-300">
          {res.error}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="rounded-md border border-zinc-800 bg-zinc-950/40 p-8 text-center text-sm text-zinc-500">
          No notes yet. The next weekday run of the patch-note job will put a
          draft here.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((n) => (
            <PatchNoteEditor key={n.slug} note={n} />
          ))}
        </ul>
      )}

      <p className="mt-8 text-xs text-zinc-500">
        Notes published before 2026-09-17 are markdown files in the repo and
        still render on the public page; they do not appear in this list.
      </p>
    </div>
  );
}
