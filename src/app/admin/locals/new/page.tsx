import { redirect } from "next/navigation";
import { getCreatorContext } from "@/modules/admin/actions";
import { LocalOfficialForm } from "@/modules/admin/components/LocalOfficialForm";

export const metadata = { title: "Add local official" };

const ROLES = new Set(["mayor", "city_council", "county_executive", "county_commissioner", "school_board", "other_local"]);

export default async function NewLocalOfficialPage({
  searchParams,
}: {
  // Prefill from /admin/local-rep-requests "Add by hand →" (and from the
  // add-another redirect after each save).
  searchParams: Promise<{ state?: string; locality?: string; role?: string; added?: string; closed?: string }>;
}) {
  const ctx = await getCreatorContext({ require: "add_local_officials" });
  if (!ctx.ok) redirect("/dashboard");

  const sp = await searchParams;
  const state = /^[A-Z]{2}$/.test(sp.state ?? "") ? sp.state : undefined;
  const locality = sp.locality?.slice(0, 120) || undefined;
  const role = ROLES.has(sp.role ?? "") ? sp.role : undefined;
  const added = sp.added?.slice(0, 120) || null;
  const fromRequest = Boolean(state && locality);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <a
        href={fromRequest ? "/admin/local-rep-requests" : "/admin/locals"}
        className="text-xs text-zinc-500 hover:text-emerald-400"
      >
        ← {fromRequest ? "Local rep requests" : "Local officials"}
      </a>
      <header className="mt-2 mb-8">
        <h1 className="text-3xl font-bold">Add local official{locality ? ` — ${locality}` : ""}</h1>
        <p className="mt-2 text-sm text-zinc-400">
          City council members, mayors, county commissioners. Once added, they appear
          on the legislators page and can be targeted in campaigns. Saving the first one
          for a place closes any pending request for it and notifies whoever asked.
        </p>
      </header>
      {added && (
        <p className="mb-6 rounded-md border border-emerald-700/50 bg-emerald-950/20 px-3 py-2 text-sm text-emerald-200">
          ✓ Added {added}.{sp.closed === "1" ? " The pending request is closed and the requester was notified." : ""} Add
          the next one below, or <a href="/admin/local-rep-requests" className="underline">go back to requests</a>.
        </p>
      )}
      <LocalOfficialForm key={added ?? "new"} initial={{ state, locality, role }} addAnother={fromRequest} />
    </div>
  );
}
