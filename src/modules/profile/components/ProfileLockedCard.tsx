import { publicHandle } from "@/lib/public-handle";
import type { ProfileView } from "../view";

/**
 * What a viewer sees when the profile exists but is not shared with them.
 * It never says WHICH audience it is shared with, and never shows a section.
 */
export function ProfileLockedCard({ p, signedIn, next }: { p: ProfileView; signedIn: boolean; next: string }) {
  const handle = publicHandle(p);
  if (p.relationship === "blocked") {
    return (
      <Card>
        You blocked {handle}. You can unblock them under{" "}
        <a href="/account#security-privacy" className="text-emerald-400 hover:underline">Account → Security &amp; privacy</a>.
      </Card>
    );
  }
  if (!signedIn) {
    return (
      <Card>
        {handle} shares their profile with members.{" "}
        <a href={`/login?redirect=${encodeURIComponent(next)}`} className="font-semibold text-emerald-400 hover:underline">Sign in</a>{" "}
        or <a href="/signup" className="font-semibold text-emerald-400 hover:underline">join iKratom</a> to see it.
      </Card>
    );
  }
  return <Card>{handle} keeps their profile private.</Card>;
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-5 text-sm text-zinc-300">
      <span aria-hidden>🔒 </span>
      {children}
    </div>
  );
}
