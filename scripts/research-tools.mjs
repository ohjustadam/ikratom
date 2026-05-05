/**
 * Tool implementations for the research-briefing agent.
 *
 * Each export is an async function that takes a single object of arguments
 * and returns a JSON-serializable result. The agent (research-campaign.mjs)
 * exposes them to the LLM via Ollama's tools API.
 *
 * Keep results compact — token budget matters. We trim and project so the
 * model has just enough info to synthesize a briefing.
 */

const MAX_NEWS = 10;
const MAX_BILLS = 8;
const MAX_LEGISLATORS = 6;

/** Pull recent news for a state (or "FED" for federal). Returns trimmed list. */
export async function search_news(supabase, args) {
  const state = String(args.state ?? "").toUpperCase();
  const days = Math.max(1, Math.min(365, Number(args.days) || 90));
  const sinceIso = new Date(Date.now() - days * 86400_000).toISOString();

  let q = supabase
    .from("news_items")
    .select("title, summary, source_name, published_at, kratom_topic, ai_relevance_score")
    .eq("active", true)
    .is("duplicate_of", null)
    .gte("published_at", sinceIso)
    .order("published_at", { ascending: false })
    .limit(MAX_NEWS);

  if (state === "FED" || state === "FEDERAL" || state === "") {
    q = q.is("state", null);
  } else {
    q = q.eq("state", state);
  }

  const { data, error } = await q;
  if (error) return { error: error.message };
  return {
    state: state || "FED",
    window_days: days,
    count: (data ?? []).length,
    items: (data ?? []).map((n) => ({
      title: n.title,
      summary: (n.summary ?? "").slice(0, 200),
      source: n.source_name,
      date: n.published_at?.slice(0, 10),
      topic: n.kratom_topic,
      relevance: n.ai_relevance_score,
    })),
  };
}

/** Pull active bills for a state. Returns trimmed list with stance. */
export async function search_bills(supabase, args) {
  const state = String(args.state ?? "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) return { error: "state must be a 2-letter code" };

  const { data, error } = await supabase
    .from("bills")
    .select(
      "bill_number, title, summary_ai, summary, advocacy_callout, status, " +
      "kratom_relevance, relevance_confidence, last_action, last_action_at"
    )
    .eq("active", true)
    .eq("state", state)
    .order("last_action_at", { ascending: false, nullsFirst: false })
    .limit(MAX_BILLS);

  if (error) return { error: error.message };
  return {
    state,
    count: (data ?? []).length,
    bills: (data ?? []).map((b) => ({
      bill: `${state} ${b.bill_number}`,
      title: b.title,
      summary: (b.summary_ai || b.summary || "").slice(0, 240),
      advocacy_callout: b.advocacy_callout,
      stance: b.kratom_relevance,
      stance_confidence: b.relevance_confidence,
      status: b.status,
      last_action: b.last_action,
      last_action_at: b.last_action_at,
    })),
  };
}

/** Pull legislators for a state by role. Returns trimmed list. */
export async function search_legislators(supabase, args) {
  const state = String(args.state ?? "").toUpperCase();
  const role = String(args.role ?? "").toLowerCase();
  if (!/^[A-Z]{2}$/.test(state)) return { error: "state must be a 2-letter code" };

  let q = supabase
    .from("legislators")
    .select("full_name, role, party, district, email, phone")
    .eq("state", state)
    .eq("active", true)
    .limit(MAX_LEGISLATORS);

  if (role) q = q.eq("role", role);

  const { data, error } = await q;
  if (error) return { error: error.message };
  return {
    state,
    role: role || "any",
    count: (data ?? []).length,
    legislators: (data ?? []).map((l) => ({
      name: l.full_name,
      role: l.role,
      party: l.party,
      district: l.district,
      email: l.email,
      phone: l.phone,
    })),
  };
}

/** OpenAI/Ollama tools schema for the LLM. */
export const TOOLS_SCHEMA = [
  {
    type: "function",
    function: {
      name: "search_news",
      description: "Recent kratom-related news for a U.S. state or federal. Returns up to 10 articles.",
      parameters: {
        type: "object",
        properties: {
          state: {
            type: "string",
            description: "2-letter state code (e.g. 'OK') or 'FED' for federal news",
          },
          days: {
            type: "integer",
            description: "Lookback window in days (default 90, max 365)",
          },
        },
        required: ["state"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_bills",
      description: "Active kratom-related bills in a U.S. state. Returns up to 8 bills with stance + advocacy callout.",
      parameters: {
        type: "object",
        properties: {
          state: { type: "string", description: "2-letter state code (e.g. 'OK')" },
        },
        required: ["state"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_legislators",
      description: "Legislators in a state, optionally filtered by role. Returns up to 6.",
      parameters: {
        type: "object",
        properties: {
          state: { type: "string", description: "2-letter state code (e.g. 'OK')" },
          role: {
            type: "string",
            description: "Optional role filter: 'us_senate', 'us_house', 'state_senate', 'state_house', or 'mayor'",
          },
        },
        required: ["state"],
      },
    },
  },
];

/** Dispatch a tool call by name. Returns JSON string for the LLM. */
export async function dispatchTool(supabase, name, args) {
  switch (name) {
    case "search_news": return await search_news(supabase, args);
    case "search_bills": return await search_bills(supabase, args);
    case "search_legislators": return await search_legislators(supabase, args);
    default: return { error: `Unknown tool: ${name}` };
  }
}
