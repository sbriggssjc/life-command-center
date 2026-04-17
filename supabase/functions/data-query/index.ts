// ============================================================================
// data-query — Edge Function port of api/data-proxy.js
// Life Command Center — Infrastructure Migration Phase 4a
//
// Dual-source proxy for Gov and Dia Supabase databases.
// Routes:
//   ?_source=gov|dia  — main GET/POST/PATCH proxy with allowlists
//   ?_route=gov-write — government write service proxy
//   ?_route=gov-evidence — government evidence/research proxy
//   ?action=health    — health check
// ============================================================================

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { authenticateUser, requireRole, primaryWorkspaceId } from "../_shared/auth.ts";
import { queryParams, parseBody } from "../_shared/utils.ts";

// ── Allowlists (ported from api/_shared/allowlist.js) ──────────────────────

const GOV_READ_TABLES = new Set([
  "properties", "prospect_leads", "ownership_history", "contacts",
  "available_listings", "gsa_lease_events", "gsa_snapshots",
  "location_code_reference", "frpp_records", "county_authorities",
  "loans", "sales_transactions", "property_sale_events",
  "recorded_owners", "true_owners",
  "v_sales_comps", "v_available_listings", "v_property_latest_sale",
  "v_property_detail", "v_lease_detail", "v_property_operations",
  "v_ownership_chain", "v_ownership_current", "v_property_intel",
  "v_property_history", "mv_gov_overview_stats",
  "sales_comps", "research_queue_outcomes", "pending_updates",
  "ingestion_tracker", "ingestion_log",
  "unified_contacts", "contact_change_log", "contact_merge_queue",
]);

const GOV_WRITE_TABLES = new Set([
  "properties", "prospect_leads", "ownership_history", "contacts",
  "recorded_owners", "true_owners", "sales_transactions", "property_sale_events", "loans",
  "research_queue_outcomes",
  "unified_contacts", "contact_change_log", "contact_merge_queue",
  "rpc/upsert_lead", "rpc/save_research_outcome", "rpc/resolve_contact",
]);

const DIA_READ_TABLES = new Set([
  "v_counts_freshness", "v_clinic_inventory_diff_summary",
  "v_clinic_inventory_latest_diff", "v_facility_patient_counts_mom",
  "v_npi_inventory_signal_summary", "v_npi_inventory_signals",
  "v_clinic_property_link_review_queue", "v_clinic_lease_backfill_candidates",
  "v_clinic_lease_data_gaps", "v_clinic_lease_renewal_watchlist",
  "v_ingestion_reconciliation", "v_clinic_research_priority",
  "v_cms_data", "v_sales_comps", "v_available_listings", "v_loans",
  "v_sf_activity_feed", "v_marketing_deals", "v_marketing_crm_tasks",
  "v_crm_client_rollup", "v_sf_tasks_contact_rollup",
  "v_opportunity_domain_classified",
  "salesforce_activities", "salesforce_tasks", "medicare_clinics",
  "available_listings", "marketing_leads", "research_queue_outcomes",
  "clinic_financial_estimates", "ownership_history", "bd_email_templates",
  "outbound_activities", "properties", "recorded_owners", "true_owners",
  "contacts", "sales_transactions", "property_sale_events", "v_property_latest_sale",
  "sale_brokers", "brokers", "broker_companies", "loans", "property_intel",
  "v_property_detail", "v_lease_detail", "v_ownership_current",
  "v_ownership_chain", "v_property_rankings",
  "facility_patient_counts", "v_facility_patient_counts_latest", "clinic_trends", "clinic_quality_metrics",
  "facility_cost_reports", "leases",
  "lease_extensions", "lease_rent_schedule", "v_lease_extensions_summary",
  "v_clinic_payer_mix",
  "v_payer_mix_geo_averages",
  "property_cms_link", "property_cms_link_history",
  "ingestion_log",
]);

