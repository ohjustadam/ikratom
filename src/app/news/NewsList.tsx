"use client";

import { useMemo, useState } from "react";

type NewsItem = {
  id: string;
  state: string | null;
  title: string;
  summary: string | null;
  url: string;
  source_name: string | null;
  published_at: string | null;
  kratom_topic: string | null;
  ai_relevance_score: number | null;
};

const TOPIC_COLORS: Record<string, string> = {
  legislation: "bg-emerald-950/40 text-emerald-300",
  science: "bg-blue-950/40 text-blue-300",
  business: "bg-amber-950/40 text-amber-300",
  enforcement: "bg-red-950/40 text-red-300",
  culture: "bg-purple-950/40 text-purple-300",
};

export function NewsList({ items, userState }: { items: NewsItem[]; userState: string | null }) {
  const [scope, setScope] = useState<"all" | "yours" | "federal">(userState ? "yours" : "all");
  const [topic, setTopic] = useState<string>("all");

  const counts = useMemo(() => {
    const yourState = userState ? items.filter((i) => i.state === userState).length : 0;
    const federal = items.filter((i) => i.state === null).length;
    return { all: items.length, yours: yourState, federal };
  }, [items, userState]);

  const filtered = useMemo(() => {
    return items.filter((i) => {
      if (scope === "yours" && i.state !== userState) return false;
      if (scope === "federal" && i.state !== null) return false;
      if (topic !== "all" && i.kratom_topic !== topic) return false;
      return true;
    });
  }, [items, scope, topic, userState]);

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-12 text-center">
        <p className="text-sm text-zinc-400">No news indexed yet.</p>
        <p className="mt-2 text-xs text-zinc-500">
          The daily AI scraper hasn&apos;t run yet — admin can trigger via{" "}
          <code className="rounded bg-zinc-900 px-2 py-0.5">npm run sync:news</code>.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {userState && (
          <Pill active={scope === "yours"} onClick={() => setScope("yours")} count={counts.yours}>
            Your state ({userState})
          </Pill>
        )}
        <Pill active={scope === "all"} onClick={() => setScope("all")} count={counts.all}>
          All
        </Pill>
        <Pill active={scope === "federal"} onClick={() => setScope("federal")} count={counts.federal}>
          Federal
        </Pill>
      </div>

      <div className="mb-6 flex flex-wrap gap-2 text-xs">
        <TopicPill active={topic === "all"} onClick={() => setTopic("all")}>All topics</TopicPill>
        {Object.keys(TOPIC_COLORS).map((t) => (
          <TopicPill key={t} active={topic === t} onClick={() => setTopic(t)} color={TOPIC_COLORS[t]}>
            {t}
          </TopicPill>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-center text-sm text-zinc-500">No items match.</p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((i) => (
            <li key={i.id}>
              <a
                href={i.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 hover:border-emerald-700/50"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {i.state ? (
                    <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-zinc-300">{i.state}</span>
                  ) : (
                    <span className="rounded bg-purple-950/40 px-1.5 py-0.5 text-purple-300">Federal</span>
                  )}
                  {i.kratom_topic && (
                    <span className={`rounded px-1.5 py-0.5 ${TOPIC_COLORS[i.kratom_topic] ?? "bg-zinc-900 text-zinc-400"}`}>
                      {i.kratom_topic}
                    </span>
                  )}
                  {i.source_name && (
                    <span className="text-zinc-500">{i.source_name}</span>
                  )}
                  {i.published_at && (
                    <span className="ml-auto text-zinc-600">{new Date(i.published_at).toLocaleDateString()}</span>
                  )}
                </div>
                <h3 className="mt-2 font-semibold leading-tight">{i.title}</h3>
                {i.summary && (
                  <p className="mt-2 text-sm text-zinc-400">{i.summary}</p>
                )}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Pill({ active, onClick, count, children }: {
  active: boolean; onClick: () => void; count: number; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
        active ? "bg-emerald-500 text-zinc-950" : "border border-zinc-800 text-zinc-400 hover:border-emerald-500"
      }`}
    >
      {children}
      <span className="ml-1.5 opacity-70">{count}</span>
    </button>
  );
}

function TopicPill({ active, onClick, color, children }: {
  active: boolean; onClick: () => void; color?: string; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 capitalize transition ${
        active
          ? "bg-emerald-500 text-zinc-950"
          : color
          ? `${color} hover:opacity-80`
          : "border border-zinc-800 text-zinc-400 hover:border-emerald-500"
      }`}
    >
      {children}
    </button>
  );
}
