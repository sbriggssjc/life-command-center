// ============================================================================
// Supabase Client — Shared database clients for Edge Functions
// Life Command Center — Infrastructure Migration Phase 0
//
// Provides typed clients for all three Supabase instances.
// Uses service-role keys for server-side access.
// ============================================================================

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── OPS Database (primary) ──────────────────────────────────────────────────

let _opsClient: SupabaseClient | null = null;

export function opsClient(): SupabaseClient {
  if (!_opsClient) {
    const url = Deno.env.get("OPS_SUPABASE_URL");
    const key = Deno.env.get("OPS_SUPABASE_SERVICE_KEY");
    if (!url || !key) throw new Error("OPS_SUPABASE_URL and OPS_SUPABASE_SERVICE_KEY are required");
    _opsClient = createClient(url, key);
  }
  return _opsClient;
}

// ── Gov Database ────────────────────────────────────────────────────────────

let _govClient: SupabaseClient | null = null;

export function govClient(): SupabaseClient {
  if (!_govClient) {
    const url = Deno.env.get("GOV_SUPABASE_URL");
    const key = Deno.env.get("GOV_SUPABASE_KEY");
    if (!url || !key) throw new Error("GOV_SUPABASE_URL and GOV_SUPABASE_KEY are required");
    _govClient = createClient(url, key);
  }
  return _govClient;
}

// ── Dia Database ────────────────────────────────────────────────────────────

let _diaClient: SupabaseClient | null = null;

export function diaClient(): SupabaseClient {
  if (!_diaClient) {
    const url = Deno.env.get("DIA_SUPABASE_URL");
    const key = Deno.env.get("DIA_SUPABASE_KEY");
    if (!url || !key) throw new Error("DIA_SUPABASE_URL and DIA_SUPABASE_KEY are required");
    _diaClient = createClient(url, key);
  }
  return _diaClient;
}

// ── Raw PostgREST query (mirrors api/_shared/ops-db.js opsQuery pattern) ──

export interface QueryResult {
  ok: boolean;
  status: number;
  data: any;
  count: number;
}

/**
 * Execute a raw PostgREST query against any Supabase instance.
 * Mirrors the opsQuery() pattern from api/_shared/ops-db.js for code portability.
 *
 * Use this when porting code that uses opsQuery('GET', 'table?filter=...') directly.
 * For new code, prefer the typed Supabase client methods.
 */
export async function rawQuery(
  baseUrl: string,
  apiKey: string,
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<QueryResult> {
  const url = `${baseUrl}/rest/v1/${path}`;
  const headers: Record<string, string> = {
    "apikey": apiKey,
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "Prefer": method === "GET" ? "count=exact" : "return=representation",
  };

  const opts: RequestInit = { method, headers };
  if (body && (method === "POST" || method === "PATCH")) {
    opts.body = JSON.stringify(body);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    const text = await res.text();

    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }

    let count = 0;
    const contentRange = res.headers.get("content-range");
    if (contentRange) {
      const match = contentRange.match(/\/(\d+)/);
      if (match) count = parseInt(match[1], 10);
    }

    return { ok: res.ok, status: res.status, data, count };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Shorthand for OPS database raw queries.
 * Direct equivalent of opsQuery() from api/_shared/ops-db.js.
 */
export function opsQuery(
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<QueryResult> {
  const url = Deno.env.get("OPS_SUPABASE_URL");
  const key = Deno.env.get("OPS_SUPABASE_SERVICE_KEY");
  if (!url || !key) {
    return Promise.resolve({ ok: false, status: 503, data: { error: "OPS database not configured" }, count: 0 });
  }
  return rawQuery(url, key, method, path, body);
}

/** Encode a value for PostgREST filter strings (mirrors pgFilterVal) */
export function pgFilterVal(v: string | number): string {
  return encodeURIComponent(String(v));
}
