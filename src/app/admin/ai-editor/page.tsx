import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import { siteConfig } from "@/config/site.config";
import { AdminEditorUI } from "./AdminEditorUI";

export const metadata = { title: "AI Editor-in-Chief" };

/**
 * /admin/ai-editor — conversational ops copilot. Owner-gated by the
 * `adminAiChief` feature flag (flip in site.config.ts to enable) + admin auth.
 */
export default async function AdminAiEditorPage() {
  const ctx = await getAdminContext({ require: "use_ai_editor" });
  if (!ctx.ok) redirect("/dashboard");
  if (!siteConfig.features.adminAiChief) redirect("/admin");

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Admin
      </a>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">AI Editor-in-Chief</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Your free, in-house ops copilot. Ask what&apos;s broken, what&apos;s pending, or what to do —
          it reads the live site status and can look up bills, campaigns, officials, queues, and cron
          health on its own. It proposes actions (moderation, data fixes, syncs) and nothing runs until
          you confirm; every action is audit-logged. It can&apos;t change code or deploy — for that,
          open a coding session.
        </p>
      </header>
      <AdminEditorUI />
    </div>
  );
}
