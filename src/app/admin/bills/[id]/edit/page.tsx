import { notFound, redirect } from "next/navigation";
import { getCreatorContext } from "@/modules/admin/actions";
import { createClient } from "@/lib/supabase/server";
import { EditBillForm } from "./EditBillForm";

export const metadata = { title: "Edit bill (admin)" };
export const dynamic = "force-dynamic";

export default async function EditBillPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getCreatorContext();
  if (!ctx.ok) redirect("/dashboard");
  if (!ctx.isAdmin && !ctx.isOwner) redirect("/dashboard");

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const { data: bill } = await supabase
    .from("bills")
    .select("id, state, bill_number, title, summary, status, scope, locality, kratom_relevance, relevance_confidence, last_action, last_action_at, source_url, official_url, active")
    .eq("id", id)
    .single();
  if (!bill) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin/bills" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← All bills
      </a>
      <header className="mt-2 mb-6">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded bg-zinc-900 px-2 py-1 font-mono text-zinc-300">
            {bill.state} · {bill.bill_number}
          </span>
          {bill.scope && bill.scope !== "state" && (
            <span className="rounded bg-purple-950/40 px-2 py-1 capitalize text-purple-300">
              {bill.scope}
            </span>
          )}
          {bill.locality && (
            <span className="rounded bg-zinc-900 px-2 py-1 text-zinc-300">
              📍 {bill.locality}
            </span>
          )}
        </div>
        <h1 className="mt-3 text-2xl font-bold leading-tight">
          {bill.title || "(untitled)"}
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          Sensitive admin action — requires fresh 2FA. Most fields auto-sync
          from OpenStates / LegiScan; manual overrides here win until the next
          sync (which respects manual values for status when newer).
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <a
            href={`/bills/${bill.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-zinc-200 hover:border-emerald-500"
          >
            View public page ↗
          </a>
          {bill.source_url && (
            <a
              href={bill.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-zinc-200 hover:border-emerald-500"
            >
              Source ↗
            </a>
          )}
          {bill.official_url && (
            <a
              href={bill.official_url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-zinc-200 hover:border-emerald-500"
            >
              Official ↗
            </a>
          )}
        </div>
      </header>

      <EditBillForm
        bill={{
          id: bill.id,
          status: bill.status ?? "introduced",
          kratom_relevance: bill.kratom_relevance ?? "unknown",
          relevance_confidence: bill.relevance_confidence ?? 0.5,
          active: bill.active,
          title: bill.title ?? "",
          summary: bill.summary ?? "",
          last_action: bill.last_action ?? "",
          last_action_at: bill.last_action_at ?? "",
          source_url: bill.source_url ?? "",
        }}
      />
    </div>
  );
}
