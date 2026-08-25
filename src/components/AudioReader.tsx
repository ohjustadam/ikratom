"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AudioTransport } from "./AudioTransport";
import {
  KokoroPlayer,
  KOKORO_VOICES,
  DEFAULT_KOKORO_VOICE,
  kokoroSupported,
  type KokoroState,
} from "@/lib/kokoro-tts-client";

/**
 * AudioReader — site-wide "Listen" (read-aloud) for any text.
 *
 * PRIMARY engine: in-browser Kokoro-82M neural TTS (the SAME model + voices as
 * the daily-brief audio) via @/lib/kokoro-tts-client — natural "NPR-anchor"
 * voice, $0, runs on the user's device (WebGPU/WASM). The ~90MB weights download
 * once on the first Listen click and are cached by the browser thereafter.
 *
 * FALLBACK engine: window.speechSynthesis (the old robotic OS voice) — used
 * automatically on browsers without WASM/AudioContext, if the Kokoro model
 * fails to load/run, and offered as an "⚡ instant" option while the model is
 * still downloading on first use.
 *
 * Voice choice persists per-browser via localStorage so every page that mounts
 * AudioReader picks up the user's preference.
 */

type Props = {
  text: string;
  /** Stable id so the resume-position persists per-paper / per-page. */
  id: string;
  /** Display label for the play button (defaults to "Listen"). */
  label?: string;
  /** Compact mode: just the button, no extra controls. */
  compact?: boolean;
  /** Hide the voice picker even in non-compact mode. */
  hideVoicePicker?: boolean;
};

