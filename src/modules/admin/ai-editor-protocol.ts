/**
 * Wire protocol for the AI Editor-in-Chief (kept out of the "use server" file
 * so it can export sync helpers + be unit-tested).
 *
 * The model talks to the server with at most ONE trailing directive line:
 *   READ: {"tool":"find","args":{...}}      → auto-executed lookup, result fed
 *                                             back to the model (agentic loop)
 *   PROPOSE: {"tool":"...","args":{...},"summary":"..."}
 *                                           → shown to the human; only a click
 *                                             on Confirm runs the real action.
 */

export type EditorProposal = { tool: string; args: Record<string, unknown>; summary: string };
export type EditorMessage = { role: "user" | "assistant"; content: string };
export type ReadCall = { tool: string; args: Record<string, unknown> };

const PROPOSE_RE = /PROPOSE:\s*(\{[\s\S]*\})\s*$/;
const READ_RE = /READ:\s*(\{[\s\S]*\})\s*$/;

/** Parse + strip a trailing PROPOSE line. Returns [proposal|null, cleanedText]. */
export function parseProposal(text: string): [EditorProposal | null, string] {
  const m = text.match(PROPOSE_RE);
  if (!m) return [null, text];
  let proposal: EditorProposal | null = null;
  try {
    const p = JSON.parse(m[1]) as EditorProposal;
    if (p && typeof p.tool === "string" && p.args && typeof p.args === "object" && !Array.isArray(p.args)) {
      proposal = { tool: p.tool, args: p.args, summary: String(p.summary ?? p.tool).slice(0, 200) };
    }
  } catch { /* malformed → treat as plain answer */ }
  return [proposal, text.replace(PROPOSE_RE, "").trim()];
}

/** Parse + strip a trailing READ line. Returns [readCall|null, cleanedText]. */
export function parseRead(text: string): [ReadCall | null, string] {
  const m = text.match(READ_RE);
  if (!m) return [null, text];
  let call: ReadCall | null = null;
  try {
    const p = JSON.parse(m[1]) as ReadCall;
    if (p && typeof p.tool === "string" && p.args && typeof p.args === "object" && !Array.isArray(p.args)) {
      call = { tool: p.tool, args: p.args };
    }
  } catch { /* malformed → ignore */ }
  return [call, text.replace(READ_RE, "").trim()];
}
