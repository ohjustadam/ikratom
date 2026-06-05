"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { submitFeedback } from "@/modules/feedback/actions";

/**
 * Floating feedback / error-report widget. Fixed to the right edge,
 * vertically centered, on every page (mounted in the root layout). Click
 * opens a slide-out panel: message + optional screenshot. Works for both
 * signed-in and anonymous users.
 */
export default function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setError(null);
    const msg = message.trim();
    if (!msg) {
      setError("Please enter a message.");
      return;
    }
    setSending(true);
    try {
      const res = await submitFeedback({
        message: msg,
        pageUrl: typeof window !== "undefined" ? window.location.href : undefined,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
        screenshotMime: file?.type ?? null,
      });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      if (res.signedUpload && file) {
        const sb = createClient();
        const { error: upErr } = await sb.storage
          .from(res.signedUpload.bucket)
          .uploadToSignedUrl(res.signedUpload.path, res.signedUpload.token, file);
        // Feedback itself is already saved; a failed screenshot upload is
        // non-fatal — don't block the success state on it.
        if (upErr) console.warn("[feedback] screenshot upload failed:", upErr.message);
      }
      setDone(true);
      setMessage("");
      setFile(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setDone(false);
        }}
        aria-label="Send feedback"
        className="fixed right-0 top-1/2 z-40 -translate-y-1/2 rounded-l-lg bg-emerald-600 px-2 py-4 text-xs font-semibold text-white shadow-lg hover:bg-emerald-500 [writing-mode:vertical-rl]"
      >
        Feedback
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="Close feedback panel"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/50"
          />
          <div className="relative z-10 flex h-full w-full max-w-sm flex-col gap-3 overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-5 text-zinc-100 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Send feedback</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-zinc-400 hover:text-zinc-200"
              >
                ✕
              </button>
            </div>

            {done ? (
              <div className="rounded-lg border border-emerald-700/40 bg-emerald-950/20 p-4 text-sm text-emerald-200">
                Thanks! Your feedback was sent to the team.
                <button
                  type="button"
                  onClick={() => setDone(false)}
                  className="mt-3 block text-xs text-emerald-400 hover:underline"
                >
                  Send another
                </button>
              </div>
            ) : (
              <>
                <p className="text-xs text-zinc-400">
                  Found a bug or have an idea? Tell us what happened — you can attach a screenshot.
                </p>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={6}
                  maxLength={5000}
                  placeholder="What's on your mind?"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-600 focus:outline-none"
                />
                <label className="text-xs text-zinc-400">
                  Screenshot (optional)
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    className="mt-1 block w-full text-xs text-zinc-400 file:mr-3 file:rounded file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-zinc-200"
                  />
                </label>
                {error && <p className="text-sm text-red-400">{error}</p>}
                <button
                  type="button"
                  onClick={send}
                  disabled={sending}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {sending ? "Sending…" : "Send feedback"}
                </button>
                <p className="text-[10px] text-zinc-600">
                  Your page URL and browser are attached to help us reproduce issues.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
