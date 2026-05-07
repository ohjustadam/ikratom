import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import { listPendingVendorApplications } from "@/modules/auth/actions-vendor";
import { VendorApplicationsPanel } from "./VendorApplicationsPanel";

export const metadata = { title: "Vendor applications" };

export default async function VendorApplicationsPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) redirect("/dashboard");

  const r = await listPendingVendorApplications();
  const apps = ("ok" in r ? r.rows : []) as {
    id: string;
    full_name: string | null;
    vendor_status: string;
    vendor_business_name: string | null;
    vendor_business_role: string | null;
    vendor_business_city: string | null;
    vendor_business_state: string | null;
    vendor_business_website: string | null;
    vendor_application_at: string | null;
  }[];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Admin
      </a>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">Vendor applications</h1>
        <p className="mt-1 text-sm text-zinc-400">
          {apps.length === 0
            ? "Queue is empty — nothing pending review."
            : `${apps.length} application${apps.length === 1 ? "" : "s"} pending. Verify the business is real + the applicant is plausibly its representative, then approve or reject with a reason.`}
        </p>
      </header>

      <VendorApplicationsPanel applications={apps} />
    </div>
  );
}
