"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { joinWave, leaveWave } from "../actions";
import { createClient } from "@/lib/supabase/client";

type Wave = {
  id: string;
  campaign_id: string;
  title: string;
  description: string | null;
  scheduled_at: string;
  fired_at: string | null;
  target_signups: number | null;
  sent_count: number;
  failed_count: number;
  active: boolean;
};

export function WavePanel({
  wave,
  initialCount,
  initialJoined,
  signedIn,
  gmailConnected,
}: {
  wave: Wave;
  initialCount: number;
  initialJoined: boolean;
  signedIn: boolean;
  gmailConnected: boolean;
}) {
  const router = useRouter();
  const [count, setCount] = useState(initialCount);
  const [joined, setJoined] = useState(initialJoined);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [now, setNow] = useState(() => Date.now());

  // Keep "fires in X" relative time fresh without a full re-render
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Realtime: bump the counter when anyone joins / leaves this wave
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`wave:${wave.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "campaign_wave_signups",
          filter: `wave_id=eq.${wave.id}`,
        },
        () => setCount((c) => c + 1),
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "campaign_wave_signups",
          filter: `wave_id=eq.${wave.id}`,
        },
        () => setCount((c) => Math.max(0, c - 1)),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [wave.id]);

  const fireTime = new Date(wave.scheduled_at).getTime();
  const msUntil = fireTime - now;
  const isFired = !!wave.fired_at;
  const isPast = msUntil <= 0;

  function join() {
    setError(null);
    startTransition(async () => {
      const r = await joinWave(wave.id);
      if ("error" in r) setError(r.error ?? "Failed");
      else {
        setJoined(true);
        router.refresh();
      }
    });
  }

  function leave() {
    if (!confirm("Pull out of this wave? You can join again before fire time.")) return;
    setError(null);
    startTransition(async () => {
      const r = await leaveWave(wave.id);
      if ("error" in r) setError(r.error ?? "Failed");
      else {
        setJoined(false);
        router.refresh();
      }
    });
  }

  // ── Post-fire summary ────────────────────────────────────────
  if (isFired) {
    return (
      <section className="mt-8 rounded-lg border border-emerald-700/40 bg-emerald-950/20 p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-300">
          Wave fired
        </p>
        <h3 className="mt-2 text-xl font-bold">{wave.title}</h3>
        <p className="mt-3 text-sm text-zinc-300">
          <span className="text-2xl font-bold text-emerald-300">{wave.sent_count}</span>{" "}
          email{wave.sent_count === 1 ? "" : "s"} sent at{" "}
          {new Date(wave.fired_at!).toLocaleString()}
          {wave.failed_count > 0 && (
            <span className="text-amber-300">
              {" "}· {wave.failed_count} failed
            </span>
          )}
          .
        </p>
      </section>
    );
  }

  // ── Active wave (not yet fired) ──────────────────────────────
  const target = wave.target_signups;
  const pct = target ? Math.min(100, Math.round((count / target) * 100)) : null;

  return (
    <section className="mt-8 rounded-lg border-2 border-amber-700/50 bg-gradient-to-br from-amber-950/30 to-zinc-950/40 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-amber-300">
            ⚡ Coalition wave
          </p>
          <h3 className="mt-1 text-xl font-bold">{wave.title}</h3>
        </div>
        {isPast ? (
          <span className="rounded bg-amber-500 px-2 py-1 text-xs font-bold text-zinc-950">
            FIRING NOW
          </span>
        ) : (
          <span className="rounded bg-zinc-900 px-2 py-1 text-xs text-zinc-300">
            Fires {fmtUntil(msUntil)}
          </span>
        )}
      </div>

      {wave.description && (
        <p className="mt-3 text-sm text-zinc-300">{wave.description}</p>
      )}

      {/* Counter + progress bar */}
      <div className="mt-4">
        <p className="text-sm text-zinc-300">
          <span className="text-3xl font-bold tabular-nums text-amber-300">{count}</span>
          {target ? (
            <>
              {" "}
              <span className="text-zinc-400">of {target}</span>
            </>
          ) : null}
          <span className="ml-2 text-zinc-400">
            advocate{count === 1 ? "" : "s"} joined
          </span>
        </p>
        {pct != null && (
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-zinc-900">
            <div
              className="h-full bg-amber-500 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
        <p className="mt-1 text-xs text-zinc-500">
          Fires <strong className="text-zinc-300">{new Date(wave.scheduled_at).toLocaleString()}</strong>
        </p>
      </div>

      {/* Action area */}
      <div className="mt-5">
        {!signedIn ? (
          <a
            href={`/login?redirect=/campaigns/${wave.campaign_id}`}
            className="inline-block rounded-md bg-amber-500 px-5 py-2.5 text-sm font-bold text-zinc-950 hover:bg-amber-400"
          >
            Sign in to join the wave →
          </a>
        ) : !gmailConnected ? (
          <div>
            <a
              href="/account"
              className="inline-block rounded-md border-2 border-amber-500 px-5 py-2.5 text-sm font-bold text-amber-300 hover:bg-amber-950/30"
            >
              Connect Gmail to join →
            </a>
            <p className="mt-2 text-xs text-zinc-500">
              Waves send from each advocate&apos;s own Gmail account so legislators
              recognize the email as authentic constituent contact. You connect once
              on /account, then join any wave with one click.
            </p>
          </div>
        ) : isPast ? (
          <p className="text-sm text-amber-300">
            Sign-ups are closed. Wave is firing now — check{" "}
            <a href="/notifications" className="underline hover:text-amber-200">
              your notifications
            </a>{" "}
            after it completes.
          </p>
        ) : joined ? (
          <div className="space-y-2">
            <div className="rounded-md border border-emerald-700/40 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-300">
              ✓ You&apos;re in. Your email will go out at the scheduled time.
            </div>
            <button
              onClick={leave}
              disabled={pending}
              className="text-xs text-zinc-500 hover:text-amber-300 disabled:opacity-50"
            >
              Pull out of this wave
            </button>
          </div>
        ) : (
          <button
            onClick={join}
            disabled={pending}
            className="rounded-md bg-amber-500 px-6 py-3 text-base font-bold text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
          >
            {pending ? "Joining…" : `Join the wave →`}
          </button>
        )}

        {error && (
          <p className="mt-3 rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

function fmtUntil(ms: number): string {
  if (ms < 0) return "any moment now";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `in ${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `in ${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `in ${hr}h ${min % 60}m`;
  const d = Math.floor(hr / 24);
  return `in ${d}d ${hr % 24}h`;
}
