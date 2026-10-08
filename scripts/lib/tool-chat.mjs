/**
 * tool-chat.mjs — a provider-portable TOOL-CALLING chat loop.
 *
 * WHY THIS EXISTS (2026-09-07). lib/ai-router.mjs rotates nine free providers,
 * but it only does one-shot "prompt in, JSON out". Our two research agents —
 * research-campaign.mjs (campaign briefings) and dossier-research.mjs (the
 * flagship dossier) — are agentic: they call tools, read the results, and
 * decide what to fetch next. They had no router to fall back on, so they spoke
 * to Ollama directly and began every run with:
 *
 *     if (!(await ollamaReachable())) { console.log("nothing to do here"); exit(0) }
 *
 * On the owner's PC that is a graceful skip. Everywhere else it means the
 * feature does not exist — and the PC had not run them in 55 days. Worse, that
 * early exit returns 0 and writes NO telemetry, so the staleness watchdog saw
 * silence rather than a failure. "Nothing to do here" was doing a lot of work
 * in that sentence.
 *
 * The fix is not to give up local inference — Ollama is free and stays FIRST.
 * It is that Ollama's /api/chat deliberately mirrors OpenAI's tool-calling
 * shape, and eight of our free providers speak that same shape. So the same
 * agent loop can run on the box tonight and in CI tomorrow, unchanged.
 *
 * TWO SHAPE DIFFERENCES that make this non-trivial, and that a naive port gets
 * silently wrong:
 *   1. Ollama returns `function.arguments` as a decoded OBJECT. Every
 *      OpenAI-compatible API returns it as a JSON STRING. JSON.parse on the
 *      object throws; passing the string straight to a tool hands it
 *      "[object Object]".
 *
 *      AND IT RUNS BOTH WAYS, which is the half that is easy to miss. Sending
 *      the assistant turn BACK with a stringified `arguments` makes Ollama
 *      reject the whole request:
 *          400 {"error":"Value looks like object, but can't find closing '}'"}
 *      while an object there is rejected by the OpenAI-compatible providers.
 *      Verified against a live hermes3:8b on 2026-09-07 (object 200, string
 *      400). So the conversation is kept in Ollama's shape and translated at
 *      the wire for cloud providers. Getting only the response direction right
 *      looks fine on turn one and fails on every turn after a tool call.
 *   2. Ollama tolerates a tool result with no tool_call_id. OpenAI-compatible
 *      providers reject the whole request when a tool message does not match
 *      an id on the preceding assistant message — and Ollama often omits ids
 *      entirely, so they must be synthesised consistently on BOTH sides.
 *
 * Gemini and Cloudflare are deliberately excluded: their function-calling uses
 * a different envelope, and a half-translated one would fail mid-conversation
 * rather than at the door.
 *
 * See also lib/ai-router.mjs (one-shot rotation), lib/grounded-ai.mjs
 * (search-grounded generation), and memory "free-ai-router-provider-churn".
 */

import { OLLAMA_NUM_THREAD } from "./ollama-options.mjs";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";

/**
 * Tool-capable providers, in preference order. Ollama first: it is free,
 * unmetered and local, so when the box IS running there is no reason to spend
 * a cloud provider's quota. Cloud providers follow, for everywhere else.
 */
const PROVIDERS = {
  ollama: {
    url: `${OLLAMA_URL}/api/chat`,
    key: () => "local", // no key; reachability is probed separately
    model: () => process.env.OLLAMA_TOOL_MODEL || "hermes3:8b",
    native: true, // Ollama's own envelope, not OpenAI's
  },
  groq: {
    url: "https://api.groq.com/openai/v1/chat/completions",
    key: () => process.env.GROQ_API_KEY,
    model: () => process.env.GROQ_MODEL || "openai/gpt-oss-120b",
  },
  cerebras: {
    url: "https://api.cerebras.ai/v1/chat/completions",
    key: () => process.env.CEREBRAS_API_KEY,
    model: () => process.env.CEREBRAS_MODEL || "gpt-oss-120b",
  },
  mistral: {
    url: "https://api.mistral.ai/v1/chat/completions",
    key: () => process.env.MISTRAL_API_KEY,
    model: () => process.env.MISTRAL_MODEL || "mistral-small-latest",
  },
  sambanova: {
    url: "https://api.sambanova.ai/v1/chat/completions",
    key: () => process.env.SAMBANOVA_API_KEY,
    model: () => process.env.SAMBANOVA_MODEL || "Meta-Llama-3.3-70B-Instruct",
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1/chat/completions",
    key: () => process.env.OPENROUTER_API_KEY,
    // OpenRouter retires individual ":free" slugs constantly: z-ai/glm-5.2:free
    // was set on 2026-09-05 and 404'd "unavailable for free" by 09-07, and the
    // llama-3.3 free slug was already gone too. "openrouter/free" is their
    // STABLE meta-slug that routes to whatever is free right now, so it cannot
    // rot the same way. Verified tool-calling through it on 2026-09-07.
    model: () => process.env.OPENROUTER_MODEL || "openrouter/free",
  },
  nvidia: {
    url: "https://integrate.api.nvidia.com/v1/chat/completions",
    key: () => process.env.NVIDIA_API_KEY,
    model: () => process.env.NVIDIA_MODEL || "meta/llama-3.3-70b-instruct",
  },
  github: {
    url: "https://models.github.ai/inference/chat/completions",
    key: () => process.env.GITHUB_MODELS_TOKEN || process.env.GH_MODELS_TOKEN,
    model: () => process.env.GITHUB_MODELS_MODEL || "openai/gpt-4o-mini",
  },
};

