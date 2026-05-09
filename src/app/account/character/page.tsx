import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CharacterForm } from "./CharacterForm";

export const metadata = { title: "Your character" };
export const dynamic = "force-dynamic";

/**
 * /account/character — the optional profile fields that aren't part
 * of the basic signup. Treats the user as a video-game character
 * being filled out: more they share, more the platform tailors.
 *
 * Privacy posture documented inline on the form. Sensitive fields
 * (story, lose_if_banned) are NEVER exposed via the public profile
 * RPC (migration 0075 enforces this server-side).
 */
export default async function CharacterPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/account/character");

  const { data: profile } = await supabase
    .from("profiles")
    .select("kratom_story, kratom_years, advocate_type, lose_if_banned, video_url, video_provider, profile_visibility, full_name, username")
    .eq("id", user.id)
    .single();

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/account" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Account
      </a>
      <header className="mt-2 mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          Your character
        </p>
        <h1 className="mt-2 text-3xl font-bold">The story behind your advocacy</h1>
        <p className="mt-3 text-sm text-zinc-400">
          Optional fields the platform uses to tailor emails, surface relevant
          campaigns, and make your legislator letters land harder. The more you
          share, the more iKratom can write in your authentic voice instead of
          stock template language.
        </p>
      </header>

      <div className="mb-6 rounded-md border border-emerald-700/40 bg-emerald-950/10 p-4 text-xs text-zinc-300">
        <p className="font-semibold text-emerald-300">🔒 What stays private</p>
        <ul className="mt-2 list-inside list-disc space-y-1 text-zinc-400">
          <li>Your story, your &ldquo;what&apos;s at stake&rdquo;, address, and contact info are <strong>never shown publicly</strong>. They only feed the AI tailoring layer when you send a campaign.</li>
          <li>Username + first name + state are public (visible on forum posts, story bylines, etc.).</li>
          <li>You can switch your whole profile to <strong>recruiters-only</strong> or <strong>private</strong> at the bottom — useful for shop owners and medical pros who want to participate without their participation being visible.</li>
        </ul>
      </div>

      <CharacterForm
        initial={{
          kratom_story: (profile as { kratom_story?: string | null } | null)?.kratom_story ?? "",
          kratom_years: (profile as { kratom_years?: number | null } | null)?.kratom_years ?? null,
          advocate_type: (profile as { advocate_type?: string | null } | null)?.advocate_type ?? "",
          lose_if_banned: (profile as { lose_if_banned?: string | null } | null)?.lose_if_banned ?? "",
          video_url: (profile as { video_url?: string | null } | null)?.video_url ?? "",
          profile_visibility: (profile as { profile_visibility?: string } | null)?.profile_visibility ?? "public",
        }}
      />
    </div>
  );
}
