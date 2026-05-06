"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateEmergencyConfig, type EmergencyConfig } from "@/modules/admin/emergency-actions";

export function EmergencyForm({ initial }: { initial: EmergencyConfig }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial.emergencyMode);
  const [severity, setSeverity] = useState<"info" | "urgent" | "critical">(initial.severity);
  const [title, setTitle] = useState(initial.title ?? "");
  const [body, setBody] = useState(initial.body ?? "");
  const [ctaLabel, setCtaLabel] = useState(initial.ctaLabel ?? "");
  const [ctaHref, setCtaHref] = useState(initial.ctaHref ?? "");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const r = await updateEmergencyConfig({
        enabled,
        severity,
        title: title.trim() || undefined,
        body: body.trim() || undefined,
        ctaLabel: ctaLabel.trim() || undefined,
        ctaHref: ctaHref.trim() || undefined,
      });
      if ("error" in r) setError(r.error ?? "Failed");
      else {
        setSuccess(true);
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5 rounded-lg border border-zinc-800 bg-zinc-950/40 p-6">
      {/* Enable toggle */}
      <label className="flex cursor-pointer items-start gap-3 rounded-md border border-red-900/30 bg-red-950/10 p-4">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="mt-1 h-5 w-5 rounded border-zinc-700 bg-zinc-950 text-red-500"
        />
        <span>
          <span className="block font-semibold text-red-300">
            Emergency mode {enabled ? "ON" : "OFF"}
          </span>
          <span className="block text-xs text-zinc-400">
            {enabled
              ? "Banner is showing on every page right now."
              : "Banner is hidden. Toggle on to activate site-wide."}
          </span>
        </span>
      </label>

      {/* Severity */}
      <div>
        <label className="block text-xs font-medium text-zinc-400">Severity</label>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {(["info", "urgent", "critical"] as const).map((s) => (
            <label
              key={s}
              className={`cursor-pointer rounded-md border px-3 py-2 text-center text-sm capitalize transition ${
                severity === s
                  ? s === "critical"
                    ? "border-red-500 bg-red-950/30 text-red-300"
                    : s === "urgent"
                      ? "border-amber-500 bg-amber-950/30 text-amber-300"
                      : "border-blue-500 bg-blue-950/30 text-blue-300"
                  : "border-zinc-800 hover:border-zinc-600"
              }`}
            >
              <input type="radio" checked={severity === s} onChange={() => setSeverity(s)} className="hidden" />
              {s}
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-zinc-400">Title (required when on) *</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          placeholder="FDA moves to schedule kratom — call your senator NOW"
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-zinc-400">Body (optional)</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={1000}
          rows={3}
          placeholder="One sentence of context. The headline should carry most of the weight."
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-zinc-400">CTA label (optional)</label>
          <input
            value={ctaLabel}
            onChange={(e) => setCtaLabel(e.target.value)}
            maxLength={80}
            placeholder="Take action"
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-400">CTA URL (optional)</label>
          <input
            type="url"
            value={ctaHref}
            onChange={(e) => setCtaHref(e.target.value)}
            maxLength={500}
            placeholder="/campaigns/stop-fda-2026"
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          />
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {success && (
        <p className="rounded-md border border-emerald-900/40 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
          Saved.
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-emerald-500 px-5 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
