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
  // ── MP3 path (preferred) ────────────────────────────────────────────
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [mp3Playing, setMp3Playing] = useState(false);

  // ── SpeechSynthesis fallback (when no MP3) ──────────────────────────
  const [available, setAvailable] = useState(false);
  const [quality, setQuality] = useState<VoiceQuality>("unavailable");
  const [playing, setPlaying] = useState(false);
  const [showQualityNote, setShowQualityNote] = useState(false);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    if (audioUrl) return; // MP3 path — no SpeechSynthesis needed
    const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
    if (!synth) return;
    setAvailable(true);
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
    const toggleMp3 = () => {
      const el = audioRef.current;
      if (!el) return;
      if (mp3Playing) { el.pause(); return; }
      el.play().catch(() => setMp3Playing(false));
    };
    return (
      <div className="inline-flex items-center gap-2">
        <button
          onClick={toggleMp3}
          className="inline-flex items-center gap-1.5 rounded-md border border-emerald-700/40 bg-emerald-950/30 px-2.5 py-1 text-[11px] font-semibold text-emerald-200 transition hover:border-emerald-500 hover:bg-emerald-900/40"
          aria-label={mp3Playing ? "Pause the brief" : "Play today's brief"}
        >
          {mp3Playing ? "⏸ Pause" : "▶ Listen"}
        </button>
        <span className="text-[10px] text-emerald-400/70" title="Pre-rendered neural-voice MP3 (Edge TTS Christopher Neural)">
          🎙 NPR voice{audioDateLabel ? ` · ${audioDateLabel}` : ""}
        </span>
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="metadata"
          onPlay={() => setMp3Playing(true)}
          onPause={() => setMp3Playing(false)}
          onEnded={() => setMp3Playing(false)}
        />
      </div>
    );
  }

  // ── SpeechSynthesis fallback ────────────────────────────────────────
  if (!available) return null;

  const toggle = () => {
    const synth = window.speechSynthesis;
    if (playing) {
      synth.cancel();
      setPlaying(false);
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
    u.onend = () => setPlaying(false);
    u.onerror = () => setPlaying(false);
    utterRef.current = u;
    synth.speak(u);
    setPlaying(true);
  };

  return (
    <div className="relative inline-flex items-center gap-2">
      <button
        onClick={toggle}
        className="inline-flex items-center gap-1.5 rounded-md border border-emerald-700/40 bg-emerald-950/30 px-2.5 py-1 text-[11px] font-semibold text-emerald-200 transition hover:border-emerald-500 hover:bg-emerald-900/40"
        aria-label={playing ? "Stop reading the brief" : "Listen to today's brief"}
      >
        {playing ? "⏸ Stop" : "▶ Listen"}
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
