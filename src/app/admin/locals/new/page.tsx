import { redirect } from "next/navigation";
import { getCreatorContext } from "@/modules/admin/actions";
import { LocalOfficialForm } from "@/modules/admin/components/LocalOfficialForm";

export const metadata = { title: "Add local official" };

export default async function NewLocalOfficialPage() {
  const ctx = await getCreatorContext({ require: "add_local_officials" });
  if (!ctx.ok) redirect("/dashboard");

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin/locals" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Local officials
      </a>
      <header className="mt-2 mb-8">
        <h1 className="text-3xl font-bold">Add local official</h1>
        <p className="mt-2 text-sm text-zinc-400">
          City council members, mayors, county commissioners. Once added, they appear
          on the legislators page and can be targeted in campaigns.
        </p>
      </header>
      <LocalOfficialForm />
    </div>
  );
}
