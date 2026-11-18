import { redirect } from "next/navigation";
import { getCreatorContext } from "@/modules/admin/actions";
import { SuggestPanel } from "./SuggestPanel";

export const metadata = { title: "AI suggest local officials" };

export default async function SuggestLocalsPage() {
  const ctx = await getCreatorContext({ require: "add_local_officials" });
  if (!ctx.ok) redirect("/dashboard");

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin/locals" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Local officials
      </a>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">
          AI suggest local officials
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          Type a city or county. If it publishes meetings on Legistar, we read the roster
          from there; otherwise the place is queued for a fuller search and you can add
          officials by hand. You review and accept. Nothing is added without you.
        </p>
        <p className="mt-1 text-xs text-zinc-500">Free. No paid AI or search is used.</p>
      </header>

      <SuggestPanel />
    </div>
  );
}
