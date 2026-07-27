import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import { listPartners } from "@/modules/partners/actions";

/**
 * /admin/partners — list of registered partner shops.
 *
 * Each row links to a print-ready kit page (the "USB asset"). Owner /
 * admin can also create new partners or delete existing ones from here.
 */
export const metadata = { title: "Partner shops" };

export default async function AdminPartnersPage() {
  const ctx = await getAdminContext({ require: "edit_partners" });
  if (!ctx.ok) redirect("/dashboard");

  const r = await listPartners();
  const partners = "ok" in r && r.rows ? r.rows : [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Admin
      </a>
      <header className="mt-2 mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold">Partner shops</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Local shops with co-branded counter materials. QR codes credit
            customer signups + actions back to the shop.
          </p>
        </div>
        <a
          href="/admin/partners/new"
          className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
        >
          + Add shop
        </a>
      </header>

      {partners.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-12 text-center text-sm text-zinc-500">
          No partner shops yet. Add your first to print a counter kit.
        </div>
      ) : (
        <ul className="space-y-2">
          {partners.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center gap-3 rounded-md border border-zinc-800 bg-zinc-950/40 p-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-zinc-100">{p.shop_name}</span>
                  <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                    /{p.slug}
                  </span>
                  {p.state && (
                    <span className="rounded bg-emerald-950/40 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
                      {p.state}
                    </span>
                  )}
                </div>
                {(p.city || p.tagline) && (
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {p.city}
                    {p.city && p.tagline ? " — " : ""}
                    {p.tagline}
                  </p>
                )}
              </div>
              <a
                href={`/admin/partners/${p.slug}/kit`}
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:border-emerald-500"
              >
                Print kit →
              </a>
              <a
                href={`/partners/${p.slug}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:border-emerald-500"
              >
                Public page ↗
              </a>
              <a
                href={`/admin/partners/${p.slug}/edit`}
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:border-zinc-500"
              >
                Edit
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
