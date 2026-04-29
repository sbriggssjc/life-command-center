// ============================================================================
// npi-lookup — Edge Function: NPPES live API auto-fill for missing-NPI clinics
// Life Command Center — Round 76ec (Phase 1 of NPI registry coverage plan)
//
// For each active medicare_clinics row where npi='', query the public NPPES
// API (https://npiregistry.cms.hhs.gov/api/) by organization name + city +
// state + ESRD taxonomy. Score the best match; auto-write npi when the score
// is >= AUTO_APPLY_THRESHOLD (0.9). Log every attempt to
// dia.npi_registry_lookups so the v_npi_lookup_review_queue view surfaces
// medium-confidence matches for human triage.
//
// Routes:
//   POST /  body { all?: bool, clinic_ids?: string[], dry_run?: bool, max?: int }
//   GET  /?action=health
//
// Auth: requires X-LCC-Key header matching LCC_API_KEY env (same as other
// admin-proxied edge functions).
// ============================================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

const NPPES_BASE = "https://npiregistry.cms.hhs.gov/api/";
const ESRD_TAXONOMY = "261QE0700X"; // End-Stage Renal Disease (ESRD) Treatment
const AUTO_APPLY_THRESHOLD = 0.9;
const REQUEST_DELAY_MS = 80;        // ~12 req/sec — well under NPPES limits
const DEFAULT_MAX = 700;

// ── Auth ─────────────────────────────────────────────────────────────────
function authOk(req: Request): boolean {
  const want = Deno.env.get("LCC_API_KEY");
  if (!want) return true; // unconfigured = open (dev)
  const got = req.headers.get("X-LCC-Key") || req.headers.get("authorization")?.replace(/^Bearer /i, "");
  return got === want;
}

// ── String matching ──────────────────────────────────────────────────────
// Suffixes that appear in either CMS-style or NPPES-style dialysis facility
// names but never carry distinguishing signal — strip before fuzzy match.
const NAME_NOISE = /\b(artificial kidney unit|artificial kidney center|dialysis center|dialysis clinic|dialysis unit|dialysis cen|dialysis|memorial|kidney center|kidney|esrd|clinic|llc|inc|corp|corporation|home training|home dialysis)\b/g;
function normalize(s: string | null | undefined): string {
  if (!s) return "";
  return s.toLowerCase()
    .replace(/&/g, " and ")
    .replace(NAME_NOISE, " ")
    .replace(/[^a-z0-9]+/g, "");
}

// Dice coefficient on character bigrams (cheap fuzzy match for org names)
function diceCoefficient(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aLen = a.length, bLen = b.length;
  if (aLen < 2 || bLen < 2) return 0;
  const aGrams = new Map<string, number>();
  for (let i = 0; i < aLen - 1; i++) {
    const g = a.slice(i, i + 2);
    aGrams.set(g, (aGrams.get(g) || 0) + 1);
  }
  let intersect = 0;
  for (let i = 0; i < bLen - 1; i++) {
    const g = b.slice(i, i + 2);
    const c = aGrams.get(g) || 0;
    if (c > 0) {
      intersect++;
      aGrams.set(g, c - 1);
    }
  }
  return (2 * intersect) / (aLen + bLen - 2);
}

interface ClinicRow {
  medicare_id: string;
  facility_name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
}

interface NpiMatch {
  npi: string;
  organization_name: string;
  npi_status: string;
  is_esrd: boolean;
  address_line: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  score: number;
  raw: unknown;
}

// Same street number + first street-name token (e.g. "2915 SAULSBURY" matches
// both "2915 SAULSBURY DR" and "2915 SAULSBURY DRIVE"). This is a partial
// address signal — gives credit for matching street even when type/unit
// abbreviations differ.
function addressPrefixMatches(a: string | null, b: string | null): boolean {
  const tokenize = (s: string | null) => (s || "").toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ").trim().split(" ");
  const ta = tokenize(a), tb = tokenize(b);
  if (ta.length < 2 || tb.length < 2) return false;
  return ta[0] === tb[0] && ta[1] === tb[1] && /^\d+$/.test(ta[0]);
}

// Score a NPPES candidate against the clinic row.
// Address is the load-bearing signal (50% of score) so a wrong-address hit
// can never reach AUTO_APPLY_THRESHOLD even with a perfect name match.
function scoreMatch(clinic: ClinicRow, hit: NpiMatch): number {
  let score = 0;
  const addrExact = !!normalize(clinic.address) && normalize(clinic.address) === normalize(hit.address_line);
  const addrPrefix = !addrExact && addressPrefixMatches(clinic.address, hit.address_line);
  if (addrExact)       score += 0.5;
  else if (addrPrefix) score += 0.4;

  const nameSim = diceCoefficient(
    normalize(clinic.facility_name),
    normalize(hit.organization_name),
  );
  score += 0.3 * nameSim;

  if (clinic.state && hit.state && clinic.state.toUpperCase() === hit.state.toUpperCase()) score += 0.05;
  if (normalize(clinic.city) && normalize(clinic.city) === normalize(hit.city)) score += 0.05;
  if (hit.is_esrd)            score += 0.05;
  if (hit.npi_status === "A") score += 0.05;

  return Math.min(1, score);
}

