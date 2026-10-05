/**
 * sync-community-videos.mjs — mirror kratom orgs' and creators' YouTube uploads
 * into community_videos for /videos (migration 0260).
 *
 * Channels are external_communities rows with category 'youtube' and is_active.
 * Add one in /admin/external-communities with ANY YouTube URL (@handle or
 * /channel/UC...); this script resolves and stores the channel id.
 *
 * Keyless and quota-free: https://www.youtube.com/feeds/videos.xml?channel_id=…
 * returns each channel's 15 newest uploads. Upcoming live streams / premieres
 * are detected from the public watch page, only for new or still-upcoming
 * videos and capped per run, so a run is ~1 request per channel plus a few.
 * Video bytes and thumbnails never touch our infrastructure.
 *
 *   node --env-file=.env.local scripts/sync-community-videos.mjs --dry-run
 */
import { createClient } from "@supabase/supabase-js";

const DRY = process.argv.includes("--dry-run");
const MAX_WATCH_FETCHES = 25;
const UA = "Mozilla/5.0 (compatible; iKratomBot/1.0; +https://www.ikratom.org/about)";

const CHANNEL_RE = /^UC[A-Za-z0-9_-]{22}$/;
const decode = (s) => String(s ?? "")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");
const tag = (xml, name) => decode(xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] ?? "").trim();

async function get(url) {
  const r = await fetch(url, { headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}

/** Channel id from the row, the URL itself, or the channel page. */
export async function resolveChannelId(row) {
  if (CHANNEL_RE.test(row.youtube_channel_id ?? "")) return row.youtube_channel_id;
  const inUrl = String(row.href).match(/\/channel\/(UC[A-Za-z0-9_-]{22})/)?.[1];
  if (inUrl) return inUrl;
  const html = await get(row.href);
  return html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})"/)?.[1]
    ?? html.match(/"externalId":"(UC[A-Za-z0-9_-]{22})"/)?.[1] ?? null;
}

export function parseFeed(xml) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
    video_id: tag(e, "yt:videoId"),
    title: tag(e, "title").slice(0, 300),
    published_at: tag(e, "published"),
    description: tag(e, "media:description").slice(0, 1000) || null,
  })).filter((v) => /^[A-Za-z0-9_-]{11}$/.test(v.video_id) && v.title && Date.parse(v.published_at));
}

/** { is_upcoming, scheduled_start_at } from the public watch page; null if unreadable. */
export async function liveStatus(videoId) {
  try {
    const html = await get(`https://www.youtube.com/watch?v=${videoId}&hl=en`);
    const upcoming = /"isUpcoming":true/.test(html);
    const ts = html.match(/"scheduledStartTime":"(\d+)"/)?.[1];
    return { is_upcoming: upcoming, scheduled_start_at: upcoming && ts ? new Date(Number(ts) * 1000).toISOString() : null };
  } catch { return null; }
}

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const startedAt = new Date().toISOString();
  const { data: channels, error } = await sb.from("external_communities")
    .select("id, name, href, youtube_channel_id").eq("category", "youtube").eq("is_active", true);
  if (error) throw new Error(error.message);

  let added = 0, refreshed = 0, watchFetches = 0;
  const problems = [];
  for (const ch of channels ?? []) {
    try {
      const channelId = await resolveChannelId(ch);
      if (!channelId) { problems.push(`${ch.name}: no channel id`); continue; }
      if (channelId !== ch.youtube_channel_id && !DRY) {
        await sb.from("external_communities").update({ youtube_channel_id: channelId }).eq("id", ch.id);
      }
      const videos = parseFeed(await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`));
      const { data: known } = await sb.from("community_videos").select("video_id, is_upcoming, scheduled_start_at")
        .in("video_id", videos.map((v) => v.video_id));
      const knownMap = new Map((known ?? []).map((k) => [k.video_id, k]));

      const rows = [];
      for (const v of videos) {
        const prev = knownMap.get(v.video_id);
        // Every row carries is_upcoming + scheduled_start_at: in a batch upsert
        // PostgREST fills a column missing from SOME rows with NULL, and
        // is_upcoming is NOT NULL (first live run, 2026-10-05: one channel's
        // whole batch rejected). Unchecked rows keep their stored value.
        const row = {
          ...v, community_id: ch.id, updated_at: new Date().toISOString(),
          is_upcoming: prev?.is_upcoming ?? false,
          scheduled_start_at: prev?.scheduled_start_at ?? null,
        };
        // Only recent uploads can be an upcoming stream/premiere — checking a
        // 2018 video spends the per-run budget for nothing.
        const recent = Date.parse(v.published_at) > Date.now() - 30 * 86_400_000;
        if ((!prev || prev.is_upcoming) && recent && watchFetches < MAX_WATCH_FETCHES) {
          watchFetches++;
          const live = await liveStatus(v.video_id);
          if (live) Object.assign(row, live);
        }
        rows.push(row);
        if (prev) refreshed++; else added++;
      }
      console.log(`${DRY ? "[dry] " : ""}${ch.name}: ${videos.length} in feed, ${videos.filter((v) => !knownMap.has(v.video_id)).length} new`);
      if (!DRY && rows.length) {
        const { error: e } = await sb.from("community_videos").upsert(rows, { onConflict: "video_id" });
        if (e) problems.push(`${ch.name}: ${e.message}`);
      }
    } catch (e) {
      problems.push(`${ch.name}: ${e.message}`);
    }
  }

  const summary = `${(channels ?? []).length} channels · ${added} new videos · ${refreshed} refreshed · ${watchFetches} live checks${problems.length ? ` · problems: ${problems.join("; ")}` : ""}`;
  console.log(summary);
  if (!DRY) {
    const failedAll = problems.length > 0 && problems.length >= (channels ?? []).length;
    await sb.from("scraper_runs").insert({ source: "sync_community_videos", started_at: startedAt, finished_at: new Date().toISOString(), status: failedAll ? "error" : "success", rows_updated: added, notes: summary.slice(0, 1000) });
    if (failedAll) process.exitCode = 1;
  }
}

// Run only as a script, so tests can import parseFeed without touching the DB.
if (process.argv[1]?.endsWith("sync-community-videos.mjs")) {
  main().catch((e) => { console.error(e.message); process.exitCode = 1; });
}
