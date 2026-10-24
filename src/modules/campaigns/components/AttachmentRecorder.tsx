"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { recordAttachmentMetadata } from "../actions-attachments";
import {
  extForContentType,
  mediaErrorMessage,
  pickRecorderMime,
  uploadContentType,
  type ClipKind,
} from "../recorder-support";

/**
 * Browser MediaRecorder → Supabase Storage uploader. Lets advocates
 * attach a 30-second video or audio message to their legislator email.
 *
 * Flow:
 *   1. User clicks "Record video" or "Record audio"
 *   2. getUserMedia → MediaRecorder collects 30s max (WebM, or MP4 on iOS)
 *   3. Optional Web Speech API live transcript runs alongside (desktop only:
 *      on phones it fights the recorder for the microphone)
 *   4. On stop: upload the Blob to storage at <user_id>/<uuid>.<ext>
 *   5. Server action persists metadata, returns public URL
 *   6. Caller adds "Listen to my 30-second message: <url>" to the letter
 *
 * The page's Permissions-Policy must allow camera/microphone for 'self'
 * (next.config.ts); until 2026-10-24 it denied both, so the buttons did nothing.
 */

const MAX_SECONDS = 30;
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB hard cap, same as the bucket (0217)

export function AttachmentRecorder({
  onAttached,
}: {
  onAttached: (attachment: { url: string; kind: ClipKind; transcript: string | null; durationSeconds: number }) => void;
}) {
  const [mode, setMode] = useState<null | ClipKind>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [attached, setAttached] = useState<ClipKind | null>(null);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // The finished clip. Kept as a Blob: fetch()ing its blob: URL is refused by
  // our CSP's connect-src, which does not list blob:.
  const blobRef = useRef<Blob | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef(0);
  const durationRef = useRef(0);
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
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  async function start(kind: ClipKind) {
    setError(null);
    setAttached(null);
    setPreviewUrl(null);
    setTranscript("");
    chunksRef.current = [];
    blobRef.current = null;
    setElapsed(0);

    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw Object.assign(new Error("unsupported"), { name: "Unsupported" });
      }
      // getUserMedia must be the first await, so iOS still sees the tap.
      const stream = await navigator.mediaDevices.getUserMedia(
        kind === "video"
          ? { video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: true }
          : { audio: true },
      );
      streamRef.current = stream;
      setMode(kind);

      const mimeType = pickRecorderMime(kind, (t) => MediaRecorder.isTypeSupported(t));
      // Modest bitrates keep 30 s of phone video well under the 25 MB cap.
      const recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 64_000,
        ...(kind === "video" ? { videoBitsPerSecond: 1_000_000 } : {}),
      });
      mediaRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const type = uploadContentType(chunksRef.current[0]?.type || recorder.mimeType, kind);
        const blob = new Blob(chunksRef.current, { type });
        if (blob.size === 0) {
          setError("Nothing was recorded. Try again.");
          setMode(null);
          return;
        }
        if (blob.size > MAX_BYTES) {
          setError("Recording is too large (max 25 MB). Try a shorter clip.");
          return;
        }
        blobRef.current = blob;
        setPreviewUrl(URL.createObjectURL(blob));
      };
      recorder.start();
      startedAtRef.current = Date.now();

      // Live transcript via Web Speech API (best-effort, desktop Chromium only)
      const SR =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
      const phone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (SR && !phone) {
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

      // Elapsed timer + auto-stop at MAX (side effects stay out of state updaters)
      tickRef.current = setInterval(() => {
        const secs = Math.floor((Date.now() - startedAtRef.current) / 1000);
        setElapsed(Math.min(secs, MAX_SECONDS));
        if (secs >= MAX_SECONDS) stop();
      }, 250);

      setRecording(true);
    } catch (e) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setError(mediaErrorMessage(e, kind));
      setMode(null);
    }
  }

  function stop() {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    durationRef.current = Math.max(1, Math.min(MAX_SECONDS, Math.round((Date.now() - startedAtRef.current) / 1000)));
    if (mediaRef.current && mediaRef.current.state !== "inactive") {
      mediaRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    try { recognitionRef.current?.stop(); } catch { /* ignore */ }
    setRecording(false);
  }

  function discard() {
    setMode(null);
    setPreviewUrl(null);
    setTranscript("");
    setElapsed(0);
    chunksRef.current = [];
    blobRef.current = null;
  }

  async function upload() {
    const blob = blobRef.current;
    if (!blob || !mode) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError("Sign in to attach."); setBusy(false); return; }

      const filename = `${user.id}/${crypto.randomUUID()}.${extForContentType(blob.type)}`;
      const { error: upErr } = await supabase.storage
        .from("campaign-attachments")
        .upload(filename, blob, { contentType: blob.type, upsert: false });
      if (upErr) { setError(`Upload failed: ${upErr.message}`); setBusy(false); return; }

      const r = await recordAttachmentMetadata({
        kind: mode,
        storagePath: filename,
        durationSeconds: durationRef.current,
        sizeBytes: blob.size,
        transcript: transcript.trim() || undefined,
      });
      if ("error" in r) { setError(r.error ?? "Failed"); setBusy(false); return; }

      onAttached({
        url: r.publicUrl,
        kind: mode,
        transcript: transcript.trim() || null,
        durationSeconds: durationRef.current,
      });
      setAttached(mode);
      discard();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const errorBox = error && (
    <p role="alert" className="mt-2 rounded-md border border-red-900/40 bg-red-950/40 px-3 py-1.5 text-xs text-red-300">
      {error}
    </p>
  );

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
      {!mode && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
            🎙 Personal message
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            {attached
              ? `✓ ${attached === "video" ? "Video" : "Audio"} attached. Its link is at the end of your letter above.`
              : "Attach a 30-second video or audio clip. Legislators read these."}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => start("audio")}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:border-emerald-500"
            >
              🎤 {attached ? "Record again (audio)" : "Record audio"}
            </button>
            <button
              type="button"
              onClick={() => start("video")}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:border-emerald-500"
            >
              📹 {attached ? "Record again (video)" : "Record video"}
            </button>
          </div>
          {errorBox}
        </div>
      )}

      {mode && (
        <div>
          {mode === "video" && recording && (
            <video
              ref={(el) => {
                videoRef.current = el;
                if (el && streamRef.current && el.srcObject !== streamRef.current) {
                  el.srcObject = streamRef.current;
                  el.play().catch(() => { /* autoplay refusal: the stream still records */ });
                }
              }}
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
                  <video src={previewUrl} controls playsInline className="aspect-video max-w-sm rounded-md bg-zinc-950" />
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

          {errorBox}

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
              onClick={() => { if (recording) stop(); discard(); }}
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
