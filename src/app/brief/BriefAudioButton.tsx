"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  script: string;
};

export default function BriefAudioButton({ script }: Props) {
  const [available, setAvailable] = useState(false);
  const [playing, setPlaying] = useState(false);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    setAvailable(typeof window !== "undefined" && "speechSynthesis" in window);
    return () => {
      try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
    };
  }, []);

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
    <button
      onClick={toggle}
      className="inline-flex items-center gap-1.5 rounded-md border border-emerald-700/40 bg-emerald-950/30 px-2.5 py-1 text-[11px] font-semibold text-emerald-200 transition hover:border-emerald-500 hover:bg-emerald-900/40"
      aria-label={playing ? "Stop reading the brief" : "Listen to today's brief"}
    >
      {playing ? "⏸ Stop" : "▶ Listen"}
    </button>
  );
}
