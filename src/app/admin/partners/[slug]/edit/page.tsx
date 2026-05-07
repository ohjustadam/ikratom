import { notFound, redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import { getPartnerBySlug } from "@/modules/partners/actions";
import { EditPartnerForm } from "./EditPartnerForm";

export const metadata = { title: "Edit partner" };

export default async function EditPartnerPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const ctx = await getAdminContext();
  if (!ctx.ok) redirect("/dashboard");

  const { slug } = await params;
  const r = await getPartnerBySlug(slug);
  if ("error" in r || !r.partner) notFound();
  const partner = r.partner;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin/partners" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Partners
      </a>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">Edit {partner.shop_name}</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Slug <span className="font-mono text-zinc-300">/{partner.slug}</span>{" "}
          is locked — printed QR codes encode it forever.
        </p>
      </header>

      <EditPartnerForm initial={partner} />
    </div>
  );
}
