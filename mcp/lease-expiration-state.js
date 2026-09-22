// mcp/lease-expiration-state.js
// ============================================================================
// RECON2-render — the ONE human-facing label for leases.expiration_state.
//
// RECON2 added dia `leases.expiration_state`. A lease past its own
// `lease_expiration` with no evidence that it renewed sits at
// 'expired_unconfirmed' while `is_active` stays TRUE by design (is_active is
// never flipped on inference alone). Without a label that lease renders as an
// ordinary "Active" lease. This helper produces the one honest label every
// reader shows for that state, and NOTHING for every other state, so the
// normal-case output of each reader is unchanged.
//
// Lives in mcp/ (not api/_shared/) because the MCP server image copies only
// mcp/, and api/ already imports from ../../mcp/ (subject-resolver, comps-tools).
// One implementation, so the four readers cannot drift apart.
//
// ⚠️ `expiration_state` exists on dia `leases` ONLY. gov `leases` has no such
// column (verified live 2026-09-22), so a reader must never add it to an
// explicit gov `select=` list — PostgREST would 400 the whole query.
// ============================================================================

export const EXPIRED_UNCONFIRMED = 'expired_unconfirmed';

/**
 * @param {{expiration_state?: string|null, lease_expiration?: string|null}|null|undefined} lease
 * @returns {string|null} the label, or null when the state is anything other
 *   than 'expired_unconfirmed' (callers add nothing in that case).
 */
export function leaseExpirationStateLabel(lease) {
  if (!lease || lease.expiration_state !== EXPIRED_UNCONFIRMED) return null;
  const date = lease.lease_expiration ? String(lease.lease_expiration).slice(0, 10) : null;
  return date
    ? `Expired ${date} — renewal not on file (unconfirmed)`
    : 'Expired — renewal not on file (unconfirmed)';
}
