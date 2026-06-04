// ============================================================================
// availability-checker — Periodic listing availability worker
// Life Command Center — Supabase Edge Function (LCC Opps project)
//
// Pulls a batch of overdue active listings from dia.available_listings and
// gov.available_listings, fetches each listing URL with a browser-shaped
// User-Agent, parses the HTML for off-market markers, and records the
// outcome through public.lcc_record_listing_check on the source domain DB.
// Also writes a field_provenance row tagged source='availability_scraper'
// for each url_status update.
//
// Entry points:
//   POST /functions/v1/availability-checker
//        body: { domain?: 'dia'|'gov'|'both', limit?: number, dry_run?: bool }
//   GET  /functions/v1/availability-checker?action=health
//   POST /functions/v1/availability-checker?action=check_url   (debug — fetches
//                                                               a single URL
//                                                               and returns the
//                                                               parser verdict;
//                                                               does not write
//                                                               anything)
//
// Operational rules (do NOT relax without re-reading the constraints in the
// task brief):
//   1. Worker NEVER writes check_result='sold'. The sales_transactions
//      watcher in api/admin.js handleAutoScrapeListings owns that path.
//      A "Sold" page marker becomes 'off_market' / off_market_reason=
//      'unverified_assumed_off' instead.
//   2. Worker treats 4xx, 5xx, and bot-block pages as 'unreachable' and
//      lets lcc_record_listing_check increment consecutive_check_failures.
//      It only escalates to 'off_market' once the failure count crosses
//      the threshold (default 3) — same listing's third strike.
//   3. Worker fans out at most 3 fetches in parallel, with 2-3s of jitter
//      between launches. CREXi / CoStar / LoopNet rate-limit aggressively
//      enough that bursts of 10+ in flight return cached bot-block bodies.
// ============================================================================

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { parseListing, ParseResult } from "./parsers.ts";

// ── Config ──────────────────────────────────────────────────────────────────

const DIA_URL = Deno.env.get("DIA_SUPABASE_URL");
const DIA_KEY = Deno.env.get("DIA_SUPABASE_KEY");
const GOV_URL = Deno.env.get("GOV_SUPABASE_URL");
const GOV_KEY = Deno.env.get("GOV_SUPABASE_KEY");

// Ops project (LCC Opps). field_provenance + lcc_merge_field live here.
const OPS_URL =
  Deno.env.get("OPS_SUPABASE_URL") ||
  Deno.env.get("SUPABASE_URL") ||
  "";
const OPS_KEY =
  Deno.env.get("OPS_SUPABASE_SERVICE_KEY") ||
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  "";

// Auth: pg_cron POSTs with Authorization: Bearer <lcc_api_key>. The
// lcc_cron_post() helper in 20260428530000_lcc_round_76cw_pg_net_timeout_bump.sql
// pulls this from vault.lcc_api_key. We accept either Bearer or X-LCC-Key
// to match the Vercel-side auth shape, plus the workspace_id-less LCC_CRON_KEY
// fallback for local dev.
const SHARED_SECRET =
  Deno.env.get("LCC_API_KEY") ||
  Deno.env.get("LCC_CRON_KEY") ||
  "";

// Browser-shaped UA. Don't put "bot" or anything Cloudflare classifies
// as automation tooling. Same UA the gov-lease url_checker.py uses.
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

const FETCH_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  "Accept":
    "text/html,application/xhtml+xml,application/xml;q=0.9," +
    "image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
  "Upgrade-Insecure-Requests": "1",
};

const FETCH_TIMEOUT_MS = 20_000;
const DEFAULT_BATCH = 25;
const MAX_BATCH = 100;
const CONCURRENCY = 3;
const JITTER_MIN_MS = 2_000;
const JITTER_MAX_MS = 3_000;
const FAILURE_THRESHOLD = 3; // consecutive_check_failures >= 3 → mark off_market

// Parser host allowlist. CREXi, CoStar, LoopNet are the only sites we
// know how to read; anything else gets routed through the generic
// classifier but flagged as `manual_review_needed` if the result would
// otherwise be 'still_available' (a clean 200 from an arbitrary host
// is not a strong enough signal to advance the verification timer).
const KNOWN_HOSTS = ["crexi.com", "costar.com", "loopnet.com"];

