import { redirect } from "next/navigation";

/**
 * /i/CODE shortlink — clean form of an invite URL meant for human
 * sharing ("ikratom.org/i/abc12345" reads better than
 * "ikratom.org?via=abc12345"). Redirects to / with ?via=<code> so
 * proxy.ts can capture the cookie via its standard ?via= path. We
 * use 307 (temporary) not 301 so search engines don't cache the
 * specific code → root mapping.
 *
 * We also lowercase + format-validate here to bail out of obvious
 * garbage before the redirect.
 */
export default async function InviteShortlink({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const clean = (code ?? "").toLowerCase();
  if (!/^[a-z0-9]{4,32}$/.test(clean)) {
    // Bad shape — send them to the homepage with no cookie set.
    redirect("/");
  }
  redirect(`/?via=${clean}`);
}
