import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listConversations } from "@/modules/dm/actions";
import { MessagesInbox } from "./MessagesInbox";

import Link from "next/link";
export const metadata = { title: "Messages" };

export default async function MessagesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/messages");

  const conversations = await listConversations();

  // My profile (so I can show my own state)
  const { data: me } = await supabase
    .from("profiles")
    .select("public_key")
    .eq("id", user.id)
    .single();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold">Messages</h1>
          <p className="mt-2 text-sm text-zinc-400">
            🔒 End-to-end encrypted. Only you and the other person can read these — not iKratom servers, not even us.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/messages/new-group"
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm hover:border-emerald-500"
          >
            + Group
          </Link>
          <Link
            href="/messages/new"
            className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
          >
            + New
          </Link>
        </div>
      </header>

      <MessagesInbox
        conversations={conversations}
        hasPublicKeyOnServer={!!me?.public_key}
      />
    </div>
  );
}
