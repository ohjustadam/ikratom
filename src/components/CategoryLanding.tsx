import Link from "next/link";
import { CATEGORIES, type Category } from "@/config/nav-categories";

/**
 * Shared layout for the category landing pages (/action, /legislative,
 * /knowledge, /community — Intel uses its existing /intel hub). Lists every
 * feature under the category with its 1–2 line walkthrough so users know
 * what a page does before clicking (PR-I).
 */
export function CategoryLanding({ category }: { category: Category }) {
  const others = CATEGORIES.filter((c) => c.slug !== category.slug);
  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-emerald-500">category</p>
      <h1 className="mt-1 text-3xl font-bold text-zinc-100">{category.label}</h1>
      <p className="mt-2 max-w-2xl text-sm text-zinc-400">{category.tagline}</p>

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {category.items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="group rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 transition-colors hover:border-emerald-800/60 hover:bg-zinc-900/60"
          >
            <div className="flex items-center justify-between">
              <span className="font-medium text-zinc-100 group-hover:text-emerald-300">{item.label}</span>
              <span aria-hidden className="text-xs text-zinc-600 group-hover:text-emerald-400">→</span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">{item.description}</p>
          </Link>
        ))}
      </div>

      <div className="mt-10 border-t border-zinc-900 pt-4 text-xs text-zinc-500">
        More:{" "}
        {others.map((c, i) => (
          <span key={c.slug}>
            <Link href={c.href} className="text-emerald-400 hover:underline">{c.label}</Link>
            {i < others.length - 1 ? " · " : ""}
          </span>
        ))}
      </div>
    </main>
  );
}
