import { createClient } from "@/lib/supabase/server";
import { publicHandle, handleInitials } from "@/lib/public-handle";
import { profileHref } from "@/modules/profile/view";

/**
 * A member's friends, as this viewer may see them. get_profile_friends (0287)
 * returns nothing unless the owner's friends_audience lets the viewer in, and
 * only lists friends whose own handle is discoverable. @handles only.
 */
export async function ProfileFriends({ ownerId, total }: { ownerId: string; total: number }) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_profile_friends", { p_owner: ownerId, p_limit: 12 });
  const friends = (data ?? []) as { id: string; username: string | null; avatar_url: string | null }[];
  if (friends.length === 0) return null;

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
        Friends <span className="text-zinc-600">· {total}</span>
      </h2>
      <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {friends.map((f) => {
          const handle = publicHandle(f);
          return (
            <li key={f.id} className="min-w-0">
              <a href={profileHref(f)} className="group flex flex-col items-center gap-1 text-center">
                {f.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- privacy route 302s to a signed URL
                  <img src={f.avatar_url} alt="" className="h-14 w-14 rounded-full bg-zinc-800 object-cover" />
                ) : (
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-800 text-sm font-bold text-zinc-300">
                    {handleInitials(handle)}
                  </span>
                )}
                <span className="w-full truncate text-xs text-zinc-400 group-hover:text-emerald-400">{handle}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
