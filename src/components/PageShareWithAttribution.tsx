import { PageShare } from "./PageShare";
import { getMyInviteSummary } from "@/modules/invite/actions";

/**
 * Server wrapper that appends the signed-in user's invite code to the
 * shared URL so attribution flows even when sharing a specific page
 * (not just the homepage). For signed-out users, falls through to the
 * bare URL.
 *
 * The path param is everything after the origin, including any leading
 * slash and any existing query string. We append ?via=CODE (or &via=
 * if there's already a query string).
 */
export async function PageShareWithAttribution({
  path,
  title,
  summary,
  align = "right",
}: {
  path: string;
  title: string;
  summary?: string;
  align?: "left" | "right";
}) {
  const base = (process.env.APP_URL ?? "https://www.ikratom.org").replace(/\/+$/, "");
  const summary2 = await getMyInviteSummary();
  const sep = path.includes("?") ? "&" : "?";
  const url = summary2?.invite_code
    ? `${base}${path}${sep}via=${summary2.invite_code}`
    : `${base}${path}`;
  return <PageShare url={url} title={title} summary={summary} align={align} />;
}
