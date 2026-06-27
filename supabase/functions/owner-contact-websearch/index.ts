// ============================================================================
// owner-contact-websearch — free-tier web-search proxy for owner enrichment
// Life Command Center — Supabase Edge Function (2026-06-27)
//
// WHY THIS EXISTS:
// The owner-contact-enrich worker's web-search adapter
// (api/_shared/web-search-enrich.js::buildWebSearchAdapter) is the worker's
// CATCH-ALL enrichment step (step 5 — after the routed sos/address/deed
// adapters). It does deterministic, role-cue-anchored, human-name-guarded
// principal extraction over a normalized search-result list — but its actual
// search() fetcher was deferred behind OWNER_ENRICH_WEBSEARCH_URL. This thin
// proxy IS that fetcher: it runs a free-tier web search and returns the
// [{title,snippet,url}] list the parser expects. It does NOT parse names / call
// an LLM — the LCC parser does the labeled-role extraction + guards. NOT a new
// api/*.js (≤12 holds).
//
// CONTRACT (what webhookFetcher sends / the adapter expects back):
//   POST /functions/v1/owner-contact-websearch?key=<secret>
//     body: { args: [ "<query string>", <row object> ] }
//     →    [ { title, snippet, url }, … ]   (a BARE array; top ~10)
//   GET  /functions/v1/owner-contact-websearch  → { ok, ready, configured } (health, no spend)
//
// The adapter feeds the returned list straight into extractPrincipalCandidates;
// a confident labeled hit ⇒ the worker attaches a guard-checked contact, else
// the owner falls to the manual worklist. So provider error / rate-limit /
// empty ⇒ we return [] (200), never throw into the worker.
//
// AUTH: webhookFetcher sends NO auth header (content-type only), so the shared
// secret rides in the configured URL's ?key=<secret>. Set
// OWNER_ENRICH_WEBSEARCH_URL=…/owner-contact-websearch?key=<secret> on Railway
// and OWNER_ENRICH_WEBSEARCH_SECRET here. Deploy --no-verify-jwt. When no secret
// env is set the function runs transitional (allow + warn), same posture as the
// rest of the edge layer (docai-ocr).
//
// PROVIDER (free-tier first — Scott's free-over-paid preference): Brave Search
// API (free ~2,000 q/mo) by default; Serper.dev as an alternative. The 357
// high-value owners + retries fit the free tier.
// ============================================================================

import { normalizeProviderResults, DEFAULT_MAX_RESULTS } from "./normalize.js";

// ── Env ─────────────────────────────────────────────────────────────────────
const PROVIDER = (Deno.env.get("WEBSEARCH_PROVIDER") || "brave").toLowerCase();
const BRAVE_KEY = Deno.env.get("BRAVE_SEARCH_API_KEY") || "";
const SERPER_KEY = Deno.env.get("SERPER_API_KEY") || "";
const SHARED_SECRET =
  Deno.env.get("OWNER_ENRICH_WEBSEARCH_SECRET") ||
  Deno.env.get("OWNER_ENRICH_WEBSEARCH_KEY") ||
  Deno.env.get("LCC_API_KEY") ||
  "";
const MAX_RESULTS = Number(Deno.env.get("WEBSEARCH_MAX_RESULTS") || DEFAULT_MAX_RESULTS);
const TIMEOUT_MS = Number(Deno.env.get("WEBSEARCH_TIMEOUT_MS") || 8000);
const SEARCH_COUNTRY = Deno.env.get("WEBSEARCH_COUNTRY") || "us";

function providerKey(): string {
  return PROVIDER === "serper" ? SERPER_KEY : BRAVE_KEY;
}
function isConfigured(): boolean {
  return !!providerKey();
}

// ── Auth (shared secret in ?key= — webhookFetcher sends no header) ───────────
function authorized(url: URL): boolean {
  if (!SHARED_SECRET) {
    console.warn("[owner-contact-websearch] no OWNER_ENRICH_WEBSEARCH_SECRET/LCC_API_KEY set — running transitional (open)");
    return true;
  }
  const key = url.searchParams.get("key") || "";
  return constantEq(key, SHARED_SECRET);
}
function constantEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let m = 0;
  for (let i = 0; i < a.length; i++) m |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return m === 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ── Provider search (returns raw provider JSON, or null on any failure) ──────
async function fetchWithTimeout(input: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function searchBrave(query: string): Promise<unknown | null> {
  const u = new URL("https://api.search.brave.com/res/v1/web/search");
  u.searchParams.set("q", query);
  u.searchParams.set("count", String(Math.min(MAX_RESULTS, 20)));
  u.searchParams.set("country", SEARCH_COUNTRY);
  let resp: Response;
  try {
    resp = await fetchWithTimeout(u.toString(), {
      method: "GET",
      headers: { "Accept": "application/json", "X-Subscription-Token": BRAVE_KEY },
    });
  } catch (err) {
    console.error("[owner-contact-websearch] brave fetch threw:", (err as Error)?.message);
    return null;
  }
  if (!resp.ok) {
    console.error(`[owner-contact-websearch] brave ${resp.status}`);
    return null;
  }
  try { return await resp.json(); } catch { return null; }
}

async function searchSerper(query: string): Promise<unknown | null> {
  let resp: Response;
  try {
    resp = await fetchWithTimeout("https://google.serper.dev/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": SERPER_KEY },
      body: JSON.stringify({ q: query, num: Math.min(MAX_RESULTS, 20), gl: SEARCH_COUNTRY }),
    });
  } catch (err) {
    console.error("[owner-contact-websearch] serper fetch threw:", (err as Error)?.message);
    return null;
  }
  if (!resp.ok) {
    console.error(`[owner-contact-websearch] serper ${resp.status}`);
    return null;
  }
  try { return await resp.json(); } catch { return null; }
}

async function runSearch(query: string): Promise<unknown | null> {
  return PROVIDER === "serper" ? searchSerper(query) : searchBrave(query);
}

// ── Handler ──────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    // Health probe — no provider call, no spend.
    return json({
      ok: true,
      service: "owner-contact-websearch",
      provider: PROVIDER,
      ready: isConfigured(),
      configured: isConfigured(),
    });
  }
  if (req.method !== "POST") return json({ ok: false, reason: "method_not_allowed" }, 405);
  // Auth failure is a misconfiguration (visible) — webhookFetcher throws on a
  // non-2xx, surfacing it as `search_error` rather than silently empty.
  if (!authorized(url)) return json({ ok: false, reason: "unauthorized" }, 401);

  // Unconfigured / provider error / empty all degrade to [] (the adapter then
  // returns no_confident_match → the owner falls to the manual worklist).
  if (!isConfigured()) {
    console.warn("[owner-contact-websearch] no provider API key — returning []");
    return json([]);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json([]); }

  const args = Array.isArray(body?.args) ? body.args : [];
  const query = typeof args[0] === "string" ? (args[0] as string).trim() : "";
  if (!query) return json([]);

  const raw = await runSearch(query);
  if (raw === null) return json([]);   // provider error / rate-limit / non-JSON

  const results = normalizeProviderResults(PROVIDER, raw, MAX_RESULTS);
  return json(results);
});
