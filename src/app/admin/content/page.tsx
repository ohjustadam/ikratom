import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import { listAllContent, CONTENT_CATALOG } from "@/lib/editable-content";

export const metadata = { title: "Edit site content" };
export const dynamic = "force-dynamic";

/**
 * /admin/content — list view of every editable copy slot.
 *
 * Designed to be usable from a phone. Each slot shows:
 *   - Key (so you can find it in code if needed)
 *   - Friendly label
 *   - Which page it appears on
 *   - Current value preview (first 200 chars)
 *   - "Edit" button → /admin/content/[key]
 *
 * Empty slots (not yet overridden) get a different visual treatment
 * so you can quickly see which sections still rely on code-defined
 * fallback copy.
 */
export default async function ContentListPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) redirect("/dashboard");

  const rows = await listAllContent();
  const rowsByKey = new Map(rows.map((r) => [r.key, r]));

  // Merge catalog + existing rows so admin sees every slot, even
  // empty ones.
  type ViewRow = {
    key: string;
    label: string;
    description: string;
    page: string;
    format: string;
    has_override: boolean;
    preview: string | null;
    updated_at: string | null;
  };
  const view: ViewRow[] = CONTENT_CATALOG.map((c) => {
    const r = rowsByKey.get(c.key);
    return {
      key: c.key,
      label: c.label,
      description: c.description,
      page: c.page,
      format: c.format,
      has_override: !!r,
      preview: r ? r.content_md.slice(0, 200) : null,
      updated_at: r?.updated_at ?? null,
    };
  });

  // Also surface ad-hoc rows that exist in DB but aren't in the
  // catalog (e.g. created via direct DB write or migration seed).
  const catalogKeys = new Set(CONTENT_CATALOG.map((c) => c.key));
  for (const r of rows) {
    if (catalogKeys.has(r.key)) continue;
    view.push({
      key: r.key,
      label: r.label ?? r.key,
      description: "(Ad-hoc key, not in catalog)",
      page: "—",
      format: r.format,
      has_override: true,
      preview: r.content_md.slice(0, 200),
      updated_at: r.updated_at,
    });
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <Link href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">← Admin</Link>
      <header className="mt-2 mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
          ◉ Site content
        </p>
        <h1 className="mt-2 text-3xl font-bold">Edit site copy</h1>
        <p className="mt-3 text-sm text-zinc-400">
          Override page text without a deploy. Edits go live within ~1 minute. Code-defined
          fallbacks remain in place if you delete a row.
        </p>
        <p className="mt-2 text-[11px] text-zinc-500">
          Signed in as <span className="font-mono text-zinc-300">{ctx.email}</span>.
          Every edit is audit-logged.
        </p>
      </header>

      <ul className="space-y-2">
        {view.map((v) => (
          <li key={v.key}>
            <Link
              href={`/admin/content/${encodeURIComponent(v.key)}`}
              className={`block rounded-lg border p-4 transition active:scale-[0.99] ${
                v.has_override
                  ? "border-emerald-700/40 bg-emerald-950/10 hover:border-emerald-500"
                  : "border-zinc-800 bg-zinc-950/40 hover:border-zinc-600"
              }`}
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-semibold text-zinc-100">{v.label}</span>
                <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                  {v.key}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">
                  {v.format}
                </span>
                {v.has_override ? (
                  <span className="ml-auto rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-zinc-950">
                    overridden
                  </span>
                ) : (
                  <span className="ml-auto text-[10px] text-zinc-500">using fallback</span>
                )}
              </div>
              <p className="mt-1 text-[11px] text-zinc-400">
                {v.description} <span className="text-zinc-600">· {v.page}</span>
              </p>
              {v.preview && (
                <p className="mt-2 line-clamp-2 text-[11px] text-zinc-300">
                  {v.preview.slice(0, 200)}{v.preview.length === 200 ? "…" : ""}
                </p>
              )}
              {v.updated_at && (
                <p className="mt-1 text-[10px] text-zinc-600">
                  Last edited {new Date(v.updated_at).toLocaleString()}
                </p>
              )}
            </Link>
          </li>
        ))}
      </ul>

      <p className="mt-6 rounded-md border border-zinc-800 bg-zinc-950/40 p-3 text-[11px] text-zinc-400">
        <strong className="text-zinc-200">How this works:</strong> Every editable slot has a code-defined fallback.
        Saving a row here overrides the fallback. Deleting a row reverts to the fallback.
        Edits cache for ~60 seconds platform-wide, then auto-invalidate.
      </p>
    </div>
  );
}
