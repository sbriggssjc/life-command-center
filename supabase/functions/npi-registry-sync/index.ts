// ============================================================================
// npi-registry-sync — Edge Function: weekly NPPES ESRD national sweep
// Life Command Center — Round 76ed (Phase 2 of NPI registry coverage plan)
//
// Walks every US state + DC + territories, querying NPPES live API filtered
// to ESRD taxonomy (261QE0700X). For states whose result count hits the
// NPPES per-query cap (200), recursively subdivides by ZIP-prefix wildcard
// until each leaf returns < 200.
//
// For each provider returned:
//   1. Upsert into npi_registry (current state).
//   2. Read most-recent clinic_npi_registry_history row for the same NPI.
//   3. Compare to detect changes (status, address, name, official); set the
//      corresponding boolean flag in the new history row.
//   4. Insert a history row with snapshot_date = today.
//
// The mv_npi_inventory_signals matview reads the change flags to emit
// npi_deactivated / address_change / name_change / new_npi BD signals.
//
// Routes:
//   POST /  body { states?: string[], dry_run?: bool }
//   GET  /?action=health
//
// Auth: X-LCC-Key header (LCC_API_KEY env on the dialysis project).
// ============================================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const NPPES_BASE = "https://npiregistry.cms.hhs.gov/api/";
const ESRD_TAXONOMY = "261QE0700X";
const NPPES_LIMIT = 200;
const REQUEST_DELAY_MS = 80;

const ALL_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN",
  "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH",
  "NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT",
  "VT","VA","WA","WV","WI","WY","PR","VI","GU","AS","MP",
];

// ── CORS ──────────────────────────────────────────────────────────────────
const FRONTEND_URL = Deno.env.get("VERCEL_FRONTEND_URL") || Deno.env.get("LCC_BASE_URL") || "https://tranquil-delight-production-633f.up.railway.app";
const ALLOWED_ORIGINS: string[] = [FRONTEND_URL, "https://tranquil-delight-production-633f.up.railway.app", "http://localhost:3000", "http://localhost:5500", "http://127.0.0.1:5500"];
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : FRONTEND_URL;
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-LCC-Workspace, X-LCC-Key, X-PA-Webhook-Secret",
    "Access-Control-Max-Age": "86400",
  };
}
function handleCors(req: Request): Response | null {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  return null;
}
function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(req), "Content-Type": "application/json" } });
}
function errorResponse(req: Request, message: string, status = 400): Response {
  return jsonResponse(req, { error: message }, status);
}

function authOk(req: Request): boolean {
  const want = Deno.env.get("LCC_API_KEY");
  if (!want) return true;
  const got = req.headers.get("X-LCC-Key") || req.headers.get("authorization")?.replace(/^Bearer /i, "");
  return got === want;
}

// ── NPPES ─────────────────────────────────────────────────────────────────
interface RawNppesAddress {
  address_purpose?: string;
  address_1?: string;
  city?: string;
  state?: string;
  postal_code?: string;
}
interface RawNppesTaxonomy { code?: string; primary?: boolean; }
interface RawNppesBasic {
  organization_name?: string;
  status?: string;
  enumeration_date?: string;
  last_updated?: string;
  authorized_official_first_name?: string;
  authorized_official_middle_name?: string;
  authorized_official_last_name?: string;
  authorized_official_title_or_position?: string;
  authorized_official_telephone_number?: string;
  replacement_npi?: string;
}
interface RawNppesHit {
  number?: string;
  basic?: RawNppesBasic;
  addresses?: RawNppesAddress[];
  taxonomies?: RawNppesTaxonomy[];
}

interface RegistryRow {
  npi: string;
  organization_name: string;
  npi_status: string;
  enumeration_date: string;
  npi_last_updated: string;
  authorized_official: string;
  authorized_official_title: string;
  authorized_official_phone: string;
  practice_address: string;
  practice_city: string;
  practice_state: string;
  practice_zip: string;
  mailing_address: string;
  mailing_city: string;
  mailing_state: string;
  mailing_zip: string;
  primary_taxonomy: string;
  is_esrd_taxonomy: boolean;
  replacement_npi: string | null;
}

function pickAddress(addrs: RawNppesAddress[], purpose: string): RawNppesAddress {
  return addrs.find((a) => a.address_purpose === purpose) || ({} as RawNppesAddress);
}

