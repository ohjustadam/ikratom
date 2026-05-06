"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { recordAttachmentMetadata } from "../actions-attachments";

/**
 * Browser MediaRecorder → Supabase Storage uploader. Lets advocates
 * attach a 30-second video or audio message to their legislator email.
 *
 * Flow:
 *   1. User clicks "Record video" or "Record audio"
 *   2. getUserMedia → MediaRecorder collects 30s max
 *   3. Optional Web Speech API live transcript runs alongside (audio only)
 *   4. On stop: upload Blob to storage at <user_id>/<uuid>.webm
 *   5. Server action persists metadata, returns public URL
 *   6. Caller appends "📹 Watch my message: <url>\n\n<transcript>" to email body
 */

const MAX_SECONDS = 30;
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB hard cap

export function AttachmentRecorder({
  onAttached,
}: {
  onAttached: (attachment: { url: string; kind: "audio" | "video"; transcript: string | null; durationSeconds: number }) => void;
}) {
  const [mode, setMode] = useState<null | "audio" | "video">(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  // Web Speech recognition is gated behind a browser check
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (tickRef.current) clearInterval(tickRef.current);
      try { recognitionRef.current?.stop(); } catch { /* ignore */ }
    };
  }, []);

  async function start(kind: "audio" | "video") {
    setError(null);
    setPreviewUrl(null);
    setTranscript("");
    chunksRef.current = [];
    setMode(kind);
    setElapsed(0);

    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        kind === "video" ? { video: true, audio: true } : { audio: true },
      );
      streamRef.current = stream;
      if (kind === "video" && videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        videoRef.current.play();
      }

      const recorder = new MediaRecorder(stream);
      mediaRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type ?? "audio/webm" });
        if (blob.size > MAX_BYTES) {
          setError("Recording is too large (max 25 MB).");
          return;
        }
        setPreviewUrl(URL.createObjectURL(blob));
      };
      recorder.start();

      // Live transcript via Web Speech API (best-effort, Chromium only)
      const SR =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
      if (SR) {
        const r = new SR();
        r.continuous = true;
        r.interimResults = true;
        r.lang = "en-US";
        let finalText = "";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        r.onresult = (event: any) => {
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const res = event.results[i];
            if (res.isFinal) finalText += res[0].transcript + " ";
            setTranscript(finalText + (res.isFinal ? "" : res[0].transcript));
          }
        };
        try { r.start(); recognitionRef.current = r; } catch { /* ignore */ }
      }

      // Elapsed timer + auto-stop at MAX
      tickRef.current = setInterval(() => {
        setElapsed((e) => {
          const next = e + 1;
          if (next >= MAX_SECONDS) stop();
          return next;
        });
      }, 1000);

      setRecording(true);
    } catch (e) {
      setError((e as Error).message || "Could not access microphone/camera.");
      setMode(null);
    }
  }

  function stop() {
    if (mediaRef.current && mediaRef.current.state !== "inactive") {
      mediaRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    try { recognitionRef.current?.stop(); } catch { /* ignore */ }
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    setRecording(false);
  }

  function discard() {
    setMode(null);
    setPreviewUrl(null);
    setTranscript("");
    setElapsed(0);
    chunksRef.current = [];
  }

  async function upload() {
    if (!previewUrl || !mode) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError("Sign in to attach."); setBusy(false); return; }

      const blob = await fetch(previewUrl).then((r) => r.blob());
      const ext = mode === "video" ? "webm" : "webm";
      const filename = `${user.id}/${crypto.randomUUID()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from("campaign-attachments")
        .upload(filename, blob, { contentType: blob.type, upsert: false });
      if (upErr) { setError(upErr.message); setBusy(false); return; }

      const r = await recordAttachmentMetadata({
        kind: mode,
        storagePath: filename,
        durationSeconds: elapsed,
        sizeBytes: blob.size,
        transcript: transcript.trim() || undefined,
      });
      if ("error" in r) { setError(r.error ?? "Failed"); setBusy(false); return; }

      onAttached({
        url: r.publicUrl,
        kind: mode,
        transcript: transcript.trim() || null,
        durationSeconds: elapsed,
      });
      discard();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
      {!mode && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
            🎙 Personal message
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            Attach a 30-second video or audio clip. Legislators read these.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => start("audio")}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:border-emerald-500"
            >
              🎤 Record audio
            </button>
            <button
              type="button"
              onClick={() => start("video")}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:border-emerald-500"
            >
              📹 Record video
            </button>
          </div>
        </div>
      )}

      {mode && (
        <div>
          {mode === "video" && (
            <video
              ref={videoRef}
              className="aspect-video w-full max-w-sm rounded-md bg-zinc-950"
              playsInline
              autoPlay
              muted
            />
          )}

          <div className="mt-2 flex items-center gap-3 text-sm">
            {recording ? (
              <>
                <span className="inline-flex items-center gap-2 text-red-400">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-red-500"></span>
                  Recording {elapsed}s / {MAX_SECONDS}s
                </span>
                <button
                  type="button"
                  onClick={stop}
                  className="rounded-md bg-red-500 px-3 py-1 text-xs font-semibold text-zinc-950 hover:bg-red-400"
                >
                  Stop
                </button>
              </>
            ) : previewUrl ? (
              <>
                {mode === "audio" && <audio src={previewUrl} controls className="max-w-full" />}
                {mode === "video" && (
                  <video src={previewUrl} controls className="aspect-video max-w-sm rounded-md bg-zinc-950" />
                )}
              </>
            ) : null}
          </div>

          {transcript && (
            <details className="mt-2 text-xs text-zinc-400">
              <summary className="cursor-pointer">Transcript ({transcript.length} chars)</summary>
              <p className="mt-1 whitespace-pre-line text-zinc-300">{transcript}</p>
            </details>
          )}

          {error && (
            <p className="mt-2 rounded-md border border-red-900/40 bg-red-950/40 px-3 py-1.5 text-xs text-red-300">
              {error}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {previewUrl && !recording && (
              <button
                type="button"
                onClick={upload}
                disabled={busy}
                className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
              >
                {busy ? "Uploading…" : "Attach to email"}
              </button>
            )}
            <button
              type="button"
              onClick={discard}
              disabled={busy}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:border-zinc-500 disabled:opacity-50"
            >
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