// CMS truncates city to 11 chars in medicare_clinics — wildcard short cities
// so NPPES expands to the full name (e.g. "FRESH MEADO" → "FRESH MEADOWS").
function npiCityParam(city: string): string {
  const c = city.trim();
  return c.length <= 11 ? `${c.toUpperCase()}*` : c;
}

// Skip organization_name in the NPPES query: CMS facility names are
// abbreviations ("SCOTT & WHITE ARTIFICIAL KIDNEY UNIT") that rarely match
// the NPPES enumerated name verbatim. Querying by city + state + ESRD
// taxonomy returns ~1-10 candidates per clinic; we score by fuzzy name+addr
// match locally.
async function queryNppes(clinic: ClinicRow): Promise<NpiMatch[]> {
  const params = new URLSearchParams({
    version: "2.1",
    enumeration_type: "NPI-2",
    taxonomy_description: "End-Stage Renal Disease",
    city: npiCityParam(clinic.city || ""),
    state: (clinic.state || "").trim(),
    country_code: "US",
    limit: "20",
  });
  const url = `${NPPES_BASE}?${params.toString()}`;
  const res = await fetch(url, {
    headers: { "Accept": "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`NPPES ${res.status}`);
  const data = await res.json() as { results?: unknown[] };
  const results = Array.isArray(data.results) ? data.results : [];
  return results.map((r) => normalizeNppesHit(r));
}

interface RawNppesAddress {
  address_purpose?: string;
  address_1?: string;
  city?: string;
  state?: string;
  postal_code?: string;
}
interface RawNppesTaxonomy {
  code?: string;
  primary?: boolean;
}
interface RawNppesHit {
  number?: string;
  basic?: { organization_name?: string; status?: string };
  addresses?: RawNppesAddress[];
  taxonomies?: RawNppesTaxonomy[];
}

function normalizeNppesHit(raw: unknown): NpiMatch {
  const r = (raw || {}) as RawNppesHit;
  const addrs = Array.isArray(r.addresses) ? r.addresses : [];
  const loc = addrs.find((a) => a.address_purpose === "LOCATION") || addrs[0] || {};
  const taxes = Array.isArray(r.taxonomies) ? r.taxonomies : [];
  return {
    npi: String(r.number || ""),
    organization_name: String(r.basic?.organization_name || ""),
    npi_status: String(r.basic?.status || ""),
    is_esrd: taxes.some((t) => t.code === ESRD_TAXONOMY),
    address_line: loc.address_1 ? String(loc.address_1) : null,
    city: loc.city ? String(loc.city) : null,
    state: loc.state ? String(loc.state) : null,
    zip: loc.postal_code ? String(loc.postal_code) : null,
    score: 0,
    raw: r,
  };
}

// ── DIA helpers (PostgREST via service role) ─────────────────────────────
function diaUrl(): string {
  const url = Deno.env.get("DIA_SUPABASE_URL");
  if (!url) throw new Error("DIA_SUPABASE_URL not configured");
  return url;
}
function diaKey(): string {
  const key = Deno.env.get("DIA_SUPABASE_SERVICE_KEY") || Deno.env.get("DIA_SUPABASE_KEY");
  if (!key) throw new Error("DIA_SUPABASE_SERVICE_KEY/DIA_SUPABASE_KEY not configured");
  return key;
}
function diaHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "apikey": diaKey(),
    "Authorization": `Bearer ${diaKey()}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function fetchTargetClinics(clinic_ids: string[] | undefined, max: number): Promise<ClinicRow[]> {
  let path = `medicare_clinics?select=medicare_id,facility_name,address,city,state,zip_code&is_active=eq.true&or=(npi.is.null,npi.eq.)&limit=${max}`;
  if (clinic_ids && clinic_ids.length > 0) {
    const list = clinic_ids.map((id) => encodeURIComponent(id)).join(",");
    path = `medicare_clinics?select=medicare_id,facility_name,address,city,state,zip_code&medicare_id=in.(${list})`;
  }
  const res = await fetch(`${diaUrl()}/rest/v1/${path}`, { headers: diaHeaders() });
  if (!res.ok) throw new Error(`fetch clinics: ${res.status}`);
  return await res.json() as ClinicRow[];
}

async function patchClinicNpi(medicare_id: string, npi: string): Promise<void> {
  const url = `${diaUrl()}/rest/v1/medicare_clinics?medicare_id=eq.${encodeURIComponent(medicare_id)}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: diaHeaders({ "Prefer": "return=minimal" }),
    body: JSON.stringify({ npi }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`patch clinic ${medicare_id}: ${res.status} ${text.slice(0, 100)}`);
  }
}

interface AuditRow {
  clinic_id: string;
  query_org_name: string | null;
  query_city: string | null;
  query_state: string | null;
  query_zip: string | null;
  result_count: number;
  best_match_npi: string | null;
  best_match_score: number | null;
  best_match_org: string | null;
  applied: boolean;
  apply_decision: string;
  raw_response: unknown;
  notes: string | null;
}

async function logLookup(rows: AuditRow[]): Promise<void> {
  if (rows.length === 0) return;
  const url = `${diaUrl()}/rest/v1/npi_registry_lookups`;
  const res = await fetch(url, {
    method: "POST",
    headers: diaHeaders({ "Prefer": "return=minimal" }),
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[npi-lookup] audit log insert failed: ${res.status} ${text.slice(0, 200)}`);
  }
}

// ── Main handler ─────────────────────────────────────────────────────────
serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const url = new URL(req.url);
  if (req.method === "GET" && url.searchParams.get("action") === "health") {
    return jsonResponse(req, { ok: true, service: "npi-lookup" });
  }

  if (req.method !== "POST") {
    return errorResponse(req, "POST required", 405);
  }
  if (!authOk(req)) {
    return errorResponse(req, "Unauthorized", 401);
  }

  let body: { all?: boolean; clinic_ids?: string[]; dry_run?: boolean; max?: number } = {};
  try {
    body = await req.json();
  } catch (_) {
    body = {};
  }
  const dryRun = !!body.dry_run;
  const max = Math.min(body.max || DEFAULT_MAX, DEFAULT_MAX);

  let clinics: ClinicRow[];
  try {
    clinics = await fetchTargetClinics(body.clinic_ids, max);
  } catch (err) {
    return errorResponse(req, `fetch clinics failed: ${(err as Error).message}`, 500);
  }

  const summary = {
    scanned: clinics.length,
    auto_applied: 0,
    too_ambiguous: 0,
    low_confidence: 0,
    no_match: 0,
    errors: 0,
    dry_run: dryRun,
  };
  const auditBatch: AuditRow[] = [];

  for (const c of clinics) {
    if (!c.facility_name || !c.city || !c.state) {
      // can't query NPPES without these
      auditBatch.push({
        clinic_id: c.medicare_id,
        query_org_name: c.facility_name, query_city: c.city, query_state: c.state, query_zip: c.zip_code,
        result_count: 0, best_match_npi: null, best_match_score: null, best_match_org: null,
        applied: false, apply_decision: "no_match", raw_response: null,
        notes: "Skipped — clinic row missing facility_name/city/state",
      });
      summary.no_match++;
      continue;
    }

    let hits: NpiMatch[] = [];
    try {
      hits = await queryNppes(c);
    } catch (err) {
      summary.errors++;
      auditBatch.push({
        clinic_id: c.medicare_id,
        query_org_name: c.facility_name, query_city: c.city, query_state: c.state, query_zip: c.zip_code,
        result_count: 0, best_match_npi: null, best_match_score: null, best_match_org: null,
        applied: false, apply_decision: "no_match", raw_response: null,
        notes: `NPPES error: ${(err as Error).message}`,
      });
      // brief backoff on error
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }

    // Score
    const esrdHits = hits.filter((h) => h.is_esrd && h.npi_status === "A");
    const candidates = (esrdHits.length > 0 ? esrdHits : hits).map((h) => ({ ...h, score: scoreMatch(c, h) }));
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];

    let decision = "no_match";
    let applied = false;
    if (!best) {
      decision = "no_match";
    } else if (best.score >= AUTO_APPLY_THRESHOLD) {
      // unique high-confidence winner? ensure 2nd-best is meaningfully lower
      const second = candidates[1];
      if (second && second.score >= best.score - 0.05) {
        decision = "too_ambiguous";
      } else if (dryRun) {
        decision = "dry_run";
      } else {
        try {
          await patchClinicNpi(c.medicare_id, best.npi);
          decision = "auto_applied";
          applied = true;
        } catch (err) {
          decision = "no_match";
          summary.errors++;
          console.error(`[npi-lookup] patch ${c.medicare_id} failed: ${(err as Error).message}`);
        }
      }
    } else if (best.score >= 0.6) {
      decision = "low_confidence";
    } else {
      decision = "low_confidence";
    }

    if (decision === "auto_applied") summary.auto_applied++;
    else if (decision === "too_ambiguous") summary.too_ambiguous++;
    else if (decision === "low_confidence") summary.low_confidence++;
    else if (decision === "no_match") summary.no_match++;

    auditBatch.push({
      clinic_id: c.medicare_id,
      query_org_name: c.facility_name, query_city: c.city, query_state: c.state, query_zip: c.zip_code,
      result_count: hits.length,
      best_match_npi: best?.npi || null,
      best_match_score: best ? Number(best.score.toFixed(3)) : null,
      best_match_org: best?.organization_name || null,
      applied,
      apply_decision: decision,
      raw_response: candidates.slice(0, 3).map((c) => ({
        npi: c.npi, name: c.organization_name, score: c.score,
        addr: c.address_line, city: c.city, state: c.state, esrd: c.is_esrd,
      })),
      notes: null,
    });

    // Flush audit batch every 25 rows so a timeout doesn't lose progress
    if (auditBatch.length >= 25) {
      await logLookup(auditBatch.splice(0, auditBatch.length));
    }

    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
  }

  if (auditBatch.length > 0) await logLookup(auditBatch);

  return jsonResponse(req, summary);
});
