import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import { listAllAnnouncements } from "@/modules/announcements/actions";
import { AnnouncementsPanel } from "./AnnouncementsPanel";

export const metadata = { title: "Announcements" };

export default async function AdminAnnouncementsPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) redirect("/dashboard");

  const r = await listAllAnnouncements();
  const rows = "ok" in r && r.rows ? r.rows : [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Admin
      </a>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">Announcements</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Posts that show up in the &ldquo;What&apos;s new&rdquo; widget on every user&apos;s dashboard
          until they dismiss them or until the expiry date.
        </p>
      </header>
      <AnnouncementsPanel initial={rows as Array<{
        id: string;
        title: string;
        body: string;
        cta_label: string | null;
        cta_href: string | null;
        tone: string;
        pinned: boolean;
        publish_at: string;
        expires_at: string | null;
      }>} />
    </div>
  );
}
