import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import { getEmergencyConfig } from "@/modules/admin/emergency-actions";
import { EmergencyForm } from "./EmergencyForm";
import { ReadOnlyForm } from "./ReadOnlyForm";

export const metadata = { title: "Emergency mode" };

export default async function EmergencyPage() {
  const ctx = await getAdminContext({ require: "admin_emergency_mode" });
  if (!ctx.ok) redirect("/dashboard");
  const config = await getEmergencyConfig();

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Admin
      </a>
      <header className="mt-2 mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-red-400">
          Break-glass
        </p>
        <h1 className="mt-1 text-3xl font-bold">Emergency mode</h1>
        <p className="mt-3 text-sm text-zinc-400">
          A site-wide banner shown on every page. Use it for FDA action,
          DEA scheduling rumors, hostile federal bills dropping, or any
          situation where you need every advocate&apos;s attention <em>right now</em>.
        </p>
      </header>

      <div className="mb-6 rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-xs text-zinc-400">
        <p className="font-semibold text-zinc-200">Banner appears on:</p>
        <ul className="mt-1 list-inside list-disc">
          <li>Every public page (top of layout)</li>
          <li>Renders the title + body + CTA you set below</li>
          <li>Color matches severity (info=blue, urgent=amber, critical=red)</li>
        </ul>
        <p className="mt-3 font-semibold text-zinc-200">When you toggle ON:</p>
        <ul className="mt-1 list-inside list-disc">
          <li>Audit-logged with your account</li>
          <li>Banner appears within seconds (no redeploy)</li>
          <li>Toggle OFF to hide; settings are preserved for reuse</li>
        </ul>
      </div>

      <EmergencyForm initial={config} />

      <hr className="my-8 border-zinc-800" />

      <ReadOnlyForm initial={config} />
    </div>
  );
}
