import Link from "next/link";
import { STANCE_TOPICS, STANCE_TOPIC_META } from "@/lib/legislator-action-plan";
import { getBillsWithTopics, topicCounts } from "@/lib/topic-bills";

export const metadata = {
  title: "Bills by topic — iKratom",
  description: "Substance-policy bills we track, grouped by topic: kratom, cannabis, hemp/CBD, psychedelics, dietary supplements, tobacco/vaping, alcohol.",
};

export const dynamic = "force-dynamic";

export default async function TopicsPage() {
  const bills = await getBillsWithTopics();
  const counts = topicCounts(bills);

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">Bills by topic</p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Substance-policy legislation</h1>
        <p className="mt-3 max-w-2xl text-sm text-zinc-400">
          We track legislation across {STANCE_TOPICS.length} substance-policy topics. Today most coverage flows
          from our kratom-bill set (omnibus bills often regulate several substances at once); dedicated discovery
          for each topic is rolling out. Each bill is tagged with the topics it touches + the direction it points.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {STANCE_TOPICS.map((t) => {
          const meta = STANCE_TOPIC_META[t];
          const n = counts[t] ?? 0;
          return (
            <Link
              key={t}
              href={`/topics/${t}`}
              className={`flex items-center justify-between rounded-lg border p-4 transition ${
                t === "kratom"
                  ? "border-emerald-700/50 bg-emerald-950/10 hover:border-emerald-500"
                  : "border-zinc-800 bg-zinc-950/40 hover:border-zinc-600"
              }`}
            >
              <span className="flex items-center gap-2.5">
                <span className="text-xl">{meta.emoji}</span>
                <span className="font-semibold">{meta.label}</span>
              </span>
              <span className="font-mono text-sm text-zinc-400">
                {n} bill{n === 1 ? "" : "s"}
              </span>
            </Link>
          );
        })}
      </div>

      <p className="mt-8 text-[11px] text-zinc-600">
        Topic tags are evidence-based (bill text keyword match + the curated kratom signal), method recorded for
        a later AI pass. &ldquo;Direction&rdquo; is a nonpartisan read of whether a bill tightens or loosens
        regulation — not an endorsement.
      </p>
    </div>
  );
}
