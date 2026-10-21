import Link from "@/components/Link";
import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";
import { createAnonClient } from "@/lib/supabase/anon";
import { publicSnapshot } from "@/lib/public-snapshots";
import { STATE_NAMES } from "@/lib/state-names";
import { buildRecords, statusWord, type RecordEntry, type SponsorRow, type VoteRow } from "@/lib/kratom-record";

/**
 * /record/[state] — every sitting state legislator's kratom record: the bills
 * they sponsored and how they voted, from the official record. Records, not
 * endorsements (see src/lib/kratom-record.ts for why nothing is labeled).
 *
 * Public data through the ANONYMOUS client, cached like the legislator pages
 * (15 min in-process, 12 h in R2), so voters and crawlers cost no database
 * reads per visit.
 */
export const revalidate = 3600;
export function generateStaticParams() {
  return []; // render on first request, then cache (memory: ISR needs generateStaticParams)
}

type Leg = { id: string; full_name: string; role: string; district: string | null; party: string | null };
type Loaded = { legs: Leg[]; records: [string, RecordEntry[]][] };

const BILL = "id, state, bill_number, title, status, session_id";

async function loadRecord(state: string) {
  const sb = createAnonClient();
  const { data: legs, error } = await sb
    .from("legislators").select("id, full_name, role, district, party")
    .eq("state", state).eq("active", true).in("role", ["state_senate", "state_house"]).limit(500);
  if (error) throw error;
  const ids = (legs ?? []).map((l) => l.id);
  if (ids.length === 0) return { data: { legs: [], records: [] } as Loaded, cacheable: true };

  const [votesRes, sponsRes] = await Promise.all([
    sb.from("bill_vote_members")
      .select(`legislator_id, vote_text, vote_value, bill_votes!inner(vote_date, motion, bills!inner(${BILL}, kratom_relevance))`)
      .in("legislator_id", ids).in("bill_votes.bills.kratom_relevance", ["pro", "anti"]).limit(5000),
    sb.from("bill_sponsors")
      .select(`legislator_id, classification, bills!inner(${BILL}, kratom_relevance)`)
      .in("legislator_id", ids).in("bills.kratom_relevance", ["pro", "anti"]).limit(5000),
  ]);
  type RawVote = { legislator_id: string; vote_text: string | null; vote_value: string | null; bill_votes: { vote_date: string | null; motion: string | null; bills: VoteRow["bill"] } };
  type RawSpons = { legislator_id: string; classification: string | null; bills: SponsorRow["bill"] };
  const votes: VoteRow[] = ((votesRes.data ?? []) as unknown as RawVote[]).map((v) => ({
    legislator_id: v.legislator_id, vote_text: v.vote_text, vote_value: v.vote_value,
    vote_date: v.bill_votes.vote_date, motion: v.bill_votes.motion, bill: v.bill_votes.bills,
  }));
  const sponsors: SponsorRow[] = ((sponsRes.data ?? []) as unknown as RawSpons[]).map((s) => ({
    legislator_id: s.legislator_id, classification: s.classification, bill: s.bills,
  }));
  return {
    data: { legs: (legs ?? []) as Leg[], records: [...buildRecords(votes, sponsors).entries()] } as Loaded,
    cacheable: !votesRes.error && !sponsRes.error,
  };
}

const getRecord = unstable_cache(
  (state: string) => publicSnapshot("kratom-record", "v1", state, 12 * 3600, () => loadRecord(state)),
  ["kratom-record"],
  { revalidate: 900, tags: ["kratom-record"] },
);

export async function generateMetadata({ params }: { params: Promise<{ state: string }> }) {
  const st = (await params).state.toUpperCase();
  const name = STATE_NAMES[st];
  return name ? { title: `${name} legislators' kratom record`, description: `How every sitting ${name} legislator sponsored and voted on kratom bills, from the official record.` } : {};
}

export default async function KratomRecordPage({ params }: { params: Promise<{ state: string }> }) {
  const st = (await params).state.toUpperCase();
  const name = STATE_NAMES[st];
  if (!name) notFound();
  const data = await getRecord(st);
  const records = new Map(data?.records ?? []);
  const legs = (data?.legs ?? []).slice().sort((a, b) => a.full_name.localeCompare(b.full_name));
  const withRecord = legs.filter((l) => (records.get(l.id) ?? []).length > 0);
  const without = legs.length - withRecord.length;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <Link href="/record" className="text-xs text-zinc-500 hover:text-emerald-400">← All states</Link>
      <h1 className="mt-2 text-3xl font-bold">{name} legislators&apos; kratom record</h1>
      <p className="mt-3 max-w-2xl text-sm text-zinc-300">
        Before you vote on Nov 3: every kratom bill your current state legislators sponsored or voted on,
        and what became of it, from the official legislative record. We don&apos;t tell you who to vote for.
        Read the bills and decide.
      </p>
      <p className="mt-2 text-xs text-zinc-500">
        {withRecord.length} of {legs.length} sitting legislators have a recorded kratom vote or sponsorship.
        A blank record usually means a newer member or a bill that never reached a recorded vote.
      </p>

      <ul className="mt-6 space-y-3">
        {withRecord.map((l) => (
          <li key={l.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <Link href={`/legislators/${l.id}`} className="text-lg font-semibold text-zinc-100 hover:text-emerald-300">{l.full_name}</Link>
              <span className="text-xs text-zinc-500">
                {l.role === "state_senate" ? "Senate" : "House"}{l.district ? ` · District ${l.district}` : ""}{l.party ? ` · ${l.party}` : ""}
              </span>
            </div>
            <ul className="mt-2 space-y-1.5 text-sm">
              {(records.get(l.id) ?? []).map((e) => (
                <li key={e.billKey} className="border-l-2 border-zinc-700 pl-3">
                  <Link href={`/bills/${e.billId}`} className="font-mono text-xs text-emerald-400 hover:underline">{e.billNumber}</Link>{" "}
                  <span className="text-zinc-300">{e.title}</span>{" "}
                  <span className="text-[11px] text-zinc-500">({statusWord(e.status)})</span>
                  <div className="mt-0.5 text-xs text-zinc-400">
                    {e.sponsored && <span className="mr-3 font-semibold text-zinc-200">{e.sponsored === "primary" ? "Primary sponsor" : "Co-sponsor"}</span>}
                    {e.votes.slice(0, 3).map((v, i) => (
                      <span key={i} className="mr-3">Voted <strong className="text-zinc-200">{v.vote}</strong>{v.date ? ` · ${new Date(v.date).toLocaleDateString()}` : ""}</span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {without > 0 && (
        <p className="mt-6 text-xs text-zinc-500">
          {without} other sitting legislators have no recorded kratom vote or sponsorship yet.{" "}
          <Link href={`/states/${st}`} className="text-emerald-400 hover:underline">See everything moving in {name} →</Link>
        </p>
      )}
    </div>
  );
}
