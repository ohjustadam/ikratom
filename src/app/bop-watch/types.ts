/**
 * Row shapes returned by the two public BoP RPCs
 * (`get_public_bop_sources` / `get_public_bop_findings`). Extracted from
 * page.tsx so the server page, the presentational parts and the client
 * filter shell can all share one definition.
 */
export type Source = {
  state: string;
  board_name: string;
  surface: string;
  kind: string;
  agenda_url: string;
  enabled: boolean;
  last_scraped_at: string | null;
  last_status: string | null;
  last_finding_count: number;
};

export type Finding = {
  id: string;
  state: string;
  title: string;
  snippet: string | null;
  url: string | null;
  meeting_date: string | null;
  relevance: string;
  severity: string;
  ai_confidence: number | null;
  ai_reasoning: string | null;
  alert_emitted_at: string | null;
  found_at: string;
  board_name: string;
  surface: string;
};
