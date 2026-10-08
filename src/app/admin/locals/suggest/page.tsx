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
          Type a city or county. Claude searches the web for the official roster, you
          review and accept. Always human-reviewed — never auto-added.
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          Cost: ~$0.01–$0.05 per query. Limit your searches.
        </p>
      </header>

      <SuggestPanel />
    </div>
  );
}