export const TOOL_PROVIDER_ORDER = Object.keys(PROVIDERS);

/** Is Ollama up AND carrying a usable model? Cheap, 3s, never throws. */
export async function ollamaToolModel() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const names = ((await res.json()).models ?? []).map((m) => m.name);
    if (!names.length) return null;
    const want = PROVIDERS.ollama.model();
    // Exact tag, then the same family at any tag (hermes3:8b vs hermes3:latest).
    return names.find((n) => n === want)
      ?? names.find((n) => n.startsWith(`${want.split(":")[0]}:`))
      ?? null;
  } catch {
    return null;
  }
}

/** Which tool-capable CLOUD providers are configured right now. */
export function availableToolProviders() {
  return TOOL_PROVIDER_ORDER.filter((p) => p !== "ollama" && PROVIDERS[p].key());
}

/**
 * Normalise one provider response into { content, toolCalls }.
 * toolCalls: [{ id, name, args }] with args ALWAYS a plain object.
 */
export function normaliseMessage(data, { native = false } = {}) {
  const msg = native ? data?.message : data?.choices?.[0]?.message;
  if (!msg) return null;
  const raw = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
  const toolCalls = raw.map((tc, i) => {
    const fn = tc.function ?? {};
    let args = fn.arguments;
    // Ollama hands back an object; OpenAI-compatible APIs hand back a string.
    if (typeof args === "string") {
      try { args = JSON.parse(args || "{}"); } catch { args = {}; }
    }
    if (args === null || typeof args !== "object" || Array.isArray(args)) args = {};
    return {
      // Synthesised when absent — OpenAI-compatible providers reject a tool
      // result whose id does not appear on the assistant turn.
      id: tc.id || `call_${i}_${Math.random().toString(36).slice(2, 8)}`,
      name: fn.name ?? tc.name ?? "",
      args,
    };
  }).filter((t) => t.name);
  return { content: typeof msg.content === "string" ? msg.content : "", toolCalls };
}

/**
 * The canonical conversation holds tool-call arguments as OBJECTS (Ollama's
 * shape). OpenAI-compatible providers want them as JSON strings, so translate
 * on the way out rather than storing two histories.
 */
export function encodeForOpenAI(messages) {
  return messages.map((m) => {
    if (!Array.isArray(m.tool_calls)) return m;
    return {
      ...m,
      tool_calls: m.tool_calls.map((tc) => ({
        ...tc,
        function: {
          ...tc.function,
          arguments: typeof tc.function?.arguments === "string"
            ? tc.function.arguments
            : JSON.stringify(tc.function?.arguments ?? {}),
        },
      })),
    };
  });
}

async function callProvider(name, { messages, tools, model, maxTokens, temperature, timeoutMs }) {
  const p = PROVIDERS[name];
  const body = p.native
    ? {
      model, messages, tools, stream: false,
      options: { temperature, num_thread: OLLAMA_NUM_THREAD, num_predict: maxTokens },
    }
    : { model, messages: encodeForOpenAI(messages), tools, temperature, max_tokens: maxTokens };

  const headers = { "Content-Type": "application/json" };
  if (!p.native) headers.Authorization = `Bearer ${p.key()}`;

  const res = await fetch(p.url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 180);
    const err = new Error(`${name} ${res.status}: ${detail}`);
    err.status = res.status;
    throw err;
  }
  const out = normaliseMessage(await res.json(), { native: p.native });
  if (!out) throw new Error(`${name}: response carried no message`);
  return out;
}

