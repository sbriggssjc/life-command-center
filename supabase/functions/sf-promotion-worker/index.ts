// ============================================================================
// sf-promotion-worker — provenance-gated promotion for the SF -> LCC bridge
// Life Command Center
//
// Drains linked sf_*_staging rows and runs each field through the EXISTING
// lcc_merge_field() oracle on LCC Opps. lcc_merge_field is a decision + audit
// function: it consults field_source_priority, logs the decision to
// field_provenance (write / skip / conflict, with supersede tracking), and
// returns the decision plus enforce_mode. It does NOT touch the domain table —
// the caller does that when decision='write' and enforcement is on.
//
// SCOPE (v1): report-only, Property object. Every field is run through
// lcc_merge_field (so the provenance ledger is fully populated), but NO domain
// table is written — the response reports what WOULD promote. Comp/Listing/Deal
// routing and enforced writes are a deliberate follow-up.
//
// Routes:
//   POST ?action=run   — body: { vertical?, limit?, enforce? }  (enforce defaults false)
//   GET  (no action)   — info
// ============================================================================

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { authenticateWebhook } from "../_shared/auth.ts";
import { queryParams, parseBody, isoNow } from "../_shared/utils.ts";

const PAYLOAD_VERSION = "sf-promotion-2026-05-v1";
const LCC_WORKSPACE_ID = "a0000000-0000-0000-0000-000000000001"; // Briggs CRE
const SF_CONFIDENCE = 0.8;
const DEFAULT_LIMIT = 25;

type Vertical = "dia" | "gov" | "ops";

// Property object: sf_property_staging column -> properties domain column.
// Conservative set — only fields with a clean 1:1 domain target.
const PROPERTY_FIELD_MAP: Record<string, string> = {
  street: "address",
  city: "city",
  state: "state",
  zip_code: "zip_code",
  property_name: "building_name",
  building_sf: "building_size",
  year_built: "year_built",
  property_type: "property_type",
};

const PROPERTY_STAGING_SELECT =
  "staging_id,linked_property_id," + Object.keys(PROPERTY_FIELD_MAP).join(",");

// ── per-vertical DB access (service-role, server-side only) ─────────────────
function dbEnv(vertical: Vertical): { url: string; key: string } | null {
  const map: Record<Vertical, [string, string]> = {
    ops: ["OPS_SUPABASE_URL", "OPS_SUPABASE_SERVICE_KEY"],
    gov: ["GOV_SUPABASE_URL", "GOV_SUPABASE_KEY"],
    dia: ["DIA_SUPABASE_URL", "DIA_SUPABASE_KEY"],
  };
  const [u, k] = map[vertical];
  const url = Deno.env.get(u), key = Deno.env.get(k);
  return url && key ? { url, key } : null;
}

