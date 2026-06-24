"use client";

import { useMemo, useState } from "react";
import { ROLE_LABEL, ROLE_SHORT, type Legislator } from "@/lib/legislators";
import { OfficialAvatar } from "@/components/OfficialAvatar";

type Role = "all" | "us_senate" | "us_house" | "state_senate" | "state_house" | "local";
type Party = "all" | "D" | "R" | "I" | "Other";

const PARTY_COLOR: Record<string, string> = {
  Democratic: "bg-blue-950/40 text-blue-300 border-blue-900/40",
  Republican: "bg-red-950/40 text-red-300 border-red-900/40",
  Independent: "bg-purple-950/40 text-purple-300 border-purple-900/40",
};

export function LegislatorBrowser({
  state,
  stateName,
  states,
  legislators,
  myRepIds,
  isSignedIn,
}: {
  state: string;
  stateName: string;
  states: { abbr: string; name: string }[];
  legislators: Legislator[];
  myRepIds: string[];
  isSignedIn: boolean;
}) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<Role>("all");
  const [party, setParty] = useState<Party>("all");
  const [onlyMine, setOnlyMine] = useState(false);

  const myRepSet = useMemo(() => new Set(myRepIds), [myRepIds]);
  const hasMine = myRepIds.length > 0;

  const counts = useMemo(() => {
    const c: Record<Role, number> = {
      all: legislators.length,
      us_senate: 0,
      us_house: 0,
      state_senate: 0,
      state_house: 0,
      local: 0,
    };
    for (const l of legislators) {
      if (l.role === "us_senate" || l.role === "us_house" ||
          l.role === "state_senate" || l.role === "state_house") {
        c[l.role as Role]++;
      } else if (l.level === "municipal" || l.level === "county") {
        c.local++;
      }
    }
    return c;
  }, [legislators]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return legislators.filter((l) => {
      if (onlyMine && !myRepSet.has(l.id)) return false;
      if (role === "local") {
        if (l.level !== "municipal" && l.level !== "county") return false;
      } else if (role !== "all" && l.role !== role) {
        return false;
      }
      if (party !== "all") {
        const p = l.party ?? "";
        if (party === "D" && !p.startsWith("Democ")) return false;
        if (party === "R" && !p.startsWith("Repub")) return false;
        if (party === "I" && !p.startsWith("Indep")) return false;
        if (party === "Other" && (p.startsWith("Democ") || p.startsWith("Repub") || p.startsWith("Indep"))) return false;
      }
      if (q && !`${l.full_name} ${l.district ?? ""} ${l.locality ?? ""} ${l.title ?? ""}`.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [legislators, query, role, party, onlyMine, myRepSet]);

  const grouped = useMemo(() => {
    const g: Record<string, Legislator[]> = {};
    for (const l of filtered) {
      // Local officials grouped by locality, others by role
      const key =
        l.level === "municipal" || l.level === "county"
          ? `local:${l.locality ?? "Unspecified locality"}`
          : l.role;
      g[key] ??= [];
      g[key].push(l);
    }
    return g;
  }, [filtered]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
            Legislators
          </p>
          <h1 className="mt-1 text-3xl font-bold">{stateName}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {legislators.length.toLocaleString()} active officials · synced from
            OpenStates
          </p>
        </div>

        <form action="/legislators" className="flex items-center gap-2">
          <select
            name="state"
            defaultValue={state}
            className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          >
            {states.map((s) => (
              <option key={s.abbr} value={s.abbr}>
                {s.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm hover:border-emerald-500"
          >
            Go
          </button>
        </form>
      </header>

      {/* Sticky search + filters */}
      <div className="sticky top-0 z-10 -mx-4 mb-6 border-b border-zinc-800 bg-zinc-950/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <SearchIcon />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or district…"
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-2 pl-9 pr-3 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {hasMine && isSignedIn && (
            <button
              type="button"
              onClick={() => setOnlyMine((v) => !v)}
              className={`rounded-md px-3 py-2 text-sm font-medium transition ${
                onlyMine
                  ? "bg-emerald-500 text-zinc-950"
                  : "border border-zinc-800 text-zinc-300 hover:border-emerald-500"
              }`}
            >
              {onlyMine ? "✓ My reps only" : "My reps only"}
              <span className="ml-2 text-xs opacity-70">({myRepIds.length})</span>
            </button>
          )}

          <select
            value={party}
            onChange={(e) => setParty(e.target.value as Party)}
            className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          >
            <option value="all">All parties</option>
            <option value="D">Democratic</option>
            <option value="R">Republican</option>
            <option value="I">Independent</option>
            <option value="Other">Other</option>
          </select>
        </div>

        {/* Role tabs */}
        <div className="mt-3 flex flex-wrap gap-2">
          <RoleTab active={role === "all"} onClick={() => setRole("all")} count={counts.all}>
            All
          </RoleTab>
          <RoleTab active={role === "us_senate"} onClick={() => setRole("us_senate")} count={counts.us_senate}>
            U.S. Senate
          </RoleTab>
          <RoleTab active={role === "us_house"} onClick={() => setRole("us_house")} count={counts.us_house}>
            U.S. House
          </RoleTab>
          <RoleTab active={role === "state_senate"} onClick={() => setRole("state_senate")} count={counts.state_senate}>
            State Senate
          </RoleTab>
          <RoleTab active={role === "state_house"} onClick={() => setRole("state_house")} count={counts.state_house}>
            State House
          </RoleTab>
          <RoleTab active={role === "local"} onClick={() => setRole("local")} count={counts.local}>
            Local
          </RoleTab>
        </div>
      </div>

      {/* "Set your address" prompt */}
      {isSignedIn && !hasMine && (
        <div className="mb-6 rounded-lg border border-amber-900/40 bg-amber-950/20 p-4 text-sm">
          <span className="text-amber-300">
            Add your address in your account to see your specific reps highlighted.
          </span>{" "}
          <a href="/account" className="text-emerald-400 hover:underline">
            Update profile →
          </a>
        </div>
      )}

      {/* Results */}
      {filtered.length === 0 ? (
        <EmptyState query={query} />
      ) : role === "all" ? (
        // Grouped by role (federal+state) then by locality (local)
        <div className="space-y-8">
          {(["us_senate", "us_house", "state_senate", "state_house"] as const).map(
            (r) =>
              grouped[r]?.length ? (
                <RoleSection
                  key={r}
                  title={ROLE_LABEL[r]}
                  legislators={grouped[r]}
                  myRepSet={myRepSet}
                />
              ) : null
          )}
          {Object.keys(grouped)
            .filter((k) => k.startsWith("local:"))
            .sort()
            .map((k) => (
              <RoleSection
                key={k}
                title={k.replace("local:", "")}
                legislators={grouped[k]}
                myRepSet={myRepSet}
              />
            ))}
        </div>
      ) : role === "local" ? (
        // Local — group by locality
        <div className="space-y-8">
          {Object.keys(grouped)
            .sort()
            .map((k) => (
              <RoleSection
                key={k}
                title={k.replace("local:", "")}
                legislators={grouped[k]}
                myRepSet={myRepSet}
              />
            ))}
        </div>
      ) : (
        // Flat grid
        <Grid legislators={filtered} myRepSet={myRepSet} />
      )}
    </div>
  );
}

function RoleSection({
  title,
  legislators,
  myRepSet,
}: {
  title: string;
  legislators: Legislator[];
  myRepSet: Set<string>;
}) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
        {title}{" "}
        <span className="font-mono text-xs text-zinc-600">
          ({legislators.length})
        </span>
      </h2>
      <Grid legislators={legislators} myRepSet={myRepSet} />
    </section>
  );
}

function Grid({
  legislators,
  myRepSet,
}: {
  legislators: Legislator[];
  myRepSet: Set<string>;
}) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {legislators.map((l) => (
        <Card key={l.id} legislator={l} mine={myRepSet.has(l.id)} />
      ))}
    </ul>
  );
}

function Card({ legislator: l, mine }: { legislator: Legislator; mine: boolean }) {
  const partyColor = PARTY_COLOR[l.party ?? ""] ?? "bg-zinc-900 text-zinc-400 border-zinc-800";

  // Detect federal contact-form (URL) vs real email
  const emailIsForm = l.email?.startsWith("http") ?? false;

  return (
    <li
      className={`relative rounded-lg border p-4 transition ${
        mine
          ? "border-emerald-700/50 bg-emerald-950/10 ring-1 ring-emerald-700/30"
          : "border-zinc-800 bg-zinc-950/40 hover:border-zinc-700"
      }`}
    >
      {mine && (
        <span className="absolute right-3 top-3 rounded bg-emerald-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-950">
          Yours
        </span>
      )}

      <div className="flex items-start gap-3">
        <OfficialAvatar name={l.full_name} portraitUrl={l.portrait_url} size="md" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold leading-tight">
            <a href={`/legislators/${l.id}`} className="hover:text-emerald-400">{l.full_name}</a>
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            {l.title ? (
              <span className="text-zinc-500">{l.title}</span>
            ) : (
              <>
                <span className="text-zinc-500">{ROLE_SHORT[l.role] ?? l.role}</span>
                {l.district && (
                  <>
                    <span className="text-zinc-700">·</span>
                    <span className="text-zinc-500">Dist. {l.district}</span>
                  </>
                )}
              </>
            )}
            {l.party && (
              <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${partyColor}`}>
                {l.party.slice(0, 1)}
              </span>
            )}
          </div>
          {l.body && (
            <p className="mt-0.5 truncate text-[11px] text-zinc-600">{l.body}</p>
          )}
        </div>
      </div>

      {/* Visible contacts with copy buttons */}
      <div className="mt-3 space-y-1.5">
        {l.email && !emailIsForm && (
          <ContactRow icon={<MailIcon />} value={l.email} href={`mailto:${l.email}`} />
        )}
        {l.email && emailIsForm && (
          <ContactRow icon={<MailIcon />} value="Contact form" href={l.email} external />
        )}
        {l.phone && (
          <ContactRow icon={<PhoneIcon />} value={l.phone} href={`tel:${l.phone}`} />
        )}
        {l.website && (
          <ContactRow
            icon={<GlobeIcon />}
            value={l.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
            href={l.website}
            external
          />
        )}
      </div>
    </li>
  );
}

function ContactRow({
  icon,
  value,
  href,
  external,
}: {
  icon: React.ReactNode;
  value: string;
  href: string;
  external?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <div className="group flex items-center gap-2 text-xs">
      <span className="text-zinc-600">{icon}</span>
      <a
        href={href}
        target={external ? "_blank" : undefined}
        rel={external ? "noreferrer" : undefined}
        className="min-w-0 flex-1 truncate text-zinc-300 hover:text-emerald-300"
      >
        {value}
      </a>
      <button
        type="button"
        onClick={copy}
        title="Copy"
        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-zinc-600 opacity-0 transition group-hover:opacity-100 hover:bg-zinc-900 hover:text-zinc-300"
      >
        {copied ? "✓" : "Copy"}
      </button>
    </div>
  );
}

function GlobeIcon() {
  return (
    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" />
    </svg>
  );
}

function RoleTab({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  children: React.ReactNode;
}) {
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

function EmptyState({ query }: { query: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-12 text-center">
      <p className="text-sm text-zinc-400">
        {query
          ? <>No legislators matched &ldquo;<span className="text-zinc-200">{query}</span>&rdquo;.</>
          : "No legislators match those filters."}
      </p>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
function MailIcon() {
  return (
    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  );
}
function PhoneIcon() {
  return (
    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path d="M3 5a2 2 0 012-2h2.5a1 1 0 01.95.68l1.5 4.5a1 1 0 01-.5 1.21l-1.7.85a11 11 0 005.5 5.5l.85-1.7a1 1 0 011.21-.5l4.5 1.5a1 1 0 01.68.95V19a2 2 0 01-2 2A18 18 0 013 5z" />
    </svg>
  );
}
