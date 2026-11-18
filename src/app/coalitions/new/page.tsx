import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CreateCoalitionForm } from "./CreateCoalitionForm";

export const metadata = {
  title: "Start a group",
};
export const dynamic = "force-dynamic";

export default async function NewCoalitionPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login?redirect=/coalitions/new");

  // Pull user's state to pre-fill the optional state scope.
  const { data: profile } = await sb
    .from("profiles")
    .select("state")
    .eq("id", user.id)
    .maybeSingle();
  const defaultState = (profile as { state: string | null } | null)?.state ?? "";

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="text-xs">
        <Link href="/coalitions" className="text-zinc-500 hover:text-emerald-400">
          ← Groups
        </Link>
      </div>
      <header className="mb-6 mt-2">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
          ◉ New group
        </p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Start a group</h1>
        <p className="mt-3 max-w-xl text-sm text-zinc-400">
          A group is a named team of advocates. You become the organizer and can invite
          people with one link. Private by default: only members can see who&apos;s in it.
        </p>
      </header>

      <CreateCoalitionForm defaultState={defaultState} />
    </div>
  );
}
