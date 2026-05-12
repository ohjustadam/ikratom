"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Microphone visualizer for the in-app call experience.
 *
 * Uses Web Audio API's AnalyserNode to read live microphone amplitude
 * + frequency spectrum, then renders 24 animated bars + a peak meter
 * + a pulse ring around the recipient avatar.
 *
 * The mic stream is created in the parent (CallTracker) so the same
 * stream that drives Web Speech transcription also drives this
 * visualization — single permission prompt, single audio context.
 *
 * Free, on-device, audio bytes never leave the browser.
 *
 * Props:
 *   stream      MediaStream from getUserMedia (mic input)
 *   recipientInitials  short label (e.g. "JS" for "James Skoufis") to
 *                      show inside the pulse ring
 *   speakingThreshold  amplitude (0..1) above which the speaking
 *                      indicator activates. Default 0.05.
 */
export function MicVisualizer({
  stream,
  recipientInitials,
  speakingThreshold = 0.05,
}: {
  stream: MediaStream | null;
  recipientInitials: string;
  speakingThreshold?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [amplitude, setAmplitude] = useState(0);     // 0..1 RMS
  const [peak, setPeak] = useState(0);                // 0..1 short-term peak
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    if (!stream || !canvasRef.current) return;

    // Set up Web Audio graph
    const AudioCtor = window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    const audioCtx = new AudioCtor();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.78;
    source.connect(analyser);
    // Note: not connected to destination — we don't play mic back through speakers.

    const bufferLen = analyser.frequencyBinCount;       // 128
    const freqData = new Uint8Array(bufferLen);
    const timeData = new Uint8Array(bufferLen);

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      analyser.getByteFrequencyData(freqData);
      analyser.getByteTimeDomainData(timeData);

      // Compute RMS amplitude from time-domain data
      let sumSq = 0;
      let maxAbs = 0;
      for (let i = 0; i < bufferLen; i++) {
        const v = (timeData[i] - 128) / 128;            // -1..1
        sumSq += v * v;
        const abs = Math.abs(v);
        if (abs > maxAbs) maxAbs = abs;
      }
      const rms = Math.sqrt(sumSq / bufferLen);
      setAmplitude(rms);
      setPeak((prev) => Math.max(prev * 0.94, maxAbs));  // decay
      setSpeaking(rms > speakingThreshold);

      // Render the bars
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const barCount = 24;
      const binsPerBar = Math.floor(bufferLen / barCount);
      const barGap = 2;
      const barWidth = (w - barGap * (barCount - 1)) / barCount;

      for (let b = 0; b < barCount; b++) {
        // Average the bins in this bar
        let sum = 0;
        for (let i = 0; i < binsPerBar; i++) {
          sum += freqData[b * binsPerBar + i];
        }
        const avg = sum / binsPerBar / 255;             // 0..1
        const barHeight = Math.max(2, avg * h);
        const x = b * (barWidth + barGap);
        const y = h - barHeight;

        // Gradient: emerald-700 to emerald-300 by intensity
        const gradient = ctx.createLinearGradient(0, h, 0, y);
        gradient.addColorStop(0, "#047857");           // emerald-700
        gradient.addColorStop(1, "#6ee7b7");           // emerald-300
        ctx.fillStyle = gradient;
        ctx.fillRect(x, y, barWidth, barHeight);
      }

      rafRef.current = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      try { audioCtx.close(); } catch { /* */ }
    };
  }, [stream, speakingThreshold]);

  const pulseScale = 1 + amplitude * 2.4;              // 1..3.4
  const peakPct = Math.round(peak * 100);

  return (
    <div className="rounded-lg border border-emerald-700/40 bg-emerald-950/15 p-4">
      <div className="flex items-center gap-4">
        {/* Pulsing avatar ring */}
        <div className="relative flex h-16 w-16 shrink-0 items-center justify-center">
          <span
            className="absolute inset-0 rounded-full border-2 border-emerald-400 opacity-50"
            style={{
              transform: `scale(${pulseScale})`,
              transition: "transform 0.08s linear",
              opacity: Math.max(0.15, 0.6 - amplitude * 0.7),
            }}
            aria-hidden
          />
          <span
            className={`relative flex h-12 w-12 items-center justify-center rounded-full font-bold text-zinc-950 ${
              speaking ? "bg-emerald-300" : "bg-emerald-500"
            }`}
            style={{ transition: "background-color 0.15s linear" }}
          >
            {recipientInitials.slice(0, 2)}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          {/* Bars canvas */}
          <canvas
            ref={canvasRef}
            width={400}
            height={48}
            className="block h-12 w-full"
            aria-label="Microphone audio visualization"
          />
          <p className="mt-1 flex items-baseline gap-2 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
            <span>peak {peakPct.toString().padStart(2, "0")}%</span>
            <span>·</span>
            <span className={speaking ? "text-emerald-400" : ""}>
              {speaking ? "you're speaking" : "listening"}
            </span>
            <span className="ml-auto">🔒 on-device only</span>
          </p>
        </div>
      </div>
    </div>
  );
}
