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

// ============================================================================
// "Not registered in <state>" disposition — the two-jurisdiction outcome.
//
// When the operator searches an owner's SOS and finds it is NOT registered in
// the searched state, that is a real signal (e.g. "Wiener Properties Inc" is not
// in CA — the CA hits were a suspended family LLC / a Minnesota out-of-state
// LLC). The doctrine (Scott, 2026-07-22): an owner LLC is searched in its
// FILING/formation state AND the state where its property sits. A miss in one
// state does NOT close the owner — it stays workable under its other candidate
// state until BOTH are exhausted; only then is it handed back for further
// processing (status='no_match', the DB's "searched, none found" signal).
//
// Pure so it is trivially unit-tested; the writeback handler maps the result
// onto the enrichment_payload trail + the status transition.
// ============================================================================

function normUpper(s) {
  return (typeof s === 'string' && s.trim()) ? s.trim().toUpperCase() : null;
}

/**
 * computeSosNotFoundDisposition({ filingState, assetState, searchedState, priorNotFound })
 *   → { notFoundStates, remaining, exhausted, searched }
 *
 * - notFoundStates: the append-only, deduped trail of { state, at } the owner
 *   has now been searched-and-missed in (prior + the new one).
 * - remaining: the candidate states still open to search (the owner is still
 *   workable there).
 * - exhausted: true when there is no OTHER candidate state left — every derivable
 *   candidate is now not-found, OR the owner is stateless (a single stateless
 *   miss resolves it). When exhausted the owner is handed back (no_match).
 * - searched: the normalized state code the operator actually searched (or null
 *   for a stateless search).
 *
 * Candidate states = the owner's derivable filing + asset states, PLUS the state
 * the operator actually searched (a deliberate human signal). `priorNotFound` is
 * the existing enrichment_payload.not_found_states array (each { state, at }).
 * Never fabricates — an absent state contributes nothing.
 */
export function computeSosNotFoundDisposition({ filingState, assetState, searchedState, priorNotFound, at } = {}) {
  const searched = normUpper(searchedState);
  const nowIso = at || null;

  // Build the append-only not-found trail (prior + new), deduped by state.
  const prior = Array.isArray(priorNotFound) ? priorNotFound.slice() : [];
  const nfSet = new Set(prior.map((x) => normUpper(x && x.state)).filter(Boolean));
  const notFoundStates = prior;
  if (searched) {
    if (!nfSet.has(searched)) {
      notFoundStates.push({ state: searched, at: nowIso });
      nfSet.add(searched);
    }
  } else {
    // A stateless search still records that the operator looked and missed.
    notFoundStates.push({ state: '(unspecified)', at: nowIso });
  }

  // Candidate states the owner could be registered in.
  const candidates = new Set([normUpper(filingState), normUpper(assetState)].filter(Boolean));
  if (searched) candidates.add(searched);

  const remaining = Array.from(candidates).filter((s) => !nfSet.has(s));
  const exhausted = candidates.size === 0 ? true : remaining.length === 0;

  return { notFoundStates, remaining, exhausted, searched };
}