function projectHit(hit: RawNppesHit): RegistryRow | null {
  const npi = String(hit.number || "");
  if (!npi) return null;
  const basic = hit.basic || {};
  const addrs = Array.isArray(hit.addresses) ? hit.addresses : [];
  const loc = pickAddress(addrs, "LOCATION");
  const mail = pickAddress(addrs, "MAILING");
  const taxes = Array.isArray(hit.taxonomies) ? hit.taxonomies : [];
  const primaryTax = taxes.find((t) => t.primary) || taxes[0] || {};
  const official = [basic.authorized_official_first_name, basic.authorized_official_middle_name, basic.authorized_official_last_name]
    .filter(Boolean).join(" ").trim();

  return {
    npi,
    organization_name: String(basic.organization_name || ""),
    npi_status: String(basic.status || ""),
    enumeration_date: String(basic.enumeration_date || ""),
    npi_last_updated: String(basic.last_updated || ""),
    authorized_official: official,
    authorized_official_title: String(basic.authorized_official_title_or_position || ""),
    authorized_official_phone: String(basic.authorized_official_telephone_number || ""),
    practice_address: String(loc.address_1 || ""),
    practice_city: String(loc.city || ""),
    practice_state: String(loc.state || ""),
    practice_zip: String(loc.postal_code || ""),
    mailing_address: String(mail.address_1 || ""),
    mailing_city: String(mail.city || ""),
    mailing_state: String(mail.state || ""),
    mailing_zip: String(mail.postal_code || ""),
    primary_taxonomy: String(primaryTax.code || ""),
    is_esrd_taxonomy: taxes.some((t) => t.code === ESRD_TAXONOMY),
    replacement_npi: basic.replacement_npi ? String(basic.replacement_npi) : null,
  };
}

