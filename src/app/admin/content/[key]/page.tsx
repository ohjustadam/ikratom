import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import { CONTENT_CATALOG } from "@/lib/editable-content";
import { getContentHistory } from "@/modules/admin/content-actions";
import { createClient } from "@/lib/supabase/server";
import { ContentEditor } from "./ContentEditor";

export const metadata = { title: "Edit content" };
export const dynamic = "force-dynamic";

type Params = Promise<{ key: string }>;

export default async function EditContentPage({ params }: { params: Params }) {
  const { key: rawKey } = await params;
  const key = decodeURIComponent(rawKey);

  const ctx = await getAdminContext();
  if (!ctx.ok) redirect("/dashboard");

  // Look up catalog metadata (if known) + current DB row.
  const catalogEntry = CONTENT_CATALOG.find((c) => c.key === key);
  const sb = await createClient();
  const { data } = await sb
    .from("editable_content")
    .select("key, content_md, format, label, updated_at, updated_by")
    .eq("key", key)
    .maybeSingle();
  const existing = data as { key: string; content_md: string; format: "markdown" | "plain"; label: string | null; updated_at: string; updated_by: string | null } | null;

  const initialFormat: "markdown" | "plain" =
    existing?.format ?? catalogEntry?.format ?? "markdown";
  const initialContent = existing?.content_md ?? "";
  const initialLabel = existing?.label ?? catalogEntry?.label ?? null;

  const history = await getContentHistory(key, 8);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <Link href="/admin/content" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← All editable content
      </Link>

      <header className="mt-2 mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
          ◉ Edit
        </p>
        <h1 className="mt-2 text-2xl font-bold sm:text-3xl">
          {catalogEntry?.label ?? key}
        </h1>
        {catalogEntry && (
          <p className="mt-2 text-sm text-zinc-400">{catalogEntry.description}</p>
        )}
        <div className="mt-2 flex flex-wrap items-baseline gap-x-2 text-[11px] text-zinc-500">
          <span className="font-mono">{key}</span>
          {catalogEntry && <span>· appears on <strong className="text-zinc-300">{catalogEntry.page}</strong></span>}
          <span>· format: {initialFormat}</span>
        </div>
      </header>

      <ContentEditor
        contentKey={key}
        initialContent={initialContent}
        initialFormat={initialFormat}
        initialLabel={initialLabel}
        hasOverride={!!existing}
      />

      {history.length > 0 && (
        <section className="mt-8 rounded-md border border-zinc-800 bg-zinc-950/40 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
            Recent edits ({history.length})
          </h2>
          <p className="mt-1 text-[10px] text-zinc-500">
            Each row captures the value BEFORE that edit. Copy any version and re-save to roll back.
          </p>
          <ul className="mt-2 space-y-2 text-[11px]">
            {history.map((h) => (
              <li key={h.id} className="rounded border border-zinc-800 bg-zinc-950/60 p-2">
                <p className="text-[10px] text-zinc-500">
                  {new Date(h.changed_at).toLocaleString()}
                </p>
                <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-[11px] text-zinc-300">
                  {h.content_md.slice(0, 1000)}{h.content_md.length > 1000 ? "…" : ""}
                </pre>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
