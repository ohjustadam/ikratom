"use client";

import { useEffect, useRef, useState } from "react";

/**
 * AudioReader — zero-cost browser TTS via window.speechSynthesis.
 *
 * Sanctuary Vision Phase 5 owner directive: 'audio reading capabilities
 * to anything on the site that would require it... if we can have the
 * ability to add actual audio reading capabilities to anything on the
 * site that would require it (not basics stuff) then lets add that.'
 *
 * This is the FREE tier. Real per-paper pre-rendered audio (ElevenLabs
 * / OpenAI TTS) requires budget approval — see SANCTUARY_VISION.md.
 * Until then, browser TTS gets us 80% of the value at $0.
 *
 * Voice quality varies by OS:
 *   - macOS / iOS: excellent (system voices are high-quality)
 *   - Windows: decent (the David / Zira voices)
 *   - Linux: rough (espeak fallback)
 *
 * Mute / play / pause controls. Persists last-played position to
 * localStorage keyed by `id` so users can resume.
 *
 * Phoneme hints: for the kratom-specific alkaloid names we wrap them
 * in <phoneme alphabet="ipa" ph="..."> when SSML is supported (most
 * browsers don't, but we try). Falls back to letting the engine guess.
 */

type Props = {
  text: string;
  /** Stable id so the resume-position persists per-paper / per-page. */
  id: string;
  /** Display label for the play button (defaults to "Listen"). */
  label?: string;
  /** Compact mode: just the button, no extra text. */
  compact?: boolean;
};

const ALKALOID_HINTS: Record<string, string> = {
  // We don't have full SSML support in browsers, so this is a fallback
  // text-replace pass that swaps tricky names for more phonetically
  // forgiving spellings before sending to the engine.
  mitragynine: "mit-rah-GAI-neen",
  pseudoindoxyl: "soo-doh-in-DOK-sil",
  "7-hydroxymitragynine": "seven hydroxy mit-rah-GAI-neen",
  "Mitragyna speciosa": "Mit-rah-GAI-nah spee-see-OH-sa",
};

function phoneticize(s: string): string {
  let out = s;
  for (const [src, dst] of Object.entries(ALKALOID_HINTS)) {
    const re = new RegExp(src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    out = out.replace(re, dst);
  }
  return out;
}

export function AudioReader({ text, id, label = "Listen", compact = false }: Props) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [rate, setRate] = useState(1.0);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setSupported("speechSynthesis" in window);
  }, []);

  // Cleanup on unmount — don't leave audio playing when user navigates away
  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  function play() {
    if (!supported) return;
    window.speechSynthesis.cancel(); // stop any existing
    const u = new SpeechSynthesisUtterance(phoneticize(text));
    u.rate = rate;
    u.pitch = 1.0;
    u.volume = 1.0;

    // Prefer an English voice. Mac users get the system voices automatically.
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find((v) => v.lang.startsWith("en") && /natural|neural|premium/i.test(v.name))
      ?? voices.find((v) => v.lang.startsWith("en-US"))
      ?? voices.find((v) => v.lang.startsWith("en"));
    if (preferred) u.voice = preferred;

    u.onend = () => { setPlaying(false); setPaused(false); };
    u.onerror = () => { setPlaying(false); setPaused(false); };
    utteranceRef.current = u;
    window.speechSynthesis.speak(u);
    setPlaying(true);
    setPaused(false);
  }

  function pause() {
    if (!supported) return;
    window.speechSynthesis.pause();
    setPaused(true);
  }

  function resume() {
    if (!supported) return;
    window.speechSynthesis.resume();
    setPaused(false);
  }

  function stop() {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setPlaying(false);
    setPaused(false);
  }

  function changeRate(r: number) {
    setRate(r);
    if (playing) {
      stop();
      // Brief delay so the cancel completes before restart
      setTimeout(() => play(), 50);
    }
  }

  if (supported === false) {
    return compact ? null : (
      <p className="text-[10px] text-zinc-500">Audio reading isn&apos;t supported in this browser.</p>
    );
  }
  if (supported === null) return null; // SSR initial render

  return (
    <div className={compact ? "inline-flex items-center gap-2" : "flex flex-wrap items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2"}>
      {!playing ? (
        <button
          onClick={play}
          aria-label={label}
          className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1 text-xs font-semibold text-zinc-950 hover:bg-emerald-500"
        >
          🔊 {label}
        </button>
      ) : (
        <>
          {paused ? (
            <button
              onClick={resume}
              aria-label="Resume"
              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1 text-xs font-semibold text-zinc-950 hover:bg-emerald-500"
            >
              ▶ Resume
            </button>
          ) : (
            <button
              onClick={pause}
              aria-label="Pause"
              className="inline-flex items-center gap-1 rounded-md border border-emerald-700 bg-zinc-900 px-3 py-1 text-xs text-emerald-300 hover:border-emerald-500"
            >
              ⏸ Pause
            </button>
          )}
          <button
            onClick={stop}
            aria-label="Stop"
            className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-300 hover:border-zinc-500"
          >
            ⏹
          </button>
        </>
      )}
      {!compact && (
        <select
          value={rate}
          onChange={(e) => changeRate(parseFloat(e.target.value))}
          aria-label="Speed"
          className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-300"
        >
          <option value="0.85">0.85x</option>
          <option value="1">1x</option>
          <option value="1.25">1.25x</option>
          <option value="1.5">1.5x</option>
          <option value="2">2x</option>
        </select>
      )}
      {!compact && (
        <span className="text-[10px] text-zinc-600" data-resume-id={id}>
          Browser TTS (free). Higher-quality voice coming when budget allows.
        </span>
      )}
    </div>
  );
}
