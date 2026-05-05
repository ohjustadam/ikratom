import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NewConversation } from "./NewConversation";

export const metadata = { title: "New message" };

export default async function NewMessagePage({
  searchParams,
}: {
  searchParams: Promise<{ to?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/messages/new");

  const { to } = await searchParams;

  // If ?to=<id> was passed (from a profile page "Send message" button),
  // look up that user's public profile so the form can pre-pick them.
  let prefilled: {
    id: string;
    full_name: string | null;
    email: string | null;
    state: string | null;
    public_key: string | null;
  } | null = null;

  if (to && /^[0-9a-f-]{36}$/i.test(to) && to !== user.id) {
    const { data } = await supabase.rpc("get_public_profile", { p_id: to });
    const p = data?.[0];
    if (p) {
      prefilled = {
        id: p.id,
        full_name: p.full_name,
        email: null,
        state: p.state,
        public_key: p.public_key,
      };
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/messages" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Messages
      </a>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">New conversation</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Search by name or email. Conversations are end-to-end encrypted — only you and the
          recipient can read them.
        </p>
      </header>
      <NewConversation myUserId={user.id} prefilled={prefilled} />
    </div>
  );
}
