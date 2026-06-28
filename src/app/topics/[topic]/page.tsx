import Link from "next/link";
import { notFound } from "next/navigation";
import { STANCE_TOPIC_META, STANCE_TOPICS } from "@/lib/legislator-action-plan";
import { getBillsForTopic, isStanceTopic, STANCE_TONE } from "@/lib/topic-bills";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ topic: string }> }) {
  const { topic } = await params;
  if (!isStanceTopic(topic)) return { title: "Topic not found" };
  const meta = STANCE_TOPIC_META[topic];
  return {
    title: `${meta.label} bills — iKratom`,
    description: `Legislation we track that touches ${meta.label.toLowerCase()} policy.`,
  };
}

export default async function TopicBillsPage({ params }: { params: Promise<{ topic: string }> }) {
  const { topic } = await params;
  if (!isStanceTopic(topic)) notFound();
  const meta = STANCE_TOPIC_META[topic];

  const bills = await getBillsForTopic(topic);
  const discovered = bills.filter((b) => b.source === "discovered").length;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="text-xs">
        <Link href="/topics" className="text-zinc-500 hover:text-emerald-400">← All topics</Link>
      </div>

      <header className="mt-2 mb-6">
        <h1 className="flex items-center gap-3 text-3xl font-bold sm:text-4xl">
          <span>{meta.emoji}</span> {meta.label}
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          {bills.length} bill{bills.length === 1 ? "" : "s"} touch {meta.label.toLowerCase()} policy
          {discovered > 0 ? <> · {discovered} discovered via LegiScan</> : null}.
        </p>
      </header>

      {bills.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-10 text-center text-sm text-zinc-400">
          No tracked bills tagged for {meta.label} yet — dedicated discovery is rolling out.
        </div>
      ) : (
        <ul className="space-y-2">
          {bills.map((b) => (
            <li key={b.key} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
              <div className="flex flex-wrap items-baseline gap-2 text-xs">
                {b.external ? (
                  <a href={b.href} target="_blank" rel="noopener noreferrer" className="font-mono font-semibold text-zinc-100 hover:text-emerald-400">
                    {b.state} {b.bill_number} ↗
                  </a>
                ) : (
                  <Link href={b.href} className="font-mono font-semibold text-zinc-100 hover:text-emerald-400">
                    {b.state} {b.bill_number}
                  </Link>
                )}
                <span className={`rounded px-1.5 py-0.5 font-semibold capitalize ${STANCE_TONE[b.stance] ?? STANCE_TONE.unknown}`}>
                  {b.stance}
                </span>
                {b.source === "discovered" && <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-500">LegiScan</span>}
                {b.lastDate && (
                  <span className="ml-auto font-mono text-zinc-500">{new Date(b.lastDate).toLocaleDateString()}</span>
                )}
              </div>
              <h2 className="mt-2 text-sm font-medium leading-snug">
                {b.external ? (
                  <a href={b.href} target="_blank" rel="noopener noreferrer" className="hover:text-emerald-400">{b.title || "(untitled)"}</a>
                ) : (
                  <Link href={b.href} className="hover:text-emerald-400">{b.title || "(untitled)"}</Link>
                )}
              </h2>
              {b.otherTopics.length > 0 && (
                <p className="mt-1.5 text-[10px] text-zinc-500">
                  also touches:{" "}
                  {b.otherTopics.map((t) => `${STANCE_TOPIC_META[t as keyof typeof STANCE_TOPIC_META].emoji} ${STANCE_TOPIC_META[t as keyof typeof STANCE_TOPIC_META].label}`).join(" · ")}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-8 text-[11px] text-zinc-600">
        Direction (restrictive / permissive / mixed) is a nonpartisan read of whether a bill tightens or loosens
        regulation, from bill text — not an endorsement.{" "}
        <Link href="/topics" className="text-zinc-500 hover:text-emerald-400">All {STANCE_TOPICS.length} topics →</Link>
      </p>
    </div>
  );
}
