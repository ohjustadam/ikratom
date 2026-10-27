import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { loadProfileView, profileHref } from "@/modules/profile/view";
import { ProfileHeader } from "@/modules/profile/components/ProfileHeader";
import { ProfileIntro } from "@/modules/profile/components/ProfileIntro";
import { ProfileThreads } from "@/modules/profile/components/ProfileThreads";
import { ProfileLockedCard } from "@/modules/profile/components/ProfileLockedCard";
import { ProfilePhotos } from "@/modules/profile/components/ProfilePhotos";
import { ProfileFriends } from "@/modules/connections/components/ProfileFriends";

/**
 * /profile/<uuid> or /profile/@handle — a member's profile, as THIS viewer may
 * see it. get_profile_view (0285) applies every privacy level in the database
 * and returns null sections for anything the viewer may not see; this page only
 * renders what came back. No row = not found (blocked, or hidden and not
 * discoverable), indistinguishable from a handle that never existed.
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const p = await loadProfileView(id);
  // Called here as well as in the page so the response is a real 404 (the
  // page body streams after the status is sent). Hidden and nonexistent
  // members still look identical.
  if (!p) notFound();
  // Title uses the public handle, never the real name. Only a profile its owner
  // made Public may be indexed.
  return {
    title: p?.username ? `@${p.username}` : "Profile",
    robots: p?.profile_audience === "public" ? undefined : { index: false, follow: false },
  };
}

export default async function PublicProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await loadProfileView(id);
  if (!p) notFound();

  const supabase = await createClient();
  const [{ data: { user } }, { data: isPowerUser }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.rpc("is_power_user", { p_id: p.id }),
  ]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
      <ProfileHeader p={p} isPowerUser={!!isPowerUser} signedIn={!!user} />

      {!p.profile_visible ? (
        <div className="mt-4">
          <ProfileLockedCard p={p} signedIn={!!user} next={profileHref(p)} />
        </div>
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="space-y-4">
            <ProfileIntro p={p} />
            {!!p.friend_count && <ProfileFriends ownerId={p.id} total={p.friend_count} />}
          </div>
          <div className="space-y-6">
            {p.story && (
              <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-5">
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-zinc-500">Advocacy story</h2>
                <p className="whitespace-pre-line text-sm leading-relaxed text-zinc-200">{p.story}</p>
              </section>
            )}
            <ProfilePhotos ownerId={p.id} isSelf={p.relationship === "self"} signedIn={!!user} />
            {p.activity_visible && <ProfileThreads authorId={p.id} />}
            {p.relationship === "self" && !p.bio && !p.story && (
              <a href="/account/profile" className="block rounded-xl border border-dashed border-emerald-700/50 p-5 text-sm text-emerald-300 hover:border-emerald-500">
                ✨ Your profile is empty. Add a bio, your advocacy story, interests and links →
              </a>
            )}
          </div>
        </div>
      )}

      <p className="mt-10 text-xs text-zinc-600">
        iKratom protects member privacy. Real names, email, address and phone are never shown to other members.
      </p>
    </div>
  );
}
