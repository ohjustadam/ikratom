"use client";

import { useMemo, useState } from "react";

type Local = {
  id: string;
  full_name: string;
  state: string;
  role: string;
  locality: string | null;
  body: string | null;
  title: string | null;
  district: string | null;
  email: string | null;
  phone: string | null;
  party: string | null;
  active: boolean;
};

const ROLE_LABEL: Record<string, string> = {
  mayor: "Mayor",
  city_council: "City Council",
  county_executive: "County Executive",
  county_commissioner: "County Commissioner",
  school_board: "School Board",
  other_local: "Other",
};

export function LocalsBrowser({ locals }: { locals: Local[] }) {
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [openLocalities, setOpenLocalities] = useState<Set<string>>(new Set());

  // Available state codes (sorted)
  const states = useMemo(() => {
    return Array.from(new Set(locals.map((l) => l.state))).sort();
  }, [locals]);

  // Filter
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return locals.filter((l) => {
      if (stateFilter !== "all" && l.state !== stateFilter) return false;
      if (roleFilter !== "all" && l.role !== roleFilter) return false;
      if (q) {
        const hay = `${l.full_name} ${l.locality ?? ""} ${l.title ?? ""} ${l.body ?? ""} ${l.email ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [locals, query, stateFilter, roleFilter]);

  // Group by locality
  const groups = useMemo(() => {
    const m = new Map<string, Local[]>();
    for (const l of filtered) {
      const k = l.locality ?? "(no locality)";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(l);
    }
    return m;
  }, [filtered]);

  const totalCount = filtered.length;
  const localityCount = groups.size;

  function toggle(locality: string) {
    setOpenLocalities((s) => {
      const next = new Set(s);
      if (next.has(locality)) next.delete(locality);
      else next.add(locality);
      return next;
    });
  }

  function expandAll() {
    setOpenLocalities(new Set(groups.keys()));
  }

  function collapseAll() {
    setOpenLocalities(new Set());
  }

  // Active role counts (for chips)
  const roleCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of locals) c[l.role] = (c[l.role] ?? 0) + 1;
    return c;
  }, [locals]);

  if (locals.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-12 text-center">
        <h2 className="text-lg font-semibold">No local officials added yet.</h2>
        <p className="mt-2 max-w-md mx-auto text-sm text-zinc-400">
          Use AI suggest for quick city lookups, or add manually. Once a locality is on
          file, advocates in that area can run targeted campaigns.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Sticky filter bar */}
      <div className="sticky top-0 z-10 -mx-4 border-b border-zinc-800 bg-zinc-950/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <SearchIcon />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, locality, title, email…"
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-2 pl-9 pr-3 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          >
            <option value="all">All states</option>
            {states.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {/* Role chips */}
        <div className="mt-3 flex flex-wrap gap-2">
          <RoleChip active={roleFilter === "all"} onClick={() => setRoleFilter("all")} count={locals.length}>
            All roles
          </RoleChip>
          {Object.entries(ROLE_LABEL).map(([role, label]) => {
            const count = roleCounts[role] ?? 0;
            if (count === 0) return null;
            return (
              <RoleChip
                key={role}
                active={roleFilter === role}
                onClick={() => setRoleFilter(role)}
                count={count}
              >
                {label}
              </RoleChip>
            );
          })}
        </div>
      </div>

      {/* Result summary + expand/collapse */}
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>
          {totalCount} official{totalCount === 1 ? "" : "s"} ·{" "}
          {localityCount} {localityCount === 1 ? "locality" : "localities"}
        </span>
        <div className="flex gap-3">
          <button onClick={expandAll} className="hover:text-emerald-400">
            Expand all
          </button>
          <button onClick={collapseAll} className="hover:text-emerald-400">
            Collapse all
          </button>
        </div>
      </div>

      {/* Groups */}
      {totalCount === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-12 text-center">
          <p className="text-sm text-zinc-400">No officials match those filters.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {Array.from(groups.entries()).map(([locality, rows]) => {
            const isOpen = openLocalities.has(locality);
            return (
              <section
                key={locality}
                className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/40"
              >
                <button
                  type="button"
                  onClick={() => toggle(locality)}
                  className="flex w-full items-center justify-between border-b border-zinc-800 bg-zinc-950 px-4 py-3 text-left hover:bg-zinc-900"
                >
                  <span className="flex items-center gap-3">
                    <Chevron open={isOpen} />
                    <span className="font-semibold">{locality}</span>
                    <span className="text-xs text-zinc-500">({rows.length})</span>
                  </span>
                  <span className="text-xs text-zinc-500">
                    {Array.from(new Set(rows.map((r) => ROLE_LABEL[r.role] ?? r.role))).join(" · ")}
                  </span>
                </button>
                {isOpen && (
                  <table className="w-full text-sm">
                    <thead className="bg-zinc-950/40 text-xs uppercase tracking-wider text-zinc-500">
                      <tr>
                        <th className="p-3 text-left">Name</th>
                        <th className="p-3 text-left">Title / role</th>
                        <th className="p-3 text-left">Email</th>
                        <th className="p-3 text-left">Phone</th>
                        <th className="p-3 text-right">Edit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-900">
                      {rows.map((l) => (
                        <tr key={l.id}>
                          <td className="p-3 font-medium">
                            {l.full_name}
                            {!l.active && (
                              <span className="ml-2 rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-500">
                                inactive
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-zinc-300">
                            {l.title ?? ROLE_LABEL[l.role] ?? l.role}
                            {l.district && (
                              <span className="ml-1 text-xs text-zinc-500">· D{l.district}</span>
                            )}
                          </td>
                          <td className="p-3 text-xs">
                            {l.email ? (
                              l.email.startsWith("http") ? (
                                <a href={l.email} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">
                                  contact form
                                </a>
                              ) : (
                                <span className="text-zinc-300">{l.email}</span>
                              )
                            ) : (
                              <span className="text-zinc-700">—</span>
                            )}
                          </td>
                          <td className="p-3 text-xs">
                            {l.phone ? <span className="text-zinc-300">{l.phone}</span> : <span className="text-zinc-700">—</span>}
                          </td>
                          <td className="p-3 text-right">
                            <a
                              href={`/admin/locals/${l.id}/edit`}
                              className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs hover:border-emerald-500"
                            >
                              Edit
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RoleChip({
  active, onClick, count, children,
}: { active: boolean; onClick: () => void; count: number; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
        active
          ? "bg-emerald-500 text-zinc-950"
          : "border border-zinc-800 text-zinc-400 hover:border-emerald-500 hover:text-zinc-100"
      }`}
    >
      {children}
      <span className="ml-1.5 opacity-70">{count}</span>
    </button>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
