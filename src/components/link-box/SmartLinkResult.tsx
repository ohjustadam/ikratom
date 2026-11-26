import Link from "@/components/Link";
import type { LinkBoxResult } from "@/modules/link-box/actions";

type Campaign = { slug: string; title: string };

/** What the smart link box says back, in plain words and large type. */
export function SmartLinkResult({ result: r, url }: { result: LinkBoxResult; url: string }) {
  if (r.status === "existing") {
    if (r.what === "pending") return <Note tone="ok" title="Someone already shared this.">A moderator is checking it now. Thank you for keeping watch!</Note>;
    if (r.what === "seen") return <Note tone="ok" title="We've already looked at this link.">Thank you for keeping watch!</Note>;
    if (r.what === "ours") return <Note tone="ok" title="That's a page on iKratom already."><Go href={r.path}>Open it</Go></Note>;
    const [href, label, campaigns] =
      r.what === "story" ? [`/news/${r.story.id}`, r.story.title, r.campaigns]
      : r.what === "alert" ? [`/alerts/${r.alert.id}`, r.alert.title, r.campaigns]
      : [`/bills/${r.bill.id}`, `${r.bill.label}${r.bill.status ? ` (${r.bill.status})` : ""}`, r.campaigns];
    return (
      <Note tone="ok" title="We already have this, here it is:">
        <Go href={href}>{label}</Go>
        <Act campaigns={campaigns} none="There's no letter to send about it right now." />
      </Note>
    );
  }
  if (r.status === "new") {
    return (
      <Note tone="ok" title="This looks new to us.">
        Press <strong>Share it</strong> to send it in.
        {r.bill && <p className="mt-2">It&apos;s about <Go href={`/bills/${r.bill.id}`} inline>{r.bill.label}</Go>.</p>}
        <Act campaigns={r.campaigns} />
      </Note>
    );
  }
  if (r.status === "added") {
    return (
      <Note tone="ok" title="Thanks! It's new, we're adding it.">
        A moderator checks every link first, usually within a few hours.
        {r.bill && (
          <p className="mt-2">
            It&apos;s about <Go href={`/bills/${r.bill.id}`} inline>{r.bill.label}</Go>.
            {r.draft && " We've asked a moderator to start a letter campaign for it."}
          </p>
        )}
        <Act campaigns={r.campaigns} />
      </Note>
    );
  }
  if (r.status === "not_kratom") {
    return (
      <Note tone="warn" title="We couldn't find anything about kratom in this link.">
        If it is about kratom, <Go href={`/alerts/submit?url=${encodeURIComponent(url)}#details`} inline>tell us more here</Go>.
      </Note>
    );
  }
  return <Note tone="warn" title={r.message} />;
}

function Note({ tone, title, children }: { tone: "ok" | "warn"; title: string; children?: React.ReactNode }) {
  const box = tone === "ok" ? "border-emerald-700 bg-emerald-950/40" : "border-amber-700 bg-amber-950/30";
  return (
    <div className={`rounded-lg border-2 p-4 text-lg leading-relaxed text-zinc-200 ${box}`}>
      <p className={`text-xl font-bold ${tone === "ok" ? "text-emerald-300" : "text-amber-200"}`}>{title}</p>
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}

function Go({ href, children, inline = false }: { href: string; children: React.ReactNode; inline?: boolean }) {
  return inline
    ? <Link href={href} className="font-semibold text-emerald-300 underline underline-offset-4">{children}</Link>
    : <Link href={href} className="block font-semibold text-emerald-200 underline underline-offset-4 hover:text-emerald-100">{children}</Link>;
}

function Act({ campaigns, none }: { campaigns: Campaign[]; none?: string }) {
  if (!campaigns.length) return none ? <p className="mt-3 text-base text-zinc-400">{none}</p> : null;
  return (
    <div className="mt-3 space-y-2">
      <p className="text-base font-semibold text-zinc-300">You can act on it now:</p>
      {campaigns.map((c) => (
        <Link key={c.slug} href={`/campaigns/${c.slug}`}
          className="block rounded-lg border-2 border-emerald-600 px-4 py-3 text-lg font-semibold text-emerald-100 hover:border-emerald-400">
          ✉️ {c.title}
        </Link>
      ))}
    </div>
  );
}
