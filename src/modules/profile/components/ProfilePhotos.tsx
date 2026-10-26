import { createClient } from "@/lib/supabase/server";
import { PhotoGrid, type GridPhoto } from "./PhotoGrid";

/**
 * The album section of a profile. get_profile_photos (0286) returns only the
 * photos THIS viewer may see; nothing renders when there are none, so an
 * empty-for-you album and a private album look the same.
 */
export async function ProfilePhotos({ ownerId, isSelf, signedIn }: { ownerId: string; isSelf: boolean; signedIn: boolean }) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_profile_photos", { p_owner: ownerId, p_limit: 30 });
  const photos = ((data ?? []) as (GridPhoto & { kind: string })[]).filter((p) => p.kind === "album");
  if (!photos.length && !isSelf) return null;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Photos</h2>
        {isSelf && <a href="/account/photos" className="text-xs font-semibold text-emerald-400 hover:underline">Manage photos</a>}
      </div>
      {photos.length ? (
        <PhotoGrid photos={photos} canReport={signedIn && !isSelf} />
      ) : (
        <a href="/account/photos" className="block rounded-xl border border-dashed border-zinc-700 p-5 text-sm text-zinc-400 hover:border-emerald-600">
          📷 Add photos to your album. You choose who sees each one.
        </a>
      )}
    </section>
  );
}