async function dbFetch(
  vertical: Vertical, method: string, path: string,
  body?: unknown, prefer = "return=minimal",
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const env = dbEnv(vertical);
  if (!env) return { ok: false, status: 503, data: { error: `${vertical} DB not configured` } };
  const res = await fetch(`${env.url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: env.key,
      Authorization: `Bearer ${env.key}`,
      "Content-Type": "application/json",
      Prefer: method === "GET" ? "count=exact" : prefer,
    },
    body: body && method !== "GET" ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

// Map the staging vertical short-name to the database identifier the
// field_provenance.target_database CHECK constraint requires.
//   dia → dia_db, gov → gov_db, ops → lcc_opps
function provenanceDbName(v: Vertical): string {
  if (v === "dia") return "dia_db";
  if (v === "gov") return "gov_db";
  return "lcc_opps";
}

// Call the lcc_merge_field() oracle on LCC Opps. Returns its decision row.
async function mergeField(
  targetDatabase: Vertical, targetTable: string, recordPk: string,
  fieldName: string, value: unknown, runId: string,
): Promise<Record<string, unknown> | null> {
  const res = await dbFetch("ops", "POST", "rpc/lcc_merge_field", {
    p_workspace_id: LCC_WORKSPACE_ID,
    p_target_database: provenanceDbName(targetDatabase),
    p_target_table: targetTable,
    p_record_pk: recordPk,
    p_field_name: fieldName,
    p_value: value,
    p_source: "salesforce",
    p_source_run_id: runId,
    p_confidence: SF_CONFIDENCE,
    p_recorded_by: null,
  }, "return=representation");
  if (!res.ok) return null;
  const rows = Array.isArray(res.data) ? res.data as Record<string, unknown>[] : [];
  return rows[0] ?? null;
}

// ── main handler ────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const params = queryParams(req);
  const action = params.get("action");

  if (req.method === "GET" && !action) {
    return jsonResponse(req, {
      service: "sf-promotion-worker",
      version: PAYLOAD_VERSION,
      scope: "report-only, Property object",
      actions: ["run"],
    });
  }

  if (!authenticateWebhook(req)) {
    return errorResponse(req, "Unauthorized — missing or invalid X-PA-Webhook-Secret", 401);
  }

  try {
    if (req.method !== "POST") return errorResponse(req, `Method ${req.method} not allowed`, 405);
    const body = (await parseBody(req)) as Record<string, unknown> | null;
    if (action === "run") return await handleRun(req, body);
    return errorResponse(req, `Unknown POST action: ${action}`, 400);
  } catch (err) {
    console.error("[sf-promotion-worker]", err);
    return errorResponse(req, `Internal error: ${err instanceof Error ? err.message : String(err)}`, 500);
  }
});

// ── POST ?action=run ────────────────────────────────────────────────────────
async function handleRun(req: Request, body: Record<string, unknown> | null): Promise<Response> {
  const b = body || {};
  const enforce = b.enforce === true; // v1: report-only by default
  const limit = Math.min(Number(b.limit) || DEFAULT_LIMIT, 200);
  const verticals: Vertical[] = b.vertical
    ? [String(b.vertical) as Vertical]
    : ["dia", "gov"];
  const runId = `promote_${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}Z`;

  const report: Record<string, unknown> = {};

  for (const vertical of verticals) {
    const vStats = {
      rows: 0, fields_evaluated: 0,
      write: 0, skip: 0, conflict: 0, errors: 0,
      sample: [] as Record<string, unknown>[],
    };

    const staged = await dbFetch(
      vertical, "GET",
      `sf_property_staging?process_status=eq.linked&linked_property_id=not.is.null` +
      `&select=${PROPERTY_STAGING_SELECT}&limit=${limit}`,
    );
    const rows = Array.isArray(staged.data) ? staged.data as Record<string, unknown>[] : [];

    for (const row of rows) {
      vStats.rows++;
      const recordPk = String(row.linked_property_id);
      const rowDecisions: Record<string, string> = {};

      for (const [stagingCol, domainCol] of Object.entries(PROPERTY_FIELD_MAP)) {
        const value = row[stagingCol];
        if (value === null || value === undefined || value === "") continue;
        vStats.fields_evaluated++;

        const result = await mergeField(vertical, "properties", recordPk, domainCol, value, runId);
        const decision = (result?.decision as string) || "error";
        rowDecisions[domainCol] = decision;

        if (decision === "write") vStats.write++;
        else if (decision === "skip") vStats.skip++;
        else if (decision === "conflict") vStats.conflict++;
        else vStats.errors++;

        // ENFORCE PATH (off in v1 report-only): when enforce=true and the
        // oracle says write under strict enforcement, patch the domain row.
        if (enforce && decision === "write" && result?.enforce_mode === "strict") {
          await dbFetch(vertical, "PATCH",
            `properties?property_id=eq.${recordPk}`,
            { [domainCol]: value });
        }
      }

      // mark the staging row processed by the worker
      await dbFetch(vertical, "PATCH",
        `sf_property_staging?staging_id=eq.${row.staging_id}`,
        {
          process_status: "reported",
          process_notes: `promotion ${runId} (${enforce ? "enforced" : "report-only"}): ` +
            Object.entries(rowDecisions).map(([f, d]) => `${f}=${d}`).join(" "),
          updated_at: isoNow(),
        });

      if (vStats.sample.length < 5) {
        vStats.sample.push({ staging_id: row.staging_id, property_id: recordPk, decisions: rowDecisions });
      }
    }

    report[vertical] = vStats;
  }

  return jsonResponse(req, {
    ok: true,
    run_id: runId,
    mode: enforce ? "enforced" : "report-only",
    object: "property",
    note: "lcc_merge_field logged every field decision to field_provenance on LCC Opps. " +
      (enforce ? "Domain writes applied where enforce_mode=strict." : "No domain tables were written."),
    by_vertical: report,
  });
}
