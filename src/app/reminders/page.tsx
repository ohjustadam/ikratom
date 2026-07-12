import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  listCustomReminders,
  cancelCustomReminder,
  deleteCustomReminder,
} from "@/modules/notifications/custom-reminders";
import { CustomReminderRow } from "./CustomReminderRow";

export const metadata = { title: "Your reminders" };
export const dynamic = "force-dynamic";

/**
 * /reminders — user-facing dashboard for custom reminders the user
 * has set. Three sections: upcoming (active), fired (history),
 * cancelled (soft-deleted).
 *
 * Each row has Cancel + Delete actions (server actions). The push
 * notification arrives via the existing fanout when remind_at < now.
 */
export default async function RemindersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/reminders");

  const reminders = await listCustomReminders();
  const now = Date.now();
  const upcoming = reminders.filter(r => !r.fired_at && !r.cancelled_at && new Date(r.remind_at).getTime() >= now);
  const overdueNotFired = reminders.filter(r => !r.fired_at && !r.cancelled_at && new Date(r.remind_at).getTime() < now);
  const fired = reminders.filter(r => r.fired_at);
  const cancelled = reminders.filter(r => r.cancelled_at);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">Your reminders</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Custom push reminders you've set on bills, meetings, campaigns, and legislators. Pending reminders fire to your phone via push notification at the time you set.
        </p>
      </header>

      {reminders.length === 0 && (
        <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-6 text-sm text-zinc-400">
          <p>No reminders yet.</p>
          <p className="mt-2">
            Open a <Link href="/bills" className="text-emerald-400 underline">bill</Link>
            {" "}or <Link href="/calendar" className="text-emerald-400 underline">meeting</Link> and click 🔔 Remind me to set one.
          </p>
        </div>
      )}

      {overdueNotFired.length > 0 && (
        <Section title="⏳ Pending (firing soon)" tone="amber">
          {overdueNotFired.map((r) => (
            <CustomReminderRow key={r.id} reminder={r} state="overdue" cancelAction={cancelCustomReminder} deleteAction={deleteCustomReminder} />
          ))}
        </Section>
      )}

      {upcoming.length > 0 && (
        <Section title={`Upcoming (${upcoming.length})`} tone="emerald">
          {upcoming.map((r) => (
            <CustomReminderRow key={r.id} reminder={r} state="upcoming" cancelAction={cancelCustomReminder} deleteAction={deleteCustomReminder} />
          ))}
        </Section>
      )}

      {fired.length > 0 && (
        <Section title={`Fired (${fired.length})`} tone="zinc">
          {fired.map((r) => (
            <CustomReminderRow key={r.id} reminder={r} state="fired" cancelAction={cancelCustomReminder} deleteAction={deleteCustomReminder} />
          ))}
        </Section>
      )}

      {cancelled.length > 0 && (
        <Section title={`Cancelled (${cancelled.length})`} tone="zinc">
          {cancelled.map((r) => (
            <CustomReminderRow key={r.id} reminder={r} state="cancelled" cancelAction={cancelCustomReminder} deleteAction={deleteCustomReminder} />
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, tone, children }: { title: string; tone: "amber" | "emerald" | "zinc"; children: React.ReactNode }) {
  const cls = tone === "amber"
    ? "border-amber-700/40 bg-amber-950/15"
    : tone === "emerald"
    ? "border-emerald-700/30 bg-emerald-950/10"
    : "border-zinc-800 bg-zinc-950/40";
  return (
    <section className={`mb-6 rounded-lg border p-4 ${cls}`}>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-300">{title}</h2>
      <ul className="space-y-2">{children}</ul>
    </section>
  );
}