const ALKALOID_HINTS: Record<string, string> = {
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

const KVOICE_STORAGE = "audio-reader:kvoice"; // Kokoro voice id
const SSVOICE_STORAGE = "audio-reader:voice"; // system speechSynthesis voice name

function voiceQualityScore(v: SpeechSynthesisVoice): number {
  let s = 0;
  if (/premium|enhanced|neural|natural/i.test(v.name)) s += 10;
  if (v.lang.startsWith("en-US")) s += 3;
  else if (v.lang.startsWith("en")) s += 2;
  if (v.localService) s += 1;
  if (v.default) s += 1;
  return s;
}

export function AudioReader({ text, id, label = "Listen", compact = false, hideVoicePicker = false }: Props) {
  // null = SSR / not yet determined. "kokoro" = neural primary. "browser" = OS TTS fallback.
  const [engine, setEngine] = useState<"kokoro" | "browser" | null>(null);
  const [rate, setRate] = useState(1.0);

  // ── Kokoro state ──────────────────────────────────────────────────
  const [kState, setKState] = useState<KokoroState>("idle");
  const [kPct, setKPct] = useState(0); // model download fraction, 0..1
  const [kVoice, setKVoice] = useState<string>(DEFAULT_KOKORO_VOICE);
  const playerRef = useRef<KokoroPlayer | null>(null);

  // ── speechSynthesis (fallback) state ──────────────────────────────
  const [ssVoices, setSsVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [ssVoiceName, setSsVoiceName] = useState<string | null>(null);
  const [ssPlaying, setSsPlaying] = useState(false);
  const [ssPaused, setSsPaused] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  // speechSynthesis chokes on one long utterance (Chromium silently
  // truncates/garbles past ~15s / a few hundred words). We queue sentence-
  // sized chunks and keep the engine awake across them.
  const ssQueueRef = useRef<string[]>([]);
  const ssIdxRef = useRef(0);
  const ssKeepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Decide engine + load persisted prefs after mount (client only).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const ss = "speechSynthesis" in window;
    setEngine(kokoroSupported() ? "kokoro" : ss ? "browser" : null);
    try {
      const kv = localStorage.getItem(KVOICE_STORAGE);
      if (kv) setKVoice(kv);
      const sv = localStorage.getItem(SSVOICE_STORAGE);
      if (sv) setSsVoiceName(sv);
    } catch { /* ignore */ }
  }, []);

  // Load system voices for the fallback path.
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const load = () => {
      const list = window.speechSynthesis.getVoices();
      if (list && list.length > 0) setSsVoices(list);
    };
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  // Stop everything on unmount.
  useEffect(() => {
    return () => {
      playerRef.current?.stop();
      if (ssKeepAliveRef.current) clearInterval(ssKeepAliveRef.current);
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  const activeSsVoice = useMemo<SpeechSynthesisVoice | undefined>(() => {
    if (ssVoices.length === 0) return undefined;
    if (ssVoiceName) {
      const m = ssVoices.find((v) => v.name === ssVoiceName);
      if (m) return m;
    }
    return [...ssVoices].sort((a, b) => voiceQualityScore(b) - voiceQualityScore(a))[0];
  }, [ssVoices, ssVoiceName]);

  // ── speechSynthesis controls ──────────────────────────────────────
  function stopKeepAlive() {
    if (ssKeepAliveRef.current) { clearInterval(ssKeepAliveRef.current); ssKeepAliveRef.current = null; }
  }

  // Split into sentence-sized chunks, hard-wrapping long sentences on word
  // boundaries so no single utterance exceeds ~220 chars.
  function ssChunks(t: string): string[] {
    const raw = t.match(/[^.!?\n]+[.!?]*|\n+/g) ?? [t];
    const out: string[] = [];
    for (const seg of raw) {
      const s = seg.trim();
      if (!s) continue;
      if (s.length <= 220) { out.push(s); continue; }
      let cur = "";
      for (const word of s.split(/\s+/)) {
        if ((cur ? cur.length + 1 + word.length : word.length) > 220) { if (cur) out.push(cur); cur = word; }
        else cur = cur ? `${cur} ${word}` : word;
      }
      if (cur) out.push(cur);
    }
    return out;
  }

  function speakNext() {
    const q = ssQueueRef.current;
    if (ssIdxRef.current >= q.length) { stopKeepAlive(); setSsPlaying(false); setSsPaused(false); return; }
    const u = new SpeechSynthesisUtterance(q[ssIdxRef.current]);
    u.rate = rate; u.pitch = 1.0; u.volume = 1.0; u.lang = "en-US";
    if (activeSsVoice) u.voice = activeSsVoice;
    u.onend = () => { ssIdxRef.current += 1; speakNext(); };
    u.onerror = () => { ssIdxRef.current += 1; speakNext(); };
    utteranceRef.current = u;
    window.speechSynthesis.speak(u);
  }

  function browserPlay() {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    ssQueueRef.current = ssChunks(phoneticize(text));
    ssIdxRef.current = 0;
    setSsPlaying(true); setSsPaused(false);
    // Chrome pauses the queue after ~15s — a periodic pause+resume keeps a
    // long multi-utterance read alive (no-op while the user has it paused).
    stopKeepAlive();
    ssKeepAliveRef.current = setInterval(() => {
      const s = window.speechSynthesis;
      if (s.speaking && !s.paused) { s.pause(); s.resume(); }
    }, 10_000);
    speakNext();
  }
  function browserStop() {
    stopKeepAlive();
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setSsPlaying(false); setSsPaused(false);
  }

  // ── Kokoro controls ───────────────────────────────────────────────
  function kokoroPlay() {
    const player = new KokoroPlayer();
    playerRef.current = player;
    player.onprogress = (f) => setKPct(f);
    player.onstate = (s) => {
      setKState(s);
      if (s === "ended" || s === "idle") playerRef.current = null;
    };
    setKState("loading"); setKPct(0);
    player.play(phoneticize(text), kVoice, rate).catch(() => {
      // Model load/runtime failure → fall back to the OS voice and play it.
      playerRef.current = null;
      setKState("idle");
      setEngine("browser");
      browserPlay();
    });
  }
  function kokoroStop() { playerRef.current?.stop(); playerRef.current = null; setKState("idle"); }

  function changeRate(r: number) {
    setRate(r);
    if (engine === "kokoro" && playerRef.current && (kState === "playing" || kState === "paused" || kState === "loading")) {
      playerRef.current.stop(); playerRef.current = null;
      setTimeout(() => kokoroPlay(), 60);
    } else if (engine === "browser" && ssPlaying) {
      browserStop();
      setTimeout(() => browserPlay(), 60);
    }
  }

  function switchToBrowserAndPlay() {
    kokoroStop();
    setEngine("browser");
    browserPlay();
  }

  function setKokoroVoice(v: string) {
    setKVoice(v);
    try { localStorage.setItem(KVOICE_STORAGE, v); } catch { /* ignore */ }
  }
  function setSystemVoice(name: string) {
    setSsVoiceName(name || null);
    try { if (name) localStorage.setItem(SSVOICE_STORAGE, name); else localStorage.removeItem(SSVOICE_STORAGE); } catch { /* ignore */ }
  }

  if (engine === null) return null; // SSR / unsupported

  const wrap = compact
    ? "inline-flex flex-wrap items-center gap-2"
    : "flex flex-wrap items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2";
  const btnPrimary = "inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1 text-xs font-semibold text-zinc-950 hover:bg-emerald-500";
  const btnGhost = "inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-300 hover:border-zinc-500";
  const btnAccent = "inline-flex items-center gap-1 rounded-md border border-emerald-700 bg-zinc-900 px-3 py-1 text-xs text-emerald-300 hover:border-emerald-500";

  const rateSelect = !compact && (
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
  );

  // ── KOKORO (neural, primary) ──────────────────────────────────────
  if (engine === "kokoro") {
    const downloading = kState === "loading" && kPct > 0 && kPct < 1;
    return (
      <div className={wrap}>
        {kState === "idle" || kState === "ended" ? (
          <button onClick={kokoroPlay} aria-label={label} className={btnPrimary}>🔊 {label}</button>
        ) : kState === "loading" ? (
          <>
            <span className="inline-flex items-center gap-1.5 rounded-md bg-zinc-800 px-3 py-1 text-xs font-semibold text-zinc-300">
              ⏳ {downloading ? `Loading natural voice… ${Math.round(kPct * 100)}%` : "Generating audio…"}
            </span>
            <button onClick={kokoroStop} aria-label="Cancel" className={btnGhost}>⏹</button>
          </>
        ) : (
          <>
            {kState === "paused" ? (
              <button onClick={() => playerRef.current?.resume()} aria-label="Resume" className={btnPrimary}>▶ Resume</button>
            ) : (
              <button onClick={() => playerRef.current?.pause()} aria-label="Pause" className={btnAccent}>⏸ Pause</button>
            )}
            <button onClick={kokoroStop} aria-label="Stop" className={btnGhost}>⏹</button>
          </>
        )}
        {rateSelect}
        {!compact && !hideVoicePicker && (
          <select
            value={kVoice}
            onChange={(e) => setKokoroVoice(e.target.value)}
            aria-label="Voice"
            className="max-w-[200px] rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-300"
          >
            {KOKORO_VOICES.map((v) => (
              <option key={v.id} value={v.id}>{v.label}</option>
            ))}
          </select>
        )}
        {!compact && (
          <span className="text-[10px] text-zinc-600">
            Natural voice · runs on your device.{" "}
            {downloading && (
              <button onClick={switchToBrowserAndPlay} className="text-emerald-400 underline-offset-2 hover:underline">
                ⚡ play instantly instead
              </button>
            )}
          </span>
        )}
        {/* Transport only once audio exists to move through. Rendering it in
            "idle" would show a dead 0:00 scrubber that does nothing. */}
        {(kState === "playing" || kState === "paused") && (
          <AudioTransport
            player={playerRef.current}
            playing={kState === "playing"}
            className="w-full basis-full"
          />
        )}
      </div>
    );
  }

  // ── BROWSER speechSynthesis (fallback) ────────────────────────────
  const ssGroups = (() => {
    const groups = new Map<string, SpeechSynthesisVoice[]>();
    for (const v of ssVoices) { const l = v.lang || "?"; if (!groups.has(l)) groups.set(l, []); groups.get(l)!.push(v); }
    return [...groups.entries()].sort(([a], [b]) => (a.startsWith("en") ? -1 : 0) - (b.startsWith("en") ? -1 : 0) || a.localeCompare(b));
  })();

  return (
    <div className={wrap}>
      {!ssPlaying ? (
        <button onClick={browserPlay} aria-label={label} className={btnPrimary}>🔊 {label}</button>
      ) : (
        <>
          {ssPaused ? (
            <button onClick={() => { window.speechSynthesis.resume(); setSsPaused(false); }} aria-label="Resume" className={btnPrimary}>▶ Resume</button>
          ) : (
            <button onClick={() => { window.speechSynthesis.pause(); setSsPaused(true); }} aria-label="Pause" className={btnAccent}>⏸ Pause</button>
          )}
          <button onClick={browserStop} aria-label="Stop" className={btnGhost}>⏹</button>
        </>
      )}
      {rateSelect}
      {!compact && !hideVoicePicker && ssVoices.length > 0 && (
        <select
          value={ssVoiceName ?? ""}
          onChange={(e) => setSystemVoice(e.target.value)}
          aria-label="Voice"
          className="max-w-[180px] rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-300"
        >
          <option value="">Auto · best available</option>
          {ssGroups.map(([lang, vs]) => (
            <optgroup key={lang} label={lang}>
              {vs.map((v) => <option key={v.name} value={v.name}>{v.name}{v.default ? " · default" : ""}</option>)}
            </optgroup>
          ))}
        </select>
      )}
      {!compact && (
        <span className="text-[10px] text-zinc-600">
          {kokoroSupported() ? (
            <button onClick={() => { browserStop(); setEngine("kokoro"); }} className="text-emerald-400 underline-offset-2 hover:underline">
              🎙 switch to natural voice
            </button>
          ) : (
            <>Browser voice (robotic). {ssVoices.length} available.</>
          )}
        </span>
      )}
    </div>
  );
}
