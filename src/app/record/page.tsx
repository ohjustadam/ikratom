import Link from "@/components/Link";
import { STATE_NAMES } from "@/lib/state-names";

/** /record — pick a state to see its legislators' kratom record (records, not endorsements). */
export const metadata = {
  title: "Your legislators' kratom record",
  description: "Before you vote: how every sitting state legislator sponsored and voted on kratom bills, from the official record.",
};

export default function KratomRecordIndex() {
  const states = Object.entries(STATE_NAMES).filter(([abbr]) => /^[A-Z]{2}$/.test(abbr) && abbr !== "US").sort((a, b) => a[1].localeCompare(b[1]));
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-bold">Your legislators&apos; kratom record</h1>
      <p className="mt-3 max-w-2xl text-sm text-zinc-300">
        Before you vote on Nov 3, see what your state legislators actually did on kratom: the bills they
        sponsored and how they voted, from the official record. No endorsements; read the record and decide.
      </p>
      <ul className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {states.map(([abbr, name]) => (
          <li key={abbr}>
            <Link href={`/record/${abbr.toLowerCase()}`} className="block rounded border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm hover:border-emerald-500">
              {name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
