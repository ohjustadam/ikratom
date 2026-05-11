import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import { createClient } from "@/lib/supabase/server";
import { SourcesPanel } from "./SourcesPanel";
import { FindingsPanel } from "./FindingsPanel";

export const metadata = { title: "Admin · BoP Monitor" };
export const dynamic = "force-dynamic";

/**
 * /admin/bop-monitor — surface for triaging Board of Pharmacy
 * findings. Schema in migration 0085. Scraper engine in
 * scripts/lib/bop-engine.mjs (also called by daily cron).
 */
export default async function BopMonitorPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) redirect("/dashboard");

  const supabase = await createClient();

  const [{ data: sources }, { data: findings }] = await Promise.all([
    supabase
      .from("bop_sources")
      .select("*")
      .order("state", { ascending: true })
      .order("board_name", { ascending: true }),
    supabase
      .from("bop_findings")
      .select("*")
      .order("found_at", { ascending: false })
      .limit(200),
  ]);

  const direct = (findings ?? []).filter((f) => f.classified_relevance === "kratom_direct");
  const adjacent = (findings ?? []).filter((f) => f.classified_relevance === "kratom_adjacent");

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <a href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Admin
      </a>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">BoP Monitor</h1>
        <p className="mt-1 text-sm text-zinc-400">
          State Board of Pharmacy + adjacent agencies. Watches agendas, rule
          proposals, and news for kratom-related action — the
          <em> administrative</em> path to a ban that bypasses the legislature.
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          {sources?.length ?? 0} sources · {direct.length} kratom-direct ·{" "}
          {adjacent.length} adjacent findings (last 200)
        </p>
      </header>

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold">Sources</h2>
        <SourcesPanel sources={sources ?? []} />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">
          Recent findings <span className="text-xs text-zinc-500">(direct + adjacent)</span>
        </h2>
        <FindingsPanel findings={[...direct, ...adjacent].slice(0, 100)} />
      </section>
    </div>
  );
}
