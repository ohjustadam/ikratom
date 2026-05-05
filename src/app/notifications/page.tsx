import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listNotifications } from "@/modules/notifications/actions";
import { NotificationList } from "./NotificationList";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/notifications");

  const items = await listNotifications(100);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">Notifications</h1>
        <p className="mt-2 text-sm text-zinc-400">
          New campaigns, bill status changes, and alerts in your area.{" "}
          <a href="/account" className="text-emerald-400 hover:underline">
            Manage preferences →
          </a>
        </p>
      </header>

      <NotificationList items={items} />
    </div>
  );
}
