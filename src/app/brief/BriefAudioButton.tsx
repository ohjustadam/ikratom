"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  /** Cleaned plain-text script used by the browser-native fallback. */
  script: string;
  /** Pre-rendered MP3 URL (Edge TTS Neural voice). When present, this
   *  is the preferred playback path — far better quality than any
   *  client-side TTS, and consistent across OSes. */
  audioUrl?: string | null;
  /** When the MP3 is from a prior day (today's render missed), surfaces
   *  the staleness so users understand. e.g. "1d ago" / "3d ago". */
  audioDateLabel?: string | null;
};

type VoiceQuality = "neural" | "standard" | "unavailable";
type AudioState = "idle" | "loading" | "ready" | "playing" | "ended" | "error";

function detectQuality(): VoiceQuality {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return "unavailable";
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return "standard";
  const hasNeural = voices.some((v) =>
    /Aria|Christopher|Jenny|Natural|Online|Neural|Eddy|Reed|Rocko|Sandy|Shelley|Grandma|Grandpa/i.test(v.name) && v.lang.startsWith("en"),
  );
  return hasNeural ? "neural" : "standard";
}

export default function BriefAudioButton({ script, audioUrl, audioDateLabel }: Props) {
  // ── MP3 path (preferred) — uses native <audio controls> ─────────────
  const [audioState, setAudioState] = useState<AudioState>(audioUrl ? "loading" : "idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // ── SpeechSynthesis fallback (when no MP3) ──────────────────────────
  const [ssAvailable, setSsAvailable] = useState(false);
  const [quality, setQuality] = useState<VoiceQuality>("unavailable");
  const [ssPlaying, setSsPlaying] = useState(false);
  const [showQualityNote, setShowQualityNote] = useState(false);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    if (audioUrl) return; // MP3 path — no SpeechSynthesis needed
    const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
    if (!synth) return;
    setSsAvailable(true);
    const recheck = () => setQuality(detectQuality());
    recheck();
    synth.addEventListener?.("voiceschanged", recheck);
    return () => {
      synth.removeEventListener?.("voiceschanged", recheck);
      try { synth.cancel(); } catch { /* noop */ }
    };
  }, [audioUrl]);

  // ── MP3 render path ─────────────────────────────────────────────────
  if (audioUrl) {
    const statusLabel: Record<AudioState, string> = {
      idle: "Tap play to start",
      loading: "Loading audio…",
      ready: "Ready · tap play",
      playing: "Playing today's brief",
      ended: "Brief finished",
      error: "Audio failed to load — try refresh",
    };
    const statusTone: Record<AudioState, string> = {
      idle: "text-zinc-400",
      loading: "text-zinc-400",
      ready: "text-emerald-300",
      playing: "text-emerald-400",
      ended: "text-zinc-500",
      error: "text-red-400",
    };
    return (
      <div className="flex w-full flex-col gap-1 sm:max-w-md">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider">
          <span className="font-semibold text-emerald-400">🎙 Daily brief audio</span>
          <span className={`${statusTone[audioState]} font-medium`}>· {statusLabel[audioState]}</span>
          {audioDateLabel && (
            <span className="text-amber-400" title="Today's render not yet generated; serving most recent">
              · {audioDateLabel}
            </span>
          )}
        </div>
        <audio
          ref={audioRef}
          controls
          // preload="auto" forces the full file download on mount.
          // preload="metadata" leaves Chrome unable to determine duration
          // for msedge-tts MP3s (no Xing VBR header), keeping the controls
          // greyed out indefinitely. Full file is only ~600KB.
          preload="auto"
          className="w-full rounded-md border border-emerald-700/40 bg-emerald-950/20"
          onLoadStart={() => setAudioState("loading")}
          onLoadedMetadata={() => setAudioState("ready")}
          onLoadedData={() => setAudioState("ready")}
          onCanPlay={() => setAudioState("ready")}
          onCanPlayThrough={() => setAudioState("ready")}
          onPlay={() => setAudioState("playing")}
          onPause={() => setAudioState((s) => (s === "playing" ? "ready" : s))}
          onEnded={() => setAudioState("ended")}
          onError={() => setAudioState("error")}
        >
          <source src={audioUrl} type="audio/mpeg" />
          Your browser doesn&apos;t support audio playback. <a href={audioUrl}>Download the MP3</a>.
        </audio>
        <p className="text-[10px] text-zinc-500">
          Pre-rendered with Microsoft Edge TTS · Christopher Neural · ~1-2 min
        </p>
      </div>
    );
  }

  // ── SpeechSynthesis fallback ────────────────────────────────────────
  if (!ssAvailable) return null;

  const toggleSs = () => {
    const synth = window.speechSynthesis;
    if (ssPlaying) {
      synth.cancel();
      setSsPlaying(false);
      return;
    }
    const u = new SpeechSynthesisUtterance(script);
    u.rate = 1.0;
    u.pitch = 1.0;
    u.lang = "en-US";
    const voices = synth.getVoices();
    const preferred = voices.find((v) =>
      /Aria|Christopher|Jenny|Natural|Online|Neural/i.test(v.name) && v.lang.startsWith("en"),
    ) ?? voices.find((v) => v.lang.startsWith("en"));
    if (preferred) u.voice = preferred;
    u.onend = () => setSsPlaying(false);
    u.onerror = () => setSsPlaying(false);
    utterRef.current = u;
    synth.speak(u);
    setSsPlaying(true);
  };

  return (
    <div className="relative inline-flex items-center gap-2">
      <button
        onClick={toggleSs}
        className="inline-flex items-center gap-1.5 rounded-md border border-emerald-700/40 bg-emerald-950/30 px-2.5 py-1 text-[11px] font-semibold text-emerald-200 transition hover:border-emerald-500 hover:bg-emerald-900/40"
        aria-label={ssPlaying ? "Stop reading the brief" : "Listen to today's brief"}
      >
        {ssPlaying ? "⏸ Stop" : "▶ Listen"}
      </button>
      {quality === "standard" && (
        <button
          onClick={() => setShowQualityNote((s) => !s)}
          className="text-[10px] text-amber-300/70 underline-offset-2 hover:underline"
          title="Your OS doesn't have a neural voice installed; the read-aloud will sound robotic. Tap for details."
        >
          ⚠ robot voice
        </button>
      )}
      {showQualityNote && (
        <div className="absolute right-0 top-full z-20 mt-1 w-72 rounded-md border border-amber-700/40 bg-zinc-950 p-3 text-[11px] text-amber-100 shadow-lg">
          <p className="mb-1.5 font-semibold">Robotic voice?</p>
          <p className="mb-2 text-amber-200/80">
            Your OS doesn&apos;t have a neural voice installed and today&apos;s pre-rendered MP3 hasn&apos;t been generated yet (daily cron job).
          </p>
          <p className="text-amber-200/80">
            <strong>Windows 11:</strong> Settings → Time &amp; language → Speech → Manage voices → Add &quot;Microsoft Aria&quot; or &quot;Christopher&quot;.
          </p>
          <p className="mt-1 text-amber-200/80">
            <strong>iOS/iPadOS:</strong> Settings → Accessibility → Spoken Content → Voices → English → tap a Premium voice to download.
          </p>
        </div>
      )}
    </div>
  );
}
