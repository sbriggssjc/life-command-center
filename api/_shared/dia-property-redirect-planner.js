// ============================================================================
// PDR14b — dia dangling property_id self-heal planner
// Life Command Center
//
// entities.metadata.domain_property_id is a one-way pointer into dia's
// `properties` table, set once and never revisited. When dia merges/drops a
// property row (dia_merge_property / dia_merge_property_reversible /
// P31/consolidation paths — see PDR14a), LCC never finds out, and every
// context assembler that reads it (get_property_context /
// assemblePropertyPacket) silently returns empty documents/transactions/
// ownership for an entity that has real history under a different property_id.
//
// domain='dia' ONLY. Never touches domain='gov' — see PDR14-GOV
// (docs/os/PLANNED-BACKLOG.md §P17): a small, closed, fully-explained gap on
// the gov side via a mechanism (gov_property_dup_retire_log) structurally
// immune to this bug class, out of scope for this planner.
//
// Resolution order, each step confident-or-nothing (never guess):
//   1. PDR14a's `dia_resolve_property_id(bigint)` — the canonical redirect
//      table (dia_property_redirects), built from a census of every dia
//      merge ledger. Called via domainQuery('dialysis', ...) — the direct
//      service-key path. NEVER via diaQuery/data-query (anon-keyed, the RPC
//      is service_role-only and will 403).
//   2. A PDR13-style strong-id fallback: an UNAMBIGUOUS exact match of the
//      entity's own captured `metadata.parcel_number` (a single, unsplit
//      token, length >= 6 — mirrors dia_find_property_twins_strong_id's
//      p_min_parcel_len default) against the LIVE dia properties.parcel_number.
//      Reuses PDR13's approach (parcel_number / effective medicare_id,
//      exact match, single-candidate-only) rather than inventing a new
//      scoring scheme. A multi-candidate or sub-threshold match resolves
//      NOTHING — it is flagged instead (step 3).
//   3. No confident match: flagged into lcc_dia_property_link_review for
//      human review. Never guessed, never auto-repointed on a fuzzy signal.
//
// Fill-blanks / reversible / provenance-tagged / idempotent / dry-run-able,
// per this repo's data-write discipline (CLAUDE.md "Data-write discipline").
// A correction NEVER overwrites an entity whose domain_property_id already
// resolves live — that branch is never reached because callers only ever
// pass already-dangling candidates (see planDiaPropertyRedirectSweep).
// ============================================================================

/** Minimum parcel_number length to attempt a fallback match — mirrors
 *  dia_find_property_twins_strong_id(p_min_parcel_len integer DEFAULT 6). A
 *  shorter token (e.g. "14") is not a strong id and is refused, never guessed. */
export const MIN_PARCEL_LEN = 6;

/**
 * Is a raw metadata.parcel_number value usable as a single strong-id token?
 * PDR13's own population is comma-joined multi-parcel captures on purpose
 * (one physical building, several tax parcels) — those are NOT attempted
 * here; matching a compound string against a single properties.parcel_number
 * column would either never match or match the wrong row. Only a single,
 * unsplit token of sufficient length is a candidate.
 */
export function usableParcelToken(rawParcel) {
  if (rawParcel == null) return null;
  const trimmed = String(rawParcel).trim();
  if (!trimmed) return null;
  if (trimmed.includes(',')) return null; // compound capture — not a single strong id
  if (trimmed.length < MIN_PARCEL_LEN) return null;
  return trimmed;
}

/**
 * Given the anti-join membership probe result (candidate pid -> exists in
 * dia.properties?), split a distinct pid list into live / dangling.
 */
export function splitLiveDangling(pidExistsRows) {
  const live = [];
  const dangling = [];
  for (const row of pidExistsRows) {
    (row.exists ? live : dangling).push(row.pid);
  }
  return { live, dangling };
}

/**
 * Resolve one dangling entity's candidates given:
 *  - redirectResolved: dia_resolve_property_id(dead_pid) result, or null/undefined
 *  - parcelMatch: { n_match, candidate_pid } from the exact-parcel probe, or null
 *    when no usable parcel token existed for this entity.
 *
 * Returns { via: 'redirect'|'parcel_match'|null, resolved: <pid>|null }.
 * NEVER returns a resolution when the parcel probe is ambiguous (n_match !== 1)
 * or the redirect table has no answer — those cases fall through to `null`,
 * which callers must route to the review queue, not apply.
 */
export function resolveDanglingEntity({ redirectResolved, parcelMatch }) {
  if (redirectResolved != null) {
    return { via: 'pdr14b_redirect', resolved: redirectResolved };
  }
  if (parcelMatch && Number(parcelMatch.n_match) === 1 && parcelMatch.candidate_pid != null) {
    return { via: 'pdr14b_parcel_match', resolved: parcelMatch.candidate_pid };
  }
  return { via: null, resolved: null };
}

/**
 * Build the full sweep plan from raw inputs (pure — no I/O), so the tick
 * handler and the tests can share one code path.
 *
 * @param {Array<{id:string, dead_pid:string, redirectResolved:(number|string|null), parcelMatch:(object|null)}>} entities
 * @returns {{ toApply: Array, toFlag: Array, resolved_via_redirect: number, resolved_via_parcel: number, flagged: number }}
 */
export function planDiaPropertyRedirectSweep(entities) {
  const toApply = [];
  const toFlag = [];
  let resolved_via_redirect = 0;
  let resolved_via_parcel = 0;
  for (const e of entities) {
    const { via, resolved } = resolveDanglingEntity({
      redirectResolved: e.redirectResolved,
      parcelMatch: e.parcelMatch,
    });
    if (via && resolved != null) {
      toApply.push({ entity_id: e.id, dead_pid: e.dead_pid, resolved: String(resolved), via });
      if (via === 'pdr14b_redirect') resolved_via_redirect += 1;
      else resolved_via_parcel += 1;
    } else {
      toFlag.push({ entity_id: e.id, dead_pid: e.dead_pid, reason: 'no_confident_match' });
    }
  }
  return {
    toApply,
    toFlag,
    resolved_via_redirect,
    resolved_via_parcel,
    flagged: toFlag.length,
  };
}
