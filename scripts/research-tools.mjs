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

// ---------------------------------------------------------------------------
// Dossier tool belt (Phase 1) — the same compact-projection discipline:
// every tool reads a VERIFIED platform corpus and returns just enough for
// the agent to synthesize. No web access, no outside knowledge.
// ---------------------------------------------------------------------------

/** Policy orgs from the confirmed 90-org roster (0181). */
export async function search_orgs(supabase, args) {
  const stance = String(args.stance ?? "").toLowerCase();
  // PostgREST .or() parses its argument as a logic tree — commas/parens/
  // quotes in the (model-supplied) query break the parse. Strip them; org
  // names like "Drug Free America Foundation, Inc." still match on the rest.
  const query = String(args.query ?? "").replace(/[,()"\\%]/g, " ").replace(/\s+/g, " ").trim();
  let q = supabase
    .from("policy_orgs")
    .select("slug, name, stance, org_type, summary, leadership, funding_note, website")
    .eq("active", true)
    .order("stance").order("name")
    .limit(10);
  if (["anti_kratom", "anti_7oh", "pro_kratom", "pro_7oh", "mixed", "regulator", "unclear"].includes(stance)) q = q.eq("stance", stance);
  if (query) q = q.or(`name.ilike.%${query}%,summary.ilike.%${query}%`);
  const { data, error } = await q;
  if (error) return { error: error.message };
  return {
    count: (data ?? []).length,
    orgs: (data ?? []).map((o) => ({
      ...o,
      summary: (o.summary ?? "").slice(0, 240) || null,
      leadership: (o.leadership ?? "").slice(0, 240) || null,
      funding_note: (o.funding_note ?? "").slice(0, 240) || null,
    })),
  };
}

/** Campaign-finance picture for legislators (OpenFEC via legislator_donors). */
export async function search_donations(supabase, args) {
  const state = String(args.state ?? "").toUpperCase();
  const name = String(args.name ?? "").trim();
  // legislator_donors is FEDERAL-only (OpenFEC) — sampling state legislators
  // would yield all-null rows the agent could misread as "no records exist".
  let lq = supabase.from("legislators").select("id, full_name, state, role, party")
    .eq("active", true)
    .in("role", ["us_senate", "us_house"])
    .order("role").order("full_name")
    .limit(8);
  if (/^[A-Z]{2}$/.test(state)) lq = lq.eq("state", state);
  if (name) lq = lq.ilike("full_name", `%${name}%`);
  const { data: legs, error: lerr } = await lq;
  if (lerr) return { error: lerr.message };
  if (!legs?.length) return { count: 0, legislators: [] };
  const { data: donors, error } = await supabase
    .from("legislator_donors")
    .select("legislator_id, cycle, total_receipts, top_industries")
    .eq("resolved_status", "matched")
    .in("legislator_id", legs.map((l) => l.id));
  if (error) return { error: error.message };
  const byId = new Map((donors ?? []).map((d) => [d.legislator_id, d]));
  return {
    count: legs.length,
    legislators: legs.map((l) => {
      const d = byId.get(l.id);
      const industries = Array.isArray(d?.top_industries) ? d.top_industries : [];
      const flagged = industries.filter((i) => i?.advocate_flag);
      return {
        name: l.full_name, state: l.state, role: l.role, party: l.party,
        cycle: d?.cycle ?? null,
        total_receipts: d?.total_receipts ?? null,
        flagged_industry_total: flagged.reduce((s, i) => s + (Number(i.amount) || 0), 0),
        flagged_industries: flagged.slice(0, 5).map((i) => `${i.label ?? i.industry}: $${Math.round(Number(i.amount) || 0).toLocaleString()}`),
      };
    }),
  };
}

/** Senate LDA lobbying filings mentioning kratom. */
export async function search_lobbying(supabase, args) {
  const client = String(args.client ?? "").trim();
  const registrant = String(args.registrant ?? "").trim();
  let q = supabase
    .from("lobbying_filings")
    .select("registrant_name, client_name, income, expenses, filing_year, filing_period_display, issue_codes, lobbyists")
    .order("filing_year", { ascending: false, nullsFirst: false })
    .order("dt_posted", { ascending: false, nullsFirst: false })
    .limit(8);
  if (client) q = q.ilike("client_name", `%${client}%`);
  if (registrant) q = q.ilike("registrant_name", `%${registrant}%`);
  const { data, error } = await q;
  if (error) return { error: error.message };
  return {
    count: (data ?? []).length,
    filings: (data ?? []).map((f) => ({
      registrant: f.registrant_name, client: f.client_name,
      spend: Number(f.income ?? 0) + Number(f.expenses ?? 0),
      year: f.filing_year, period: f.filing_period_display,
      issues: (f.issue_codes ?? []).slice(0, 5),
      lobbyist_count: Array.isArray(f.lobbyists) ? f.lobbyists.length : 0,
    })),
  };
}

/** Confirmed local kratom bans (the audited, two-source-gated set). */
export async function search_local_bans(supabase, args) {
  const state = String(args.state ?? "").toUpperCase();
  let q = supabase
    .from("bills")
    .select("state, locality, scope, verification_note, verified_at")
    .in("scope", ["county", "municipal"])
    .eq("verification_status", "confirmed")
    .eq("active", true)
    .order("state").order("locality")
    .limit(15);
  if (/^[A-Z]{2}$/.test(state)) q = q.eq("state", state);
  const { data, error } = await q;
  if (error) return { error: error.message };
  return {
    count: (data ?? []).length,
    bans: (data ?? []).map((b) => ({
      where: `${b.locality} (${b.scope})`, state: b.state,
      detail: (b.verification_note ?? "").slice(0, 180),
    })),
  };
}

/** Peer-reviewed research from the evaluated PubMed corpus. */
export async function search_research(supabase, args) {
  const topic = String(args.topic ?? "").trim();
  const studyType = String(args.study_type ?? "").trim();
  let q = supabase
    .from("research_papers")
    .select("title, journal, publication_year, study_type, ai_evidence_strength, ai_methodology_quality, ai_key_findings_md, pubmed_id")
    .eq("is_active", true)
    .eq("retracted", false)
    .order("ai_methodology_quality", { ascending: false, nullsFirst: false })
    .order("citation_count", { ascending: false, nullsFirst: false })
    .limit(8);
  if (topic) q = q.contains("topics", [topic]);
  if (studyType) q = q.eq("study_type", studyType);
  const { data, error } = await q;
  if (error) return { error: error.message };
  return {
    count: (data ?? []).length,
    papers: (data ?? []).map((p) => ({
      title: p.title, journal: p.journal, year: p.publication_year,
      type: p.study_type, evidence: p.ai_evidence_strength, quality_1to5: p.ai_methodology_quality,
      findings: (p.ai_key_findings_md ?? "").slice(0, 220),
      pubmed: p.pubmed_id,
    })),
  };
}

/** Upcoming approved municipal meetings (the public-comment calendar). */
export async function search_meetings(supabase, args) {
  const state = String(args.state ?? "").toUpperCase();
  const days = Math.max(1, Math.min(60, Number(args.days) || 30));
  let q = supabase
    .from("municipal_meetings")
    .select("locality, body_name, meeting_at, format, agenda_url, public_comment_signup_url")
    .eq("moderation_status", "approved")
    .gte("meeting_at", new Date().toISOString())
    .lte("meeting_at", new Date(Date.now() + days * 864e5).toISOString())
    .order("meeting_at", { ascending: true })
    .limit(8);
  if (/^[A-Z]{2}$/.test(state)) q = q.eq("state", state);
  const { data, error } = await q;
  if (error) return { error: error.message };
  return {
    count: (data ?? []).length,
    meetings: (data ?? []).map((m) => ({
      where: m.locality, body: m.body_name, when: m.meeting_at,
      format: m.format, agenda: m.agenda_url, comment_signup: m.public_comment_signup_url,
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
  {
    type: "function",
    function: {
      name: "search_orgs",
      description: "Policy organizations from the confirmed roster (advocacy, trade, medical, regulators) with stance, leadership, and funding notes. Returns up to 10.",
      parameters: {
        type: "object",
        properties: {
          stance: { type: "string", description: "Optional: 'anti_kratom', 'anti_7oh', 'pro_kratom', 'pro_7oh', 'mixed', 'regulator', 'unclear'" },
          query: { type: "string", description: "Optional name/summary text filter" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_donations",
      description: "Campaign-finance picture for FEDERAL legislators only (FEC has no state-level data): total receipts + substance-policy-adjacent flagged industry money. Filter by state and/or name. Returns up to 8.",
      parameters: {
        type: "object",
        properties: {
          state: { type: "string", description: "Optional 2-letter state code" },
          name: { type: "string", description: "Optional legislator name filter" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_lobbying",
      description: "Senate LDA lobbying filings mentioning kratom: who hired whom, spend, issue codes. Returns up to 8, newest first.",
      parameters: {
        type: "object",
        properties: {
          client: { type: "string", description: "Optional client-organization name filter (who PAID)" },
          registrant: { type: "string", description: "Optional lobbying-firm name filter (who LOBBIED)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_local_bans",
      description: "CONFIRMED city/county kratom bans (two-source verified). Optionally filter by state. Returns up to 15.",
      parameters: {
        type: "object",
        properties: {
          state: { type: "string", description: "Optional 2-letter state code" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_research",
      description: "Peer-reviewed kratom research (PubMed corpus, AI-evaluated for methodology + evidence strength). Returns up to 8, best evidence first.",
      parameters: {
        type: "object",
        properties: {
          topic: { type: "string", description: "Optional topic tag filter (e.g. 'safety', 'dependence', '7-oh')" },
          study_type: { type: "string", description: "Optional: 'rct', 'review', 'observational', 'case_report', 'survey', 'animal', 'in_vitro', 'clinical'" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_meetings",
      description: "Upcoming approved municipal meetings (public-comment opportunities) in a state. Returns up to 8.",
      parameters: {
        type: "object",
        properties: {
          state: { type: "string", description: "2-letter state code" },
          days: { type: "integer", description: "Lookahead window in days (default 30, max 60)" },
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
    case "search_orgs": return await search_orgs(supabase, args);
    case "search_donations": return await search_donations(supabase, args);
    case "search_lobbying": return await search_lobbying(supabase, args);
    case "search_local_bans": return await search_local_bans(supabase, args);
    case "search_research": return await search_research(supabase, args);
    case "search_meetings": return await search_meetings(supabase, args);
    default: return { error: `Unknown tool: ${name}` };
  }
}
