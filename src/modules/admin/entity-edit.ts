/**
 * Entity-edit engine — the ONE whitelisted write path shared by the AI
 * Editor-in-Chief's `edit_entity` tool and the /admin/master-edit surface.
 *
 * Safety model (layered):
 *   1. Column whitelist — only the fields listed here can ever be written.
 *      Unknown tables/columns are rejected before any DB call.
 *   2. Per-field validation — type coercion + length caps + enum sets.
 *   3. User-scoped Supabase client — every write rides the caller's session,
 *      so the `*_admin_all` RLS policies are the backstop even if a bug slips
 *      past the whitelist. Never the service-role client.
 *   4. Diff-then-write — the current row is read first; only genuinely changed
 *      columns are written, and the before→after diff goes to the audit log.
 *   5. Campaign template provenance — edits to subject/body templates append a
 *      campaign_template_versions row (anti-tamper, mig 0204), same as the
 *      manual campaign editor.
 *
 * Kept out of "use server" so sync helpers are exportable + unit-testable.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAdminAction } from "@/lib/audit";

export type EntityType = "bill" | "campaign" | "legislator" | "alert" | "state";

type FieldDef =
  | { kind: "text"; maxLen: number }
  | { kind: "bool" }
  | { kind: "date" }
  | { kind: "enum"; values: readonly string[] };

export type EntityDef = {
  table: string;
  label: string;
  idCol: string;
  /** Columns `find` searches with ilike. */
  searchCols: string[];
  /** Safe columns to show admins (never PII beyond public-official contact). */
  displayCols: string[];
  editable: Record<string, FieldDef>;
};

export const BILL_STATUS_VALUES = [
  "introduced", "committee", "in_committee", "in_chamber",
  "passed_chamber", "enacted", "vetoed", "dead", "failed",
] as const;

export const ENTITIES: Record<EntityType, EntityDef> = {
  bill: {
    table: "bills",
    label: "Bill",
    idCol: "id",
    searchCols: ["bill_number", "title"],
    displayCols: [
      "id", "state", "bill_number", "title", "status", "kratom_relevance",
      "active", "scope", "locality", "last_action", "last_action_at", "summary",
    ],
    editable: {
      title: { kind: "text", maxLen: 300 },
      summary: { kind: "text", maxLen: 5000 },
      status: { kind: "enum", values: BILL_STATUS_VALUES },
      kratom_relevance: { kind: "text", maxLen: 40 },
      active: { kind: "bool" },
    },
  },
  campaign: {
    table: "campaigns",
    label: "Campaign",
    idCol: "id",
    searchCols: ["title", "slug"],
    displayCols: [
      "id", "slug", "title", "state", "active", "review_state", "is_standing",
      "auto_generated", "blurb", "subject_template", "body_template", "ends_at", "created_at",
    ],
    editable: {
      title: { kind: "text", maxLen: 300 },
      blurb: { kind: "text", maxLen: 1000 },
      subject_template: { kind: "text", maxLen: 300 },
      body_template: { kind: "text", maxLen: 10000 },
      active: { kind: "bool" },
      ends_at: { kind: "date" },
    },
  },
  legislator: {
    table: "legislators",
    label: "Legislator / official",
    idCol: "id",
    searchCols: ["full_name"],
    displayCols: [
      "id", "state", "full_name", "role", "title", "district", "party", "level",
      "locality", "email", "phone", "website", "office_address", "active",
    ],
    editable: {
      email: { kind: "text", maxLen: 200 },
      phone: { kind: "text", maxLen: 60 },
      website: { kind: "text", maxLen: 300 },
      office_address: { kind: "text", maxLen: 400 },
      active: { kind: "bool" },
    },
  },
  alert: {
    table: "policy_alerts",
    label: "Intel alert",
    idCol: "id",
    searchCols: ["title"],
    displayCols: [
      "id", "kind", "severity", "title", "locality", "moderation_status",
      "action_required", "source_url", "occurs_at", "expires_at", "created_at", "body",
    ],
    editable: {
      title: { kind: "text", maxLen: 300 },
      body: { kind: "text", maxLen: 5000 },
      severity: { kind: "enum", values: ["watch", "alert", "critical"] as const },
      expires_at: { kind: "date" },
    },
  },
  state: {
    table: "states",
    label: "State",
    idCol: "abbr",
    searchCols: ["name", "abbr"],
    displayCols: ["abbr", "name", "kratom_status", "notes", "briefing_gen_enabled"],
    editable: {
      kratom_status: { kind: "text", maxLen: 120 },
      notes: { kind: "text", maxLen: 2000 },
      briefing_gen_enabled: { kind: "bool" },
    },
  },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATE_RE = /^[A-Z]{2}$/;

export function isValidEntityId(type: EntityType, id: string): boolean {
  return type === "state" ? STATE_RE.test(id) : UUID_RE.test(id);
}

/** Coerce + validate one field value. Returns [ok, coercedValue | errorMessage]. */
export function coerceField(def: FieldDef, raw: unknown): [true, unknown] | [false, string] {
  switch (def.kind) {
    case "text": {
      if (raw === null || raw === undefined) return [true, null];
      if (typeof raw !== "string") return [false, "expected text"];
      const v = raw.trim();
      if (v.length > def.maxLen) return [false, `too long (max ${def.maxLen} chars)`];
      return [true, v === "" ? null : v];
    }
    case "bool": {
      if (typeof raw === "boolean") return [true, raw];
      if (raw === "true") return [true, true];
      if (raw === "false") return [true, false];
      return [false, "expected true or false"];
    }
    case "date": {
      if (raw === null || raw === undefined || raw === "") return [true, null];
      if (typeof raw !== "string") return [false, "expected an ISO date string"];
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) return [false, `"${raw}" is not a valid date`];
      return [true, d.toISOString()];
    }
    case "enum": {
      if (typeof raw !== "string" || !def.values.includes(raw)) {
        return [false, `must be one of: ${def.values.join(", ")}`];
      }
      return [true, raw];
    }
  }
}

