import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import { SqlPanel } from "./SqlPanel";
import { CronTriggerPanel } from "./CronTriggerPanel";
import { CachePanel } from "./CachePanel";

export const metadata = { title: "Admin console" };
export const dynamic = "force-dynamic";

/**
 * /admin/console — the "nuclear option" admin surface.
 *
 * Three panels, each independently dangerous:
 *
 *   1. SQL console — run arbitrary single-statement SQL via the
 *      admin_exec_sql RPC (migration 0160). Reads are owner+admin,
 *      writes are owner-only and require an explicit confirm.
 *      Blocklist on DROP/TRUNCATE/auth.* mutations. Every query is
 *      audit-logged.
 *
 *   2. Manual cron trigger — fire a /api/cron/* endpoint with the
 *      CRON_SECRET server-side. Useful when an automation is silent
 *      and you don't want to wait for the next scheduled tick.
 *
 *   3. Cache invalidation — flush named cache tags (currently:
 *      editable-content) or revalidate specific paths. Use after
 *      manual DB edits so the site picks up the change immediately
 *      instead of waiting for natural TTL.
 *
 * Open from any device with admin/owner cookies — no IDE, no git,
 * no Claude required.
 */
export default async function ConsolePage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) redirect("/dashboard");

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <Link href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">← Admin</Link>
      <header className="mt-2 mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-400">
          ◉ Console
        </p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Admin console</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          The nuclear option. Direct SQL, manual cron triggers, cache invalidation. Every action
          is audit-logged. Use when no other admin page can fix what&apos;s broken — typically from
          a phone in another time zone.
        </p>
        <p className="mt-2 text-[11px] text-zinc-500">
          Signed in as <span className="font-mono text-zinc-300">{ctx.email}</span> ·
          role: <span className="font-mono text-zinc-300">{ctx.isOwner ? "owner" : "admin"}</span>
        </p>
      </header>

      <section className="mb-8 rounded-md border border-red-700/30 bg-red-950/10 p-3 text-[11px] text-red-200">
        <strong>Read these before using SQL writes:</strong>
        <ul className="ml-4 mt-1 list-disc space-y-1">
          <li>Mutations require <code className="bg-zinc-900 px-1">owner</code> role + confirm dialog.</li>
          <li>DROP / TRUNCATE / auth.* writes are hard-blocked.</li>
          <li>Every query (read or write) is logged to <code className="bg-zinc-900 px-1">admin_audit_log</code>.</li>
          <li>Multi-statement queries are refused — run one statement at a time.</li>
        </ul>
      </section>

      <SqlPanel isOwner={ctx.isOwner} />

      <hr className="my-8 border-zinc-800" />

      <CronTriggerPanel isOwner={ctx.isOwner} />

      <hr className="my-8 border-zinc-800" />

      <CachePanel />
    </div>
  );
}
