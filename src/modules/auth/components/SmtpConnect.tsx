"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { connectSmtpEmail, disconnectSmtpEmail } from "../actions-smtp";

/**
 * Connect Yahoo, AOL or iCloud with an app password (owner yes 2026-10-22).
 * Help links and labels come from the server so the provider list has one home
 * (src/lib/email/smtp.ts).
 */
type Option = { id: string; label: string; help: string; domains: string[] };

export function SmtpConnect({ options, connected }: { options: Option[]; connected: { label: string; email: string } | null }) {
  const router = useRouter();
  const [provider, setProvider] = useState(options[0]?.id ?? "yahoo");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const opt = options.find((o) => o.id === provider) ?? options[0];

  if (connected) {
    return (
      <div className="text-sm">
        <p className="text-zinc-200">
          ✓ Connected: <span className="font-mono text-emerald-300">{connected.email}</span> ({connected.label})
        </p>
        <button type="button" disabled={pending}
          onClick={() => start(async () => { await disconnectSmtpEmail(); router.refresh(); })}
          className="mt-2 text-xs text-zinc-400 underline decoration-dotted hover:text-red-300">
          Disconnect (deletes the saved app password)
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await connectSmtpEmail({ provider, email, appPassword: pw });
          setPw("");
          if (!r.ok) setError(r.error ?? "Couldn't connect."); else router.refresh();
        });
      }}
      className="space-y-2 text-sm"
    >
      <p className="text-xs text-zinc-400">
        These providers don&apos;t offer a &ldquo;Sign in with&rdquo; button, so you make an <strong className="text-zinc-200">app password</strong>:
        a separate password that only works for sending mail, which you can cancel any time in your provider&apos;s settings.
        It is <strong className="text-zinc-200">not</strong> your real password. We store it encrypted and never show it again.
      </p>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button type="button" key={o.id} onClick={() => setProvider(o.id)}
            className={`rounded-md border px-3 py-1.5 text-xs ${provider === o.id ? "border-emerald-500 text-emerald-300" : "border-zinc-700 text-zinc-300"}`}>
            {o.label}
          </button>
        ))}
      </div>
      <p className="text-xs">
        Step 1: <a href={opt.help} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">make an app password for {opt.label} ↗</a>
      </p>
      <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email"
        placeholder={`you@${opt.domains[0]}`} aria-label="Your email address"
        className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-zinc-100" />
      <input value={pw} onChange={(e) => setPw(e.target.value)} type="password" autoComplete="off"
        placeholder="Step 2: paste the app password" aria-label="App password"
        className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-zinc-100" />
      <button type="submit" disabled={pending || !email || !pw}
        className="rounded-md bg-emerald-500 px-4 py-2 font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-40">
        {pending ? "Checking with your provider…" : `Connect ${opt.label}`}
      </button>
      <p className="text-[11px] text-zinc-500">
        You can connect one email account at a time; this replaces a Gmail or Outlook connection.
        Proton isn&apos;t possible: free Proton accounts allow no outside apps.
      </p>
      {error && <p className="text-xs text-amber-300">{error}</p>}
    </form>
  );
}
