import Link from "@/components/Link";

/** Shared building blocks for the getting-started guide. Server components. */

export function Block({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-16 scroll-mt-20">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">{eyebrow}</p>
      <h2 className="mt-1 text-2xl font-bold sm:text-3xl">{title}</h2>
      <div className="mt-5 space-y-4 text-zinc-300">{children}</div>
    </section>
  );
}

export type StepItem = { title: string; body: string; href?: string; cta?: string; tip?: string };

/** A numbered walkthrough: one card per step, each with the link that does it. */
export function Steps({ items }: { items: StepItem[] }) {
  return (
    <ol className="space-y-3">
      {items.map((s, i) => (
        <li key={s.title} className="flex gap-4 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500 font-bold text-zinc-950">{i + 1}</span>
          <div className="min-w-0">
            <h3 className="font-semibold text-zinc-100">{s.title}</h3>
            <p className="mt-1 text-sm text-zinc-300">{s.body}</p>
            {s.tip && <p className="mt-2 text-xs text-zinc-400">💡 {s.tip}</p>}
            {s.href && (
              <Link href={s.href} className="mt-2 inline-block text-sm font-semibold text-emerald-400 hover:underline">
                {s.cta ?? "Open"} →
              </Link>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

export type Tool = { icon: string; name: string; href: string; body: string };

/** A grid of tools, each card a link straight to the tool. */
export function ToolGrid({ heading, tools }: { heading: string; tools: Tool[] }) {
  return (
    <div className="mt-6">
      <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400">{heading}</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {tools.map((t) => (
          <Link key={t.href} href={t.href} className="block rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 hover:border-emerald-600">
            <p className="font-semibold text-zinc-100"><span aria-hidden>{t.icon}</span> {t.name}</p>
            <p className="mt-1 text-sm text-zinc-400">{t.body}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function Note({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3 text-sm text-zinc-300">{children}</p>;
}

export function ListBox({ tone, title, items }: { tone: "good" | "bad"; title: string; items: string[] }) {
  const cls = tone === "good" ? "border-emerald-700/40 bg-emerald-950/10" : "border-red-900/40 bg-red-950/10";
  return (
    <div className={`rounded-lg border p-5 ${cls}`}>
      <h3 className="text-base font-bold">{title}</h3>
      <ul className="mt-3 space-y-2 text-sm">
        {items.map((it) => <li key={it} className="text-zinc-200">{it}</li>)}
      </ul>
    </div>
  );
}

/** Question-and-answer rows that open in place. */
export function Faq({ items }: { items: { q: string; a: string }[] }) {
  return (
    <div className="divide-y divide-zinc-800 rounded-lg border border-zinc-800">
      {items.map((f) => (
        <details key={f.q} className="group p-4">
          <summary className="cursor-pointer list-none font-semibold text-zinc-100">
            <span className="mr-2 text-emerald-400 group-open:hidden">+</span>
            <span className="mr-2 hidden text-emerald-400 group-open:inline">−</span>
            {f.q}
          </summary>
          <p className="mt-2 text-sm text-zinc-300">{f.a}</p>
        </details>
      ))}
    </div>
  );
}