const DIA_WRITE_TABLES = new Set([
  "research_queue_outcomes", "outbound_activities", "marketing_leads",
  "properties", "recorded_owners", "true_owners", "contacts",
  "sales_transactions", "property_sale_events", "property_intel",
  "loans", "v_clinic_property_link_review_queue",
  "salesforce_activities",
  "property_cms_link", "property_cms_link_history",
  "rpc/upsert_research_outcome", "rpc/save_outbound_activity",
  "rpc/match_marketing_lead_to_sf", "rpc/refresh_crm_rollup",
]);

const GOV_WRITE_SERVICE_TABLES = new Set([
  "properties", "prospect_leads", "recorded_owners", "true_owners",
  "contacts", "research_queue_outcomes",
  "rpc/upsert_lead", "rpc/save_research_outcome",
]);

const MAX_LIMIT = 10000;
const DEFAULT_LIMIT = 1000;

function isAllowedTable(table: string, allowlist: Set<string>): boolean {
  if (!table || typeof table !== "string") return false;
  if (!/^[a-zA-Z0-9_/]+$/.test(table)) return false;
  return allowlist.has(table);
}

function safeLimit(limit: string | null): number {
  const n = parseInt(limit || "", 10);
  if (isNaN(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function safeSelect(select: string | null): string {
  if (!select || typeof select !== "string") return "*";
  if (!/^[a-zA-Z0-9_,.*:()\s!]+$/.test(select)) return "*";
  return select;
}

function safeColumn(col: string): string | null {
  if (!col || typeof col !== "string") return null;
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col)) return null;
  return col;
}

// ── Source config ───────────────────────────────────────────────────────────

interface SourceConfig {
  urlEnv: string;
  keyEnv: string;
  readTables: Set<string>;
  writeTables: Set<string>;
  label: string;
}

const SOURCE_CONFIG: Record<string, SourceConfig> = {
  gov: {
    urlEnv: "GOV_SUPABASE_URL",
    keyEnv: "GOV_SUPABASE_KEY",
    readTables: GOV_READ_TABLES,
    writeTables: GOV_WRITE_TABLES,
    label: "GOV",
  },
  dia: {
    urlEnv: "DIA_SUPABASE_URL",
    keyEnv: "DIA_SUPABASE_KEY",
    readTables: DIA_READ_TABLES,
    writeTables: DIA_WRITE_TABLES,
    label: "DIA",
  },
};

// ── Gov Write Service ──────────────────────────────────────────────────────

const GOV_WRITE_ENDPOINT_MAP: Record<string, string> = {
  "ownership": "/api/write/ownership",
  "lead-research": "/api/write/lead-research",
  "financial": "/api/write/financial",
  "resolve-pending": "/api/pending-updates",
};

interface EvidenceConfig {
  path: string | ((params: Record<string, string>) => string);
  methods: string[];
}

const GOV_EVIDENCE_ENDPOINT_MAP: Record<string, EvidenceConfig> = {
  "evidence-health": { path: "/api/evidence-health", methods: ["GET"] },
  "extract-screenshot-json": { path: "/api/extract-screenshot-json", methods: ["POST"] },
  "research-artifacts": { path: "/api/research-artifacts", methods: ["POST"] },
  "apply-loan": {
    path: (p) => `/api/research-artifacts/${encodeURIComponent(p.artifact_id)}/apply-loan`,
    methods: ["POST"],
  },
  "apply-ownership": {
    path: (p) => `/api/research-artifacts/${encodeURIComponent(p.artifact_id)}/apply-ownership`,
    methods: ["POST"],
  },
  "apply-listing": {
    path: (p) => `/api/research-artifacts/${encodeURIComponent(p.artifact_id)}/apply-listing`,
    methods: ["POST"],
  },
  "apply-broker-contact": {
    path: (p) => `/api/research-artifacts/${encodeURIComponent(p.artifact_id)}/apply-broker-contact`,
    methods: ["POST"],
  },
  "apply-activity-note": {
    path: (p) => `/api/research-artifacts/${encodeURIComponent(p.artifact_id)}/apply-activity-note`,
    methods: ["POST"],
  },
  "promote-observations": {
    path: (p) => `/api/research-artifacts/${encodeURIComponent(p.artifact_id)}/promote-observations`,
    methods: ["POST"],
  },
  "research-observations": { path: "/api/research-observations", methods: ["GET"] },
  "broker-feedback": { path: "/api/research-observations/broker-feedback", methods: ["GET"] },
  "review-observation": {
    path: (p) => `/api/research-observations/${encodeURIComponent(p.observation_id)}/review`,
    methods: ["POST"],
  },
  "promote-observation": {
    path: (p) => `/api/research-observations/${encodeURIComponent(p.observation_id)}/promote`,
    methods: ["POST"],
  },
};

async function handleGovWrite(
  req: Request,
  params: URLSearchParams,
  user: { id: string; email: string; display_name: string }
): Promise<Response> {
  if (req.method !== "POST") {
    return errorResponse(req, "Method not allowed", 405);
  }

  const GOV_API_URL = Deno.env.get("GOV_API_URL");
  if (!GOV_API_URL) {
    return errorResponse(req, "GOV_API_URL not configured", 503);
  }

  const endpoint = params.get("endpoint") || "";
  if (!endpoint || !GOV_WRITE_ENDPOINT_MAP[endpoint]) {
    return errorResponse(
      req,
      `Invalid endpoint. Use: ${Object.keys(GOV_WRITE_ENDPOINT_MAP).join(", ")}`,
      400
    );
  }

  let govPath = GOV_WRITE_ENDPOINT_MAP[endpoint];
  if (endpoint === "resolve-pending") {
    const updateId = params.get("update_id");
    if (!updateId) {
      return errorResponse(req, "update_id query parameter required for resolve-pending", 400);
    }
    govPath = `${govPath}/${encodeURIComponent(updateId)}/resolve`;
  }

  const govUrl = `${GOV_API_URL.replace(/\/+$/, "")}${govPath}`;
  const rawBody = await parseBody<Record<string, unknown>>(req);
  const body = {
    ...(rawBody || {}),
    source_app: "lcc",
    actor: user.email || user.display_name || user.id,
  };

  try {
    const response = await fetch(govUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Source-App": "lcc",
        "X-LCC-User": user.id,
      },
      body: JSON.stringify(body),
    });

    const responseText = await response.text();
    let data;
    try { data = JSON.parse(responseText); } catch { data = { raw: responseText }; }

    if (!response.ok) {
      return jsonResponse(req, { error: `Gov write service returned ${response.status}`, detail: data }, response.status);
    }

    return jsonResponse(req, data);
  } catch (err) {
    console.error(`[gov-write] Error calling ${govUrl}:`, (err as Error).message);
    return errorResponse(req, "Failed to reach government write service", 502);
  }
}