// Tracking-wrapper / safelink hosts to skip outright. Resolving these
// just bounces us through Mimecast and produces meaningless 200s.
const SKIP_HOSTS = [
  "mimecastprotect.com",
  "safelinks.protection.outlook.com",
  "click.email",
  "tracking.",
  "t.co",
  "bit.ly",
  "lnkd.in",
];

// ── Types ───────────────────────────────────────────────────────────────────

interface DomainConfig {
  domain: "dia" | "gov";
  url: string;
  key: string;
  // `available_listings` columns differ between dia and gov.
  isActiveFilter: string;        // PostgREST filter for active rows
  excludeFilter: string;         // optional filter chunk (gov has exclude_from_listing_metrics)
  selectCols: string;            // columns to pull
  urlField: string;              // which row field has the listing URL
  // Field provenance target_table key for lcc_merge_field.
  provTargetTable: string;       // 'dia.available_listings' or 'gov.available_listings'
  // Which column the provenance row tracks. gov has a `url_status` text
  // column; dia doesn't (it flips `is_active` instead — see #710 cleanup
  // migration 20260511120000_field_source_priority_schema_drift_710_cleanup.sql).
  provFieldName: string;
}

interface ListingRow {
  listing_id: number | string;
  property_id: number | string | null;
  listing_date?: string | null;
  verification_due_at?: string | null;
  consecutive_check_failures?: number | null;
  // possible URL fields (dia: listing_url/url, gov: source_url/tracked_urls)
  listing_url?: string | null;
  url?: string | null;
  source_url?: string | null;
  tracked_urls?: unknown;
  url_status?: string | null;
}

interface FetchOutcome {
  ok: boolean;
  status: number;
  finalUrl: string;
  body: string;
  error?: string;
}

interface CheckSummary {
  scanned: number;
  off_market: number;
  off_market_sold_hint: number;
  still_available: number;
  unreachable: number;
  unreachable_promoted_to_off_market: number;
  manual_review_needed: number;
  skipped_no_url: number;
  errors: Array<Record<string, unknown>>;
}

// ── Auth ────────────────────────────────────────────────────────────────────

function authorize(req: Request): { ok: boolean; error?: string } {
  if (!SHARED_SECRET) {
    // Local dev fallback — function still works without auth, but we log it.
    return { ok: true };
  }
  const auth = req.headers.get("authorization") || "";
  const xkey = req.headers.get("x-lcc-key") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  if (bearer === SHARED_SECRET || xkey === SHARED_SECRET) return { ok: true };
  return { ok: false, error: "Invalid or missing API key" };
}

// ── Domain configs ──────────────────────────────────────────────────────────

function diaConfig(): DomainConfig | null {
  if (!DIA_URL || !DIA_KEY) return null;
  return {
    domain: "dia",
    url: DIA_URL,
    key: DIA_KEY,
    isActiveFilter: "is_active=eq.true",
    excludeFilter: "",
    selectCols:
      "listing_id,property_id,listing_date,verification_due_at," +
      "consecutive_check_failures,listing_url,url",
    urlField: "listing_url",
    provTargetTable: "dia.available_listings",
    // dia has no url_status column; provenance lands against the boolean
    // is_active column that lcc_record_listing_check actually flips.
    provFieldName: "is_active",
  };
}

function govConfig(): DomainConfig | null {
  if (!GOV_URL || !GOV_KEY) return null;
  return {
    domain: "gov",
    url: GOV_URL,
    key: GOV_KEY,
    isActiveFilter: "listing_status=eq.active",
    excludeFilter: "&exclude_from_listing_metrics=not.is.true",
    selectCols:
      "listing_id,property_id,listing_date,verification_due_at," +
      "consecutive_check_failures,source_url,tracked_urls,url_status",
    urlField: "source_url",
    provTargetTable: "gov.available_listings",
    provFieldName: "url_status",
  };
}

// ── URL extraction ──────────────────────────────────────────────────────────

