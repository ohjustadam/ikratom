import { notFound, redirect } from "next/navigation";
import { getCreatorContext } from "@/modules/admin/actions";
import { createClient } from "@/lib/supabase/server";
import { LocalOfficialForm } from "@/modules/admin/components/LocalOfficialForm";

export const metadata = { title: "Edit local official" };

export default async function EditLocalOfficialPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getCreatorContext({ require: "add_local_officials" });
  if (!ctx.ok) redirect("/dashboard");

  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("legislators")
    .select(
      "id,full_name,state,role,locality,body,title,district,email,phone,website,office_address,party,level"
    )
    .eq("id", id)
    .single();

  if (!data || (data.level !== "municipal" && data.level !== "county")) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin/locals" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Local officials
      </a>
      <header className="mt-2 mb-8">
        <h1 className="text-3xl font-bold">Edit local official</h1>
        <p className="mt-2 text-sm text-zinc-400">{data.locality}</p>
      </header>
      <LocalOfficialForm initial={data} />
    </div>
  );
}
