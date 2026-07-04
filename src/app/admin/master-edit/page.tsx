import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import { ENTITIES } from "@/modules/admin/entity-edit";
import { MasterEditUI, type TypeMeta } from "./MasterEditUI";

export const metadata = { title: "Master edit" };

/**
 * /admin/master-edit — spreadsheet-like editor over the core data types
 * (queue #7a). The editable-field registry lives server-side (entity-edit.ts);
 * the client gets a plain JSON descriptor, never the engine.
 */
export default async function MasterEditPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) redirect("/dashboard");

  const meta: TypeMeta[] = Object.entries(ENTITIES).map(([type, def]) => ({
    type,
    label: def.label,
    idCol: def.idCol,
    displayCols: def.displayCols,
    editable: Object.fromEntries(
      Object.entries(def.editable).map(([col, f]) => [
        col,
        { kind: f.kind, maxLen: "maxLen" in f ? f.maxLen : undefined, values: "values" in f ? [...f.values] : undefined },
      ]),
    ),
    hasState: type !== "state",
  }));

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">← Admin</a>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">🛠 Master edit</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Find rows, edit the whitelisted fields inline, review the exact before → after diff, then apply.
          Every applied change is validated server-side and written to the audit log. Nothing saves until
          you click Apply.
        </p>
      </header>
      <MasterEditUI meta={meta} />
    </div>
  );
}
