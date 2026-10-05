import Link from "next/link";
import { loadVideoPage, subscribeUrl, type CommunityVideo } from "@/modules/community-videos/queries";
import { VideoCard } from "./VideoCard";

export const metadata = {
  title: "Kratom videos",
  description: "The latest videos from kratom advocacy organizations and independent creators, in one place.",
};

// Same for every visitor: anon reads, ISR, and edge-cacheable (see
// scripts/cloudflare-cache-setup.mjs). 48 renders a day at most.
export const revalidate = 1800;

const ET = "America/New_York";
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: ET, month: "short", day: "numeric", year: "numeric" });
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: ET, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

export default async function VideosPage() {
  const { channels, upcoming, latest } = await loadVideoPage();
  const byId = new Map(channels.map((c) => [c.id, c]));

  const card = (v: CommunityVideo, badge?: string) => {
    const c = byId.get(v.community_id);
    if (!c) return null;
    return (
      <VideoCard key={v.video_id} id={v.video_id} title={v.title} channelName={c.name}
        subscribeHref={subscribeUrl(c)} badge={badge}
        dateLabel={badge && v.scheduled_start_at ? when(v.scheduled_start_at) : day(v.published_at)} />
    );
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">Watch</p>
        <h1 className="mt-2 text-4xl font-bold">Kratom videos</h1>
        <p className="mt-3 max-w-2xl text-zinc-400">
          The newest uploads from kratom advocacy organizations and independent creators, newest first.
          Videos play right here; likes and subscriptions go to each creator&apos;s own channel.
          iKratom is independent and doesn&apos;t endorse any organization.
        </p>
      </header>

      {upcoming.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-red-400">🔴 Live soon</h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{upcoming.map((v) => card(v, "Upcoming"))}</ul>
        </section>
      )}

      <section className="mb-12">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">Latest</h2>
        {latest.length === 0 ? (
          <p className="rounded-lg border border-zinc-800 p-8 text-center text-sm text-zinc-500">Videos are on their way — check back shortly.</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{latest.map((v) => card(v))}</ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">Channels</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {channels.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
              <div>
                <a href={c.href} target="_blank" rel="noopener noreferrer" className="font-semibold text-zinc-100 hover:text-emerald-300">{c.name}</a>
                {c.description && <p className="mt-1 text-sm text-zinc-400">{c.description}</p>}
              </div>
              <a href={subscribeUrl(c)} target="_blank" rel="noopener noreferrer"
                className="shrink-0 rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500">Subscribe</a>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-zinc-500">
          Know a channel we should include? <Link href="/support" className="text-emerald-400 hover:underline">Tell us</Link>.
        </p>
      </section>
    </div>
  );
}
