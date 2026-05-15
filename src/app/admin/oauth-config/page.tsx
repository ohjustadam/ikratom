import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";

export const metadata = { title: "OAuth Config — admin" };
export const dynamic = "force-dynamic";

/**
 * /admin/oauth-config — surfaces every OAuth redirect URI the app
 * generates, so the admin can verify each one is registered in the
 * corresponding developer console.
 *
 * Origin: a friend hit `Error 400: redirect_uri_mismatch` while trying
 * to link their Gmail account after signup (2026-05-15). Root cause:
 * the Google Cloud Console OAuth client for production didn't have
 * `https://www.ikratom.org/api/oauth/google/callback` in its
 * "Authorized redirect URIs" list. Same risk exists for Discord
 * (Developer Portal) and any future OAuth provider.
 *
 * This page is a defensive surface: it shows EXACTLY what redirect URIs
 * the app will send, in copy-pastable form, so the admin can spot-check
 * every developer console without code-spelunking.
 *
 * Read-only. Pulls from `process.env.APP_URL` which is set per
 * environment (Vercel: production = www.ikratom.org).
 */
type ProviderConfig = {
  name: string;
  envVarPrefix: string;
  callbackPath: string;
  consoleUrl: string;
  consoleLocation: string;
  envKeys: string[];
};

const PROVIDERS: ProviderConfig[] = [
  {
    name: "Google (Gmail send-on-behalf)",
    envVarPrefix: "GOOGLE_OAUTH",
    callbackPath: "/api/oauth/google/callback",
    consoleUrl: "https://console.cloud.google.com/apis/credentials",
    consoleLocation: "APIs & Services → Credentials → OAuth 2.0 Client IDs → <your client> → Authorized redirect URIs",
    envKeys: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"],
  },
  {
    name: "Discord (link account)",
    envVarPrefix: "DISCORD_OAUTH",
    callbackPath: "/api/oauth/discord/callback",
    consoleUrl: "https://discord.com/developers/applications",
    consoleLocation: "Your Application → OAuth2 → Redirects",
    envKeys: ["DISCORD_OAUTH_CLIENT_ID", "DISCORD_OAUTH_CLIENT_SECRET"],
  },
];

export default async function OAuthConfigPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) redirect("/dashboard");

  const appUrl = (process.env.APP_URL ?? "").replace(/\/+$/, "");
  const publicAppUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");

  // Build environments the app is likely deployed to. Each one needs its
  // own redirect URI registered. localhost is dev-only; the prod URL
  // (APP_URL) is what most users will hit; www.ikratom.org is the
  // canonical production hostname.
  const environments = [
    { label: "Production (this deploy)", url: appUrl || "(APP_URL not set)" },
    { label: "Canonical production", url: "https://www.ikratom.org" },
    { label: "Vercel preview", url: "https://ikratom.vercel.app" },
    { label: "Local dev", url: "http://localhost:3001" },
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Admin
      </a>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">OAuth redirect-URI config check</h1>
        <p className="mt-2 max-w-3xl text-sm text-zinc-400">
          Every OAuth provider needs its <strong>authorized redirect URI</strong> registered in the matching developer console. If a URI isn&apos;t registered, the user sees Google&apos;s generic <code className="rounded bg-zinc-900 px-1">Error 400: redirect_uri_mismatch</code> page instead of returning to iKratom. Use this page to confirm every URI is registered correctly.
        </p>
        <p className="mt-2 text-[11px] text-zinc-500">
          App URL detected: <code className="rounded bg-zinc-900 px-1">{appUrl || "(APP_URL not set)"}</code>
          {publicAppUrl && publicAppUrl !== appUrl && (
            <>{" "}· NEXT_PUBLIC_APP_URL: <code className="rounded bg-zinc-900 px-1">{publicAppUrl}</code></>
          )}
        </p>
      </header>

      {PROVIDERS.map((p) => {
        const clientId = process.env[`${p.envVarPrefix}_CLIENT_ID`];
        const clientSecret = process.env[`${p.envVarPrefix}_CLIENT_SECRET`];
        const configured = !!(clientId && clientSecret);
        return (
          <section
            key={p.name}
            className={`mb-6 rounded-lg border p-5 ${
              configured ? "border-zinc-800 bg-zinc-950/40" : "border-amber-700/50 bg-amber-950/15"
            }`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-lg font-bold text-zinc-100">{p.name}</h2>
              <span className={`text-[11px] font-semibold ${configured ? "text-emerald-400" : "text-amber-300"}`}>
                {configured ? "✓ env vars set" : "⚠ env vars missing — provider disabled"}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-zinc-500">
              Console: <a href={p.consoleUrl} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">{p.consoleUrl}</a>
            </p>
            <p className="mt-1 text-[11px] text-zinc-500">{p.consoleLocation}</p>

            <p className="mt-4 text-[11px] uppercase tracking-wider text-zinc-500">
              Redirect URIs the app will send (each must be registered):
            </p>
            <ul className="mt-2 space-y-1">
              {environments.map((env) => {
                const uri = env.url.startsWith("(") ? env.url : `${env.url}${p.callbackPath}`;
                return (
                  <li key={env.label} className="flex flex-wrap items-baseline gap-3 rounded border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                    <span className="min-w-[180px] text-[10px] uppercase tracking-wider text-zinc-500">{env.label}</span>
                    <code className="flex-1 break-all font-mono text-[11px] text-zinc-200">{uri}</code>
                  </li>
                );
              })}
            </ul>

            <p className="mt-4 text-[11px] uppercase tracking-wider text-zinc-500">
              Env keys required:
            </p>
            <ul className="mt-1 space-y-1">
              {p.envKeys.map((k) => {
                const has = !!process.env[k];
                return (
                  <li key={k} className="text-[11px]">
                    <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-300">{k}</code>
                    <span className={`ml-2 ${has ? "text-emerald-400" : "text-amber-300"}`}>
                      {has ? "✓ set" : "✗ not set"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <section className="mt-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
          How to fix Error 400: redirect_uri_mismatch
        </h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-zinc-300">
          <li>Identify which provider hit the error (Gmail = Google, Discord-link = Discord).</li>
          <li>Open the provider&apos;s developer console (links above for each section).</li>
          <li>Find the OAuth client whose Client ID matches the env var for that provider.</li>
          <li>Add the redirect URI shown above to the &quot;Authorized redirect URIs&quot; list.</li>
          <li>Save the console change. No code redeploy needed — Google/Discord validate the URI at request time.</li>
          <li>User retries the connect flow. Should complete successfully.</li>
        </ol>
        <p className="mt-3 text-[11px] text-zinc-500">
          <strong className="text-zinc-200">Common cause #1:</strong> only <code>https://ikratom.org</code> (no www) or <code>https://ikratom.vercel.app</code> is registered, but production traffic uses <code>https://www.ikratom.org</code>.
        </p>
        <p className="mt-1 text-[11px] text-zinc-500">
          <strong className="text-zinc-200">Common cause #2:</strong> only the <code>localhost:3001</code> dev URI is registered, never updated for production.
        </p>
        <p className="mt-1 text-[11px] text-zinc-500">
          <strong className="text-zinc-200">Best practice:</strong> register ALL four URIs shown above (production, www-canonical, vercel-preview, localhost) so the same OAuth client works in every environment.
        </p>
      </section>
    </div>
  );
}
