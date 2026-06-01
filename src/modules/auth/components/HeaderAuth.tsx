import { getCachedAuthProfile } from "@/lib/supabase/server";
import { SignOutButton } from "./SignOutButton";
import { HeaderBell } from "@/modules/notifications/components/HeaderBell";
import { MessagesIcon } from "@/modules/dm/components/MessagesIcon";
import { HeaderAvatar } from "./HeaderAvatar";

export async function HeaderAuth() {
  // Request-cached: local JWT verify (getClaims) + a shared profile read,
  // deduped with the root layout. No auth-server round-trip.
  const { userId, profile } = await getCachedAuthProfile();

  if (!userId) {
    return (
      <a
        href="/login"
        className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-emerald-400"
      >
        Sign in
      </a>
    );
  }

  const isAdmin = !!(profile?.is_admin || profile?.is_owner);
  const isLeader = isAdmin || !!profile?.is_advocate_leader;

  return (
    <div className="flex items-center gap-3 text-sm">
      <MessagesIcon />
      <HeaderBell />
      <a href="/dashboard" className="hidden text-zinc-300 hover:text-emerald-400 lg:inline">
        Dashboard
      </a>
      {isLeader && (
        <a
          href={isAdmin ? "/admin" : "/leader"}
          className="rounded-md border border-emerald-700/50 px-2 py-1 text-emerald-300 hover:border-emerald-500"
        >
          {isAdmin ? "Admin" : "Leader"}
        </a>
      )}
      <HeaderAvatar
        username={profile?.username ?? null}
        avatarUrl={profile?.avatar_url ?? null}
        fullName={profile?.full_name ?? null}
      />
      <span className="hidden lg:inline">
        <SignOutButton />
      </span>
    </div>
  );
}
