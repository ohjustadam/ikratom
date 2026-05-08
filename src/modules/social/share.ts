/**
 * Share-URL builders for "social media bombing" — one-click share to
 * X / Bluesky / Telegram / Mastodon / Facebook. Returns the URL to
 * open in a new tab; consumer renders it as a button or dispatches
 * with window.open.
 *
 * Each network has slightly different conventions:
 *   - X (Twitter): supports text + url + hashtags
 *   - Bluesky: bluesky's web composer supports just text (URL must
 *     be embedded in the text)
 *   - Telegram: text + url separately
 *   - Mastodon: instance-aware; we send to the user's chosen instance
 *     (default mastodon.social). Text + url.
 *   - Facebook: only URL (FB strips text reliably; text in opengraph
 *     description matters more)
 *
 * Attribution: every share URL includes ?ref=share&host=<network> so
 * the existing proxy.ts referral capture credits the network. Share
 * counts can be derived from referrals later.
 */

export type ShareNetwork = "x" | "bluesky" | "telegram" | "mastodon" | "facebook";

export const NETWORK_LABEL: Record<ShareNetwork, string> = {
  x: "X / Twitter",
  bluesky: "Bluesky",
  telegram: "Telegram",
  mastodon: "Mastodon",
  facebook: "Facebook",
};

export const NETWORK_EMOJI: Record<ShareNetwork, string> = {
  x: "𝕏",
  bluesky: "🦋",
  telegram: "✈",
  mastodon: "🐘",
  facebook: "f",
};

const TEXT_HARD_CAP: Record<ShareNetwork, number> = {
  x: 280,
  bluesky: 300,
  telegram: 1000,
  mastodon: 500,
  facebook: 1000,
};

function clipText(text: string, network: ShareNetwork, urlOverhead = 30): string {
  const cap = TEXT_HARD_CAP[network] - urlOverhead;
  if (text.length <= cap) return text;
  return text.slice(0, cap - 1).trimEnd() + "…";
}

function withRef(url: string, network: ShareNetwork): string {
  try {
    const u = new URL(url);
    u.searchParams.set("ref", "share");
    u.searchParams.set("host", network);
    return u.toString();
  } catch {
    return url;
  }
}

export function buildShareUrl(input: {
  network: ShareNetwork;
  text: string;
  url: string;
  hashtags?: string[];
  mastodonInstance?: string; // default mastodon.social
}): string {
  const tracked = withRef(input.url, input.network);
  const text = clipText(input.text, input.network, tracked.length + 5);

  switch (input.network) {
    case "x": {
      const params = new URLSearchParams({
        text,
        url: tracked,
        ...(input.hashtags?.length ? { hashtags: input.hashtags.slice(0, 3).join(",") } : {}),
      });
      return `https://twitter.com/intent/tweet?${params.toString()}`;
    }
    case "bluesky": {
      // Bluesky composer takes a single 'text' param. Embed URL inline.
      const params = new URLSearchParams({ text: `${text} ${tracked}` });
      return `https://bsky.app/intent/compose?${params.toString()}`;
    }
    case "telegram": {
      const params = new URLSearchParams({ url: tracked, text });
      return `https://t.me/share/url?${params.toString()}`;
    }
    case "mastodon": {
      const instance = input.mastodonInstance?.replace(/^https?:\/\//, "") || "mastodon.social";
      const params = new URLSearchParams({ text: `${text} ${tracked}` });
      return `https://${instance}/share?${params.toString()}`;
    }
    case "facebook": {
      // FB sharer just takes a URL — opengraph metadata on the page does
      // the heavy lifting for title/description.
      const params = new URLSearchParams({ u: tracked });
      return `https://www.facebook.com/sharer/sharer.php?${params.toString()}`;
    }
  }
}

/**
 * Default copy generator for a campaign — picks an appropriately-toned
 * line based on the campaign's bill stance. Used as the default text
 * for share buttons; the user can edit before sharing.
 */
export function defaultCampaignShareText(input: {
  title: string;
  state: string | null;
  isHostile: boolean;
}): string {
  const tag = input.state ? ` (${input.state})` : "";
  if (input.isHostile) {
    return `🚨 ${input.title}${tag} — take 30 seconds to email your reps. Every voice matters.`;
  }
  return `${input.title}${tag} — let's back this. iKratom makes it one click.`;
}