async function handleGovEvidence(
  req: Request,
  params: URLSearchParams,
  user: { id: string; email: string; display_name: string }
): Promise<Response> {
  if (!["GET", "POST"].includes(req.method)) {
    return errorResponse(req, "Method not allowed", 405);
  }

  const GOV_API_URL = Deno.env.get("GOV_API_URL");
  if (!GOV_API_URL) {
    return errorResponse(req, "GOV_API_URL not configured", 503);
  }

  const endpoint = params.get("endpoint") || "";
  const config = endpoint ? GOV_EVIDENCE_ENDPOINT_MAP[endpoint] : null;
  if (!config) {
    return errorResponse(
      req,
      `Invalid endpoint. Use: ${Object.keys(GOV_EVIDENCE_ENDPOINT_MAP).join(", ")}`,
      400
    );
  }
  if (!config.methods.includes(req.method)) {
    return errorResponse(req, `Method ${req.method} not allowed for ${endpoint}`, 405);
  }

  // Build path — may be parameterized
  const queryObj: Record<string, string> = {};
  params.forEach((v, k) => { queryObj[k] = v; });
  const builtPath = typeof config.path === "function" ? config.path(queryObj) : config.path;
  if (!builtPath || builtPath.includes("undefined")) {
    return errorResponse(req, "Required identifier missing for government evidence endpoint", 400);
  }

  const govUrl = new URL(`${GOV_API_URL.replace(/\/+$/, "")}${builtPath}`);
  ["status", "artifact_id", "lead_id", "property_id", "ownership_id", "actor"].forEach((key) => {
    const value = params.get(key);
    if (value != null && value !== "") govUrl.searchParams.set(key, value);
  });
  if (!govUrl.searchParams.get("actor") && req.method === "POST") {
    govUrl.searchParams.set("actor", user.email || user.display_name || user.id);
  }

  const headers: Record<string, string> = {
    "X-Source-App": "lcc",
    "X-LCC-User": user.id,
  };
  const options: RequestInit = { method: req.method, headers };

  if (req.method === "POST") {
    headers["Content-Type"] = "application/json";
    const rawBody = await parseBody<Record<string, unknown>>(req);
    const body: Record<string, unknown> = rawBody && typeof rawBody === "object" ? { ...rawBody } : {};
    if (!body.actor) body.actor = user.email || user.display_name || user.id;
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(govUrl.toString(), options);
    const responseText = await response.text();
    let data;
    try { data = JSON.parse(responseText); } catch { data = { raw: responseText }; }

    if (!response.ok) {
      return jsonResponse(
        req,
        { error: `Gov evidence service returned ${response.status}`, detail: data },
        response.status
      );
    }

    return jsonResponse(req, data, response.status || 200);
  } catch (err) {
    console.error(`[gov-evidence] Error calling ${govUrl}:`, (err as Error).message);
    return errorResponse(req, "Failed to reach government evidence service", 502);
  }
}

