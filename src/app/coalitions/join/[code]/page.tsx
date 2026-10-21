import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { JoinClient } from "./JoinClient";

export const metadata = {
  title: "Join coalition",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

type Params = Promise<{ code: string }>;
type Search = Promise<{ via?: string }>;

/**
 * /coalitions/join/[code] — accept an invite link.
 *
 * Anonymous users get a sign-in nudge that preserves the code in the
 * redirect URL. Signed-in users immediately fire the join RPC and
 * land on the coalition page.
 *
 * The RPC validates code, expiry, max-uses, and idempotently inserts
 * the membership row. We don't show the coalition name BEFORE accept
 * — that would leak private coalition existence to anyone with the
 * URL pattern. The user discovers the name after accepting.
 */
export default async function JoinPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { code } = await params;
  const { via } = await searchParams;
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();

  if (!user) {
    const ref = via && /^[a-z0-9]{4,32}$/i.test(via) ? `&via=${encodeURIComponent(via)}` : "";
    redirect(`/login?redirect=${encodeURIComponent(`/coalitions/join/${code}`)}${ref}`);
  }

  return (
    <div className="mx-auto max-w-md px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
          ◉ Coalition invite
        </p>
        <h1 className="mt-2 text-3xl font-bold">Accept invite</h1>
        <p className="mt-3 text-sm text-zinc-400">
          You were invited to join a coalition. Click below to accept — you&apos;ll be added as
          a member and redirected to the coalition page.
        </p>
      </header>

      <JoinClient code={code} />

      <p className="mt-6 text-[11px] text-zinc-500">
        Already a member?{" "}
        <Link href="/coalitions" className="text-emerald-400 hover:underline">
          See your coalitions
        </Link>
      </p>
    </div>
  );
}
