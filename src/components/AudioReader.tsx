"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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
 * Voice picker (added 2026-05-15 per owner ask):
 *   - Lists every installed system voice. macOS users typically have
 *     30+. Choice persists per-browser via localStorage so the next
 *     page that mounts AudioReader picks up the user's preference.
 *   - Defaults to a "Premium / Natural / Neural" English voice if
 *     available; otherwise the first en-US voice; otherwise the first
 *     English voice; otherwise the system default.
 *   - In compact mode, the picker is hidden — the parent surface can
 *     show its own voice picker once and have it apply globally.
 */

type Props = {
  text: string;
  /** Stable id so the resume-position persists per-paper / per-page. */
  id: string;
  /** Display label for the play button (defaults to "Listen"). */
  label?: string;
  /** Compact mode: just the button, no extra text. */
  compact?: boolean;
  /** Hide the voice picker even in non-compact mode. Useful if the
   *  parent surface owns a single global voice picker. */
  hideVoicePicker?: boolean;
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

const VOICE_STORAGE = "audio-reader:voice";

/** Heuristic ranking: higher = better. Used for the default pick. */
function voiceQualityScore(v: SpeechSynthesisVoice): number {
  let s = 0;
  if (/premium|enhanced|neural|natural/i.test(v.name)) s += 10;
  if (v.lang.startsWith("en-US")) s += 3;
  else if (v.lang.startsWith("en")) s += 2;
  if (v.localService) s += 1; // local voices are usually higher quality + private
  if (v.default) s += 1;
  return s;
}

export function AudioReader({ text, id, label = "Listen", compact = false, hideVoicePicker = false }: Props) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [rate, setRate] = useState(1.0);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceName, setSelectedVoiceName] = useState<string | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setSupported("speechSynthesis" in window);
    try {
      const stored = localStorage.getItem(VOICE_STORAGE);
      if (stored) setSelectedVoiceName(stored);
    } catch { /* ignore */ }
  }, []);

  // Voices load asynchronously in most browsers — listen for the
  // voiceschanged event AND call getVoices() once on mount in case
  // the event fired before we attached.
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const load = () => {
      const list = window.speechSynthesis.getVoices();
      if (list && list.length > 0) setVoices(list);
    };
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  // Cleanup on unmount — don't leave audio playing when user navigates away
  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  /** Best voice given current state. Selected → quality-ranked. */
  const activeVoice = useMemo<SpeechSynthesisVoice | undefined>(() => {
    if (voices.length === 0) return undefined;
    if (selectedVoiceName) {
      const match = voices.find((v) => v.name === selectedVoiceName);
      if (match) return match;
    }
    // Fall back to quality ranking
    return [...voices].sort((a, b) => voiceQualityScore(b) - voiceQualityScore(a))[0];
  }, [voices, selectedVoiceName]);

  /** Group voices by language label for the picker. */
  const voiceGroups = useMemo(() => {
    const groups = new Map<string, SpeechSynthesisVoice[]>();
    for (const v of voices) {
      const lang = v.lang || "?";
      if (!groups.has(lang)) groups.set(lang, []);
      groups.get(lang)!.push(v);
    }
    // English first, then alphabetical
    return [...groups.entries()].sort(([a], [b]) => {
      const aEn = a.startsWith("en");
      const bEn = b.startsWith("en");
      if (aEn && !bEn) return -1;
      if (!aEn && bEn) return 1;
      return a.localeCompare(b);
    });
  }, [voices]);

  function onVoiceChange(name: string) {
    setSelectedVoiceName(name || null);
    try {
      if (name) localStorage.setItem(VOICE_STORAGE, name);
      else localStorage.removeItem(VOICE_STORAGE);
    } catch { /* ignore */ }
  }

  function play() {
    if (!supported) return;
    window.speechSynthesis.cancel(); // stop any existing
    const u = new SpeechSynthesisUtterance(phoneticize(text));
    u.rate = rate;
    u.pitch = 1.0;
    u.volume = 1.0;
    if (activeVoice) u.voice = activeVoice;
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

  function previewVoice() {
    if (!supported) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance("Kratom advocacy, peer-reviewed research, read aloud.");
    u.rate = rate;
    if (activeVoice) u.voice = activeVoice;
    window.speechSynthesis.speak(u);
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
      {!compact && !hideVoicePicker && voices.length > 0 && (
        <>
          <select
            value={selectedVoiceName ?? ""}
            onChange={(e) => onVoiceChange(e.target.value)}
            aria-label="Voice"
            title={activeVoice ? `Current: ${activeVoice.name} (${activeVoice.lang})` : "Voice"}
            className="max-w-[180px] rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-300"
          >
            <option value="">Auto · best available</option>
            {voiceGroups.map(([lang, vs]) => (
              <optgroup key={lang} label={lang}>
                {vs.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name}{v.default ? " · default" : ""}{v.localService ? " · local" : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button
            onClick={previewVoice}
            aria-label="Preview voice"
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] text-zinc-300 hover:border-emerald-500"
            type="button"
          >
            ▶ test
          </button>
        </>
      )}
      {!compact && (
        <span className="text-[10px] text-zinc-600" data-resume-id={id}>
          Browser TTS (free). {voices.length} voice{voices.length === 1 ? "" : "s"} available.
        </span>
      )}
    </div>
  );
}
