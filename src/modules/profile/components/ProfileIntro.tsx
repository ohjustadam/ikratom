import { interestLabel } from "../audience";
import type { ProfileView } from "../view";

/** Bio, interests, links and the activity counts — each only if it came back. */
export function ProfileIntro({ p }: { p: ProfileView }) {
  const interests = (p.interests ?? []).map(interestLabel).filter(Boolean) as string[];
  const links = p.links ?? [];
  const hasAny = p.bio || interests.length || links.length || p.activity_visible;
  if (!hasAny) return null;

  return (
    <section className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-950/40 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Intro</h2>
      {p.bio && <p className="whitespace-pre-line text-sm text-zinc-200">{p.bio}</p>}
      {interests.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {interests.map((label) => (
            <li key={label} className="rounded-full border border-emerald-800/50 bg-emerald-950/20 px-2.5 py-0.5 text-xs text-emerald-200">{label}</li>
          ))}
        </ul>
      )}
      {links.length > 0 && (
        <ul className="space-y-1 text-sm">
          {links.map((l) => (
            <li key={l.url} className="truncate">
              <span aria-hidden>🔗 </span>
              <a href={l.url} rel="nofollow ugc noopener noreferrer" target="_blank" className="text-emerald-400 hover:underline">{l.label}</a>
              <span className="ml-1 text-xs text-zinc-600">{hostOf(l.url)}</span>
            </li>
          ))}
        </ul>
      )}
      {p.activity_visible && (
        <div className="grid grid-cols-2 gap-2 pt-1">
          <Stat label="Threads started" value={p.thread_count ?? 0} />
          <Stat label="Actions taken" value={p.action_count ?? 0} />
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2 text-center">
      <div className="text-xl font-bold text-zinc-100">{value}</div>
      <div className="text-xs text-zinc-500">{label}</div>
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
