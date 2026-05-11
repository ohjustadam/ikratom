import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABEL } from "@/lib/legislators";
import { ShareButtons } from "@/components/ShareButtons";

const APP_URL = process.env.APP_URL ?? "https://www.ikratom.org";

type Legislator = {
  id: string;
  state: string;
  role: string;
  district: string | null;
  full_name: string;
  party: string | null;
  email: string | null;
  phone: string | null;
  office_address: string | null;
  website: string | null;
  level: string | null;
  locality: string | null;
  body: string | null;
  title: string | null;
  active: boolean;
};

type SponsoredBill = {
  bill_id: string;
  classification: string;
  bills: {
    bill_number: string;
    title: string | null;
    kratom_relevance: string | null;
    targets_natural_leaf: boolean | null;
    status: string | null;
    last_action_at: string | null;
    state: string;
  }[] | { bill_number: string; title: string | null; kratom_relevance: string | null; targets_natural_leaf: boolean | null; status: string | null; last_action_at: string | null; state: string } | null;
};

const RELEVANCE_TAG: Record<string, { label: string; cls: string }> = {
  pro: { label: "Pro-kratom", cls: "bg-emerald-950/40 text-emerald-300" },
  anti: { label: "Anti-kratom", cls: "bg-red-950/40 text-red-300" },
  neutral: { label: "Neutral", cls: "bg-zinc-900 text-zinc-400" },
};

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("legislators")
    .select("full_name, state, role")
    .eq("id", id)
    .single();
  return data
    ? { title: `${(data as { full_name: string }).full_name} (${(data as { state: string }).state})` }
    : { title: "Legislator" };
}

