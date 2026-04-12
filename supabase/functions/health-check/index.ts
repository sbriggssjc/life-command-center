// ============================================================================
// Health Check — Edge Function infrastructure validation
// Life Command Center — Infrastructure Migration Phase 0
//
// Verifies connectivity to all three Supabase databases and reports status.
// Called to validate the Edge Function deployment before any migration begins.
//
// GET /functions/v1/health-check
// ============================================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { opsQuery, pgFilterVal } from "../_shared/supabase-client.ts";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

interface SourceStatus {
  name: string;
  status: "connected" | "error" | "not_configured";
  latency_ms: number | null;
  error?: string;
}

async function checkSource(
  name: string,
  urlEnv: string,
  keyEnv: string,
  testTable: string
): Promise<SourceStatus> {
  const url = Deno.env.get(urlEnv);
  const key = Deno.env.get(keyEnv);

  if (!url || !key) {
    return { name, status: "not_configured", latency_ms: null };
  }

  const start = Date.now();
  try {
    const res = await fetch(`${url}/rest/v1/${testTable}?limit=1`, {
      headers: {
        "apikey": key,
        "Authorization": `Bearer ${key}`,
      },
      signal: AbortSignal.timeout(5000),
    });

    const latency = Date.now() - start;

    if (res.ok) {
      return { name, status: "connected", latency_ms: latency };
    } else {
      const text = await res.text().catch(() => "");
      return { name, status: "error", latency_ms: latency, error: `HTTP ${res.status}: ${text.slice(0, 100)}` };
    }
  } catch (err) {
    return {
      name,
      status: "error",
      latency_ms: Date.now() - start,
      error: (err as Error).message,
    };
  }
}

serve(async (req: Request) => {
  // CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "GET") {
    return errorResponse(req, "GET only", 405);
  }

  const startMs = Date.now();

  // Check all three databases in parallel
  const [ops, gov, dia] = await Promise.all([
    checkSource("ops_db", "OPS_SUPABASE_URL", "OPS_SUPABASE_SERVICE_KEY", "users"),
    checkSource("gov_db", "GOV_SUPABASE_URL", "GOV_SUPABASE_KEY", "properties"),
    checkSource("dia_db", "DIA_SUPABASE_URL", "DIA_SUPABASE_KEY", "properties"),
  ]);

  const sources = [ops, gov, dia];
  const allConnected = sources.every(s => s.status === "connected");
  const anyError = sources.some(s => s.status === "error");

  // Check if critical tables exist in OPS
  let contextPacketsExists = false;
  let signalsExists = false;
  if (ops.status === "connected") {
    try {
      const [packetsRes, signalsRes] = await Promise.all([
        opsQuery("GET", "context_packets?limit=0"),
        opsQuery("GET", "signals?limit=0"),
      ]);
      contextPacketsExists = packetsRes.ok;
      signalsExists = signalsRes.ok;
    } catch {
      // Tables might not exist yet
    }
  }

  const overallStatus = allConnected ? "healthy" : anyError ? "degraded" : "unavailable";

  return jsonResponse(req, {
    status: overallStatus,
    service: "lcc-edge-functions",
    version: "0.1.0",
    timestamp: new Date().toISOString(),
    total_latency_ms: Date.now() - startMs,
    sources: Object.fromEntries(sources.map(s => [s.name, {
      status: s.status,
      latency_ms: s.latency_ms,
      ...(s.error ? { error: s.error } : {}),
    }])),
    tables: {
      context_packets: contextPacketsExists ? "exists" : "missing",
      signals: signalsExists ? "exists" : "missing",
    },
    environment: {
      ops_configured: !!Deno.env.get("OPS_SUPABASE_URL"),
      gov_configured: !!Deno.env.get("GOV_SUPABASE_URL"),
      dia_configured: !!Deno.env.get("DIA_SUPABASE_URL"),
      pa_webhook_secret_set: !!Deno.env.get("PA_WEBHOOK_SECRET"),
      vercel_frontend_url: Deno.env.get("VERCEL_FRONTEND_URL") || "(default)",
    },
  });
});
