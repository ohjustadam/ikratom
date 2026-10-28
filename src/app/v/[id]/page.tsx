import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * /v/<id>: the short, branded link a letter uses for its recorded message.
 *
 * Letters used to end with the raw storage URL (about 150 characters on
 * supabase.co), which Paul said looks like spam and may scare an office off
 * clicking it (2026-10-28). This page plays the same file from the same public
 * bucket, with the member's own transcript when they gave one. It shows no
 * name or account details, is not indexed, and disappears when the member
 * withdraws the recording.
 */
export const revalidate = 86400;

export function generateStaticParams() {
  return [];
}

export const metadata: Metadata = {
  title: "A recorded message",
  robots: { index: false, follow: false },
};

type Clip = { kind: "audio" | "video"; storage_path: string; duration_seconds: number | null; transcript: string | null };

const getClip = unstable_cache(
  async (id: string): Promise<Clip | null> => {
    const { data } = await createServiceRoleClient()
      .from("campaign_attachments")
      .select("kind, storage_path, duration_seconds, transcript")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    return (data as Clip | null) ?? null;
  },
  ["voice-clip"],
  { revalidate: 86400 },
);

export default async function ClipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const clip = await getClip(id);
  if (!clip) notFound();
  const src = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/campaign-attachments/${clip.storage_path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  const secs = clip.duration_seconds ? ` · ${clip.duration_seconds} seconds` : "";

  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
        {clip.kind === "video" ? "Video message" : "Voice message"}{secs}
      </p>
      <h1 className="mt-2 text-2xl font-bold text-zinc-100">A recorded message sent with a letter</h1>
      <p className="mt-2 text-sm text-zinc-400">
        The person who wrote to you recorded this to go with their letter.
      </p>
      <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
        {clip.kind === "video" ? (
          <video controls preload="metadata" src={src} className="w-full rounded" />
        ) : (
          <audio controls preload="metadata" src={src} className="w-full" />
        )}
      </div>
      {clip.transcript && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Transcript</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">{clip.transcript}</p>
        </section>
      )}
      <p className="mt-10 text-xs text-zinc-500">
        Sent with iKratom, a free, nonpartisan tool that helps people write to their elected officials.
      </p>
    </div>
  );
}
