// ============================================================================
// CORS — Cross-Origin Resource Sharing headers for Edge Functions
// Life Command Center — Infrastructure Migration Phase 0
//
// The frontend is served from Vercel (different origin than Supabase Edge).
// These headers allow browser requests to reach Edge Functions.
// ============================================================================

const VERCEL_URL = Deno.env.get("VERCEL_FRONTEND_URL") || "https://life-command-center.vercel.app";

const ALLOWED_ORIGINS: string[] = [
  VERCEL_URL,
  "http://localhost:3000",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
];

/**
 * Build CORS response headers for a given request.
 * Returns the requesting origin if it's in the allowlist,
 * otherwise falls back to the Vercel production URL.
 */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : VERCEL_URL;
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-LCC-Workspace, X-LCC-Key, X-PA-Webhook-Secret, X-LCC-User-Id, X-LCC-User-Email",
    "Access-Control-Max-Age": "86400",
  };
}

/**
 * Handle CORS preflight (OPTIONS) requests.
 * Returns a 204 response if the request is OPTIONS, null otherwise.
 *
 * Usage:
 *   const corsResponse = handleCors(req);
 *   if (corsResponse) return corsResponse;
 */
export function handleCors(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  return null;
}

/**
 * Create a JSON response with CORS headers.
 */
export function jsonResponse(
  req: Request,
  body: unknown,
  status = 200
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/json",
    },
  });
}

/**
 * Create an error response with CORS headers.
 */
export function errorResponse(
  req: Request,
  message: string,
  status = 400
): Response {
  return jsonResponse(req, { error: message }, status);
}
