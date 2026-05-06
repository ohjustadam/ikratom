import { redirect } from "next/navigation";
import { getCreatorContext } from "@/modules/admin/actions";
import { NewEventForm } from "./NewEventForm";

export const metadata = { title: "Add an event" };

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

export default async function NewEventPage() {
  const ctx = await getCreatorContext();
  if (!ctx.ok) redirect("/dashboard");

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Admin
      </a>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">Add a town hall / hearing</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Public events where advocates can show up. No free nationwide
          API covers these — admin-entered like local officials.
        </p>
      </header>

      <NewEventForm states={STATES} />
    </div>
  );
}
