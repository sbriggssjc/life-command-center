// ============================================================================
// resolver-client — thin client for the Railway entity-resolution service (W4.4)
//
// The resolver (resolver/ FastAPI on Railway) SCORES entity pairs; it never
// writes. This client calls POST /match (owner_owner model) to get a calibrated
// name-similarity band for a single owner-name pair. Used by the ORE reconcile
// engine as the name-match signal that GATES an auto-merge.
//
// FAIL-CLOSED CONTRACT: any unset URL / unreachable / timeout / non-2xx returns
// { ok:false }. The caller MUST treat { ok:false } (and any non-'auto_link' band)
// as "do NOT auto-merge" — cap the outcome at needs_review. The service being
// down can never turn into a merge.
//
// Config:
//   RESOLVER_URL      — the Railway resolver base URL (unset → this client no-ops).
//   ORE_USE_RESOLVER  — '1'/'true' turns the ORE gate on (revert without redeploy).
// ============================================================================

const DEFAULT_TIMEOUT_MS = 3000;

export function resolverConfigured() {
  return !!(process.env.RESOLVER_URL && process.env.RESOLVER_URL.trim());
}

export function oreResolverEnabled() {
  const v = process.env.ORE_USE_RESOLVER;
  return v === '1' || v === 'true';
}

/**
 * Score one owner-name pair via the resolver /match (owner_owner model).
 *
 * @returns {Promise<{ok:true, band:string, probability:number, autoLink:number|null}
 *                   | {ok:false, error:string}>}
 *   ok:false on unset URL / unreachable / timeout / non-2xx → the caller fails closed.
 */
export async function matchOwnerNamePair(nameA, nameB, opts = {}) {
  const base = (process.env.RESOLVER_URL || '').replace(/\/$/, '');
  if (!base) return { ok: false, error: 'RESOLVER_URL unset' };
  if (!nameA || !nameB) return { ok: false, error: 'missing name' };
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(base + '/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'owner_owner',
        left: [{ id: 'L', name: nameA, state: opts.stateA || null }],
        right: [{ id: 'R', name: nameB, state: opts.stateB || null }],
        use_embeddings: true,
      }),
      signal: controller.signal,
    });
    if (!r.ok) return { ok: false, error: 'match ' + r.status };
    const j = await r.json();
    const autoLink = j && j.bands && typeof j.bands.auto_link === 'number' ? j.bands.auto_link : null;
    const pair = Array.isArray(j && j.pairs) && j.pairs.length ? j.pairs[0] : null;
    if (!pair) {
      // No candidate returned → the pair failed blocking / fell below the return
      // floor → the names are NOT a confident match. Report a rejecting band.
      return { ok: true, band: 'auto_reject', probability: 0, autoLink };
    }
    return { ok: true, band: pair.band, probability: pair.probability, autoLink };
  } catch (e) {
    const timeout = e && e.name === 'AbortError';
    return { ok: false, error: timeout ? 'timeout' : String((e && e.message) || e) };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Pure: map a matchOwnerNamePair result to a merge-gate decision.
 *   confirm  — the resolver confidently matches the names (auto_link band).
 *   veto     — the resolver reached a verdict but it is NOT a confident match.
 *   fallback — the resolver was unreachable/unset/timed out (fail-closed).
 * Both `veto` and `fallback` mean: do NOT auto-merge.
 */
export function gateFromMatch(res) {
  if (!res || !res.ok) return { decision: 'fallback', error: (res && res.error) || 'no result' };
  if (res.band === 'auto_link') return { decision: 'confirm', probability: res.probability };
  return { decision: 'veto', band: res.band, probability: res.probability };
}