function pickUrl(row: ListingRow, cfg: DomainConfig): string | null {
  if (cfg.domain === "dia") {
    return (
      (row.listing_url && String(row.listing_url).trim()) ||
      (row.url && String(row.url).trim()) ||
      null
    );
  }
  // gov: source_url first, then first tracked_url that's not a wrapper.
  const sourceUrl = row.source_url ? String(row.source_url).trim() : "";
  if (sourceUrl) return sourceUrl;
  const tracked = row.tracked_urls;
  if (Array.isArray(tracked)) {
    for (const t of tracked) {
      if (typeof t === "string" && t.trim()) return t.trim();
    }
  } else if (typeof tracked === "string") {
    try {
      const parsed = JSON.parse(tracked);
      if (Array.isArray(parsed)) {
        for (const t of parsed) {
          if (typeof t === "string" && t.trim()) return t.trim();
        }
      }
    } catch {
      // not JSON — fall through
    }
  }
  return null;
}

function shouldSkipHost(u: string): boolean {
  try {
    const host = new URL(u).host.toLowerCase();
    // Hostname-anchored match. The previous host.includes(s) form would
    // false-positive whenever a SKIP_HOSTS entry happened to appear as a
    // substring in an unrelated host — e.g. "t.co" matched "product.costar.com"
    // (the `t.co` formed by `producT.COstar`), which silently dropped every
    // CoStar-Suite URL the function ever saw.
    //
    // Entries ending with "." are label prefixes (e.g. "tracking." matches
    // tracking.foo.com but not retracking.com). Bare entries match either
    // the exact host or any subdomain.
    return SKIP_HOSTS.some((s) =>
      s.endsWith(".")
        ? host.startsWith(s)
        : host === s || host.endsWith("." + s)
    );
  } catch {
    return true;
  }
}

function isKnownHost(u: string): boolean {
  try {
    const host = new URL(u).host.toLowerCase();
    return KNOWN_HOSTS.some((s) => host === s || host.endsWith("." + s) || host.endsWith(s));
  } catch {
    return false;
  }
}

// ── Concurrency primitives ──────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function jitter(): number {
  return JITTER_MIN_MS + Math.floor(Math.random() * (JITTER_MAX_MS - JITTER_MIN_MS));
}

// Cap parallelism at N. We don't ship a real semaphore here — we just walk
// the input in chunks of N, which is simpler and matches the tiny batch
// sizes we run with. Each task in the chunk waits for a per-task jitter
// before launching its fetch, so the three concurrent requests don't all
// start the millisecond a chunk begins.
async function runWithConcurrency<T, R>(
  items: T[],
  worker: (item: T, idx: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function spin(): Promise<void> {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      // Per-task jitter — each launching task gets a 2-3s pause before
      // hitting the network. With 3 spinners that means at steady state
      // we're issuing ~1 request per second.
      await sleep(jitter());
      results[idx] = await worker(items[idx], idx);
    }
  }
  const spinners: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    spinners.push(spin());
  }
  await Promise.all(spinners);
  return results;
}

// ── HTTP helpers ────────────────────────────────────────────────────────────

async function fetchListingPage(url: string): Promise<FetchOutcome> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: FETCH_HEADERS,
      redirect: "follow",
      signal: ctrl.signal,
    });
    const body = await resp.text().catch(() => "");
    return {
      ok: true,
      status: resp.status,
      finalUrl: resp.url || url,
      body,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      finalUrl: url,
      body: "",
      error: (err as Error).message,
    };
  } finally {
    clearTimeout(t);
  }
}

async function pgGet<T = unknown>(
  baseUrl: string,
  apiKey: string,
  path: string,
): Promise<{ ok: boolean; status: number; data: T | null; raw: string }> {
  const resp = await fetch(`${baseUrl}/rest/v1/${path}`, {
    method: "GET",
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });
  const raw = await resp.text();
  let data: T | null = null;
  try {
    data = raw ? (JSON.parse(raw) as T) : null;
  } catch {
    data = null;
  }
  return { ok: resp.ok, status: resp.status, data, raw };
}