/**
 * Pure validation half — usable without a DB (unit-tested). Rejects unknown
 * types/columns and bad values; returns the coerced patch.
 */
export function validateChanges(
  type: string,
  id: string,
  changes: Record<string, unknown>,
): { ok: true; def: EntityDef; patch: Record<string, unknown> } | { ok: false; error: string } {
  const def = ENTITIES[type as EntityType];
  if (!def) return { ok: false, error: `Unknown entity type "${type}". Valid: ${Object.keys(ENTITIES).join(", ")}.` };
  if (!isValidEntityId(type as EntityType, id)) {
    return { ok: false, error: type === "state" ? "State id must be a 2-letter code (e.g. OK)." : "id must be a UUID." };
  }
  const keys = Object.keys(changes ?? {});
  if (keys.length === 0) return { ok: false, error: "No changes given." };
  if (keys.length > 10) return { ok: false, error: "Too many fields in one edit (max 10)." };
  const patch: Record<string, unknown> = {};
  for (const key of keys) {
    // Own-property check: JSON.parse can put "__proto__"/"constructor"/etc. as
    // own enumerable keys, and a bare bracket lookup would return an inherited
    // Object.prototype member (crashing coerceField). Reject, don't crash.
    const field = Object.prototype.hasOwnProperty.call(def.editable, key) ? def.editable[key] : undefined;
    if (!field) {
      return { ok: false, error: `"${key}" is not editable on ${def.label}. Editable: ${Object.keys(def.editable).join(", ")}.` };
    }
    const [ok, v] = coerceField(field, changes[key]);
    if (!ok) return { ok: false, error: `${key}: ${v as string}` };
    patch[key] = v;
  }
  return { ok: true, def, patch };
}

/** Timestamptz columns come back from PostgREST as "+00:00" strings while our
 *  coerced value is toISOString() ".000Z" — compare instants, not text. */
export function valuesEqual(def: FieldDef, from: unknown, to: unknown): boolean {
  if (def.kind === "date" && typeof from === "string" && typeof to === "string") {
    const a = new Date(from).getTime();
    const b = new Date(to).getTime();
    if (!Number.isNaN(a) && !Number.isNaN(b)) return a === b;
  }
  return from === to;
}

