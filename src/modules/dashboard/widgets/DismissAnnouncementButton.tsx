"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { dismissAnnouncement } from "@/modules/announcements/actions";

export function DismissAnnouncementButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      await dismissAnnouncement(id);
      router.refresh();
    });
  }

  return (
    <button
      onClick={onClick}
      disabled={pending}
      aria-label="Dismiss"
      className="shrink-0 rounded-md border border-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500 hover:border-zinc-600 hover:text-zinc-300 disabled:opacity-40"
    >
      ✕
    </button>
  );
}