/**
 * Run an agentic tool-calling conversation to completion.
 *
 * @param {object}   o
 * @param {Array}    o.messages   seed conversation (system + user)
 * @param {Array}    o.tools      OpenAI-shape tool schema
 * @param {Function} o.dispatch   async (name, args) => result (string|object)
 * @param {number}  [o.maxTurns]  hard cap on model round trips
 * @param {string}  [o.providerOverride] start here instead of the default order
 * @param {Function}[o.onEvent]   ({type,...}) progress hook for logging
 * @returns {Promise<{provider,model,text,turns,toolCallCount,messages}>}
 */
export async function toolChat({
  messages,
  tools,
  dispatch,
  maxTurns = 8,
  maxTokens = 2048,
  temperature = 0.2,
  timeoutMs = 120_000,
  providerOverride = null,
  onEvent = () => {},
}) {
  // Build the candidate list. Ollama only enters if it is actually up with a
  // model — otherwise every call wastes a connection-refused round trip, the
  // exact cost the officials pipeline had to add an env knob to dodge.
  const localModel = await ollamaToolModel();
  let order = [];
  if (localModel) order.push("ollama");
  order.push(...availableToolProviders());
  if (providerOverride) {
    order = [providerOverride, ...order.filter((p) => p !== providerOverride)]
      .filter((p) => PROVIDERS[p] && (p !== "ollama" || localModel));
  }
  if (order.length === 0) {
    throw new Error(
      "TOOL_CHAT_UNAVAILABLE: no tool-capable provider. Start Ollama, or set one of "
      + `${TOOL_PROVIDER_ORDER.filter((p) => p !== "ollama").join(", ")}.`,
    );
  }

  const convo = [...messages];
  let turns = 0, toolCallCount = 0, provider = null, model = null;
  const errors = [];

  while (turns < maxTurns) {
    turns++;
    let reply = null;

    // Try providers in order for THIS turn. The conversation is
    // provider-agnostic, so a provider dying mid-run is survivable: the next
    // one picks up the same history rather than restarting the research.
    for (const name of order) {
      const m = name === "ollama" ? localModel : PROVIDERS[name].model();
      try {
        reply = await callProvider(name, { messages: convo, tools, model: m, maxTokens, temperature, timeoutMs });
        provider = name; model = m;
        break;
      } catch (e) {
        errors.push(String(e.message ?? e).slice(0, 140));
        onEvent({ type: "provider-failed", provider: name, error: String(e.message ?? e).slice(0, 140) });
      }
    }
    if (!reply) {
      throw new Error(`TOOL_CHAT_FAILED: every provider failed. ${errors.slice(-3).join(" | ")}`);
    }

    if (reply.toolCalls.length === 0) {
      onEvent({ type: "done", provider, turns });
      return { provider, model, text: reply.content, turns, toolCallCount, messages: convo };
    }

    // Append the assistant turn WITH the ids we normalised to, so the tool
    // results below line up on providers that enforce the pairing. Arguments
    // stay OBJECTS here — encodeForOpenAI stringifies them per provider.
    convo.push({
      role: "assistant",
      content: reply.content,
      tool_calls: reply.toolCalls.map((t) => ({
        id: t.id,
        type: "function",
        function: { name: t.name, arguments: t.args },
      })),
    });

    for (const call of reply.toolCalls) {
      toolCallCount++;
      onEvent({ type: "tool", name: call.name, args: call.args, provider });
      let content;
      try {
        const r = await dispatch(call.name, call.args);
        content = typeof r === "string" ? r : JSON.stringify(r);
      } catch (e) {
        // A failed tool is data the model can act on, not a reason to abort.
        content = JSON.stringify({ error: String(e.message ?? e).slice(0, 200) });
      }
      convo.push({ role: "tool", tool_call_id: call.id, name: call.name, content: String(content).slice(0, 12_000) });
    }
  }

  // Out of turns with tools still pending: ask once for the final answer.
  convo.push({ role: "user", content: "Stop calling tools. Write your final answer now from what you have gathered." });
  for (const name of order) {
    const m = name === "ollama" ? localModel : PROVIDERS[name].model();
    try {
      const reply = await callProvider(name, { messages: convo, tools: undefined, model: m, maxTokens, temperature, timeoutMs });
      return { provider: name, model: m, text: reply.content, turns, toolCallCount, messages: convo };
    } catch (e) {
      errors.push(String(e.message ?? e).slice(0, 140));
    }
  }
  throw new Error(`TOOL_CHAT_FAILED: exhausted turns and providers. ${errors.slice(-3).join(" | ")}`);
}