async function fetchNppes(state: string, zipPrefix: string | null): Promise<RawNppesHit[]> {
  const params = new URLSearchParams({
    version: "2.1",
    enumeration_type: "NPI-2",
    taxonomy_description: "End-Stage Renal Disease",
    state,
    country_code: "US",
    limit: String(NPPES_LIMIT),
  });
  if (zipPrefix) params.set("postal_code", `${zipPrefix}*`);
  const res = await fetch(`${NPPES_BASE}?${params.toString()}`, {
    headers: { "Accept": "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`NPPES ${res.status} state=${state} zip=${zipPrefix || "*"}`);
  const data = await res.json() as { results?: unknown[] };
  return (Array.isArray(data.results) ? data.results : []) as RawNppesHit[];
}

// Recursive enumeration: returns every ESRD NPI in `state`. Subdivides by ZIP
// prefix when a query hits the 200-result cap.
async function enumerateState(state: string, zipPrefix: string | null, depth: number, debug: string[]): Promise<RawNppesHit[]> {
  const hits = await fetchNppes(state, zipPrefix);
  await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
  if (hits.length < NPPES_LIMIT) {
    debug.push(`${state} zip=${zipPrefix || "*"}: ${hits.length}`);
    return hits;
  }
  // Hit the cap. Subdivide by ZIP first digit (or next digit if already prefixed).
  if (depth >= 5) {
    debug.push(`${state} zip=${zipPrefix || "*"}: 200 (max depth — likely truncated)`);
    return hits;
  }
  debug.push(`${state} zip=${zipPrefix || "*"}: 200 — subdividing`);
  const accum = new Map<string, RawNppesHit>();
  for (let d = 0; d < 10; d++) {
    const child = `${zipPrefix || ""}${d}`;
    const subHits = await enumerateState(state, child, depth + 1, debug);
    for (const h of subHits) {
      if (h.number) accum.set(String(h.number), h);
    }
  }
  return Array.from(accum.values());
}

// ── DIA helpers ───────────────────────────────────────────────────────────
function diaUrl(): string {
  const url = Deno.env.get("DIA_SUPABASE_URL") || Deno.env.get("SUPABASE_URL");
  if (!url) throw new Error("DIA_SUPABASE_URL/SUPABASE_URL not configured");
  return url;
}
function diaKey(): string {
  const key = Deno.env.get("DIA_SUPABASE_SERVICE_KEY") || Deno.env.get("DIA_SUPABASE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) throw new Error("service key not configured");
  return key;
}
function diaHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { "apikey": diaKey(), "Authorization": `Bearer ${diaKey()}`, "Content-Type": "application/json", ...extra };
}

// Map of npi -> latest history row (for diff detection).
async function fetchPriorHistorySnapshot(): Promise<Map<string, RegistryRow>> {
  // We need only the latest row per NPI. Use the unique (npi, snapshot_date)
  // index — query npi_registry directly since it stores the same fields and
  // is keyed on npi alone.
  const path = `npi_registry?select=npi,organization_name,npi_status,enumeration_date,npi_last_updated,authorized_official,authorized_official_title,authorized_official_phone,npi_address,npi_city,npi_state,npi_zip,primary_taxonomy,is_esrd_taxonomy&is_esrd_taxonomy=eq.true&limit=20000`;
  const res = await fetch(`${diaUrl()}/rest/v1/${path}`, { headers: diaHeaders() });
  if (!res.ok) throw new Error(`fetch prior registry: ${res.status}`);
  const rows = await res.json() as Array<Record<string, unknown>>;
  const map = new Map<string, RegistryRow>();
  for (const r of rows) {
    const npi = String(r.npi || "");
    if (!npi) continue;
    map.set(npi, {
      npi,
      organization_name: String(r.organization_name || ""),
      npi_status: String(r.npi_status || ""),
      enumeration_date: String(r.enumeration_date || ""),
      npi_last_updated: String(r.npi_last_updated || ""),
      authorized_official: String(r.authorized_official || ""),
      authorized_official_title: String(r.authorized_official_title || ""),
      authorized_official_phone: String(r.authorized_official_phone || ""),
      practice_address: String(r.npi_address || ""),
      practice_city: String(r.npi_city || ""),
      practice_state: String(r.npi_state || ""),
      practice_zip: String(r.npi_zip || ""),
      mailing_address: "", mailing_city: "", mailing_state: "", mailing_zip: "",
      primary_taxonomy: String(r.primary_taxonomy || ""),
      is_esrd_taxonomy: r.is_esrd_taxonomy === true,
      replacement_npi: null,
    });
  }
  return map;
}

interface UpsertRegistryRow {
  npi: string;
  organization_name: string;
  npi_status: string;
  enumeration_date: string;
  npi_last_updated: string;
  authorized_official: string;
  authorized_official_title: string;
  authorized_official_phone: string;
  npi_address: string;
  npi_city: string;
  npi_state: string;
  npi_zip: string;
  is_esrd_taxonomy: boolean;
  primary_taxonomy: string;
  updated_at: string;
}

async function upsertRegistry(rows: UpsertRegistryRow[]): Promise<void> {
  if (rows.length === 0) return;
  // Chunk to avoid PostgREST request-size limits.
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const url = `${diaUrl()}/rest/v1/npi_registry?on_conflict=npi`;
    const res = await fetch(url, {
      method: "POST",
      headers: diaHeaders({ "Prefer": "return=minimal,resolution=merge-duplicates" }),
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`upsert npi_registry: ${res.status} ${t.slice(0, 200)}`);
    }
  }
}

interface HistoryRow {
  npi: string;
  snapshot_date: string;
  organization_name: string;
  npi_status: string;
  enumeration_date: string;
  npi_last_updated: string;
  authorized_official: string;
  authorized_official_title: string;
  authorized_official_phone: string;
  practice_address: string;
  practice_city: string;
  practice_state: string;
  practice_zip: string;
  mailing_address: string;
  mailing_city: string;
  mailing_state: string;
  mailing_zip: string;
  primary_taxonomy: string;
  is_esrd_taxonomy: boolean;
  replacement_npi: string | null;
  is_new: boolean;
  status_changed: boolean;
  address_changed: boolean;
  name_changed: boolean;
  official_changed: boolean;
}

async function insertHistory(rows: HistoryRow[]): Promise<void> {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    // Idempotent: re-run on the same date should overwrite the day's snapshot.
    const url = `${diaUrl()}/rest/v1/clinic_npi_registry_history?on_conflict=npi,snapshot_date`;
    const res = await fetch(url, {
      method: "POST",
      headers: diaHeaders({ "Prefer": "return=minimal,resolution=merge-duplicates" }),
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`insert history: ${res.status} ${t.slice(0, 200)}`);
    }
  }
}

function diffFlags(prev: RegistryRow | undefined, curr: RegistryRow): { is_new: boolean; status_changed: boolean; address_changed: boolean; name_changed: boolean; official_changed: boolean; } {
  if (!prev) return { is_new: true, status_changed: false, address_changed: false, name_changed: false, official_changed: false };
  const norm = (s: string) => s.trim().toUpperCase();
  return {
    is_new: false,
    status_changed: norm(prev.npi_status) !== norm(curr.npi_status),
    address_changed:
      norm(prev.practice_address) !== norm(curr.practice_address) ||
      norm(prev.practice_city) !== norm(curr.practice_city) ||
      norm(prev.practice_state) !== norm(curr.practice_state) ||
      norm(prev.practice_zip).slice(0, 5) !== norm(curr.practice_zip).slice(0, 5),
    name_changed: norm(prev.organization_name) !== norm(curr.organization_name),
    official_changed: norm(prev.authorized_official) !== norm(curr.authorized_official),
  };
}

// ── Main handler ─────────────────────────────────────────────────────────
serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const url = new URL(req.url);
  if (req.method === "GET" && url.searchParams.get("action") === "health") {
    return jsonResponse(req, { ok: true, service: "npi-registry-sync" });
  }
  if (req.method !== "POST") return errorResponse(req, "POST required", 405);
  if (!authOk(req)) return errorResponse(req, "Unauthorized", 401);

  let body: { states?: string[]; dry_run?: boolean } = {};
  try { body = await req.json(); } catch (_) { body = {}; }
  const dryRun = !!body.dry_run;
  const states = body.states && body.states.length > 0
    ? body.states.map((s) => s.toUpperCase())
    : ALL_STATES;

  const startedAt = Date.now();
  const debug: string[] = [];
  const today = new Date().toISOString().slice(0, 10);

  // Load prior state once to compute diff flags.
  let prior: Map<string, RegistryRow>;
  try { prior = await fetchPriorHistorySnapshot(); }
  catch (err) { return errorResponse(req, `prior load: ${(err as Error).message}`, 500); }

  const seenNpis = new Set<string>();
  const upsertBuf: UpsertRegistryRow[] = [];
  const historyBuf: HistoryRow[] = [];
  const summary = {
    states_processed: 0,
    nppes_queries: 0,
    providers_seen: 0,
    new_npis: 0,
    status_changed: 0,
    address_changed: 0,
    name_changed: 0,
    official_changed: 0,
    errors: 0,
    duration_ms: 0,
    dry_run: dryRun,
    debug: [] as string[],
  };

  for (const st of states) {
    let stateHits: RawNppesHit[] = [];
    try {
      const before = debug.length;
      stateHits = await enumerateState(st, null, 0, debug);
      summary.nppes_queries += debug.length - before;
    } catch (err) {
      summary.errors++;
      debug.push(`${st}: error ${(err as Error).message}`);
      continue;
    }
    summary.states_processed++;

    for (const h of stateHits) {
      const proj = projectHit(h);
      if (!proj || !proj.is_esrd_taxonomy) continue;
      if (seenNpis.has(proj.npi)) continue;  // dedup across overlapping ZIPs
      seenNpis.add(proj.npi);
      summary.providers_seen++;

      const flags = diffFlags(prior.get(proj.npi), proj);
      if (flags.is_new) summary.new_npis++;
      if (flags.status_changed) summary.status_changed++;
      if (flags.address_changed) summary.address_changed++;
      if (flags.name_changed) summary.name_changed++;
      if (flags.official_changed) summary.official_changed++;

      upsertBuf.push({
        npi: proj.npi,
        organization_name: proj.organization_name,
        npi_status: proj.npi_status,
        enumeration_date: proj.enumeration_date,
        npi_last_updated: proj.npi_last_updated,
        authorized_official: proj.authorized_official,
        authorized_official_title: proj.authorized_official_title,
        authorized_official_phone: proj.authorized_official_phone,
        npi_address: proj.practice_address,
        npi_city: proj.practice_city,
        npi_state: proj.practice_state,
        npi_zip: proj.practice_zip,
        is_esrd_taxonomy: proj.is_esrd_taxonomy,
        primary_taxonomy: proj.primary_taxonomy,
        updated_at: new Date().toISOString(),
      });
      historyBuf.push({
        npi: proj.npi,
        snapshot_date: today,
        organization_name: proj.organization_name,
        npi_status: proj.npi_status,
        enumeration_date: proj.enumeration_date,
        npi_last_updated: proj.npi_last_updated,
        authorized_official: proj.authorized_official,
        authorized_official_title: proj.authorized_official_title,
        authorized_official_phone: proj.authorized_official_phone,
        practice_address: proj.practice_address,
        practice_city: proj.practice_city,
        practice_state: proj.practice_state,
        practice_zip: proj.practice_zip,
        mailing_address: proj.mailing_address,
        mailing_city: proj.mailing_city,
        mailing_state: proj.mailing_state,
        mailing_zip: proj.mailing_zip,
        primary_taxonomy: proj.primary_taxonomy,
        is_esrd_taxonomy: proj.is_esrd_taxonomy,
        replacement_npi: proj.replacement_npi,
        ...flags,
      });
    }

    // Flush every state to keep memory bounded and progress durable.
    if (!dryRun && upsertBuf.length >= 500) {
      try {
        await upsertRegistry(upsertBuf.splice(0, upsertBuf.length));
        await insertHistory(historyBuf.splice(0, historyBuf.length));
      } catch (err) {
        summary.errors++;
        debug.push(`flush error: ${(err as Error).message}`);
      }
    }
  }

  if (!dryRun && (upsertBuf.length > 0 || historyBuf.length > 0)) {
    try {
      await upsertRegistry(upsertBuf);
      await insertHistory(historyBuf);
    } catch (err) {
      summary.errors++;
      debug.push(`final flush error: ${(err as Error).message}`);
    }
  }

  summary.duration_ms = Date.now() - startedAt;
  summary.debug = debug.slice(0, 80); // trim verbose log
  return jsonResponse(req, summary);
});