export default async function LegislatorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: legRaw } = await supabase
    .from("legislators")
    .select("id, state, role, district, full_name, party, email, phone, office_address, website, level, locality, body, title, active")
    .eq("id", id)
    .single();
  if (!legRaw) notFound();
  const leg = legRaw as unknown as Legislator;

  // Sponsored bills (with stance + status)
  const { data: sponsoredRaw } = await supabase
    .from("bill_sponsors")
    .select("bill_id, classification, bills(bill_number, title, kratom_relevance, targets_natural_leaf, status, last_action_at, state)")
    .eq("legislator_id", id);
  const sponsored = (sponsoredRaw ?? []) as unknown as SponsoredBill[];

  // Active campaigns targeting this legislator (explicit IDs OR role match)
  const { data: explicitCampaigns } = await supabase
    .from("campaigns")
    .select("id, slug, title, state, blurb")
    .eq("active", true)
    .contains("target_legislator_ids", [id]);

  const { data: roleCampaigns } = await supabase
    .from("campaigns")
    .select("id, slug, title, state, blurb")
    .eq("active", true)
    .eq("state", leg.state)
    .contains("target_roles", [leg.role]);

  const targetingCampaigns = new Map<string, { id: string; slug: string; title: string; state: string | null; blurb: string | null }>();
  for (const c of [...(explicitCampaigns ?? []), ...(roleCampaigns ?? [])] as Array<{ id: string; slug: string; title: string; state: string | null; blurb: string | null }>) {
    targetingCampaigns.set(c.id, c);
  }

  // Donor profile (OpenFEC) — federal legislators only
  const isFederalLegislator = leg.role === "us_senate" || leg.role === "us_house";
  type DonorProfile = {
    cycle: number | null;
    total_receipts: number | null;
    top_industries: Array<{ industry: string; amount: number }> | null;
    top_employers: Array<{ employer: string; amount: number }> | null;
    kratom_relevant: { pharma?: number; retail?: number; alcohol?: number; tobacco?: number; hospital_health?: number; total?: number } | null;
    resolved_status: string | null;
    synced_at: string | null;
  };
  let donorProfile: DonorProfile | null = null;
  if (isFederalLegislator) {
    const { data: dp } = await supabase
      .from("legislator_donors")
      .select("cycle, total_receipts, top_industries, top_employers, kratom_relevant, resolved_status, synced_at")
      .eq("legislator_id", id)
      .maybeSingle();
    donorProfile = (dp as DonorProfile | null) ?? null;
  }

  // Quick stance summary for sponsored bills
  const summary = {
    pro: 0, anti: 0, neutral: 0, total: sponsored.length,
    leafTargeting: 0,
  };
  for (const s of sponsored) {
    const b = Array.isArray(s.bills) ? s.bills[0] : s.bills;
    if (!b) continue;
    if (b.kratom_relevance === "pro") summary.pro++;
    else if (b.kratom_relevance === "anti") summary.anti++;
    else summary.neutral++;
    if (b.targets_natural_leaf === true) summary.leafTargeting++;
  }

  const roleLabel = ROLE_LABEL[leg.role] ?? leg.role;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <a href={`/legislators?state=${leg.state}`} className="text-xs text-zinc-500 hover:text-emerald-400">
        ← {leg.state} legislators
      </a>

      <header className="mt-3 mb-6">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded bg-zinc-900 px-2 py-1 font-mono text-zinc-300">{leg.state}</span>
          <span className="rounded bg-zinc-900 px-2 py-1 text-zinc-300">{roleLabel}</span>
          {leg.district && (
            <span className="rounded bg-zinc-900 px-2 py-1 text-zinc-400">District {leg.district}</span>
          )}
          {leg.party && <span className="text-zinc-500">({leg.party})</span>}
          {leg.locality && (
            <span className="rounded bg-zinc-900 px-2 py-1 text-zinc-300">📍 {leg.locality}</span>
          )}
          {!leg.active && (
            <span className="rounded bg-amber-950/40 px-2 py-1 text-amber-300">No longer in office</span>
          )}
        </div>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">{leg.full_name}</h1>
        {leg.title && <p className="mt-1 text-sm text-zinc-400">{leg.title}</p>}
      </header>

      {/* Contact */}
      <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">Contact</h2>
        <ul className="space-y-2 text-sm">
          {leg.email && (
            <li>
              <span className="text-zinc-500">Email: </span>
              <a href={`mailto:${leg.email}`} className="text-emerald-400 hover:underline">{leg.email}</a>
            </li>
          )}
          {leg.phone && (
            <li>
              <span className="text-zinc-500">Phone: </span>
              <a href={`tel:${leg.phone}`} className="text-amber-300 hover:text-amber-200">{leg.phone}</a>
              <span className="ml-3 text-xs text-zinc-500">(Phone calls weigh more than emails — call them.)</span>
            </li>
          )}
          {leg.office_address && (
            <li>
              <span className="text-zinc-500">Office: </span>
              <span className="text-zinc-200">{leg.office_address}</span>
            </li>
          )}
          {leg.website && (
            <li>
              <a href={leg.website} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">
                Official website ↗
              </a>
            </li>
          )}
          {!leg.email && !leg.phone && !leg.website && (
            <li className="text-zinc-500">No public contact info on file. Try the official chamber directory.</li>
          )}
        </ul>
      </section>

      {/* Kratom record summary */}
      {summary.total > 0 && (
        <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Kratom record
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat value={summary.total} label="Bills sponsored" />
            <Stat value={summary.anti} label="Anti-kratom" warn={summary.anti > 0} />
            <Stat value={summary.pro} label="Pro-kratom" accent={summary.pro > 0} />
            <Stat value={summary.leafTargeting} label="Restrict natural leaf" warn={summary.leafTargeting > 0} />
          </div>
          {summary.anti > 0 && (
            <p className="mt-3 text-xs text-amber-200">
              ⚠ This legislator has sponsored {summary.anti} anti-kratom bill{summary.anti === 1 ? "" : "s"}.
              When you contact them, lead with your story.
            </p>
          )}
          {summary.pro > 0 && summary.anti === 0 && (
            <p className="mt-3 text-xs text-emerald-300">
              ✓ This legislator has sponsored pro-kratom legislation. Thank-you emails matter — they keep allies engaged.
            </p>
          )}
        </section>
      )}

      {/* Sponsored bills */}
      {sponsored.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Sponsored kratom bills ({sponsored.length})
          </h2>
          <ul className="space-y-2">
            {sponsored.map((s, i) => {
              const b = Array.isArray(s.bills) ? s.bills[0] : s.bills;
              if (!b) return null;
              const tag = RELEVANCE_TAG[b.kratom_relevance ?? "neutral"] ?? RELEVANCE_TAG.neutral;
              return (
                <li
                  key={`${s.bill_id}-${i}`}
                  className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-zinc-300">
                      {b.state} · {b.bill_number}
                    </span>
                    <span className={`rounded px-1.5 py-0.5 font-semibold ${tag.cls}`}>{tag.label}</span>
                    {b.targets_natural_leaf === true && (
                      <span className="rounded bg-red-950/40 px-1.5 py-0.5 text-red-300">🚨 leaf</span>
                    )}
                    <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-500 capitalize">
                      {s.classification}
                    </span>
                    {b.last_action_at && (
                      <span className="ml-auto text-zinc-500">
                        {new Date(b.last_action_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <h3 className="mt-2 text-sm font-medium leading-snug">
                    <a href={`/bills/${s.bill_id}`} className="hover:text-emerald-400">
                      {b.title || "(untitled)"}
                    </a>
                  </h3>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Donor profile (federal only) */}
      {donorProfile && donorProfile.resolved_status === "matched" && donorProfile.total_receipts && donorProfile.total_receipts > 0 && (
        <section className="mb-6 rounded-lg border border-amber-700/40 bg-amber-950/10 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-300">
              💰 Donor profile — {donorProfile.cycle} cycle
            </h2>
            <span className="text-[10px] text-zinc-500">
              public data via OpenFEC · synced {donorProfile.synced_at ? new Date(donorProfile.synced_at).toLocaleDateString() : "?"}
            </span>
          </div>
          <p className="mt-2 text-2xl font-bold text-zinc-100">
            ${(donorProfile.total_receipts / 1_000_000).toFixed(2)}M total receipts
          </p>

          {donorProfile.kratom_relevant && (
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
              {[
                { key: "pharma", label: "💊 Pharma", color: "text-red-300" },
                { key: "tobacco", label: "🚬 Tobacco", color: "text-red-300" },
                { key: "alcohol", label: "🍷 Alcohol", color: "text-amber-300" },
                { key: "retail", label: "🛒 Retail", color: "text-zinc-300" },
                { key: "hospital_health", label: "🏥 Hospital/Health", color: "text-zinc-300" },
              ].map((b) => {
                const amount = donorProfile.kratom_relevant?.[b.key as keyof typeof donorProfile.kratom_relevant] ?? 0;
                if (!amount || amount <= 0) return null;
                const total = donorProfile.kratom_relevant?.total ?? donorProfile.total_receipts ?? 0;
                const share = total > 0 ? (amount / total * 100).toFixed(1) : "?";
                return (
                  <div key={b.key} className="rounded border border-zinc-800 bg-zinc-950/60 p-2">
                    <div className={`text-[10px] font-bold uppercase ${b.color}`}>{b.label}</div>
                    <div className="mt-1 font-mono text-sm font-bold text-zinc-100">
                      ${(amount / 1000).toFixed(0)}k
                    </div>
                    <div className="text-[10px] text-zinc-500">{share}% of receipts</div>
                  </div>
                );
              })}
            </div>
          )}

          {(donorProfile.top_industries?.length ?? 0) > 0 && (
            <details className="mt-3 rounded border border-zinc-800 bg-zinc-950/60 p-3">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Top {Math.min(donorProfile.top_industries!.length, 10)} industries by contribution
              </summary>
              <ol className="mt-2 space-y-1 text-xs">
                {donorProfile.top_industries!.slice(0, 10).map((i, idx) => (
                  <li key={idx} className="flex items-baseline gap-2 border-b border-zinc-900 py-1 last:border-b-0">
                    <span className="font-mono text-zinc-600">{idx + 1}.</span>
                    <span className="flex-1 text-zinc-300">{i.industry}</span>
                    <span className="font-mono text-zinc-400">${(i.amount / 1000).toFixed(0)}k</span>
                  </li>
                ))}
              </ol>
            </details>
          )}

          <p className="mt-3 text-[11px] text-zinc-500">
            Public campaign-finance data. Useful narrative for legislator emails — &ldquo;You took $X from
            industries that profit when kratom is banned. Please vote on the merits, not on donor
            interest.&rdquo;
          </p>
        </section>
      )}

      {/* Targeting campaigns */}
      {targetingCampaigns.size > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Active campaigns targeting them
          </h2>
          <ul className="space-y-2">
            {Array.from(targetingCampaigns.values()).map((c) => (
              <li
                key={c.id}
                className="rounded-lg border border-emerald-700/40 bg-emerald-950/20 p-4"
              >
                <a href={`/campaigns/${c.slug}`} className="block">
                  <p className="text-sm font-semibold text-emerald-300">{c.title}</p>
                  {c.blurb && <p className="mt-1 text-xs text-zinc-300">{c.blurb}</p>}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Share */}
      <section className="mt-8 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Share this profile
        </p>
        <p className="mt-1 text-sm text-zinc-400">
          Tag your network — point constituents at their actual rep.
        </p>
        <div className="mt-3">
          <ShareButtons
            url={`${APP_URL}/legislators/${leg.id}`}
            title={`${leg.full_name} — ${leg.state} ${roleLabel} on kratom`}
            text={`Kratom record for ${leg.full_name}: ${summary.anti} anti-kratom bill${summary.anti === 1 ? "" : "s"} sponsored.`}
            target={{ kind: "campaign", campaignId: Array.from(targetingCampaigns.values())[0]?.id ?? leg.id }}
          />
        </div>
      </section>
    </div>
  );
}

function Stat({ value, label, accent, warn }: { value: number; label: string; accent?: boolean; warn?: boolean }) {
  const cls = accent
    ? "border-emerald-700/50 bg-emerald-950/20"
    : warn
    ? "border-red-900/40 bg-red-950/20"
    : "border-zinc-800 bg-zinc-950/40";
  const valueCls = accent ? "text-emerald-300" : warn ? "text-red-300" : "text-zinc-100";
  return (
    <div className={`rounded-lg border p-3 text-center ${cls}`}>
      <div className={`text-2xl font-bold tabular-nums ${valueCls}`}>{value.toLocaleString()}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
    </div>
  );
}
