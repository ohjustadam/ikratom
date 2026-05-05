import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getGroupDetails } from "@/modules/dm/group-actions";
import { GroupSettings } from "./GroupSettings";

export const metadata = { title: "Group settings" };

export default async function GroupSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?redirect=/messages/${id}/settings`);

  const details = await getGroupDetails(id);
  if (!details) notFound();
  if (!details.is_group) redirect(`/messages/${id}`);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 lg:px-8">
      <a
        href={`/messages/${id}`}
        className="text-xs text-zinc-500 hover:text-emerald-400"
      >
        ← Back to chat
      </a>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">Group settings</h1>
        <p className="mt-1 text-sm text-zinc-400">{details.name}</p>
      </header>
      <GroupSettings
        conversationId={id}
        myUserId={user.id}
        myRole={details.my_role ?? "member"}
        name={details.name ?? ""}
        description={details.description ?? ""}
        members={details.members}
      />
    </div>
  );
}
