import { redirect } from "next/navigation";
import { getCreatorContext } from "@/modules/admin/actions";
import { NewBillForm } from "./NewBillForm";

export const metadata = { title: "Add a bill (manual)" };

export default async function NewBillPage() {
  const ctx = await getCreatorContext();
  if (!ctx.ok) redirect("/dashboard");

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Admin
      </a>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">Add a bill manually</h1>
        <p className="mt-2 text-sm text-zinc-400">
          State + federal bills auto-sync daily from OpenStates. Use this form
          for <strong className="text-zinc-200">county and municipal bills</strong>{" "}
          (which OpenStates doesn&apos;t track) or to add a bill we missed
          from a state legislature.
        </p>
      </header>

      <div className="mb-6 rounded-md border border-amber-700/40 bg-amber-950/20 p-4 text-sm text-amber-200">
        <p className="font-semibold text-amber-300">⚠ No free API covers local bills nationwide</p>
        <p className="mt-1 text-amber-200/80">
          County commissions, city councils, school boards — these have to be
          tracked manually. Watch your local news, your state&apos;s shop-owner
          group, and AKA alerts. When something drops, paste the city/county
          government link below and we&apos;ll cross-reference.
        </p>
      </div>

      <NewBillForm />
    </div>
  );
}
