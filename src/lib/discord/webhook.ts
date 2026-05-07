/**
 * Discord webhook sender. POSTs a rich-embed payload to a server's
 * webhook URL. Used by the fan-out hooks (bill drop, campaign launch,
 * wave fire) to push alerts into partner Discord channels.
 *
 * Failure handling:
 *   - 404 / 410: webhook revoked or channel deleted. We mark the
 *     integration's `consecutive_failures` and auto-disable after 3.
 *   - 429: rate limit. Discord webhooks limit to 30 messages/min/channel.
 *     We back off and retry once after the Retry-After header value.
 *   - other 4xx/5xx: log + count as failure but don't auto-disable.
 *
 * NEVER log the webhook URL in plaintext. The router masks it in audit
 * trails and structured logs as `https://discord.com/api/webhooks/****`.
 */

const TIMEOUT_MS = 10_000;

/** Max length per Discord embed field per their API. */
const EMBED_TITLE_MAX = 256;
const EMBED_DESC_MAX = 4_096;
const EMBED_FIELD_NAME_MAX = 256;
const EMBED_FIELD_VALUE_MAX = 1_024;

export type DiscordEmbedField = {
  name: string;
  value: string;
  inline?: boolean;
};

export type DiscordEmbed = {
  title?: string;
  description?: string;
  url?: string;
  /** Decimal int. 0xff5555 = red, 0x10b981 = emerald-500, etc. */
  color?: number;
  fields?: DiscordEmbedField[];
  footer?: { text: string };
  timestamp?: string;
};

export type DiscordSendResult =
  | { ok: true; status: 204 }
  | { ok: false; status: number; gone: boolean; error: string };

export async function sendDiscordEmbed(
  webhookUrl: string,
  embed: DiscordEmbed,
): Promise<DiscordSendResult> {
  const safeEmbed: DiscordEmbed = {
    ...embed,
    title: embed.title?.slice(0, EMBED_TITLE_MAX),
    description: embed.description?.slice(0, EMBED_DESC_MAX),
    fields: embed.fields?.slice(0, 25).map((f) => ({
      name: f.name.slice(0, EMBED_FIELD_NAME_MAX),
      value: f.value.slice(0, EMBED_FIELD_VALUE_MAX),
      inline: f.inline,
    })),
    footer: embed.footer ? { text: embed.footer.text.slice(0, 2_048) } : undefined,
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embeds: [safeEmbed] }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (res.status === 204) return { ok: true, status: 204 };

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("Retry-After") ?? 1);
        if (attempt === 0 && retryAfter < 30) {
          await new Promise((r) => setTimeout(r, Math.min(retryAfter, 5) * 1000));
          continue;
        }
        return { ok: false, status: 429, gone: false, error: `rate_limited; retry_after=${retryAfter}s` };
      }

      const body = await res.text();
      const gone = res.status === 404 || res.status === 410;
      return {
        ok: false,
        status: res.status,
        gone,
        error: `${res.status}: ${body.slice(0, 300)}`,
      };
    } catch (e) {
      if (attempt === 0) continue;
      return { ok: false, status: 0, gone: false, error: (e as Error).message };
    }
  }
  return { ok: false, status: 0, gone: false, error: "max_attempts_exceeded" };
}

/**
 * Mask a webhook URL for safe logging — keep enough to disambiguate but
 * not enough to repost. We keep the host + the webhook id, but mask the
 * token (everything after the last slash).
 */
export function maskWebhook(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/");
    if (parts.length >= 2) {
      parts[parts.length - 1] = "****";
    }
    return `${u.origin}${parts.join("/")}`;
  } catch {
    return "https://discord.com/api/webhooks/****";
  }
}

/**
 * Color palette for our embeds. Keep these consistent with the site's
 * Tailwind palette so the Discord posts feel like part of the platform.
 */
export const EMBED_COLORS = {
  red: 0xef4444,    // hostile bill, danger
  amber: 0xf59e0b,  // attention, warning
  emerald: 0x10b981, // friendly bill, success, win
  blue: 0x3b82f6,   // info
  zinc: 0x71717a,   // neutral
} as const;
