import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import { NewPartnerForm } from "./NewPartnerForm";

export const metadata = { title: "Add partner shop" };

export default async function NewPartnerPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) redirect("/dashboard");

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin/partners" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Partners
      </a>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">Add a partner shop</h1>
        <p className="mt-1 text-sm text-zinc-400">
          The slug is auto-generated from the shop name. Once set, it can&apos;t change
          — printed QR codes encode it forever.
        </p>
      </header>

      <NewPartnerForm />
    </div>
  );
}
