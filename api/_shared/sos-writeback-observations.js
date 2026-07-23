// ============================================================================
// ORE Option B / Option A wire — shape the SOS-sidebar capture's owner addresses
// into append-only observation rows for the LCC Opps store.
//
// The compliant human-in-the-loop SOS capture (extension/content/public-records.js
// → POST /api/sos-writeback) already writes the curated recorded_owners row. This
// pure helper turns the SAME capture's address surfaces into DISTINCT, source-
// tagged observations so the Build-2 multi-signal reconcile engine + the Option-A
// address dimension see them — reusing the exact recorder RPC
// (lcc_record_owner_address_observation) that the CoStar capture path uses.
//
// Doctrine (Scott, 2026-07-22): "Grab and store ALL different addresses and
// reconcile later." NEVER collapse — a principal address and a registered-agent
// address are two DIFFERENT owner-side addresses and each becomes its own row
// (the RPC dedupes on (owner, addr_norm, surface), so a repeat is a no-op). A
// situs/property address is never emitted here (an SOS filing carries none).
//
// Pure + dependency-free so it is trivially unit-tested; the writeback handler
// maps each returned {address, kind} onto the RPC args with a fixed
// source_surface='sos_sidebar'.
// ============================================================================

// The SOS scanner (public-records.js scanSOS) emits: principal_address (the
// entity's business/principal office), agent_address (the registered agent's
// office), and — on the assessor fallback — mailing_address. Each is an
// owner-side address (matchable), never a situs.
const SOS_ADDRESS_FIELDS = [
  { field: 'principal_address', kind: 'principal' },
  { field: 'agent_address',     kind: 'registered_agent' },
  { field: 'mailing_address',   kind: 'mailing' },
];

/**
 * buildSosAddressObservations(capture) → [{ address, kind }]
 * One entry per non-empty owner-side address in the SOS capture, de-duplicated
 * within-kind (the RPC handles cross-surface dedup). Never fabricates: an absent
 * field yields nothing.
 */
export function buildSosAddressObservations(capture) {
  const cap = capture || {};
  const out = [];
  for (const { field, kind } of SOS_ADDRESS_FIELDS) {
    const raw = cap[field];
    const addr = (typeof raw === 'string' ? raw.trim() : '');
    if (!addr) continue;
    // within-kind dedup (defensive — the same field can't repeat, but a caller
    // could pass a merged capture)
    if (out.some((o) => o.kind === kind && o.address.toLowerCase() === addr.toLowerCase())) continue;
    out.push({ address: addr, kind });
  }
  return out;
}

export const SOS_OBSERVATION_SURFACE = 'sos_sidebar';
