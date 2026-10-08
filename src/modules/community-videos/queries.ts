import { createAnonClient } from "@/lib/supabase/anon";

/**
 * Public reads for /videos (migration 0260). Anon client on purpose: the page
 * is identical for every visitor, so it can be ISR-cached and edge-cached.
 * Descriptions are NOT selected — the page doesn't show them, and every byte
 * here is Supabase egress on each revalidation.
 */

export type VideoChannel = {
  id: string;
  name: string;
  href: string;
  description: string | null;
  youtube_channel_id: string | null;
};

export type CommunityVideo = {
  video_id: string;
  community_id: string;
  title: string;
  published_at: string;
  is_upcoming: boolean;
  scheduled_start_at: string | null;
};

/**
 * Channels, plus videos split into "Live soon" (scheduled, starting within the
 * last 2h or later — soonest first) and "Latest" (newest uploads).
 */
export async function loadVideoPage(limit = 48): Promise<{ channels: VideoChannel[]; upcoming: CommunityVideo[]; latest: CommunityVideo[] }> {
  const sb = createAnonClient();
  const [ch, vids] = await Promise.all([
    sb.from("external_communities")
      .select("id, name, href, description, youtube_channel_id")
      .eq("category", "youtube").eq("is_active", true)
      .order("sort_order", { ascending: true }),
    sb.from("community_videos")
      .select("video_id, community_id, title, published_at, is_upcoming, scheduled_start_at")
      .order("published_at", { ascending: false })
      .limit(limit),
  ]);
  const videos = (vids.data ?? []) as CommunityVideo[];
  const cutoff = Date.now() - 2 * 3600_000;
  const isSoon = (v: CommunityVideo) => v.is_upcoming && !!v.scheduled_start_at && Date.parse(v.scheduled_start_at) > cutoff;
  return {
    channels: (ch.data ?? []) as VideoChannel[],
    upcoming: videos.filter(isSoon).sort((a, b) => Date.parse(a.scheduled_start_at!) - Date.parse(b.scheduled_start_at!)),
    latest: videos.filter((v) => !isSoon(v)).slice(0, 36),
  };
}

/** Subscribe link that opens YouTube's own confirm dialog on the real channel. */
export function subscribeUrl(c: Pick<VideoChannel, "href" | "youtube_channel_id">): string {
  return c.youtube_channel_id
    ? `https://www.youtube.com/channel/${c.youtube_channel_id}?sub_confirmation=1`
    : c.href;
}
