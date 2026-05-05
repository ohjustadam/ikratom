import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NewGroup } from "./NewGroup";

export const metadata = { title: "New group" };

export default async function NewGroupPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/messages/new-group");

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/messages" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Messages
      </a>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">New group</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Private group chat — end-to-end encrypted. Add members, give it a name, start
          coordinating. Up to 50 members.
        </p>
      </header>
      <NewGroup myUserId={user.id} />
    </div>
  );
}