// ── Filter parsing helper ──────────────────────────────────────────────────

function applyFilter(url: URL, filterStr: string | null): string | null {
  if (!filterStr) return null;

  // Compound PostgREST filters: or(...) / and(...)
  if (filterStr.startsWith("or(") || filterStr.startsWith("and(")) {
    const key = filterStr.startsWith("or(") ? "or" : "and";
    const inner = filterStr.slice(filterStr.indexOf("(") + 1, filterStr.lastIndexOf(")"));
    url.searchParams.set(key, "(" + inner + ")");
    return null;
  }

  // Simple col=op.val filter
  const eqIdx = filterStr.indexOf("=");
  if (eqIdx > 0) {
    const col = safeColumn(filterStr.substring(0, eqIdx));
    if (!col) return "Invalid column name in filter";
    const val = filterStr.substring(eqIdx + 1);
    url.searchParams.set(col, val);
  }
  return null;
}

function appendWriteFilter(
  baseUrl: string,
  filterStr: string | null
): { url: string; error: string | null } {
  if (!filterStr) return { url: baseUrl, error: null };
  const eqIdx = filterStr.indexOf("=");
  if (eqIdx <= 0) return { url: baseUrl, error: null };
  const col = safeColumn(filterStr.substring(0, eqIdx));
  if (!col) return { url: baseUrl, error: "Invalid column name in filter" };
  const val = filterStr.substring(eqIdx + 1);
  const sep = baseUrl.includes("?") ? "&" : "?";
  return { url: `${baseUrl}${sep}${encodeURIComponent(col)}=${encodeURIComponent(val)}`, error: null };
}

