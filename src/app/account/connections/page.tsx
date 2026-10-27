import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ConnectionRow, type MyConnection } from "@/modules/connections/components/ConnectionRow";

export const metadata = { title: "Friends" };
export const dynamic = "force-dynamic";

/**
 * /account/connections — requests waiting for you, requests you sent, and your
 * friends. get_my_connections (0287) only ever returns YOUR graph, with
 * @handles; blocked pairs never appear (blocking deletes the connection).
 */
export default async function ConnectionsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/account/connections");

  const { data } = await supabase.rpc("get_my_connections");
  const all = (data ?? []) as MyConnection[];
  const incoming = all.filter((c) => c.status === "pending" && c.direction === "in");
  const sent = all.filter((c) => c.status === "pending" && c.direction === "out");
  const friends = all.filter((c) => c.status === "accepted");

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <a href="/account" className="text-xs text-zinc-500 hover:text-emerald-400">← Account</a>
      <header className="mt-2 mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">Friends</p>
        <h1 className="mt-1 text-2xl font-bold">Your connections</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Friends see what you share with <strong>Friends</strong> in your{" "}
          <a href="/account/privacy" className="text-emerald-400 hover:underline">privacy settings</a>. Everyone appears by @username only.
        </p>
      </header>

      <Section title="Requests for you" empty="No requests right now." items={incoming} />
      <Section title="Requests you sent" empty="You haven't sent any requests." items={sent} />
      <Section
        title={`Friends · ${friends.length}`}
        empty="No friends yet. Open a member's profile and tap Connect."
        items={friends}
      />
    </div>
  );
}

function Section({ title, empty, items }: { title: string; empty: string; items: MyConnection[] }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-zinc-500">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((c) => <ConnectionRow key={c.other_id} c={c} />)}
        </ul>
      )}
    </section>
  );
}
