import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "./SignOutButton";
import { HeaderBell } from "@/modules/notifications/components/HeaderBell";
import { MessagesIcon } from "@/modules/dm/components/MessagesIcon";

export async function HeaderAuth() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <a
        href="/login"
        className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-emerald-400"
      >
        Sign in
      </a>
    );
  }

  // Check role — cheap single-row read
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, is_owner, is_advocate_leader")
    .eq("id", user.id)
    .single();
  const isAdmin = !!(profile?.is_admin || profile?.is_owner);
  const isLeader = isAdmin || !!profile?.is_advocate_leader;

  return (
    <div className="flex items-center gap-4 text-sm">
      <MessagesIcon />
      <HeaderBell />
      <a href="/dashboard" className="text-zinc-300 hover:text-emerald-400">
        Dashboard
      </a>
      <a href="/account" className="text-zinc-300 hover:text-emerald-400">
        Account
      </a>
      {isLeader && (
        <a
          href="/admin"
          className="rounded-md border border-emerald-700/50 px-2 py-1 text-emerald-300 hover:border-emerald-500"
        >
          {isAdmin ? "Admin" : "Leader"}
        </a>
      )}
      <SignOutButton />
    </div>
  );
}
