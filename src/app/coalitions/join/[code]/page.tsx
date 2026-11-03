import Link from "@/components/Link";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { JoinClient } from "./JoinClient";

export const metadata = {
  title: "Join a group",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

type Params = Promise<{ code: string }>;
type Search = Promise<{ via?: string; auto?: string }>;

const CODE_RE = /^[A-Za-z0-9_-]{8,32}$/;

/**
 * /coalitions/join/[code]: where a group link or QR code lands.
 *
 * A valid, unexpired code shows the group's name and size: whoever holds the
 * code was meant to see it. An invalid code shows nothing about any group.
 * Visitors without an account are offered "Create a free account" first,
 * since most people scanning a QR are new; signup remembers the invite
 * (src/lib/pending-join.ts) so confirming the email lands them here with
 * ?auto=1, which joins at once.
 */
export default async function JoinPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { code } = await params;
  const { via, auto } = await searchParams;
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();

  const group = CODE_RE.test(code) ? await groupForCode(code) : null;
  const back = `/coalitions/join/${code}`;
  const ref = via && /^[a-z0-9]{4,32}$/i.test(via) ? `&via=${encodeURIComponent(via)}` : "";

  return (
    <div className="mx-auto max-w-md px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">◉ Group invite</p>
        <h1 className="mt-2 text-3xl font-bold">{group ? `Join ${group.name}` : "Join a group"}</h1>
        {group ? (
          <p className="mt-3 text-sm text-zinc-400">
            {group.members === 1 ? "1 member" : `${group.members} members`}
            {group.state ? ` · ${group.state}` : ""}. Kratom advocates who act together: letters to lawmakers,
            meetings, and a shared plan. Free, and your name stays private: other members see only your @username.
          </p>
        ) : (
          <p className="mt-3 text-sm text-amber-300">
            This invite link isn&apos;t working. It may have expired or been typed wrong. Ask the person who shared it for a fresh one.
          </p>
        )}
      </header>

      {group && !user && (
        <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
          <Link href={`/login?mode=signup&redirect=${encodeURIComponent(back)}${ref}`}
            className="block w-full rounded-md bg-emerald-500 px-4 py-3 text-center text-sm font-semibold text-zinc-950 hover:bg-emerald-400">
            Create a free account to join
          </Link>
          <Link href={`/login?redirect=${encodeURIComponent(back)}${ref}`}
            className="block w-full rounded-md border border-zinc-700 px-4 py-3 text-center text-sm text-zinc-200 hover:border-emerald-500">
            I already have an account
          </Link>
          <p className="text-[11px] text-zinc-500">After you confirm your email, you land straight in the group.</p>
        </div>
      )}
      {group && user && <JoinClient code={code} groupName={group.name} auto={auto === "1"} />}

      <p className="mt-6 text-[11px] text-zinc-500">
        Already in?{" "}
        <Link href="/coalitions" className="text-emerald-400 hover:underline">See your groups</Link>
      </p>
    </div>
  );
}

/** The group behind a live invite code, or null. Service role: the code is the key. */
async function groupForCode(code: string) {
  const admin = createServiceRoleClient();
  const { data: inv } = await admin
    .from("coalition_invites").select("coalition_id, expires_at, max_uses, use_count")
    .eq("code", code).maybeSingle();
  if (!inv) return null;
  if (inv.expires_at && new Date(inv.expires_at) < new Date()) return null;
  if (inv.use_count >= inv.max_uses) return null;
  const [{ data: c }, { count }] = await Promise.all([
    admin.from("coalitions").select("name, state").eq("id", inv.coalition_id).maybeSingle(),
    admin.from("coalition_members").select("user_id", { count: "exact", head: true }).eq("coalition_id", inv.coalition_id),
  ]);
  return c ? { name: c.name as string, state: (c.state as string | null) ?? null, members: count ?? 0 } : null;
}
