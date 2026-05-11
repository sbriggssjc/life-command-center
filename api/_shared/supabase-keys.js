// ============================================================================
// Domain Supabase key resolution (GitHub issue #720)
//
// The DIA_SUPABASE_KEY / GOV_SUPABASE_KEY env vars on Vercel + Railway have
// historically held the **anon** JWTs for the dialysis and government
// Supabase projects, despite the names suggesting otherwise. Trusted server-
// side code (this Node backend, scheduled cron workers, scripts) needs the
// service_role JWT so a future mass-revoke of anon grants doesn't break it.
//
// This module is the single place that defines the precedence: prefer the
// new *_SUPABASE_SERVICE_KEY env var, fall back to the existing
// *_SUPABASE_KEY for backwards compatibility while the new var is rolled
// out. Once DIA_SUPABASE_SERVICE_KEY / GOV_SUPABASE_SERVICE_KEY are set on
// every environment the codebase will start routing through service_role
// automatically; the fallback can be removed in a follow-up.
//
// See the issue for the full migration plan + Phase 4 mass-revoke timeline.
// ============================================================================

/**
 * Resolve the dialysis Supabase JWT for trusted server-side calls.
 * Prefers DIA_SUPABASE_SERVICE_KEY, falls back to DIA_SUPABASE_KEY.
 * @returns {string | undefined}
 */
export function diaSupabaseKey() {
  return process.env.DIA_SUPABASE_SERVICE_KEY || process.env.DIA_SUPABASE_KEY;
}

/**
 * Resolve the government Supabase JWT for trusted server-side calls.
 * Prefers GOV_SUPABASE_SERVICE_KEY, falls back to GOV_SUPABASE_KEY.
 * @returns {string | undefined}
 */
export function govSupabaseKey() {
  return process.env.GOV_SUPABASE_SERVICE_KEY || process.env.GOV_SUPABASE_KEY;
}

/**
 * Resolve a domain Supabase JWT by symbolic domain name.
 * @param {'dia'|'dialysis'|'gov'|'government'} domain
 * @returns {string | undefined}
 */
export function domainSupabaseKey(domain) {
  if (domain === 'dia' || domain === 'dialysis') return diaSupabaseKey();
  if (domain === 'gov' || domain === 'government') return govSupabaseKey();
  return undefined;
}