async function pgRpc(
  baseUrl: string,
  apiKey: string,
  fn: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; raw: string }> {
  const resp = await fetch(`${baseUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  });
  const raw = await resp.text();
  return { ok: resp.ok, status: resp.status, raw };
}

// ── Provenance write ────────────────────────────────────────────────────────
//
// Best-effort: a provenance write failing must not block the listing
// status update — we'd rather leave the audit trail incomplete than skip
// the actual url_status mutation. Errors are logged and surfaced in the
// per-listing diagnostics array.

// Round 76ej.h — once per domain at the end of a run, post the unreachable
// share to lcc_record_availability_botblock so a sudden bot-block storm
// surfaces in lcc_health_alerts. The RPC handles dedup and auto-resolve.
async function recordBotBlockHealth(
  domain: "dia" | "gov",
  scanned: number,
  unreachable: number,
): Promise<{ ok: boolean; action?: string; error?: string }> {
  if (!OPS_URL || !OPS_KEY) {
    return { ok: false, error: "ops project credentials not configured" };
  }
  if (scanned <= 0) {
    return { ok: true, action: "skipped_zero_scanned" };
  }
  const share = unreachable / scanned;
  try {
    const resp = await fetch(`${OPS_URL}/rest/v1/rpc/lcc_record_availability_botblock`, {
      method: "POST",
      headers: {
        apikey: OPS_KEY,
        Authorization: `Bearer ${OPS_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_domain: domain,
        p_scanned: scanned,
        p_unreachable: unreachable,
        p_unreachable_share: share,
      }),
    });
    if (!resp.ok) {
      const t = await resp.text();
      return { ok: false, error: `lcc_record_availability_botblock http ${resp.status}: ${t.slice(0, 200)}` };
    }
    let action: string | undefined;
    try {
      const body = await resp.json();
      action = body?.action || (Array.isArray(body) ? body[0]?.action : undefined);
    } catch {
      action = undefined;
    }
    return { ok: true, action };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