// ── Main Handler ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // CORS
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  const params = queryParams(req);
  const action = params.get("action");
  const route = params.get("_route");

  // Health check
  if (action === "health") {
    return jsonResponse(req, {
      status: "ok",
      function: "data-query",
      gov_tables: GOV_READ_TABLES.size + GOV_WRITE_TABLES.size,
      dia_tables: DIA_READ_TABLES.size + DIA_WRITE_TABLES.size,
      timestamp: new Date().toISOString(),
    });
  }

  // Authenticate
  const user = await authenticateUser(req);
  if (!user) {
    return errorResponse(req, "Authentication required", 401);
  }

  const wsId = primaryWorkspaceId(user);
  if (!wsId || !requireRole(user, "viewer", wsId)) {
    return errorResponse(req, "Insufficient permissions", 403);
  }

  // Gov write service sub-handler
  if (route === "gov-write") {
    if (!requireRole(user, "operator", wsId)) {
      return errorResponse(req, "Operator role required for government writes", 403);
    }
    return handleGovWrite(req, params, user);
  }

  // Gov evidence sub-handler
  if (route === "gov-evidence") {
    if (!requireRole(user, "operator", wsId)) {
      return errorResponse(req, "Operator role required for government evidence actions", 403);
    }
    return handleGovEvidence(req, params, user);
  }

  // Main proxy — require GET/POST/PATCH
  if (!["GET", "POST", "PATCH"].includes(req.method)) {
    return errorResponse(req, `Method ${req.method} not allowed`, 405);
  }

  // Write access requires operator role
  if (req.method === "POST" || req.method === "PATCH") {
    if (!requireRole(user, "operator", wsId)) {
      return errorResponse(req, "Write access requires operator role or higher", 403);
    }
  }

  // Resolve source
  const source = params.get("_source") || "";
  const cfg = SOURCE_CONFIG[source];
  if (!cfg) {
    return errorResponse(req, "Invalid _source. Must be gov or dia.", 400);
  }

  const dbUrl = Deno.env.get(cfg.urlEnv);
  const dbKey = Deno.env.get(cfg.keyEnv);
  if (!dbUrl) return errorResponse(req, `${cfg.label}_SUPABASE_URL not configured`, 500);
  if (!dbKey) return errorResponse(req, `${cfg.label}_SUPABASE_KEY not configured`, 500);

  const table = params.get("table") || "";
  if (!table) return errorResponse(req, "table parameter required", 400);

  // ── POST / PATCH (writes and RPC) ─────────────────────────────────────
  if (req.method === "POST" || req.method === "PATCH") {
    if (!isAllowedTable(table, cfg.writeTables)) {
      return errorResponse(req, `Write access denied for table: ${table}`, 403);
    }

    const body = await parseBody<Record<string, unknown>>(req);

    // Redirect RCM/LoopNet marketing_leads writes to lead-ingest edge function
    if (source === "dia" && table === "marketing_leads" && req.method === "POST" && body) {
      if ((body.source === "rcm" || body.source === "loopnet") && body.raw_body) {
        const edgeBase = Deno.env.get("EDGE_FUNCTION_BASE_URL") || "";
        if (edgeBase) {
          const ingestAction = body.source === "rcm" ? "rcm" : "loopnet";
          try {
            const ingestResp = await fetch(
              `${edgeBase}/lead-ingest?action=${ingestAction}`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${Deno.env.get("OPS_SUPABASE_SERVICE_KEY") || ""}`,
                },
                body: JSON.stringify(body),
              }
            );
            const ingestData = await ingestResp.text();
            try {
              return jsonResponse(req, JSON.parse(ingestData), ingestResp.status);
            } catch {
              return jsonResponse(req, { raw: ingestData }, ingestResp.status);
            }
          } catch (err) {
            console.error("Lead ingest redirect failed, falling back to raw insert:", (err as Error).message);
          }
        }
      }
    }

    // Government domain tables must use write services
    if (source === "gov" && GOV_WRITE_SERVICE_TABLES.has(table)) {
      const serviceHint =
        table === "prospect_leads" || table === "rpc/upsert_lead"
          ? "lead-research"
          : table === "research_queue_outcomes" || table === "rpc/save_research_outcome"
          ? "lead-research"
          : "ownership";
      return jsonResponse(
        req,
        {
          error: `Government domain writes to "${table}" must use the write service endpoint.`,
          hint: `POST /api/gov-write?endpoint=${serviceHint}`,
          docs: "Government closed-loop write services handle propagation, provenance, and change journaling.",
        },
        400
      );
    }

    const isRpc = table.startsWith("rpc/");
    const clientPrefer = req.headers.get("prefer") || "";
    const wantsRepresentation = clientPrefer.includes("return=representation");

    try {
      let patchUrl = `${dbUrl}/rest/v1/${table}`;
      const filter = params.get("filter");
      const filter2 = params.get("filter2");

      const f1 = appendWriteFilter(patchUrl, filter);
      if (f1.error) return errorResponse(req, f1.error, 400);
      patchUrl = f1.url;

      const f2 = appendWriteFilter(patchUrl, filter2);
      if (f2.error) return errorResponse(req, "Invalid column name in filter2", 400);
      patchUrl = f2.url;

      let preferHeader = "return=minimal";
      if (isRpc || wantsRepresentation) preferHeader = "return=representation";

      const response = await fetch(patchUrl, {
        method: req.method,
        headers: {
          apikey: dbKey,
          Authorization: `Bearer ${dbKey}`,
          "Content-Type": "application/json",
          Prefer: preferHeader,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errBody = await response.text();
        return jsonResponse(req, { error: errBody }, response.status);
      }

      if (isRpc || wantsRepresentation) {
        const text = await response.text();
        try {
          const data = JSON.parse(text);
          return jsonResponse(req, Array.isArray(data) ? data : [data], req.method === "POST" ? 201 : 200);
        } catch {
          return jsonResponse(req, [], req.method === "POST" ? 201 : 200);
        }
      }

      return jsonResponse(req, { ok: true }, req.method === "POST" ? 201 : 200);
    } catch (err) {
      console.error("[data-query] Write error:", (err as Error).message);
      return errorResponse(req, "Write operation failed", 500);
    }
  }

  // ── GET (read queries) ────────────────────────────────────────────────
  if (!isAllowedTable(table, cfg.readTables)) {
    return errorResponse(req, `Read access denied for table: ${table}`, 403);
  }

  const url = new URL(`${dbUrl}/rest/v1/${table}`);
  url.searchParams.set("select", safeSelect(params.get("select")));

  const filterErr1 = applyFilter(url, params.get("filter"));
  if (filterErr1) return errorResponse(req, filterErr1, 400);

  const filterErr2 = applyFilter(url, params.get("filter2"));
  if (filterErr2) return errorResponse(req, "Invalid column name in filter2", 400);

  const order = params.get("order");
  if (order) url.searchParams.set("order", order);
  url.searchParams.set("limit", String(safeLimit(params.get("limit"))));

  const offset = params.get("offset");
  if (offset !== null) url.searchParams.set("offset", offset);

  try {
    const wantCount = params.get("count") !== "false";
    const isHeavyView = table === "v_crm_client_rollup" || table === "v_sf_tasks_contact_rollup";

    const fetchHeaders: Record<string, string> = {
      apikey: dbKey,
      Authorization: `Bearer ${dbKey}`,
      "Content-Type": "application/json",
    };
    if (wantCount) {
      fetchHeaders["Prefer"] = isHeavyView ? "count=planned" : "count=exact";
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: fetchHeaders,
    });

    const text = await response.text();
    const contentRange = response.headers.get("content-range");

    if (!response.ok) {
      return jsonResponse(
        req,
        { error: `Supabase returned ${response.status}`, detail: text.substring(0, 500) },
        response.status
      );
    }

    let count = 0;
    if (contentRange) {
      const match = contentRange.match(/\/(\d+)/);
      if (match) count = parseInt(match[1], 10);
    }

    const data = JSON.parse(text);
    return jsonResponse(
      req,
      { data: Array.isArray(data) ? data : [], count },
      200,
      { "Cache-Control": "s-maxage=60, stale-while-revalidate=300" }
    );
  } catch (err) {
    console.error("[data-query] Read error:", (err as Error).message);
    return errorResponse(req, "Read operation failed", 500);
  }
});
