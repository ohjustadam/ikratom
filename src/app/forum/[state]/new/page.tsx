import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NewThreadForm } from "./NewThreadForm";

export const metadata = { title: "New thread" };

export default async function NewThreadPage({
  params,
}: {
  params: Promise<{ state: string }>;
}) {
  const { state: raw } = await params;
  const abbr = raw.toUpperCase();
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?redirect=/forum/${abbr}/new`);

  const { data: stateRow } = await supabase
    .from("states")
    .select("abbr, name")
    .eq("abbr", abbr)
    .single();
  if (!stateRow) notFound();

  const { data: prof } = await supabase
    .from("profiles")
    .select("state")
    .eq("id", user.id)
    .single();

  const userIsLocal = prof?.state === abbr;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 lg:px-8">
      <a
        href={`/forum/${abbr}`}
        className="text-xs text-zinc-500 hover:text-emerald-400"
      >
        ← {stateRow.name} forum
      </a>
      <header className="mt-2 mb-8">
        <h1 className="text-3xl font-bold">New thread in {stateRow.name}</h1>
        {!userIsLocal && (
          <p className="mt-2 rounded-md border border-purple-900/40 bg-purple-950/20 p-3 text-xs text-purple-200">
            You&apos;re posting in {stateRow.name} from{" "}
            <strong>{prof?.state ?? "out of state"}</strong>. Your thread will show a
            &ldquo;From {prof?.state ?? "out of state"}&rdquo; badge to be transparent
            with locals about who&apos;s starting the conversation.
          </p>
        )}
      </header>
      <NewThreadForm state={abbr} userIsLocal={userIsLocal} />
    </div>
  );
}
