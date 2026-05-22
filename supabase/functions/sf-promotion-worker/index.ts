import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { authenticateWebhook } from "../_shared/auth.ts";
import { queryParams, parseBody, isoNow } from "../_shared/utils.ts";

const PAYLOAD_VERSION = "sf-promotion-2026-05-v4";
const LCC_WORKSPACE_ID = "a0000000-0000-0000-0000-000000000001";
const SF_CONFIDENCE = 0.8;
const DEFAULT_LIMIT = 25;
// Wall-clock budget per call. Each promote* loop checks this before starting a
// new row and returns 200 with truncated=true once exceeded, instead of running
// past Power Automate's HTTP timeout (the SF Object/Property-Promotion flows
// time out ~120s). Deal rows are dense (~16 cross-region lcc_merge_field RPCs
// each), so the deal path used to blow past the timeout and fail daily; this
// caps every call well under it. Override per call with body.max_ms.
const DEFAULT_MAX_MS = 60000;
const HARD_MAX_MS = 110000;

type Vertical = "dia" | "gov" | "ops";
type ObjectKey = "property" | "comp" | "listing" | "deal";

const PROPERTY_FIELD_MAP: Record<string, string> = {
  street: "address", city: "city", state: "state", zip_code: "zip_code",
  property_name: "building_name", building_sf: "building_size",
  year_built: "year_built", property_type: "property_type",
};
const PROPERTY_STAGING_SELECT = "staging_id,linked_property_id," + Object.keys(PROPERTY_FIELD_MAP).join(",");

// Comp staging col -> comparable_sales domain col (dia only; gov has no comparable_sales)
const COMP_FIELD_MAP: Record<string, string> = {
  street: "comp_address", city: "comp_city", state: "comp_state",
  property_type: "comp_property_type", tenant: "comp_tenant",
  sold_price: "comp_sale_price", cap_rate: "comp_cap_rate",
  annual_rent: "comp_noi", price_sf: "comp_price_per_sf",
  sold_date: "comp_sale_date", building_sf: "comp_building_size",
};
const COMP_STAGING_SELECT = "staging_id,sf_comp_id,sf_property_id,linked_property_id," + Object.keys(COMP_FIELD_MAP).join(",");

// Listing/Deal: no clean domain target on either DB; merge into field_provenance only via lcc_merge_field
const LISTING_FIELDS = ["listing_name", "listing_status", "marketing_status", "listing_price", "asking_list_price", "marketing_cap_rate", "first_broadcast_date", "listing_expiration_date", "lease_expiration", "property_address", "property_subtype", "tenant_names", "primary_use"];
const LISTING_STAGING_SELECT = "staging_id,sf_listing_id,sf_property_id,linked_property_id," + LISTING_FIELDS.join(",");
const DEAL_FIELDS = ["deal_name", "deal_type", "stage", "expected_close_date", "deal_price", "deal_cap_rate", "listing_price", "noi", "annual_rent", "seller_company_name", "buyer_company_name", "property_state", "property_city", "property_address", "tenant_names", "lease_term_remaining"];
const DEAL_STAGING_SELECT = "staging_id,sf_deal_id,sf_property_id,linked_property_id," + DEAL_FIELDS.join(",");

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

