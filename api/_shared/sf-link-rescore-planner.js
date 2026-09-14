// ============================================================================
// W9.3 — SF-link live RE-SCORE planner (pure, dependency-free brain).
//
// W4.3 (2026-07-31) scored the 30,711-row sf_link_research_queue backlog OFFLINE
// against the LOCAL ops SF-Account registry (then 15,987 accounts) with the
// owner_sf Fellegi-Sunter model, CONSERVATIVE bands 0.9/0.1 (the calibrated
// 0.005/0.0008 band was measured NOT to transfer to the live-backlog
// distribution — it would auto-link ~26k incl. '2200 Main LLC'→'900 South Main
// LLC'). Every W4.3 auto-link was, in practice, an EXACT/near-exact name match
// (P>=0.98929, 15/15 clean sample). 23,817 rows landed `no_match`, judged vs the
// STALE local registry.
//
// The registry is LIVE-synced (external_identities salesforce/Account) and has
// since grown (15,987 -> 16,210+). W9.3 RE-SCORES the `no_match` rows against the
// CURRENT registry so new/changed accounts can now match. To honor the measured
// band-transfer failure WITHOUT re-porting libpostal's FS math to JS (which the
// W4.3 archaeology warned drifts), this planner reproduces the CONSERVATIVE tier
// that actually determined W4.3 auto-links: a DETERMINISTIC normalized-name gate.
//   - EXACT clean-name equality, UNIQUE registry account  -> auto_link  (0.99)
//   - clean-name equality but AMBIGUOUS (>1 account)       -> needs_review (0.70)
//   - CORE-name (legal-form-stripped) equality, unique     -> needs_review (0.85)
//   - core equality, ambiguous                             -> needs_review (0.50)
//   - else                                                 -> no_match   (0.00)
// Bands: auto_link >= 0.9, no_match <= 0.1, else needs_review. So AUTO-LINK fires
// ONLY on an unambiguous exact clean-name hit — the safest reproduction of
// "exact/near-exact only", never a fuzzy guess. Ambiguity always routes to the
// human review lane (now assist-ranked by W9.3 WS1). Optional: when RESOLVER_URL
// is configured the IO tick MAY additionally consult the resolver /match owner_sf
// probability, but the deterministic gate is authoritative and never widened by
// it (a resolver disagreement only DEMOTES to review, never promotes to auto).
//
// Pure: no IO, no throws, injectable clock. The live query/write side lives in
// api/admin.js::handleSfLinkRescoreTick.
// ============================================================================

export const RESCORE_AUTO_LINK_BAND = 0.9;   // >= => auto_link
export const RESCORE_NO_MATCH_BAND = 0.1;    // <= => no_match
export const RESCORE_BATCH_TAG_PREFIX = 'w9_3_splink_v2';

// Legal-entity forms stripped to derive the CORE name. Mirrors gov_owner_strict_core
// discipline: strip PURE legal forms, KEEP semantic tokens (co/company/group/
// partners/holdings/trust are kept — they distinguish real parties). Short
// bleed-prone forms (pllc/plc/pa/pc/lc) are deliberately EXCLUDED to avoid eating
// a leading letter of a real word ("...grou|p llc").
const LEGAL_FORMS = new Set([
  'llc', 'l l c', 'lp', 'l p', 'llp', 'lllp', 'inc', 'incorporated',
  'corp', 'corporation', 'ltd', 'limited', 'dst', 'reit',
]);

