import { publicHandle, handleInitials } from "@/lib/public-handle";
import { PowerUserBadge } from "@/components/PowerUserBadge";
import { AUDIENCE_ICON, AUDIENCE_LABEL } from "../audience";
import type { ProfileView } from "../view";
import { PhotoUploadButton } from "./PhotoUploadButton";

/**
 * Cover band + avatar + @handle + role badges + the viewer's actions.
 * Identity is publicHandle() only — never a real name (standing rule 1).
 */
export function ProfileHeader({ p, isPowerUser }: { p: ProfileView; isPowerUser: boolean }) {
  const handle = publicHandle(p);
  const badges: { label: string; cls: string }[] = [];
  if (p.is_admin) badges.push({ label: "Admin", cls: "bg-emerald-950/40 text-emerald-300" });
  else if (p.is_advocate_leader) badges.push({ label: "Advocate Leader", cls: "bg-emerald-950/40 text-emerald-300" });

  const self = p.relationship === "self";

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/40">
      <div className="relative h-28 bg-gradient-to-br from-emerald-900/60 via-zinc-900 to-zinc-950 sm:h-48">
        {p.cover_url && (
          // eslint-disable-next-line @next/next/no-img-element -- privacy route 302s to a signed URL
          <img src={p.cover_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
        )}
        {self && (
          <div className="absolute right-3 top-3">
            <PhotoUploadButton kind="cover" label={p.cover_url ? "Change cover" : "Add cover photo"} />
          </div>
        )}
      </div>
      <div className="px-4 pb-5 sm:px-6">
        <div className="-mt-10 flex flex-wrap items-end gap-4 sm:-mt-12">
          <div className="relative shrink-0">
            {p.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- privacy route
              <img src={p.avatar_url} alt={`${handle} profile photo`} className="h-20 w-20 rounded-full border-4 border-zinc-950 bg-zinc-800 object-cover sm:h-24 sm:w-24" />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-zinc-950 bg-zinc-800 text-2xl font-bold text-zinc-200 sm:h-24 sm:w-24">
                {handleInitials(handle)}
              </div>
            )}
            {self && (
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2">
                <PhotoUploadButton kind="avatar" label="📷" className="rounded-full border border-zinc-600 bg-zinc-900 px-2 py-1 text-xs hover:border-emerald-500" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1 pb-1">
            <h1 className="flex flex-wrap items-center gap-2 break-all text-2xl font-bold">
              {handle}
              {isPowerUser && <PowerUserBadge size="md" />}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              {p.state && <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-zinc-300">{p.state}</span>}
              {p.friend_count !== null && <span>{p.friend_count} {p.friend_count === 1 ? "friend" : "friends"}</span>}
              {p.relationship === "friends" && <span className="text-emerald-400">✓ Friends</span>}
              {badges.map((b) => (
                <span key={b.label} className={`rounded px-2 py-0.5 font-semibold ${b.cls}`}>{b.label}</span>
              ))}
            </div>
          </div>
          <HeaderActions p={p} />
        </div>
        {p.relationship === "self" && p.profile_audience && (
          <p className="mt-3 text-xs text-zinc-500">
            {AUDIENCE_ICON[p.profile_audience]} Your profile is visible to: <strong className="text-zinc-300">{AUDIENCE_LABEL[p.profile_audience]}</strong>
          </p>
        )}
      </div>
    </div>
  );
}

function HeaderActions({ p }: { p: ProfileView }) {
  if (p.relationship === "self") {
    return (
      <div className="flex gap-2">
        <a href="/account/profile" className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400">Edit profile</a>
        <a href="/account/profile#privacy" className="rounded-md border border-zinc-700 px-3 py-2 text-sm hover:border-emerald-500">Privacy</a>
      </div>
    );
  }
  if (!p.can_message) return null;
  return (
    <a href={`/messages/new?to=${p.id}`} className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400">
      Message
    </a>
  );
}