export type EditDiff = Record<string, { from: unknown; to: unknown }>;
export type EditResult = { ok: boolean; message: string; diff?: EditDiff };

/** Human-readable one-liner for a diff (used in tool results + audit). */
export function summarizeDiff(diff: EditDiff): string {
  const fmt = (v: unknown) => (v === null || v === undefined ? "∅" : String(v).slice(0, 60));
  return Object.entries(diff).map(([k, d]) => `${k}: "${fmt(d.from)}" → "${fmt(d.to)}"`).join("; ");
}

/**
 * Apply one whitelisted edit through the caller's OWN session (RLS backstop).
 * Reads the row first, writes only real changes, audit-logs the diff.
 */
export async function applyEntityEdit(
  supabase: SupabaseClient,
  userId: string,
  input: { type: string; id: string; changes: Record<string, unknown> },
): Promise<EditResult> {
  const v = validateChanges(input.type, input.id, input.changes);
  if (!v.ok) return { ok: false, message: v.error };
  const { def, patch } = v;

  const { data: row, error: readErr } = await supabase
    .from(def.table)
    .select(def.displayCols.join(","))
    .eq(def.idCol, input.id)
    .maybeSingle<Record<string, unknown>>();
  if (readErr) return { ok: false, message: `Read failed: ${readErr.message}` };
  if (!row) return { ok: false, message: `${def.label} ${input.id} not found.` };

  const diff: EditDiff = {};
  for (const [k, to] of Object.entries(patch)) {
    if (!valuesEqual(def.editable[k], row[k] ?? null, to)) diff[k] = { from: row[k] ?? null, to };
  }
  if (Object.keys(diff).length === 0) {
    return { ok: true, message: "No changes — the row already has those values.", diff };
  }

  // Activating a campaign publishes it (campaigns_public_read = active) and
  // would bypass the review state machine. Approval must go through moderation
  // (moderate_campaign / the pending queue), which controls notify + provenance.
  // Deactivating (→ false) stays allowed — it only hides a live campaign.
  if (def.table === "campaigns" && diff.active && diff.active.to === true) {
    return { ok: false, message: "Activating a campaign must go through moderation (approve it in the pending queue), not a raw field edit. You can deactivate a campaign here." };
  }

  const write: Record<string, unknown> = {};
  for (const k of Object.keys(diff)) write[k] = patch[k];

  const { data: updated, error: writeErr } = await supabase
    .from(def.table)
    .update(write)
    .eq(def.idCol, input.id)
    .select(def.idCol);
  if (writeErr) return { ok: false, message: `Write failed: ${writeErr.message}` };
  if (!updated?.length) return { ok: false, message: "Write affected 0 rows (blocked by RLS or row vanished)." };

  // Anti-tamper provenance (mig 0204): template edits append a version row,
  // exactly like the manual campaign editor. Best-effort (never blocks the
  // edit) but observable — if the append silently fails, the audit row records
  // it so a missing provenance entry is detectable (layer 5 of the safety model).
  let templateVersionOk: boolean | undefined;
  if (def.table === "campaigns" && ("subject_template" in diff || "body_template" in diff)) {
    const { error: tvErr } = await supabase.from("campaign_template_versions").insert({
      campaign_id: input.id,
      subject_template: (write.subject_template ?? row.subject_template) as string,
      body_template: (write.body_template ?? row.body_template) as string,
      edited_by: userId,
    });
    templateVersionOk = !tvErr;
  }

  await recordAdminAction({
    action: "entity_edit",
    targetType: input.type === "alert" ? "policy_alert" : input.type === "state" ? undefined : (input.type as "bill" | "campaign" | "legislator"),
    targetId: input.id,
    details: {
      table: def.table,
      diff: JSON.parse(JSON.stringify(diff)) as Record<string, unknown>,
      ...(templateVersionOk !== undefined ? { templateVersionOk } : {}),
    },
  });

  return { ok: true, message: `Updated ${def.label.toLowerCase()} — ${summarizeDiff(diff)}`, diff };
}