// Clean form: lowercase, punctuation -> space, collapse. KEEPS every token
// (including legal forms + numbers) — the strictest match key.
export function cleanSfName(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Core form: clean, then drop trailing/interior legal-entity forms. Used for the
// near-exact (needs_review) tier only — NEVER for auto-link.
export function coreSfName(s) {
  const toks = cleanSfName(s).split(' ').filter(Boolean);
  const kept = toks.filter((t) => !LEGAL_FORMS.has(t));
  const out = (kept.length ? kept : toks).join(' ');
  return out;
}

// Build the registry lookup maps from the enumerated SF-account registry rows
// ([{ sf_account_id, sf_account_name }]). Two maps keyed by clean / core name,
// each value a de-duped array of { id, name } so ambiguity (one name -> many
// accounts) is detectable and NEVER silently collapsed.
export function buildRegistryMaps(accounts) {
  const clean = new Map();
  const core = new Map();
  const add = (map, key, id, name) => {
    if (!key || !id) return;
    let arr = map.get(key);
    if (!arr) { arr = []; map.set(key, arr); }
    if (!arr.some((x) => String(x.id) === String(id))) arr.push({ id: String(id), name: name || null });
  };
  for (const a of (accounts || [])) {
    const id = a && (a.sf_account_id != null ? a.sf_account_id : a.id);
    const nm = a && (a.sf_account_name != null ? a.sf_account_name : a.name);
    if (id == null) continue;
    const c = cleanSfName(nm);
    const k = coreSfName(nm);
    add(clean, c, id, nm);
    add(core, k, id, nm);
  }
  return { clean, core, size: (accounts || []).length };
}

// Score one queue row against the registry maps. `row` carries owner_name +
// canonical_name (either may match). Returns the best disposition.
//   { level, probability, band, sf_account_id, sf_account_name, match_key, ambiguous }
// level: 3 exact-clean-unique / 2 exact-clean-ambiguous / 1 core-unique /
//        0.5 core-ambiguous / 0 none.
export function scoreQueueRow(row, maps) {
  const names = [];
  if (row && row.owner_name) names.push(String(row.owner_name));
  if (row && row.canonical_name) names.push(String(row.canonical_name));
  const cleanKeys = [...new Set(names.map(cleanSfName).filter(Boolean))];
  const coreKeys = [...new Set(names.map(coreSfName).filter(Boolean))];

  // Tier 1: exact clean equality (the ONLY auto-link tier).
  for (const ck of cleanKeys) {
    const hit = maps.clean.get(ck);
    if (hit && hit.length === 1) {
      return { level: 3, probability: 0.99, band: 'auto_link', sf_account_id: hit[0].id,
        sf_account_name: hit[0].name, match_key: 'clean:' + ck, ambiguous: false };
    }
    if (hit && hit.length > 1) {
      return { level: 2, probability: 0.70, band: 'needs_review', sf_account_id: hit[0].id,
        sf_account_name: hit[0].name, match_key: 'clean:' + ck, ambiguous: true };
    }
  }
  // Tier 2: core (legal-form-stripped) equality -> review only.
  for (const kk of coreKeys) {
    if (!kk) continue;
    const hit = maps.core.get(kk);
    if (hit && hit.length === 1) {
      return { level: 1, probability: 0.85, band: 'needs_review', sf_account_id: hit[0].id,
        sf_account_name: hit[0].name, match_key: 'core:' + kk, ambiguous: false };
    }
    if (hit && hit.length > 1) {
      return { level: 0.5, probability: 0.50, band: 'needs_review', sf_account_id: hit[0].id,
        sf_account_name: hit[0].name, match_key: 'core:' + kk, ambiguous: true };
    }
  }
  return { level: 0, probability: 0, band: 'no_match', sf_account_id: null,
    sf_account_name: null, match_key: null, ambiguous: false };
}

// Plan the queue-row disposition given the score + the row's CURRENT SF value on
// the owner record (null-guard: auto-link never overwrites a different non-null
// id — that becomes a needs_review conflict, exactly like W4.3).
//   Returns { queueStatus, writeSource, landedSfId, conflict, conflictExistingId,
//             band, probability, sfAccountId, sfAccountName, provenance }
export function planRescoreDisposition({ score, currentSfId } = {}) {
  const s = score || { band: 'no_match', probability: 0, sf_account_id: null };
  const base = {
    band: s.band, probability: s.probability,
    sfAccountId: s.sf_account_id || null, sfAccountName: s.sf_account_name || null,
    queueStatus: 'no_match', writeSource: false, landedSfId: null,
    conflict: false, conflictExistingId: null, provenance: false,
  };
  if (s.band === 'auto_link' && s.sf_account_id) {
    const cur = currentSfId != null && String(currentSfId).trim() !== '' ? String(currentSfId) : null;
    if (cur && cur !== String(s.sf_account_id)) {
      // A DIFFERENT id already sits on the owner -> never overwrite; surface as a
      // conflict in the review lane (mirrors W4.3's conflict handling).
      return Object.assign(base, {
        queueStatus: 'needs_review', conflict: true, conflictExistingId: cur,
      });
    }
    const idempotent = !!(cur && cur === String(s.sf_account_id));
    return Object.assign(base, {
      queueStatus: 'linked', writeSource: !idempotent, landedSfId: String(s.sf_account_id),
      provenance: !idempotent,
    });
  }
  if (s.band === 'needs_review' && s.sf_account_id) {
    return Object.assign(base, { queueStatus: 'needs_review' });
  }
  return Object.assign(base, { queueStatus: 'no_match' });
}

// Idempotency key: a row re-scores only when its inputs change (registry size +
// its own name). Lets the tick resume + skip already-scored rows cheaply.
export function rescoreScoredKey(queueId, registrySize, ownerName) {
  return String(queueId) + '|' + String(registrySize) + '|' + cleanSfName(ownerName);
}

// Bounded, budget-floored scorer (the house pattern). Scores rows until either
// the row cap or the wall-clock budget is hit; returns what was covered + whether
// more remains, so the tick never outruns the Railway proxy and always resumes.
export function scoreRescoreWithBudget(rows, scoreFn, { maxN = 500, budgetMs = 60000, now } = {}) {
  const clock = typeof now === 'function' ? now : () => Date.now();
  const start = clock();
  const out = [];
  let i = 0;
  let budgetExhausted = false;
  for (; i < rows.length; i++) {
    if (out.length >= maxN) break;
    if (clock() - start >= budgetMs) { budgetExhausted = true; break; }
    out.push(scoreFn(rows[i], i));
  }
  return {
    scored: out,
    covered: i,
    budget_exhausted: budgetExhausted,
    capped: out.length >= maxN,
    remaining_unscored: Math.max(0, rows.length - i),
  };
}

// Batch tag for a run (date-stamped, refreshed-registry marker). Deterministic
// from an injected day-string so the tick is resumable across a day.
export function rescoreBatchTag(dayStr) {
  const d = String(dayStr || '').replace(/[^0-9]/g, '').slice(0, 8) || '00000000';
  return RESCORE_BATCH_TAG_PREFIX + '_' + d + '_refreshed_registry';
}
