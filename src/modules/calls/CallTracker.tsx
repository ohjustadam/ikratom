"use client";

import { useEffect, useRef, useState } from "react";
import { startCallSession, updateCallTranscript, endCallSession } from "./actions";
import { TWO_PARTY_CONSENT_STATES } from "./consent";
import { MicVisualizer } from "./MicVisualizer";

/**
 * In-app call-tracking UI.
 *
 * Flow:
 *   1. User sees a "Call <recipient>" panel with the phone number.
 *   2. Optional: tick "Track this call" + (for 2-party states) confirm
 *      they will recite the disclosure line.
 *   3. Tap "Call now" — fires tel: link to launch device dialer.
 *   4. If tracking: app records session start, optionally starts Web
 *      Speech API live transcription.
 *   5. User taps "End call" + picks outcome → session finalized + AI
 *      summary generated.
 *
 * Web Speech API is supported in Chrome/Edge/Safari (iOS+macOS).
 * Firefox doesn't support it — UI shows a clear fallback.
 */
export function CallTracker({
  legislatorId,
  campaignId,
  billId,
  recipientName,
  recipientPhone,
  recipientRole,
  recipientOffice,
  state,
}: {
  legislatorId?: string | null;
  campaignId?: string | null;
  billId?: string | null;
  recipientName: string;
  recipientPhone: string;
  recipientRole?: string | null;
  recipientOffice?: string | null;
  state?: string | null;
}) {
  const [trackingEnabled, setTrackingEnabled] = useState(false);
  const [recordingConsent, setRecordingConsent] = useState(false);
  const [disclosureRecited, setDisclosureRecited] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "calling" | "ended">("idle");
  const [transcript, setTranscript] = useState("");
  const [notes, setNotes] = useState("");
  const [submitForReview, setSubmitForReview] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [summaryMd, setSummaryMd] = useState<string | null>(null);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [micError, setMicError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionWrapper | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number | null>(null);

  const requireTwoParty = !!state && TWO_PARTY_CONSENT_STATES.has(state.toUpperCase());
  const consentValid = !recordingConsent || !requireTwoParty || disclosureRecited;
  const supportsSpeechRecognition = typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  // Tick duration while in 'calling' phase
  useEffect(() => {
    if (phase !== "calling" || !startedAtRef.current) return;
    intervalRef.current = setInterval(() => {
      setDuration(Math.floor((Date.now() - (startedAtRef.current ?? Date.now())) / 1000));
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [phase]);

  async function handleCall() {
    setErrorMsg(null);
    if (trackingEnabled) {
      const r = await startCallSession({
        legislatorId, campaignId, billId,
        recipientName, recipientPhone, recipientRole, recipientOffice, state,
        recordingConsent,
        twoPartyDisclosureRecited: requireTwoParty ? disclosureRecited : null,
      });
      if ("error" in r) {
        setErrorMsg(r.error ?? "Failed to start session");
        return;
      }
      setSessionId(r.sessionId);
      startedAtRef.current = Date.now();
      setPhase("calling");

      // Request mic ONCE — same stream feeds the visualizer + speech
      // recognition. No mic = no visualizer, no transcript. Audio
      // bytes never leave the device.
      if (recordingConsent) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          });
          setMicStream(stream);
          if (supportsSpeechRecognition) startRecognition();
        } catch (e) {
          setMicError("Microphone permission denied — visualizer + transcript will be disabled, but the call still works.");
          console.error("[mic]", e);
        }
      }
    }
    // Launch the dialer
    window.location.href = `tel:${recipientPhone}`;
  }

  function startRecognition() {
    if (!supportsSpeechRecognition) return;
    // Web Speech API is non-standard; TypeScript's DOM lib doesn't ship
    // its constructor types. Use a structural cast.
    // NOTE: Web Speech API requests its OWN mic permission internally;
    // we already prompted via getUserMedia, so this call is silent.
    type SRConstructor = new () => {
      continuous: boolean;
      interimResults: boolean;
      lang: string;
      onresult: (e: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] & { length: number } }) => void;
      onerror: (e: { error: string }) => void;
      onend: () => void;
      start: () => void;
      stop: () => void;
    };
    const win = window as unknown as { SpeechRecognition?: SRConstructor; webkitSpeechRecognition?: SRConstructor };
    const SR = win.SpeechRecognition ?? win.webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";

    let final = "";
    rec.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) final += result[0].transcript + " ";
        else interim += result[0].transcript;
      }
      setTranscript(final + (interim ? `\n[…${interim}…]` : ""));
    };
    rec.onerror = (e) => {
      console.error("[speech]", e.error);
    };
    rec.onend = () => {
      if (phase === "calling") {
        try { rec.start(); } catch { /* already running */ }
      }
    };

    try {
      rec.start();
      recognitionRef.current = { stop: () => rec.stop() };
    } catch (e) {
      console.error("[speech start]", e);
    }
  }

  async function handleEnd(outcome: "reached" | "voicemail" | "busy" | "declined" | "no_answer") {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    if (intervalRef.current) clearInterval(intervalRef.current);
    // Release microphone — turns off the OS-level "mic in use" indicator.
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      setMicStream(null);
    }
    if (!sessionId) {
      setPhase("ended");
      return;
    }
    const r = await endCallSession({
      sessionId,
      outcome,
      transcript_md: transcript,
      user_notes_md: notes,
      submitForReview,
    });
    if ("error" in r) {
      setErrorMsg(r.error ?? "Failed to end session");
      return;
    }
    setSummaryMd(r.summary ?? null);
    setPhase("ended");
  }

  // ─── Render states ───────────────────────────────────────────────

  if (phase === "ended") {
    return (
      <div className="rounded-lg border border-emerald-700/40 bg-emerald-950/15 p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-300">
          ✓ Call logged
        </p>
        <h3 className="mt-2 text-lg font-bold">{recipientName}</h3>
        <p className="mt-1 text-sm text-zinc-300">
          Duration: <span className="font-mono">{formatDur(duration)}</span> ·{" "}
          {trackingEnabled ? "Tracked" : "Untracked"}{submitForReview && " · Submitted for review"}
        </p>
        {summaryMd && (
          <div className="mt-4 rounded border border-zinc-800 bg-zinc-950/40 p-3 text-sm text-zinc-200 whitespace-pre-wrap">
            {summaryMd}
          </div>
        )}
        <a
          href="/account/calls"
          className="mt-4 inline-block text-xs font-semibold text-emerald-400 hover:underline"
        >
          See your call history →
        </a>
      </div>
    );
  }

  if (phase === "calling") {
    const initials = recipientName.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
    return (
      <div className="rounded-lg border border-emerald-700/60 bg-emerald-950/25 p-5">
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-300">
            📞 On the call · {formatDur(duration)}
          </p>
          <a href={`tel:${recipientPhone}`} className="text-xs text-emerald-400 hover:underline">
            redial
          </a>
        </div>
        <h3 className="mt-2 text-lg font-bold">{recipientName}</h3>

        {/* Live mic visualizer — pulses with user's voice while on call.
            Audio stays on device. Recommends earbuds for private listen. */}
        {micStream && (
          <div className="mt-3">
            <MicVisualizer stream={micStream} recipientInitials={initials} />
            <p className="mt-1 text-[10px] text-zinc-500">
              💡 <strong>Use earbuds with a mic</strong> for a private call. Otherwise put your phone on speakerphone so the app can pick up both sides.
            </p>
          </div>
        )}
        {micError && (
          <p className="mt-3 rounded border border-amber-700/40 bg-amber-950/15 p-2 text-[11px] text-amber-200">
            {micError}
          </p>
        )}

        {recordingConsent && supportsSpeechRecognition && (
          <div className="mt-3">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              Live transcript (Web Speech API, on-device)
            </label>
            <textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              rows={6}
              className="mt-1 block w-full rounded border border-zinc-800 bg-zinc-950 p-2 text-sm"
              placeholder="Transcript will appear as you speak..."
              onBlur={() => sessionId && updateCallTranscript({ sessionId, transcript_md: transcript })}
            />
          </div>
        )}
        <div className="mt-3">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Your notes (private)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="e.g. ‘Said she'd consider it’, ‘asked for follow-up after May 18’"
            className="mt-1 block w-full rounded border border-zinc-800 bg-zinc-950 p-2 text-sm"
          />
        </div>
        <label className="mt-3 flex items-center gap-2 text-xs text-zinc-300">
          <input
            type="checkbox"
            checked={submitForReview}
            onChange={(e) => setSubmitForReview(e.target.checked)}
            className="accent-emerald-500"
          />
          Submit this transcript for admin review to add to the public "what is government saying" intel.
        </label>
        <p className="mt-3 text-xs text-zinc-500">How did the call end?</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => handleEnd("reached")}
            className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
          >
            ✓ Reached them
          </button>
          <button
            type="button"
            onClick={() => handleEnd("voicemail")}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm hover:border-emerald-500"
          >
            📨 Left voicemail
          </button>
          <button
            type="button"
            onClick={() => handleEnd("no_answer")}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm hover:border-emerald-500"
          >
            🔇 No answer
          </button>
          <button
            type="button"
            onClick={() => handleEnd("busy")}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm hover:border-emerald-500"
          >
            ☎️ Busy
          </button>
          <button
            type="button"
            onClick={() => handleEnd("declined")}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm hover:border-zinc-500"
          >
            🚫 Declined to speak
          </button>
        </div>
        {errorMsg && <p className="mt-3 text-xs text-red-400">{errorMsg}</p>}
      </div>
    );
  }

  // Idle (pre-call)
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
        📞 Call this decision-maker
      </p>
      <h3 className="mt-2 text-lg font-bold">{recipientName}</h3>
      {recipientRole && <p className="text-[11px] uppercase tracking-wider text-zinc-500">{recipientRole}{recipientOffice && ` · ${recipientOffice}`}</p>}
      <p className="mt-2 font-mono text-sm text-zinc-300">{recipientPhone}</p>

      <label className="mt-4 flex items-center gap-2 text-sm text-zinc-200">
        <input
          type="checkbox"
          checked={trackingEnabled}
          onChange={(e) => setTrackingEnabled(e.target.checked)}
          className="accent-emerald-500"
        />
        Track this call (for goals + achievements)
      </label>

      {trackingEnabled && supportsSpeechRecognition && (
        <>
          <label className="mt-2 flex items-center gap-2 text-sm text-zinc-200">
            <input
              type="checkbox"
              checked={recordingConsent}
              onChange={(e) => setRecordingConsent(e.target.checked)}
              className="accent-emerald-500"
            />
            Transcribe live + show audio waveform (free, on-device only)
          </label>
          {recordingConsent && (
            <p className="ml-6 mt-1 text-[11px] text-zinc-500">
              💡 <strong>Use earbuds with a mic</strong> to keep the call private. Speakerphone also works but anyone nearby will hear.
            </p>
          )}
        </>
      )}

      {trackingEnabled && !supportsSpeechRecognition && (
        <p className="mt-2 rounded border border-amber-700/40 bg-amber-950/15 p-2 text-[11px] text-amber-200">
          Your browser doesn't support live speech recognition. You can still track the call + add notes manually.
        </p>
      )}

      {recordingConsent && requireTwoParty && (
        <div className="mt-3 rounded border border-amber-700/40 bg-amber-950/15 p-3 text-xs text-amber-100">
          <p className="font-semibold">⚠ Two-party-consent state ({state}). You must recite this before recording starts:</p>
          <p className="my-2 italic text-amber-200">
            &ldquo;Hi, my name is [your name]. I&apos;m calling about kratom policy and I&apos;m recording this call
            for advocacy tracking purposes — is that okay with you?&rdquo;
          </p>
          <label className="flex items-center gap-2 text-xs text-amber-200">
            <input
              type="checkbox"
              checked={disclosureRecited}
              onChange={(e) => setDisclosureRecited(e.target.checked)}
              className="accent-amber-500"
            />
            I will read the disclosure to the recipient before any sensitive conversation.
          </label>
        </div>
      )}

      <button
        type="button"
        onClick={handleCall}
        disabled={trackingEnabled && !consentValid}
        className="mt-4 inline-flex items-center gap-2 rounded-md bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
      >
        📞 Call now
      </button>
      {errorMsg && <p className="mt-3 text-xs text-red-400">{errorMsg}</p>}
    </div>
  );
}

function formatDur(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

type SpeechRecognitionWrapper = { stop: () => void };