async function dbFetch(vertical: Vertical, method: string, path: string, body?: unknown, prefer = "return=minimal"): Promise<{ ok: boolean; status: number; data: unknown }> {
  const env = dbEnv(vertical);
  if (!env) return { ok: false, status: 503, data: { error: `${vertical} DB not configured` } };
  const res = await fetch(`${env.url}/rest/v1/${path}`, {
    method,
    headers: { apikey: env.key, Authorization: `Bearer ${env.key}`, "Content-Type": "application/json", Prefer: method === "GET" ? "count=exact" : prefer },
    body: body && method !== "GET" ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

function provenanceDbName(v: Vertical): string {
  if (v === "dia") return "dia_db";
  if (v === "gov") return "gov_db";
  return "lcc_opps";
}

async function mergeField(targetDatabase: Vertical, targetTable: string, recordPk: string, fieldName: string, value: unknown, runId: string): Promise<Record<string, unknown> | null> {
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

function normAddress(s: string | null | undefined): string | null {
  if (!s) return null;
  const n = String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  return n || null;
}

// Resolve sf staging row to LCC property_id. Try linked_property_id first, then sf_property_id->properties match via sf_property_staging chain, then address match.
async function resolvePropertyId(vertical: Vertical, sfPropertyId: string | null, linkedPropertyId: number | null, address: string | null, city: string | null, state: string | null): Promise<{ propertyId: number | null; method: string }> {
  if (linkedPropertyId) return { propertyId: Number(linkedPropertyId), method: "prelinked" };
  if (sfPropertyId) {
    const r = await dbFetch(vertical, "GET", `sf_property_staging?sf_property_id=eq.${encodeURIComponent(sfPropertyId)}&linked_property_id=not.is.null&select=linked_property_id&limit=1`);
    const rows = Array.isArray(r.data) ? r.data as Record<string, unknown>[] : [];
    if (rows.length && rows[0].linked_property_id) return { propertyId: Number(rows[0].linked_property_id), method: "sf_prop_chain" };
  }
  if (city && state) {
    const r = await dbFetch(vertical, "GET", `properties?city=ilike.${encodeURIComponent(city)}&state=ilike.${encodeURIComponent(state)}&select=property_id,address&limit=50`);
    const rows = Array.isArray(r.data) ? r.data as Record<string, unknown>[] : [];
    const target = normAddress(address);
    for (const p of rows) {
      const candidate = normAddress(p.address as string);
      if (target && candidate && (candidate === target || candidate.includes(target) || target.includes(candidate))) {
        return { propertyId: Number(p.property_id), method: "address_match" };
      }
    }
  }
  return { propertyId: null, method: "unmatched" };
}

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;
  const params = queryParams(req);
  const action = params.get("action");
  if (req.method === "GET" && !action) {
    return jsonResponse(req, { service: "sf-promotion-worker", version: PAYLOAD_VERSION, scope: "Property, Comp, Listing, Deal", actions: ["run"], objects: ["property", "comp", "listing", "deal", "all"] });
  }
  if (!authenticateWebhook(req)) return errorResponse(req, "Unauthorized — missing or invalid X-PA-Webhook-Secret", 401);
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

async function handleRun(req: Request, body: Record<string, unknown> | null): Promise<Response> {
  const b = body || {};
  const enforce = b.enforce === true;
  const limit = Math.min(Number(b.limit) || DEFAULT_LIMIT, 200);
  const deadline = Date.now() + Math.min(Number(b.max_ms) || DEFAULT_MAX_MS, HARD_MAX_MS);
  const verticals: Vertical[] = b.vertical ? [String(b.vertical) as Vertical] : ["dia", "gov"];
  const objectParam = String(b.object || "property").toLowerCase();
  const objects: ObjectKey[] = objectParam === "all" ? ["property", "comp", "listing", "deal"] : [objectParam as ObjectKey];
  const runId = `promote_${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}Z`;
  const report: Record<string, unknown> = {};
  for (const vertical of verticals) {
    report[vertical] = {};
    for (const obj of objects) {
      try {
        const r = await promoteObject(vertical, obj, limit, enforce, runId, deadline);
        (report[vertical] as Record<string, unknown>)[obj] = r;
      } catch (err) {
        (report[vertical] as Record<string, unknown>)[obj] = { error: err instanceof Error ? err.message : String(err) };
      }
    }
  }
  return jsonResponse(req, { ok: true, run_id: runId, mode: enforce ? "enforced" : "report-only", objects, by_vertical: report });
}

async function promoteObject(vertical: Vertical, obj: ObjectKey, limit: number, enforce: boolean, runId: string, deadline: number): Promise<Record<string, unknown>> {
  if (obj === "property") return await promoteProperty(vertical, limit, enforce, runId, deadline);
  if (obj === "comp") return await promoteComp(vertical, limit, enforce, runId, deadline);
  if (obj === "listing") return await promoteEntity(vertical, "listing", "sf_listing_staging", "sf_listing_id", LISTING_STAGING_SELECT, LISTING_FIELDS, limit, runId, deadline);
  if (obj === "deal") return await promoteEntity(vertical, "deal", "sf_deal_staging", "sf_deal_id", DEAL_STAGING_SELECT, DEAL_FIELDS, limit, runId, deadline);
  return { skipped: "unknown_object" };
}

async function promoteProperty(vertical: Vertical, limit: number, enforce: boolean, runId: string, deadline: number): Promise<Record<string, unknown>> {
  const vStats = { rows: 0, fields_evaluated: 0, write: 0, skip: 0, conflict: 0, errors: 0, written_to_domain: 0, truncated: false, sample: [] as Record<string, unknown>[] };
  const staged = await dbFetch(vertical, "GET", `sf_property_staging?process_status=eq.linked&linked_property_id=not.is.null&select=${PROPERTY_STAGING_SELECT}&limit=${limit}`);
  const rows = Array.isArray(staged.data) ? staged.data as Record<string, unknown>[] : [];
  for (const row of rows) {
    if (Date.now() > deadline) { vStats.truncated = true; break; }
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
      if (enforce && decision === "write" && result?.enforce_mode === "strict") {
        await dbFetch(vertical, "PATCH", `properties?property_id=eq.${recordPk}`, { [domainCol]: value });
        vStats.written_to_domain++;
      }
    }
    await dbFetch(vertical, "PATCH", `sf_property_staging?staging_id=eq.${row.staging_id}`, { process_status: "reported", process_notes: `promotion ${runId} (${enforce ? "enforced" : "report-only"})`, updated_at: isoNow() });
    if (vStats.sample.length < 3) vStats.sample.push({ staging_id: row.staging_id, property_id: recordPk, decisions: rowDecisions });
  }
  return vStats;
}

async function promoteComp(vertical: Vertical, limit: number, enforce: boolean, runId: string, deadline: number): Promise<Record<string, unknown>> {
  const vStats = { rows: 0, resolved: 0, unmatched: 0, fields_evaluated: 0, write: 0, skip: 0, conflict: 0, errors: 0, inserted_to_domain: 0, truncated: false, sample: [] as Record<string, unknown>[] };
  // Process pending rows. Domain table is comparable_sales (dia only).
  const staged = await dbFetch(vertical, "GET", `sf_comp_staging?process_status=eq.pending&select=${COMP_STAGING_SELECT}&limit=${limit}`);
  const rows = Array.isArray(staged.data) ? staged.data as Record<string, unknown>[] : [];
  const supportsCompareSales = vertical === "dia"; // gov has no comparable_sales
  for (const row of rows) {
    if (Date.now() > deadline) { vStats.truncated = true; break; }
    vStats.rows++;
    const resolution = await resolvePropertyId(vertical, row.sf_property_id as string | null, row.linked_property_id as number | null, row.street as string | null, row.city as string | null, row.state as string | null);
    if (resolution.propertyId === null) {
      vStats.unmatched++;
      await dbFetch(vertical, "PATCH", `sf_comp_staging?staging_id=eq.${row.staging_id}`, { process_status: "review", process_notes: `no property match (${resolution.method})`, updated_at: isoNow() });
      continue;
    }
    vStats.resolved++;
    const recordPk = String(resolution.propertyId);
    const rowDecisions: Record<string, string> = {};
    for (const [stagingCol, domainCol] of Object.entries(COMP_FIELD_MAP)) {
      const value = row[stagingCol];
      if (value === null || value === undefined || value === "") continue;
      vStats.fields_evaluated++;
      const result = await mergeField(vertical, supportsCompareSales ? "comparable_sales" : "comp_provenance", recordPk, domainCol, value, runId);
      const decision = (result?.decision as string) || "error";
      rowDecisions[domainCol] = decision;
      if (decision === "write") vStats.write++;
      else if (decision === "skip") vStats.skip++;
      else if (decision === "conflict") vStats.conflict++;
      else vStats.errors++;
    }
    // Optionally insert into comparable_sales when enforce mode and dia
    if (enforce && supportsCompareSales) {
      const insertRow: Record<string, unknown> = { property_id: resolution.propertyId };
      for (const [stagingCol, domainCol] of Object.entries(COMP_FIELD_MAP)) {
        if (row[stagingCol] !== null && row[stagingCol] !== undefined && row[stagingCol] !== "") insertRow[domainCol] = row[stagingCol];
      }
      insertRow.source_file = `sf_promotion_${runId}`;
      const up = await dbFetch("dia", "POST", `comparable_sales`, [insertRow]);
      if (up.ok) vStats.inserted_to_domain++;
    }
    await dbFetch(vertical, "PATCH", `sf_comp_staging?staging_id=eq.${row.staging_id}`, { process_status: "reported", linked_property_id: resolution.propertyId, match_method: resolution.method, processed: true, processed_at: isoNow(), process_notes: `promotion ${runId} resolved via ${resolution.method}`, updated_at: isoNow() });
    if (vStats.sample.length < 3) vStats.sample.push({ staging_id: row.staging_id, property_id: recordPk, method: resolution.method, decisions: rowDecisions });
  }
  return vStats;
}

async function promoteEntity(vertical: Vertical, kind: string, table: string, sfIdCol: string, selectCols: string, fields: string[], limit: number, runId: string, deadline: number): Promise<Record<string, unknown>> {
  const vStats = { rows: 0, resolved: 0, unmatched: 0, fields_evaluated: 0, write: 0, skip: 0, conflict: 0, errors: 0, truncated: false, sample: [] as Record<string, unknown>[] };
  const staged = await dbFetch(vertical, "GET", `${table}?process_status=eq.pending&select=${selectCols}&limit=${limit}`);
  const rows = Array.isArray(staged.data) ? staged.data as Record<string, unknown>[] : [];
  for (const row of rows) {
    if (Date.now() > deadline) { vStats.truncated = true; break; }
    vStats.rows++;
    // Try to resolve via sf_property_id chain (no address fields on listing/deal beyond property_address composite)
    const composite = row["property_address"] as string | null;
    const resolution = await resolvePropertyId(vertical, row.sf_property_id as string | null, row.linked_property_id as number | null, composite, null, null);
    let recordPk: string;
    if (resolution.propertyId) {
      vStats.resolved++;
      recordPk = String(resolution.propertyId);
    } else {
      vStats.unmatched++;
      // Use SF id as virtual record pk so provenance still gets logged
      recordPk = `sf:${row[sfIdCol]}`;
    }
    const rowDecisions: Record<string, string> = {};
    for (const field of fields) {
      const value = row[field];
      if (value === null || value === undefined || value === "") continue;
      vStats.fields_evaluated++;
      const result = await mergeField(vertical, `${kind}_provenance`, recordPk, field, value, runId);
      const decision = (result?.decision as string) || "error";
      rowDecisions[field] = decision;
      if (decision === "write") vStats.write++;
      else if (decision === "skip") vStats.skip++;
      else if (decision === "conflict") vStats.conflict++;
      else vStats.errors++;
    }
    await dbFetch(vertical, "PATCH", `${table}?staging_id=eq.${row.staging_id}`, { process_status: resolution.propertyId ? "reported" : "review", linked_property_id: resolution.propertyId, match_method: resolution.method, processed: !!resolution.propertyId, processed_at: isoNow(), process_notes: `promotion ${runId} (${kind}) resolved via ${resolution.method}`, updated_at: isoNow() });
    if (vStats.sample.length < 3) vStats.sample.push({ staging_id: row.staging_id, record_pk: recordPk, method: resolution.method, decisions: rowDecisions });
  }
  return vStats;
}
