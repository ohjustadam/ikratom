"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { testDiscordIntegration } from "@/modules/discord/actions";

export function TestPostButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function onClick() {
    setMsg(null);
    startTransition(async () => {
      const r = await testDiscordIntegration(id);
      if ("error" in r) setMsg(r.error ?? "Failed");
      else {
        setMsg("✓ posted");
        router.refresh();
        setTimeout(() => setMsg(null), 4000);
      }
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={onClick}
        disabled={pending}
        className="rounded-md border border-zinc-700 px-2 py-0.5 text-[11px] hover:border-emerald-500 disabled:opacity-40"
      >
        {pending ? "…" : "Test post"}
      </button>
      {msg && (
        <span className={`text-[10px] ${msg.startsWith("✓") ? "text-emerald-400" : "text-red-400"}`}>{msg}</span>
      )}
    </span>
  );
}
