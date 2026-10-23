import { tiersForProvider } from "@/lib/email/provider-limits";

/**
 * "Is my email account safe?" — shown wherever someone connects or sends from
 * their own mailbox (owner ask 2026-10-22: "so they have assurance of their
 * account"). Every number is read from provider-limits.ts, the same table the
 * send queue obeys, so this note can never promise a limit the code doesn't
 * keep. No hooks: renders in server and client components alike.
 */
const ROWS = (["gmail", "outlook", "yahoo", "aol", "icloud"] as const).flatMap((p) => tiersForProvider(p));
const fmt = (n: number) => n.toLocaleString("en-US");

export function EmailSafetyNote({ collapsed = false, className = "" }: { collapsed?: boolean; className?: string }) {
  const body = (
    <div className="space-y-2 text-xs text-zinc-400">
      <p>
        Every letter is sent from <strong className="text-zinc-200">your own email account</strong>, so it counts
        toward your email provider&apos;s daily limit. We always stop well short of that limit, so your account is never
        flagged for spam.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[22rem] border-collapse text-left">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-500">
              <th className="py-1 pr-3 font-medium">Your email</th>
              <th className="py-1 pr-3 font-medium">Provider&apos;s limit (24 h)</th>
              <th className="py-1 font-medium">iKratom stops at</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((t) => (
              <tr key={t.tier} className="border-b border-zinc-900">
                <td className="py-1 pr-3 text-zinc-300">{t.label}</td>
                <td className="py-1 pr-3">{fmt(t.documentedDaily)}</td>
                <td className="py-1 text-emerald-300">
                  {fmt(t.effectiveDaily)} a day, at most {fmt(t.maxPerMinute)} a minute
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="list-disc space-y-0.5 pl-4">
        <li>Go over your daily amount and the rest <strong className="text-zinc-200">pauses and finishes automatically the next day</strong>. Nothing is lost.</li>
        <li>Every letter is recorded as it goes out, so <strong className="text-zinc-200">nobody gets the same letter twice</strong>.</li>
        <li>We can only <em>send</em>: we never read your inbox. Disconnect any time in your account settings.</li>
      </ul>
    </div>
  );

  if (!collapsed) {
    return (
      <div className={`rounded-md border border-emerald-900/40 bg-emerald-950/10 p-3 ${className}`}>
        <p className="mb-2 text-xs font-semibold text-emerald-300">🛡 Your email account is protected</p>
        {body}
      </div>
    );
  }
  return (
    <details className={`rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2 ${className}`}>
      <summary className="cursor-pointer text-xs font-semibold text-emerald-300">🛡 Is my email account safe? See the limits we keep</summary>
      <div className="mt-2">{body}</div>
    </details>
  );
}
