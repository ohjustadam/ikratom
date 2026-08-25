"use client";

import { useEffect, useRef, useState } from "react";
import { formatTime } from "@/lib/audio-timeline";
import type { KokoroPlayer } from "@/lib/kokoro-tts-client";

/**
 * AudioTransport — scrub bar, rewind/forward, elapsed time, pitch.
 *
 * Renders ONLY for the Kokoro engine, and that is a real constraint rather
 * than an oversight: speechSynthesis has no currentTime, no duration and no
 * seek. The browser fallback physically cannot be scrubbed, so drawing a
 * timeline over it would be a control that lies — the failure mode this
 * project keeps finding (a cap that reported success while sending 20 of 198,
 * a mailto that truncated silently). Better to omit it and say why.
 *
 * Position is read from the player on an animation frame rather than pushed
 * from it, because the AudioContext clock is the only honest source. While
 * suspended, ctx.currentTime freezes, so a paused transport stops on its own
 * with no extra state to keep in sync.
 */
export function AudioTransport({
  player,
  playing,
  className = "",
}: {
  player: KokoroPlayer | null;
  /** True while audio should be advancing — drives the rAF loop. */
  playing: boolean;
  className?: string;
}) {
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [pitch, setPitch] = useState(0);
  /** While the user drags, the thumb follows the pointer, not the clock. */
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!player) return;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      setPosition(player.position);
      setDuration(player.duration);
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      alive = false;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [player, playing]);

  if (!player) return null;

  // Duration grows while generation streams, so "unknown yet" is a real state
  // — show the scrubber disabled rather than a bar pinned at 100%.
  const known = duration > 0;
  const shown = scrubbing ?? position;
  const pct = known ? Math.min(100, (shown / duration) * 100) : 0;

  return (
    <div className={`mt-2 ${className}`}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => player.nudge(-15)}
          aria-label="Rewind 15 seconds"
          title="Back 15s"
          className="rounded px-1.5 py-0.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-emerald-300"
        >
          ↺15
        </button>

        <span className="tabular-nums text-[11px] text-zinc-400" aria-hidden>
          {formatTime(shown)}
        </span>

        <input
          type="range"
          min={0}
          max={known ? duration : 1}
          step={0.1}
          value={shown}
          disabled={!known}
          aria-label="Seek"
          aria-valuetext={`${formatTime(shown)} of ${formatTime(duration)}`}
          onChange={(e) => setScrubbing(Number(e.target.value))}
          // Commit on release, not on every input event: seeking rebuilds the
          // whole schedule, and doing that per pixel of drag would stutter.
          onMouseUp={() => { if (scrubbing !== null) { player.seek(scrubbing); setScrubbing(null); } }}
          onTouchEnd={() => { if (scrubbing !== null) { player.seek(scrubbing); setScrubbing(null); } }}
          onKeyUp={() => { if (scrubbing !== null) { player.seek(scrubbing); setScrubbing(null); } }}
          className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-zinc-800 accent-emerald-500 disabled:cursor-default disabled:opacity-50"
          style={{
            background: known
              ? `linear-gradient(to right, rgb(16 185 129) ${pct}%, rgb(39 39 42) ${pct}%)`
              : undefined,
          }}
        />

        <span className="tabular-nums text-[11px] text-zinc-500" aria-hidden>
          {known ? formatTime(duration) : "—:—"}
        </span>

        <button
          type="button"
          onClick={() => player.nudge(15)}
          aria-label="Forward 15 seconds"
          title="Forward 15s"
          className="rounded px-1.5 py-0.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-emerald-300"
        >
          15↻
        </button>
      </div>

      <div className="mt-1.5 flex items-center gap-2">
        <label htmlFor="tts-pitch" className="text-[11px] text-zinc-500">
          Voice
        </label>
        <input
          id="tts-pitch"
          type="range"
          min={-6}
          max={6}
          step={1}
          value={pitch}
          aria-label="Voice pitch in semitones"
          aria-valuetext={pitch === 0 ? "Normal" : `${pitch > 0 ? "+" : ""}${pitch} semitones`}
          onChange={(e) => {
            const v = Number(e.target.value);
            setPitch(v);
            player.setPitch(v);
          }}
          className="h-1 w-24 cursor-pointer appearance-none rounded-full bg-zinc-800 accent-emerald-500"
        />
        <span className="tabular-nums text-[11px] text-zinc-500">
          {pitch === 0 ? "normal" : `${pitch > 0 ? "+" : ""}${pitch}`}
        </span>
        {pitch !== 0 && (
          <button
            type="button"
            onClick={() => { setPitch(0); player.setPitch(0); }}
            className="text-[11px] text-zinc-500 underline decoration-dotted hover:text-emerald-300"
          >
            reset
          </button>
        )}
      </div>
    </div>
  );
}
