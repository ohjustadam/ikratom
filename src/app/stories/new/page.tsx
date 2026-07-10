import { createClient } from "@/lib/supabase/server";
import { NewStoryForm } from "./NewStoryForm";

export const metadata = { title: "Share your story" };

export default async function NewStoryPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Anonymous visitors see the form — the in-page sign-in modal
  // (SignInProvider in layout.tsx) opens on submit, then the post fires.
  const profile = user
    ? (await supabase
        .from("profiles")
        .select("username, state")
        .eq("id", user.id)
        .single()).data
    : null;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/stories" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Story bank
      </a>
      <header className="mt-2 mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          Your voice matters
        </p>
        <h1 className="mt-1 text-3xl font-bold">Share your kratom story</h1>
        <p className="mt-3 text-sm text-zinc-400">
          A paragraph from someone whose life kratom has touched is the most
          persuasive thing legislators read. Share what kratom does for you,
          how it found you, what would change if it became illegal. Be specific.
          Be honest. We&apos;ll review before posting.
        </p>
      </header>

      <div className="mb-5 rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-xs text-zinc-400">
        <p className="font-semibold text-zinc-200">What we approve:</p>
        <ul className="mt-1 list-inside list-disc">
          <li>First-person experience (yours or someone you know with consent)</li>
          <li>Specific, factual — &quot;I cut my opioid dose by 60%&quot; over &quot;it&apos;s great&quot;</li>
          <li>Whatever tone fits — calm, urgent, grateful, angry, all welcome</li>
        </ul>
        <p className="mt-3 font-semibold text-zinc-200">What we don&apos;t approve:</p>
        <ul className="mt-1 list-inside list-disc">
          <li>Medical claims that present kratom as a cure or treatment</li>
          <li>Personal attacks on legislators, family members, or other advocates</li>
          <li>Vendor promotion / sales — DM us if you have a shop story angle</li>
        </ul>
      </div>

      <NewStoryForm
        defaultName={(() => {
          // Anonymity-by-default (audit #6): the public byline defaults to the
          // user's @username, NEVER their legal name. They can type a real name
          // only by explicitly overriding this field (labeled "shown publicly").
          const u = (profile as { username: string | null } | null)?.username;
          return u ? `@${u}` : "";
        })()}
        defaultState={(profile as { state: string | null } | null)?.state ?? ""}
      />
    </div>
  );
}
