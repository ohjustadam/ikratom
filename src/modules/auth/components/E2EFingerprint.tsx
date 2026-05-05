"use client";

import { useEffect, useState } from "react";
import {
  fingerprintForPublicKey,
  getOrCreateKeypair,
  regenerateKeypair,
} from "@/lib/crypto/e2e";
import { setPublicKey } from "@/modules/dm/actions";

export function E2EFingerprint() {
  const [publicKey, setPublicKeyLocal] = useState<string | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const kp = await getOrCreateKeypair();
      setPublicKeyLocal(kp.publicKey);
      setFingerprint(await fingerprintForPublicKey(kp.publicKey));
    })();
  }, []);

  async function regenerate() {
    if (
      !confirm(
        "Regenerate your encryption keypair?\n\nYou'll lose access to messages in your existing conversations on this device. New messages will work fine — the other person will see a 'key changed' note."
      )
    ) return;

    setBusy(true);
    setMsg(null);
    try {
      const kp = await regenerateKeypair();
      const r = await setPublicKey(kp.publicKey);
      if ("error" in r && r.error) {
        setMsg(`✗ ${r.error}`);
      } else {
        setPublicKeyLocal(kp.publicKey);
        setFingerprint(await fingerprintForPublicKey(kp.publicKey));
        setMsg("✓ New keypair generated and uploaded.");
      }
    } catch (e) {
      setMsg(`✗ ${(e as Error).message}`);
    }
    setBusy(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-950/30 text-lg">
          🔒
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-zinc-100">End-to-end encryption</h3>
          <p className="mt-1 text-xs text-zinc-400">
            Direct messages are encrypted on your device before they leave. Even iKratom
            can&apos;t read them. Your private key lives on this device only — never
            uploaded to the server.
          </p>
        </div>
      </div>

      {/* Optional fingerprint reveal — only for advanced users */}
      <details className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
        <summary className="cursor-pointer text-xs text-zinc-400 hover:text-emerald-400">
          Advanced — show my key fingerprint
        </summary>
        <div className="mt-3 space-y-2">
          <p className="text-xs text-zinc-500">
            Your <strong>public key fingerprint</strong> identifies your device on the platform.
            You can share this fingerprint out-of-band (text, call) with someone you message,
            and have them confirm yours matches what they see — that proves no one is
            impersonating either of you. Optional.
          </p>
          {fingerprint ? (
            <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
              <p className="font-mono text-xs text-zinc-200">{fingerprint}</p>
            </div>
          ) : (
            <p className="text-xs text-zinc-500">Generating…</p>
          )}
          {publicKey && (
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="text-xs text-emerald-400 hover:underline"
            >
              {show ? "Hide" : "Show"} full public key
            </button>
          )}
          {show && publicKey && (
            <textarea
              readOnly
              value={publicKey}
              rows={3}
              className="w-full rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2 font-mono text-xs"
            />
          )}
          <div className="flex flex-col gap-2 border-t border-zinc-900 pt-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-zinc-500">
              Lost access on a new device? Regenerate to start fresh — old conversations stay private.
            </p>
            <button
              type="button"
              onClick={regenerate}
              disabled={busy}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:border-amber-500 hover:text-amber-300 disabled:opacity-50"
            >
              {busy ? "…" : "Regenerate keypair"}
            </button>
          </div>
          {msg && (
            <p className={`text-xs ${msg.startsWith("✓") ? "text-emerald-300" : "text-red-300"}`}>
              {msg}
            </p>
          )}
        </div>
      </details>
    </div>
  );
}
