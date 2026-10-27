import { publicHandle, handleInitials } from "@/lib/public-handle";
import { profileHref } from "@/modules/profile/view";
import { BlockButton } from "@/modules/profile/components/BlockButton";
import { ConnectButton, type ConnectionState } from "./ConnectButton";

export type MyConnection = {
  other_id: string;
  username: string | null;
  avatar_url: string | null;
  status: "pending" | "accepted";
  direction: "in" | "out";
  created_at: string;
};

export function connectionState(c: Pick<MyConnection, "status" | "direction">): ConnectionState {
  if (c.status === "accepted") return "friends";
  return c.direction === "out" ? "pending_out" : "pending_in";
}

/** One member in your connections list: avatar, @handle, the right buttons. */
export function ConnectionRow({ c }: { c: MyConnection }) {
  const handle = publicHandle({ username: c.username });
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <a href={profileHref({ id: c.other_id, username: c.username })} className="flex min-w-0 flex-1 items-center gap-3 hover:text-emerald-400">
        {c.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- privacy route 302s to a signed URL
          <img src={c.avatar_url} alt="" className="h-10 w-10 shrink-0 rounded-full bg-zinc-800 object-cover" />
        ) : (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-bold text-zinc-300">
            {handleInitials(handle)}
          </span>
        )}
        <span className="truncate text-sm font-semibold">{handle}</span>
      </a>
      <ConnectButton userId={c.other_id} handle={handle} state={connectionState(c)} />
      <BlockButton userId={c.other_id} handle={handle} />
    </li>
  );
}
