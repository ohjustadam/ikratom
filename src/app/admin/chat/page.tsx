import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import { AdminChatUI } from "./AdminChatUI";

export const metadata = { title: "Admin chatbot — iKratom" };
export const dynamic = "force-dynamic";

/**
 * /admin/chat — admin-only RAG chatbot over the iKratom corpus.
 *
 * Origin: owner directive 2026-05-15 — "begin on admin only rag chatbot."
 *
 * Free-tier-first design:
 *   - Retrieval: pure Postgres ilike via src/lib/site-search (zero LLM cost)
 *   - Generation: AI router routes to Groq → Gemini → Ollama, all $0
 *   - Rate-limit: 30 messages/hour per admin (server-enforced)
 *
 * The conversation state lives entirely client-side. Each turn ships
 * the last 6 turns to the server, so refreshing the page resets the
 * chat (no server persistence required).
 */
export default async function AdminChatPage() {
  const ctx = await getAdminContext({ require: "moderate_lounge" });
  if (!ctx.ok) redirect("/dashboard");

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Admin
      </a>
      <header className="mt-2 mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          🤖 Admin chatbot · alpha
        </p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Ask the corpus</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          A retrieval-augmented chatbot grounded in the iKratom library — bills, research papers, legislators, campaigns, discussions. Cited answers, free-tier inference (Groq → Gemini → Ollama).
        </p>
        <p className="mt-2 text-[11px] text-zinc-500">
          Admin only. Rate-limited to 30 messages / hour. Refreshing the page clears the conversation.
        </p>
      </header>

      <AdminChatUI />

      <footer className="mt-6 rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-[11px] text-zinc-400">
        <p className="font-semibold text-zinc-300">How the grounding works</p>
        <p className="mt-1">
          Each question runs through the same Postgres ilike search that powers /search. The top 12 hits are inlined into the LLM&apos;s context as <code className="rounded bg-zinc-900 px-1">[src:N]</code> blocks. The LLM is instructed to cite inline and refuse to invent facts about kratom legislation / research. Sources are linked under every answer.
        </p>
        <p className="mt-2">
          <strong className="text-zinc-300">If you spot a hallucination,</strong> screenshot the chat + flag it in /admin — we&apos;ll tune the prompt or beef up retrieval.
        </p>
      </footer>
    </div>
  );
}
