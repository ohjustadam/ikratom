import { redirect } from "next/navigation";
import { getCreatorContext } from "@/modules/admin/actions";
import { createClient } from "@/lib/supabase/server";
import { LocalsBrowser } from "./LocalsBrowser";

export const metadata = { title: "Admin · Local officials" };

export default async function AdminLocalsPage() {
  const ctx = await getCreatorContext({ require: "add_local_officials" });
  if (!ctx.ok) redirect("/dashboard");

  const supabase = await createClient();
  const { data: locals } = await supabase
    .from("legislators")
    .select("id,full_name,state,role,locality,body,title,email,phone,active,party,district")
    .in("level", ["municipal", "county"])
    .order("locality")
    .order("title")
    .order("full_name");

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      <a href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Admin
      </a>
      <header className="mt-2 mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold">Local officials</h1>
          <p className="mt-1 text-sm text-zinc-400">
            City and county officials. Add them as advocacy needs arise — there&apos;s no
            free comprehensive source for these, so we build the roster as we go.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <a
            href="/admin/locals/suggest"
            className="rounded-md border border-emerald-700/50 px-4 py-2 text-sm font-semibold text-emerald-300 hover:border-emerald-500"
          >
            ✨ AI suggest
          </a>
          <a
            href="/admin/locals/new"
            className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
          >
            + Add manually
          </a>
        </div>
      </header>

      <LocalsBrowser locals={locals ?? []} />
    </div>
  );
}
