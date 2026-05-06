import { redirect } from "next/navigation";
import { getCreatorContext } from "@/modules/admin/actions";
import { createClient } from "@/lib/supabase/server";
import { moderationQueueCount } from "@/modules/forum/actions";

export const metadata = { title: "Admin" };

export default async function AdminPage() {
  const ctx = await getCreatorContext();
  if (!ctx.ok) redirect("/dashboard");
  const adminOnly = ctx.isAdmin || ctx.isOwner;

  const supabase = await createClient();
  const [
    { count: userCount },
    { count: campaignCount },
    { count: legislatorCount },
    { count: billCount },
    { count: actionCount },
    queueCount,
  ] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("campaigns").select("id", { count: "exact", head: true }),
    supabase.from("legislators").select("id", { count: "exact", head: true }),
    supabase.from("bills").select("id", { count: "exact", head: true }),
    supabase.from("campaign_actions").select("id", { count: "exact", head: true }),
    moderationQueueCount(),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          {ctx.isOwner ? "Owner" : ctx.isAdmin ? "Admin" : "Advocate Leader"}
        </p>
        <h1 className="mt-2 text-3xl font-bold">{adminOnly ? "Control room" : "Leader workshop"}</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Signed in as <span className="font-mono text-zinc-200">{ctx.email}</span>
        </p>
      </header>

      <section className="mb-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Users" value={userCount} />
        <Stat label="Campaigns" value={campaignCount} />
        <Stat label="Legislators" value={legislatorCount} />
        <Stat label="Bills" value={billCount} />
        <Stat label="Actions sent" value={actionCount} />
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <AdminCard
          href="/admin/campaigns"
          title="Campaigns"
          body="Create, edit, archive call-to-action campaigns."
          accent
        />
        <AdminCard
          href="/admin/locals"
          title="Local officials"
          body="Add city + county officials for local campaigns."
        />
        {adminOnly && (
          <AdminCard
            href="/admin/users"
            title="Users"
            body="Manage admins, advocate leaders, ownership."
          />
        )}
        {adminOnly && (
          <AdminCard
            href="/admin/legislators"
            title="State + federal sync"
            body="Trigger OpenStates / Congress sync, see counts."
          />
        )}
        {adminOnly && (
          <AdminCard
            href="/admin/bills/new"
            title="Add a bill (manual)"
            body="For county / municipal bills OpenStates doesn't track. State + federal auto-sync daily."
          />
        )}
        <AdminCard
          href="/admin/forum"
          title={queueCount > 0 ? `Forum moderation (${queueCount})` : "Forum moderation"}
          body="Review flagged posts + threads. New-account posts and links are auto-flagged."
          accent={queueCount > 0}
        />
        {adminOnly && (
          <AdminCard
            href="/admin/audit"
            title="Audit log"
            body="Sensitive actions, role changes, sync history."
          />
        )}
        {adminOnly && (
          <AdminCard
            href="/admin/events/new"
            title="Town halls + hearings"
            body="Add upcoming public events where advocates can show up."
          />
        )}
        {adminOnly && (
          <AdminCard
            href="/admin/stories"
            title="Story moderation"
            body="Review user-submitted advocacy stories before they go public."
          />
        )}
        {adminOnly && (
          <AdminCard
            href="/admin/emergency"
            title="🚨 Emergency mode"
            body="Site-wide red banner. Use for FDA action, hostile federal bills, scheduling rumors."
          />
        )}
      </section>

      <p className="mt-8 text-xs text-zinc-500">
        Admin tools are scaffolded but not yet implemented. Each card lights up as the
        underlying feature ships.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="text-xs uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-zinc-100">{value ?? "—"}</div>
    </div>
  );
}

function AdminCard({
  href, title, body, disabled, accent,
}: { href: string; title: string; body: string; disabled?: boolean; accent?: boolean }) {
  const cls = disabled
    ? "border-zinc-900 bg-zinc-950/40 opacity-50 cursor-not-allowed"
    : accent
    ? "border-emerald-700/50 bg-emerald-950/20 hover:border-emerald-500"
    : "border-zinc-800 bg-zinc-950/40 hover:border-emerald-500";
  const content = (
    <>
      <h3 className={`text-base font-semibold ${accent ? "text-emerald-300" : ""}`}>{title}</h3>
      <p className="mt-1 text-sm text-zinc-400">{body}</p>
      {disabled && <p className="mt-2 text-xs text-zinc-600">Coming soon</p>}
    </>
  );
  if (disabled) return <div className={`block rounded-lg border p-5 transition ${cls}`}>{content}</div>;
  return <a href={href} className={`block rounded-lg border p-5 transition ${cls}`}>{content}</a>;
}