async function recordProvenance(
  cfg: DomainConfig,
  listingId: number | string,
  newStatus: string,
): Promise<{ ok: boolean; error?: string; skipped?: boolean }> {
  if (!OPS_URL || !OPS_KEY) {
    return { ok: false, error: "ops project credentials not configured" };
  }
  // dia tracks the URL-probe verdict on the boolean is_active column. The
  // RPC only flips is_active on definitive verdicts ('off_market' or
  // 'still_available'); 'unreachable' and 'manual_review' bump the failure
  // counter without touching is_active, so recording provenance against
  // is_active for those would be inaccurate. gov has a dedicated url_status
  // text column and records all four states.
  if (
    cfg.provFieldName === "is_active" &&
    newStatus !== "off_market" &&
    newStatus !== "live"
  ) {
    return { ok: true, skipped: true };
  }
  // PostgREST passes p_value through to the JSONB function argument as
  // its parsed JSON form — sending the bare string "off_market" turns
  // into '"off_market"'::jsonb in the helper, which is what
  // lcc_merge_field's value column stores.
  const body = {
    p_workspace_id: null,
    p_target_database: cfg.domain,
    p_target_table: cfg.provTargetTable,
    p_record_pk: String(listingId),
    p_field_name: cfg.provFieldName,
    // dia tracks is_active (boolean) — by the early-return above newStatus
    // is restricted to 'off_market' or 'live' here. gov keeps the text
    // enum on its url_status column.
    p_value: cfg.provFieldName === "is_active"
      ? newStatus !== "off_market"
      : newStatus,
    p_source: "availability_scraper",
    p_source_run_id: `availability-checker-${new Date().toISOString().slice(0, 10)}`,
    p_confidence: 0.7,
    p_recorded_by: null,
  };
  try {
    const resp = await fetch(`${OPS_URL}/rest/v1/rpc/lcc_merge_field`, {
      method: "POST",
      headers: {
        apikey: OPS_KEY,
        Authorization: `Bearer ${OPS_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const t = await resp.text();
      return { ok: false, error: `lcc_merge_field http ${resp.status}: ${t.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ── Listing-date correction (Round 68-A, Task 1) ─────────────────────────────
//
// When the page exposed a marketing-start marker (parsed.listed_on) that
// materially predates the stored listing_date, ask the domain DB to re-date the
// row WITH that receipt. dia only — gov listing_date has separate semantics and
// no correction RPC. Best-effort: a failure here never blocks the status write.
async function maybeCorrectListingDate(
  cfg: DomainConfig,
  row: ListingRow,
  parsed: ParseResult,
): Promise<{ attempted: boolean; action?: string; error?: string }> {
  if (cfg.domain !== "dia") return { attempted: false };
  const recovered = parsed.listed_on;
  if (!recovered) return { attempted: false };

  // Cheap client-side pre-filter so we don't bother the RPC on no-op cases;
  // the RPC re-checks the >30d rule authoritatively.
  if (row.listing_date) {
    const stored = Date.parse(row.listing_date);
    const found = Date.parse(recovered);
    if (Number.isFinite(stored) && Number.isFinite(found) &&
        found >= stored - 30 * 86_400_000) {
      return { attempted: false };
    }
  }

  const rpc = await pgRpc(cfg.url, cfg.key, "dia_record_listing_date_correction", {
    p_listing_id: Number(row.listing_id),
    p_new_date: recovered,
    p_source_url: pickUrl(row, cfg),
    p_marker: parsed.listed_on_marker ?? null,
  });
  if (!rpc.ok) {
    return { attempted: true, error: `rpc http ${rpc.status}: ${rpc.raw.slice(0, 160)}` };
  }
  let action: string | undefined;
  try {
    const parsedResp = JSON.parse(rpc.raw);
    action = parsedResp?.action || (Array.isArray(parsedResp) ? parsedResp[0]?.action : undefined);
  } catch {
    action = undefined;
  }
  // Record provenance for the listing_date field only when we actually moved it.
  if (action === "corrected" && OPS_URL && OPS_KEY) {
    try {
      await fetch(`${OPS_URL}/rest/v1/rpc/lcc_merge_field`, {
        method: "POST",
        headers: {
          apikey: OPS_KEY, Authorization: `Bearer ${OPS_KEY}`,
          "Content-Type": "application/json", Prefer: "return=minimal",
        },
        body: JSON.stringify({
          p_workspace_id: null,
          p_target_database: "dia",
          p_target_table: "dia.available_listings",
          p_record_pk: String(row.listing_id),
          p_field_name: "listing_date",
          p_value: recovered,
          p_source: "availability_scraper",
          p_source_run_id: `availability-checker-${new Date().toISOString().slice(0, 10)}`,
          p_confidence: 0.7,
          p_recorded_by: null,
        }),
      });
    } catch {
      // provenance is best-effort — the correction already landed.
    }
  }
  return { attempted: true, action };
}

// ── Per-listing pipeline ───────────────────────────────────────────────────

interface ListingDecision {
  listing_id: number | string;
  url: string | null;
  parser?: string;
  parse?: ParseResult;
  written?: {
    method: "lcc_record_listing_check";
    check_result: string;
    off_market_reason: string | null;
  };
  provenance?: { ok: boolean; error?: string };
  listing_date_correction?: { attempted: boolean; action?: string; error?: string };
  classification:
    | "off_market"
    | "off_market_sold_hint"
    | "still_available"
    | "unreachable"
    | "unreachable_promoted_to_off_market"
    | "manual_review_needed"
    | "skipped_no_url";
  notes: string;
  error?: string;
}

async function processListing(
  cfg: DomainConfig,
  row: ListingRow,
  dryRun: boolean,
): Promise<ListingDecision> {
  const url = pickUrl(row, cfg);
  if (!url) {
    return {
      listing_id: row.listing_id,
      url: null,
      classification: "skipped_no_url",
      notes: "no listing URL on row",
    };
  }
  if (shouldSkipHost(url)) {
    return {
      listing_id: row.listing_id,
      url,
      classification: "skipped_no_url",
      notes: `tracking-wrapper host skipped`,
    };
  }

  const fetchResult = await fetchListingPage(url);
  let parsed: ParseResult;
  if (!fetchResult.ok) {
    parsed = {
      outcome: "unreachable",
      http_status: 0,
      parser: "network",
      notes: `fetch error: ${fetchResult.error || "unknown"}`,
    };
  } else {
    parsed = parseListing(fetchResult.body, fetchResult.finalUrl, fetchResult.status);
  }

  // For unknown hosts, downgrade still_available verdicts to manual_review.
  // We don't trust a clean 200 from an arbitrary domain to attest that a
  // listing is still on the market — could be a broker-firm landing page
  // that exists regardless of inventory.
  if (parsed.outcome === "still_available" && !isKnownHost(fetchResult.finalUrl || url)) {
    parsed = {
      ...parsed,
      outcome: "manual_review_needed",
      notes: parsed.notes + " (host not in CREXi/CoStar/LoopNet allowlist)",
    };
  }

  // Decide what to call lcc_record_listing_check with.
  let checkResult: string;
  let offMarketReason: string | null = null;
  let promotedFromUnreachable = false;

  switch (parsed.outcome) {
    case "off_market":
      checkResult = "off_market";
      offMarketReason = parsed.reason ?? "withdrawn";
      break;
    case "off_market_sold_hint":
      // CRITICAL: we never write 'sold' here — that path is owned by the
      // sales_transactions watcher in api/admin.js. We instead record an
      // 'off_market' check tagged unverified_assumed_off so the SF /
      // research queue can prioritize evidence collection.
      checkResult = "off_market";
      offMarketReason = "unverified_assumed_off";
      break;
    case "still_available":
      checkResult = "still_available";
      break;
    case "unreachable": {
      // Only escalate to off_market once we've crossed the threshold.
      // We're about to make this call's failure the (current+1)th, so
      // compare current >= threshold-1.
      const current = Number(row.consecutive_check_failures ?? 0);
      if (current + 1 >= FAILURE_THRESHOLD) {
        checkResult = "off_market";
        offMarketReason = "unverified_assumed_off";
        promotedFromUnreachable = true;
      } else {
        checkResult = "unreachable";
      }
      break;
    }
    case "manual_review_needed":
    default:
      checkResult = "manual_review_needed";
      break;
  }

  const classification: ListingDecision["classification"] =
    promotedFromUnreachable
      ? "unreachable_promoted_to_off_market"
      : (parsed.outcome === "off_market" || parsed.outcome === "still_available" ||
         parsed.outcome === "off_market_sold_hint" || parsed.outcome === "unreachable" ||
         parsed.outcome === "manual_review_needed")
        ? parsed.outcome
        : "manual_review_needed";

  if (dryRun) {
    return {
      listing_id: row.listing_id,
      url,
      parser: parsed.parser,
      parse: parsed,
      classification,
      notes: parsed.notes,
    };
  }

  // Listing IDs cross between integer (dia) and uuid (gov). PostgREST
  // accepts both as JSON values; the helper signature picks the right
  // overload by domain.
  const listingIdParam: number | string =
    cfg.domain === "dia"
      ? Number(row.listing_id)
      : String(row.listing_id);

  const responseSummary = parsed.matched
    ? `${parsed.parser}: matched '${parsed.matched}' (http ${parsed.http_status})`
    : `${parsed.parser}: ${parsed.notes} (http ${parsed.http_status})`;

  const rpcResp = await pgRpc(cfg.url, cfg.key, "lcc_record_listing_check", {
    p_listing_id: listingIdParam,
    p_method: "auto_scrape",
    p_check_result: checkResult,
    p_source_url: url,
    p_http_status: parsed.http_status || null,
    p_response_summary: responseSummary,
    p_off_market_reason: offMarketReason,
    p_notes: `availability-checker (${parsed.parser})${promotedFromUnreachable ? " [promoted from unreachable on threshold]" : ""}`,
    p_verified_by: null,
  });
  if (!rpcResp.ok) {
    return {
      listing_id: row.listing_id,
      url,
      parser: parsed.parser,
      parse: parsed,
      classification,
      notes: parsed.notes,
      error: `lcc_record_listing_check http ${rpcResp.status}: ${rpcResp.raw.slice(0, 200)}`,
    };
  }

  // url_status mirrors what auto-scrape just wrote. For provenance we use
  // a small enumeration so consumers can join field_provenance back to a
  // human-readable status pill.
  const urlStatus =
    checkResult === "off_market" ? "off_market" :
    checkResult === "still_available" ? "live" :
    checkResult === "unreachable" ? "unreachable" :
    "manual_review";

  const prov = await recordProvenance(cfg, row.listing_id, urlStatus);

  // Round 68-A (Task 1): re-date with a page-marker receipt, if we found one.
  const listingDateCorrection = await maybeCorrectListingDate(cfg, row, parsed);

  return {
    listing_id: row.listing_id,
    url,
    parser: parsed.parser,
    parse: parsed,
    written: {
      method: "lcc_record_listing_check",
      check_result: checkResult,
      off_market_reason: offMarketReason,
    },
    provenance: prov,
    listing_date_correction: listingDateCorrection,
    classification,
    notes: parsed.notes,
  };
}

// ── Domain runner ──────────────────────────────────────────────────────────

async function runDomain(
  cfg: DomainConfig,
  limit: number,
  dryRun: boolean,
): Promise<{ summary: CheckSummary; decisions: ListingDecision[] }> {
  const summary: CheckSummary = {
    scanned: 0,
    off_market: 0,
    off_market_sold_hint: 0,
    still_available: 0,
    unreachable: 0,
    unreachable_promoted_to_off_market: 0,
    manual_review_needed: 0,
    skipped_no_url: 0,
    errors: [],
  };

  // Mirror handleAutoScrapeListings' overdue-or-null filter (Round 76cx).
  // Drop the max-age cutoff — this worker is the heavy path; if a listing
  // is months overdue we want to actually probe it, not skip it.
  const path =
    `available_listings?${cfg.isActiveFilter}` +
    cfg.excludeFilter +
    `&or=(verification_due_at.is.null,verification_due_at.lte.${encodeURIComponent(new Date().toISOString())})` +
    `&select=${cfg.selectCols}` +
    `&order=verification_due_at.asc.nullsfirst&limit=${limit}`;

  const list = await pgGet<ListingRow[]>(cfg.url, cfg.key, path);
  if (!list.ok) {
    summary.errors.push({
      stage: "list",
      status: list.status,
      detail: list.raw.slice(0, 400),
    });
    return { summary, decisions: [] };
  }
  const listings = Array.isArray(list.data) ? list.data : [];
  summary.scanned = listings.length;
  if (listings.length === 0) return { summary, decisions: [] };

  const decisions = await runWithConcurrency(
    listings,
    (row) => processListing(cfg, row, dryRun),
    CONCURRENCY,
  );

  for (const d of decisions) {
    switch (d.classification) {
      case "off_market": summary.off_market += 1; break;
      case "off_market_sold_hint": summary.off_market_sold_hint += 1; break;
      case "still_available": summary.still_available += 1; break;
      case "unreachable": summary.unreachable += 1; break;
      case "unreachable_promoted_to_off_market":
        summary.unreachable_promoted_to_off_market += 1;
        break;
      case "manual_review_needed": summary.manual_review_needed += 1; break;
      case "skipped_no_url": summary.skipped_no_url += 1; break;
    }
    if (d.error) {
      summary.errors.push({
        stage: "process",
        listing_id: d.listing_id,
        error: d.error,
      });
    }
  }

  return { summary, decisions };
}

// ── Single-URL debug endpoint ──────────────────────────────────────────────

async function handleDebugCheckUrl(req: Request): Promise<Response> {
  let target: string | null = null;
  try {
    const body = await req.json();
    target = body?.url || null;
  } catch {
    target = null;
  }
  if (!target) return errorResponse(req, "url required in JSON body", 400);
  if (shouldSkipHost(target)) {
    // Wrap the skip in the same envelope as a real parse so the acceptance
    // script (and any other caller) can categorize the result by
    // `parsed.outcome` rather than having to special-case a separate
    // `{ skipped: true }` shape.
    return jsonResponse(req, {
      requested: target,
      final_url: target,
      http_status: 0,
      parsed: {
        outcome: "skipped",
        http_status: 0,
        parser: "skip",
        notes: "host on SKIP_HOSTS list (tracking / shortener / known-paywall)",
      } as ParseResult,
    });
  }
  const fetched = await fetchListingPage(target);
  const parsed = fetched.ok
    ? parseListing(fetched.body, fetched.finalUrl, fetched.status)
    : { outcome: "unreachable", http_status: 0, parser: "network", notes: fetched.error || "fetch failed" } as ParseResult;
  return jsonResponse(req, {
    requested: target,
    final_url: fetched.finalUrl,
    http_status: fetched.status,
    parsed,
  });
}

// ── Main handler ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  if (action === "health") {
    return jsonResponse(req, {
      status: "ok",
      function: "availability-checker",
      dia_configured: !!(DIA_URL && DIA_KEY),
      gov_configured: !!(GOV_URL && GOV_KEY),
      ops_configured: !!(OPS_URL && OPS_KEY),
      concurrency: CONCURRENCY,
      jitter_ms: [JITTER_MIN_MS, JITTER_MAX_MS],
      failure_threshold: FAILURE_THRESHOLD,
      timestamp: new Date().toISOString(),
    });
  }

  const auth = authorize(req);
  if (!auth.ok) return errorResponse(req, auth.error || "unauthorized", 401);

  if (action === "check_url") {
    if (req.method !== "POST") return errorResponse(req, "POST only", 405);
    return handleDebugCheckUrl(req);
  }

  if (req.method !== "POST" && req.method !== "GET") {
    return errorResponse(req, "GET (dry-run) or POST only", 405);
  }

  let body: Record<string, unknown> = {};
  if (req.method === "POST") {
    try {
      body = await req.json();
    } catch {
      body = {};
    }
  }

  const domain = String(
    body.domain || url.searchParams.get("domain") || "both",
  ).toLowerCase();
  if (!["dia", "gov", "both"].includes(domain)) {
    return errorResponse(req, "domain must be dia, gov, or both", 400);
  }

  const limitRaw = Number(body.limit ?? url.searchParams.get("limit") ?? DEFAULT_BATCH);
  const limit = Math.min(MAX_BATCH, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : DEFAULT_BATCH));

  // Default: GET = dry-run, POST = apply. Allow either to flip via body.
  const dryRunDefault = req.method === "GET";
  const dryRun = body.dry_run !== undefined ? !!body.dry_run : dryRunDefault;

  const targets: DomainConfig[] = [];
  if (domain === "dia" || domain === "both") {
    const c = diaConfig();
    if (c) targets.push(c);
  }
  if (domain === "gov" || domain === "both") {
    const c = govConfig();
    if (c) targets.push(c);
  }

  if (targets.length === 0) {
    return errorResponse(
      req,
      "No domain targets configured. Set DIA_SUPABASE_URL/KEY and/or GOV_SUPABASE_URL/KEY.",
      503,
    );
  }

  const result: Record<string, unknown> = {
    mode: dryRun ? "dry_run" : "apply",
    domain,
    limit,
    by_domain: {} as Record<string, unknown>,
  };

  let totalDecisions: ListingDecision[] = [];
  for (const cfg of targets) {
    const { summary, decisions } = await runDomain(cfg, limit, dryRun);
    // Bot-block self-alert (Round 76ej.h). Skip on dry runs — we don't
    // want a smoke test to open or close real alerts.
    let bot_block: Record<string, unknown> | undefined;
    if (!dryRun) {
      // Count unreachable verdicts including the threshold-promoted
      // ones, since a promotion still represents a network failure for
      // the purposes of detecting a bot-block storm.
      const unreachableTotal =
        summary.unreachable + summary.unreachable_promoted_to_off_market;
      const health = await recordBotBlockHealth(
        cfg.domain,
        summary.scanned,
        unreachableTotal,
      );
      bot_block = {
        unreachable: unreachableTotal,
        unreachable_share: summary.scanned > 0
          ? unreachableTotal / summary.scanned
          : 0,
        ok: health.ok,
        action: health.action,
        error: health.error,
      };
    }
    (result.by_domain as Record<string, unknown>)[cfg.domain] = {
      ...summary,
      bot_block,
      decisions: decisions.map((d) => ({
        listing_id: d.listing_id,
        classification: d.classification,
        url: d.url,
        parser: d.parser,
        http_status: d.parse?.http_status,
        matched: d.parse?.matched,
        listed_on: d.parse?.listed_on,
        listing_date_correction: d.listing_date_correction,
        written: d.written,
        provenance_ok: d.provenance?.ok,
        provenance_error: d.provenance?.error,
        notes: d.notes,
        error: d.error,
      })),
    };
    totalDecisions = totalDecisions.concat(decisions);
  }

  // 207 if any per-listing errors, else 200.
  const totalErrs = totalDecisions.filter((d) => d.error).length;
  const status = totalErrs > 0 ? 207 : 200;
  return jsonResponse(req, result, status);
});
