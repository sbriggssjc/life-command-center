// ============================================================================
// Intake Matcher — Match extraction snapshots to existing properties
// Life Command Center
//
// After document extraction completes, attempts to match the extracted
// address/tenant to an existing property in the dialysis or government
// domain databases. Writes match results to staged_intake_matches.
//
// Matching priority:
//   1. Exact address + state match
//   2. Normalized address match (normalizeAddress())
//   3. Fuzzy address match (Levenshtein distance <= 3)
//   4. Tenant + city + state match
//   5. No match → needs_review
//
// Usage:
//   import { matchIntakeToProperty } from './_handlers/intake-matcher.js';
//   const result = await matchIntakeToProperty(intakeId, extractionSnapshot);
// ============================================================================

import { opsQuery } from '../_shared/ops-db.js';
import { domainQuery } from '../_shared/domain-db.js';
import { normalizeAddress, stripDirectional, normalizeState } from '../_shared/entity-link.js';
import {
  normalizeStreetAddress,
  stripDirectionalTokens,
  leadingStreetNumber,
  splitMultiAddress,
} from '../_shared/normalize-street-address.js';

// Dialysis-operator detection for domain routing. Extends the original
// davita/fresenius/dialysis/kidney/renal set with legal-entity names that
// don't carry an obvious dialysis keyword — most importantly
// "Bio-Medical Applications of <State>", which is Fresenius's lessee entity.
// A 2026-06-04 forensic found "Fresenius - Jacksonville" OMs (tenant
// "Bio-Medical Applications of Florida") routed to government and parked
// unmatched because the dialysis tenant wasn't recognized. Also covers
// Satellite Healthcare, DCI, and nephrology operators.
export const DIALYSIS_KEYWORDS =
  /davita|fresenius|dialysis|kidney|renal|nephrolog|bio[-\s]?medical\s+applications|satellite\s+health|\bdci\b|total\s+renal/i;

// ============================================================================
// LEVENSHTEIN DISTANCE — for fuzzy address matching
// ============================================================================

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b[i - 1] === a[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Compute confidence score for fuzzy match based on Levenshtein distance.
 * Distance 0 = exact (shouldn't reach here), 1 = 0.95, 2 = 0.90, 3 = 0.80
 */
function fuzzyConfidence(distance) {
  if (distance <= 1) return 0.95;
  if (distance === 2) return 0.90;
  return 0.80;
}

// ============================================================================
// CANONICAL STREET-ADDRESS MATCH (2026-06-04)
// ============================================================================
// The original tiers compared the OM's one-way-normalized address against the
// raw DB column with ilike, which silently failed whenever the two sides spelled
// a directional or suffix differently ("198 N Springfield Ave" vs the canonical
// "198 North Springfield Avenue"). This tier normalizes BOTH sides to the same
// canonical key via normalizeStreetAddress() and compares for equality, so
// N↔North and Ave↔Avenue line up. Candidates are narrowed to the same state and
// leading house number so the JS-side comparison stays cheap.

/**
 * Pick a single canonical hit from a candidate list. Tries exact normalized
 * equality first; falls back to directional-stripped equality. When more than
 * one candidate matches and a city is available, narrows by city to break the
 * multi-city street collision. Returns { hit, reason, confidence } or null when
 * no UNIQUE hit can be established (ambiguity → no match, let looser tiers try).
 */
function pickCanonicalHit(candidates, address, city) {
  const normQuery = normalizeStreetAddress(address);
  if (!normQuery) return null;
  const cands = (candidates || []).filter((c) => c && c.address);
  if (!cands.length) return null;

  const cityLc = city ? String(city).trim().toLowerCase() : '';
  const narrowByCity = (rows) => {
    if (rows.length <= 1 || !cityLc) return rows;
    const narrowed = rows.filter((c) => String(c.city || '').trim().toLowerCase() === cityLc);
    return narrowed.length ? narrowed : rows;
  };

  // 1. Exact normalized equality.
  let hits = narrowByCity(cands.filter((c) => normalizeStreetAddress(c.address) === normQuery));
  if (hits.length === 1) {
    return { hit: hits[0], reason: 'canonical_address', confidence: 0.97 };
  }

  // 2. Directional-stripped equality (OM omits a directional the record has,
  //    or vice versa). Only accept a UNIQUE hit.
  const normNoDir = stripDirectionalTokens(normQuery);
  if (normNoDir) {
    let ndHits = narrowByCity(
      cands.filter((c) => stripDirectionalTokens(normalizeStreetAddress(c.address)) === normNoDir)
    );
    if (ndHits.length === 1) {
      return { hit: ndHits[0], reason: 'canonical_address_no_directional', confidence: 0.93 };
    }
  }

  return null;
}

/**
 * Canonical address match against a domain's properties table.
 * Narrows candidates by state + leading house number, then normalized compare.
 */
async function canonicalDomainMatch(domain, address, state, city) {
  if (!address || !state) return null;
  const baseCols = SELECT_BY_DOMAIN[domain] || 'property_id,address';
  const cols = baseCols.includes(',city') || baseCols.endsWith('city') ? baseCols : `${baseCols},city`;
  const filters = [`state=eq.${encodeURIComponent(state)}`];
  const num = leadingStreetNumber(address);
  if (num) filters.push(`address=ilike.${encodeURIComponent(num + '%')}`);
  filters.push(`select=${cols}`, 'limit=200');

  const result = await domainQuery(domain, 'GET', `properties?${filters.join('&')}`);
  if (!result.ok || !Array.isArray(result.data) || !result.data.length) return null;

  const picked = pickCanonicalHit(result.data, address, city);
  if (!picked) return null;
  return {
    status: 'matched',
    reason: picked.reason,
    confidence: picked.confidence,
    property_id: picked.hit.property_id,
    domain,
    candidates: [picked.hit],
  };
}

/**
 * Canonical address match against the LCC-native entities table.
 */
async function canonicalLccMatch(address, state, city) {
  if (!address || !state) return null;
  const filters = [`entity_type=eq.asset`, `state=eq.${encodeURIComponent(state)}`];
  const num = leadingStreetNumber(address);
  if (num) filters.push(`address=ilike.${encodeURIComponent(num + '%')}`);
  filters.push(`select=id,address,city,state,metadata`, 'limit=200');

  const result = await opsQuery('GET', `entities?${filters.join('&')}`);
  if (!result.ok || !Array.isArray(result.data) || !result.data.length) return null;

  const picked = pickCanonicalHit(result.data, address, city);
  if (!picked) return null;
  return {
    status: 'matched',
    reason: `${picked.reason}_lcc`,
    confidence: picked.confidence,
    property_id: picked.hit.id,
    domain: 'lcc',
    candidates: [picked.hit],
  };
}

// ============================================================================
// DOMAIN PROPERTY LOOKUP HELPERS
// ============================================================================

/**
 * Attempt exact address + state match against a domain's properties table.
 */
async function exactAddressMatch(domain, address, state) {
  const selectCols = SELECT_BY_DOMAIN[domain] || 'property_id,address';
  const result = await domainQuery(domain, 'GET',
    `properties?address=eq.${encodeURIComponent(address)}` +
    `&state=eq.${encodeURIComponent(state)}` +
    `&select=${selectCols}&limit=3`
  );
  if (result.ok && result.data?.length) {
    return {
      status: 'matched',
      reason: 'exact_address',
      confidence: 1.0,
      property_id: result.data[0].property_id,
      domain,
      candidates: result.data,
    };
  }
  return null;
}

/**
 * Attempt normalized address ilike match against a domain's properties table.
 */
async function normalizedAddressMatch(domain, normalizedAddr, state) {
  const selectCols = SELECT_BY_DOMAIN[domain] || 'property_id,address';
  const result = await domainQuery(domain, 'GET',
    `properties?address=ilike.${encodeURIComponent(normalizedAddr)}` +
    `&state=eq.${encodeURIComponent(state)}` +
    `&select=${selectCols}&limit=3`
  );
  if (result.ok && result.data?.length) {
    return {
      status: 'matched',
      reason: 'normalized_address',
      confidence: 0.95,
      property_id: result.data[0].property_id,
      domain,
      candidates: result.data,
    };
  }
  return null;
}

/**
 * Fuzzy address match — fetch candidate properties in the same state
 * and compute Levenshtein distance on normalized addresses.
 */
async function fuzzyAddressMatch(domain, normalizedAddr, state) {
  // Fetch properties in the same state to compare against
  const selectCols = SELECT_BY_DOMAIN[domain] || 'property_id,address';
  const result = await domainQuery(domain, 'GET',
    `properties?state=eq.${encodeURIComponent(state)}` +
    `&select=${selectCols}&limit=50`
  );
  if (!result.ok || !result.data?.length) return null;

  // Apply stripDirectional on BOTH sides so "991 johnstown rd" vs
  // "991 e johnstown rd" compares at distance 0 instead of 2.
  const queryNoDir = stripDirectional(normalizedAddr);

  let bestMatch = null;
  let bestDistance = Infinity;

  for (const prop of result.data) {
    if (!prop.address) continue;
    const propNorm  = normalizeAddress(prop.address);
    const propNoDir = stripDirectional(propNorm);
    // Take the tighter of (raw normalized distance, direction-stripped
    // distance) so we don't downgrade the match when the directionals
    // happen to agree.
    const distRaw   = levenshtein(normalizedAddr, propNorm);
    const distNoDir = levenshtein(queryNoDir, propNoDir);
    const dist = Math.min(distRaw, distNoDir);
    if (dist <= 3 && dist < bestDistance) {
      bestDistance = dist;
      bestMatch = prop;
    }
  }

  if (bestMatch) {
    return {
      status: 'matched',
      reason: 'fuzzy_address',
      confidence: fuzzyConfidence(bestDistance),
      property_id: bestMatch.property_id,
      domain,
      candidates: [bestMatch],
    };
  }
  return null;
}

// Each domain DB uses a different column name for the occupant/tenant:
//   dialysis.properties.tenant         — operator name (Fresenius / DaVita / ...)
//   government.properties.agency       — short agency name (CBP, GSA, ...)
// Using the wrong column produces a 400 "column does not exist" from Supabase,
// which domainQuery swallows silently and makes the match step look like a
// legitimate no-match.
const TENANT_COLUMN_BY_DOMAIN = {
  dialysis:   'tenant',
  government: 'agency',
};

// Select lists also differ because gov has no `tenant` column. Returning
// only columns that exist for the domain keeps the response shape sane.
const SELECT_BY_DOMAIN = {
  dialysis:   'property_id,address,tenant',
  government: 'property_id,address,agency,agency_full_name',
};

/**
 * Tenant + city + state fallback match when no address match found.
 * Column name differs by domain (see TENANT_COLUMN_BY_DOMAIN).
 */
async function tenantCityStateMatch(domain, tenant, city, state) {
  const tenantCol = TENANT_COLUMN_BY_DOMAIN[domain] || 'tenant';
  const selectCols = SELECT_BY_DOMAIN[domain] || 'property_id,address';
  const filters = [`${tenantCol}=ilike.*${encodeURIComponent(tenant)}*`];
  if (city) filters.push(`city=ilike.${encodeURIComponent(city)}`);
  if (state) filters.push(`state=eq.${encodeURIComponent(state)}`);
  filters.push(`select=${selectCols}`, 'limit=3');

  const result = await domainQuery(domain, 'GET',
    `properties?${filters.join('&')}`
  );
  if (result.ok && result.data?.length) {
    return {
      status: 'matched',
      reason: 'tenant_city_state',
      confidence: 0.70,
      property_id: result.data[0].property_id,
      domain,
      candidates: result.data,
    };
  }
  return null;
}

// ============================================================================
// MAIN MATCHER
// ============================================================================

/**
 * Run the full match sequence against a single domain.
 * Returns first successful match or null.
 */
async function matchAgainstDomain(domain, address, state, city, tenant) {
  const norm    = address ? normalizeAddress(address) : '';
  const noDir   = norm     ? stripDirectional(norm)   : '';

  // 0. Canonical normalized-equality match. Handles N↔North, Ave↔Avenue,
  //    Blvd↔Boulevard, unit/suite stripping — the class of mismatch that
  //    left the bulk of the review_required pile unmatched. Highest-quality
  //    tier, so it runs first.
  if (address && state) {
    const canon = await canonicalDomainMatch(domain, address, state, city);
    if (canon) return canon;
  }

  // 1. Exact address + state
  if (address && state) {
    const exact = await exactAddressMatch(domain, address, state);
    if (exact) return exact;
  }

  // 2. Normalized address match
  if (norm && state) {
    const normalized = await normalizedAddressMatch(domain, norm, state);
    if (normalized) return normalized;
  }

  // 2b. Normalized + directional-stripped. Catches "991 Johnstown Rd"
  //     vs "991 E Johnstown Rd" style mismatches where the source doc
  //     and the canonical record disagree on whether the directional
  //     is present. Only run when stripping actually changed something,
  //     otherwise it's a duplicate of step 2.
  if (noDir && noDir !== norm && state) {
    const noDirMatch = await normalizedAddressMatch(domain, noDir, state);
    if (noDirMatch) {
      noDirMatch.reason = 'normalized_address_no_directional';
      noDirMatch.confidence = 0.93;
      return noDirMatch;
    }
  }

  // 3. Fuzzy address match (Levenshtein <= 3)
  if (norm && state) {
    const fuzzy = await fuzzyAddressMatch(domain, norm, state);
    if (fuzzy) return fuzzy;
  }

  // 4. Tenant + city + state
  if (tenant && (city || state)) {
    const tenantMatch = await tenantCityStateMatch(domain, tenant, city, state);
    if (tenantMatch) return tenantMatch;
  }

  return null;
}

// ============================================================================
// LCC-NATIVE ENTITY LOOKUP
// ============================================================================
// The sidebar/CoStar ingestion already populates `entities` on the LCC Opps
// Supabase (entity_type='asset'). Many dialysis/government properties live
// there first — the domain DBs (dialysis_db, government_db) are curated
// subsets that may not include every address the LCC org has touched. Check
// LCC entities before falling through to the domain DBs so intake links to
// the same record the sidebar uses.

async function lccExactAddressMatch(address, state) {
  const path = `entities?entity_type=eq.asset` +
    `&address=eq.${encodeURIComponent(address)}` +
    `&state=eq.${encodeURIComponent(state)}` +
    `&select=id,address,city,state,metadata&limit=3`;
  const result = await opsQuery('GET', path);
  if (result.ok && Array.isArray(result.data) && result.data.length) {
    return {
      status: 'matched',
      reason: 'exact_address_lcc',
      confidence: 1.0,
      property_id: result.data[0].id,
      domain: 'lcc',
      candidates: result.data,
    };
  }
  return null;
}

async function lccNormalizedAddressMatch(normalizedAddr, state) {
  const path = `entities?entity_type=eq.asset` +
    `&address=ilike.${encodeURIComponent(normalizedAddr)}` +
    `&state=eq.${encodeURIComponent(state)}` +
    `&select=id,address,city,state,metadata&limit=3`;
  const result = await opsQuery('GET', path);
  if (result.ok && Array.isArray(result.data) && result.data.length) {
    return {
      status: 'matched',
      reason: 'normalized_address_lcc',
      confidence: 0.95,
      property_id: result.data[0].id,
      domain: 'lcc',
      candidates: result.data,
    };
  }
  return null;
}

async function lccFuzzyAddressMatch(normalizedAddr, state) {
  // Pull up to 100 same-state assets and score via Levenshtein on normalized
  // addresses. Same pattern as fuzzyAddressMatch() but against LCC entities,
  // with stripDirectional applied to both sides so directional-only diffs
  // compare at distance 0.
  const path = `entities?entity_type=eq.asset` +
    `&state=eq.${encodeURIComponent(state)}` +
    `&select=id,address,city,state,metadata&limit=100`;
  const result = await opsQuery('GET', path);
  if (!result.ok || !Array.isArray(result.data) || !result.data.length) return null;

  const queryNoDir = stripDirectional(normalizedAddr);

  let bestMatch = null;
  let bestDistance = Infinity;
  for (const prop of result.data) {
    if (!prop.address) continue;
    const propNorm  = normalizeAddress(prop.address);
    const propNoDir = stripDirectional(propNorm);
    const distRaw   = levenshtein(normalizedAddr, propNorm);
    const distNoDir = levenshtein(queryNoDir, propNoDir);
    const dist = Math.min(distRaw, distNoDir);
    if (dist <= 3 && dist < bestDistance) {
      bestDistance = dist;
      bestMatch = prop;
    }
  }

  if (bestMatch) {
    return {
      status: 'matched',
      reason: 'fuzzy_address_lcc',
      confidence: fuzzyConfidence(bestDistance),
      property_id: bestMatch.id,
      domain: 'lcc',
      candidates: [bestMatch],
    };
  }
  return null;
}

async function matchAgainstLcc(address, state, city) {
  if (!address || !state) return null;
  const norm  = normalizeAddress(address);
  const noDir = stripDirectional(norm);

  // 0. Canonical normalized-equality match (N↔North, Ave↔Avenue, units).
  const canon = await canonicalLccMatch(address, state, city);
  if (canon) return canon;

  // 1. Exact
  const exact = await lccExactAddressMatch(address, state);
  if (exact) return exact;

  // 2. Normalized
  if (norm) {
    const normalized = await lccNormalizedAddressMatch(norm, state);
    if (normalized) return normalized;
  }

  // 2b. Normalized + directional-stripped
  if (noDir && noDir !== norm) {
    const noDirMatch = await lccNormalizedAddressMatch(noDir, state);
    if (noDirMatch) {
      noDirMatch.reason = 'normalized_address_no_directional_lcc';
      noDirMatch.confidence = 0.93;
      return noDirMatch;
    }
  }

  // 3. Fuzzy
  if (norm) {
    const fuzzy = await lccFuzzyAddressMatch(norm, state);
    if (fuzzy) return fuzzy;
  }

  return null;
}

/**
 * Match an intake extraction snapshot to an existing property in the
 * dialysis or government domain databases.
 *
 * @param {string} intakeId — UUID of the staged_intake_item
 * @param {object} extractionSnapshot — merged extraction result
 * @returns {{ status: string, confidence: number, property_id: string|null, domain?: string }}
 */
export async function matchIntakeToProperty(intakeId, extractionSnapshot) {
  // AI extractors commonly emit "Ohio" while domain DBs and LCC entities
  // store "OH". Normalize at the top so every downstream filter uses the
  // canonical 2-letter code.
  const state = normalizeState(extractionSnapshot.state);
  const city  = extractionSnapshot.city;

  // Multi-property OMs dump every address into one field — as a JSON-array
  // string, a real array, or a pipe/semicolon join. Split before matching so
  // each property gets its own match pass instead of guaranteeing unmatched.
  // Prefer a structured `addresses[]`/`tenant_names[]` array when the extractor
  // emitted one; fall back to the single `address`/`tenant_name` fields.
  const pairs = splitMultiAddress(
    extractionSnapshot.addresses ?? extractionSnapshot.address,
    extractionSnapshot.tenant_names ?? extractionSnapshot.tenant_name
  );

  const anyAddress = pairs.some((p) => p.address);
  const anyTenant  = pairs.some((p) => p.tenant) || extractionSnapshot.tenant_name;
  if (!anyAddress && !anyTenant) {
    const noData = { status: 'no_data', confidence: 0, property_id: null };
    await writeMatchResult(intakeId, noData);
    return noData;
  }

  // Multi-address intake: match each, attach to the first matched property,
  // record the rest in the intake for review (promoter is single-attach).
  if (pairs.length > 1) {
    return await matchMultiAddress(intakeId, pairs, state, city, extractionSnapshot);
  }

  const address = pairs[0].address;
  const tenant  = pairs[0].tenant || extractionSnapshot.tenant_name;
  const { match: resolved, primaryDomain } = await resolveAddressMatch({ address, state, city, tenant });
  const match = resolved || { status: 'unmatched', confidence: 0, property_id: null, domain: primaryDomain };

  // R8: when no confident single match resolved, check whether MULTIPLE near-miss
  // candidates exist (the case that currently parks as unmatched/review). If so,
  // funnel it into the Decision Center (match_disambiguation lane) instead of
  // letting it sit unmatched — the human picks the right property or creates a
  // new one. Purely additive: confident matches never reach this branch.
  if (match.status === 'unmatched' && address && state) {
    const top = await collectAmbiguousCandidates(address, state, primaryDomain);
    if (top.length >= DISAMBIG_MIN_CANDIDATES) {
      await emitMatchDisambiguation(intakeId, address, tenant, top);
      const ambiguous = {
        status: 'review_required', reason: 'ambiguous_candidates', confidence: 0,
        property_id: null, domain: null, candidate_count: top.length,
        candidates: top,
      };
      await writeMatchResult(intakeId, ambiguous);
      return ambiguous;
    }
  }

  await writeMatchResult(intakeId, match);
  return match;
}

// Looser than the auto-match dist<=3: a candidate that's a near-miss (not good
// enough to auto-attach) but plausible enough that a human should choose.
const DISAMBIG_MAX_DIST = 5;
const DISAMBIG_MIN_CANDIDATES = 2;

// Collect near-miss property candidates across both domains for a single
// address. Returns up to 5 distinct candidates (domain+property_id), tightest
// first. Used only on the unmatched path, so it never overrides a confident
// match — it only enriches the "park in review" case into a disambiguation.
async function collectAmbiguousCandidates(address, state, primaryDomain) {
  const norm = normalizeAddress(address);
  if (!norm) return [];
  const secondary = primaryDomain === 'dialysis' ? 'government' : 'dialysis';
  const fetchDom = async (domain) => {
    const selectCols = SELECT_BY_DOMAIN[domain] || 'property_id,address';
    const result = await domainQuery(domain, 'GET',
      `properties?state=eq.${encodeURIComponent(state)}&select=${selectCols}&limit=80`);
    if (!result.ok || !result.data?.length) return [];
    const queryNoDir = stripDirectional(norm);
    const out = [];
    for (const prop of result.data) {
      if (!prop.address) continue;
      const propNorm = normalizeAddress(prop.address);
      const dist = Math.min(levenshtein(norm, propNorm), levenshtein(queryNoDir, stripDirectional(propNorm)));
      if (dist <= DISAMBIG_MAX_DIST) {
        out.push({
          domain: domain === 'dialysis' ? 'dia' : 'gov',
          property_id: String(prop.property_id),
          address: prop.address,
          tenant: prop.tenant || prop.agency || prop.agency_full_name || null,
          confidence: fuzzyConfidence(dist),
          _dist: dist,
        });
      }
    }
    return out;
  };
  const all = (await Promise.all([fetchDom(primaryDomain), fetchDom(secondary)])).flat()
    .sort((a, b) => a._dist - b._dist);
  const seen = new Set();
  const top = [];
  for (const c of all) {
    const k = c.domain + ':' + c.property_id;
    if (seen.has(k)) continue;
    seen.add(k);
    top.push({ domain: c.domain, property_id: c.property_id, address: c.address,
      tenant: c.tenant, confidence: c.confidence });
    if (top.length >= 5) break;
  }
  return top;
}

// Raise a match_disambiguation decision (Decision Center). Idempotent on
// subject_ref; best-effort (a failed emit never breaks the matcher). context is
// bounded (ids + scalar facts + ≤5 candidate summaries).
// Exported (Phase 2 Slice 2a) so the enrich-channel promoter can route an
// unresolved PROPERTIES file to the SAME lane instead of creating a property.
export async function emitMatchDisambiguation(intakeId, address, tenant, candidates, opts = {}) {
  try {
    // Slice 2d (Unit 2): the light attach path has no intake_id (a non-OM doc is
    // attached by path anchor without staging an intake), so callers can pass a
    // stable subjectRef (e.g. the server-relative path) + extra context. Default
    // preserves the intake-keyed behavior for every existing caller.
    const subjectRef = opts.subjectRef || ('match_disambig:' + intakeId);
    await opsQuery('POST', 'rpc/lcc_open_decision', {
      p_decision_type: 'match_disambiguation',
      p_workspace_id: opts.workspaceId || null,
      p_question: 'Multiple candidate properties matched this intake — which one (or create new)?',
      p_context: {
        intake_id: intakeId, address: address || null, tenant: tenant || null,
        candidates: candidates,
        ...(opts.context || {}),
      },
      p_subject_ref: subjectRef,
      p_rank_value: candidates.length,
    });
  } catch (e) {
    console.warn('[intake-matcher] match_disambiguation emit skipped:', e?.message || e);
  }
}

// ============================================================================
// PATH-ANCHOR MATCH (Phase 2 Slice 2d — light attach path)
// ============================================================================
//
// Resolve an EXISTING property from the SharePoint path anchor ALONE — no AI
// extraction. The PROPERTIES tree encodes PROPERTIES/<bucket>/<tenant>/<City,
// ST>, so parseSubjectHintFromPath already hands us {tenant_brand, city, state,
// vertical}. That is exactly the tenant+city+state matcher tier, so this reuses
// tenantCityStateMatch per resolved domain.
//
// Conservative by construction — it NEVER guesses:
//   • exactly one candidate across the resolved domain(s) → matched (attach)
//   • more than one candidate                              → review_required
//     (the caller routes it to the match_disambiguation lane)
//   • zero candidates                                      → unmatched
//
// Used by api/_handlers/folder-feed-attach.js to attach lease/BOV/DD/master/comp
// working docs to the property they describe without staging an intake.
export async function matchByPathAnchor(subjectHint) {
  // Prefer the cleaned tenant CORE (folder labels carry fused City/ST, portfolio
  // descriptors, and broker initials that never ILIKE-match a tenant column).
  const tenantRaw = subjectHint?.tenant_brand ? String(subjectHint.tenant_brand).trim() : '';
  const tenant    = subjectHint?.tenant_core ? String(subjectHint.tenant_core).trim() : tenantRaw;
  const city      = subjectHint?.city ? String(subjectHint.city).trim() : '';
  const state     = normalizeState(subjectHint?.state);
  const address   = subjectHint?.address ? String(subjectHint.address).trim() : '';

  // Need a state plus either a street address OR a tenant to resolve safely.
  // Otherwise the anchor is too weak — bail to unmatched (no decision, no guess).
  if (!state || (!address && !tenant)) {
    return { status: 'unmatched', confidence: 0, reason: 'insufficient_anchor', property_id: null, domain: null, candidates: [] };
  }

  // Resolve which domain(s) to probe. The research-root/tenant-cue vertical is
  // authoritative when present; otherwise probe both, tenant-cue first.
  const vertical = subjectHint?.vertical;
  let domains;
  if (vertical === 'dia') domains = ['dialysis'];
  else if (vertical === 'gov') domains = ['government'];
  else domains = DIALYSIS_KEYWORDS.test(tenant) ? ['dialysis', 'government'] : ['government', 'dialysis'];

  const toReview = (cands) => ({
    status: 'review_required',
    reason: 'path_anchor_ambiguous',
    confidence: 0,
    property_id: null,
    domain: null,
    candidates: cands.slice(0, 5).map(c => ({
      domain: c.domain === 'dialysis' ? 'dia' : 'gov',
      property_id: String(c.property_id),
      address: c.address || null,
      tenant: c.tenant || c.agency || c.agency_full_name || null,
      confidence: 0.7,
    })),
  });

  // 1) Address-first — when the path/filename carried a street address, run the
  //    full canonical/exact/normalized matcher (highest precision, single hit).
  if (address) {
    const addrCands = [];
    for (const domain of domains) {
      const m = await matchAgainstDomain(domain, address, state, city, tenant);
      if (m && m.property_id != null) addrCands.push({ domain, ...m });
    }
    if (addrCands.length === 1) {
      const c = addrCands[0];
      return {
        status: 'matched',
        reason: `path_anchor_${c.reason || 'address'}`,
        confidence: Math.max(0.8, c.confidence || 0.8),
        property_id: c.property_id,
        domain: c.domain,
        candidates: addrCands,
      };
    }
    if (addrCands.length > 1) return toReview(addrCands);
    // 0 address hits → fall through to tenant+city+state.
  }

  // 2) Tenant + city + state — only when we actually have a tenant.
  const candidates = [];
  if (tenant) {
    for (const domain of domains) {
      const m = await tenantCityStateMatch(domain, tenant, city, state);
      if (m && Array.isArray(m.candidates)) {
        for (const c of m.candidates) candidates.push({ domain, ...c });
      }
    }
  }

  if (candidates.length === 1) {
    const c = candidates[0];
    return {
      status: 'matched',
      reason: 'path_anchor_tenant_city_state',
      confidence: 0.75,
      property_id: c.property_id,
      domain: c.domain,
      candidates,
    };
  }
  if (candidates.length > 1) return toReview(candidates);
  return { status: 'unmatched', confidence: 0, reason: 'no_domain_property', property_id: null, domain: null, candidates: [] };
}

/**
 * Resolve a single address+tenant against LCC entities, the tenant-implied
 * primary domain, then the other domain (cross-domain fallback). Returns
 * { match, primaryDomain } where match is null when nothing matched.
 * Pure resolution — does NOT write the result.
 */
async function resolveAddressMatch({ address, state, city, tenant }) {
  // 0. LCC-native entity lookup. The sidebar/CoStar pipeline often has
  //    already populated `entities` for this property — check there first
  //    so intake links to the same record the sidebar uses.
  let match = address ? await matchAgainstLcc(address, state, city) : null;

  // 1. Determine primary domain — try dialysis first if tenant looks dialysis.
  const isDialysis = tenant && DIALYSIS_KEYWORDS.test(tenant);
  const primaryDomain = isDialysis ? 'dialysis' : 'government';
  const secondaryDomain = primaryDomain === 'dialysis' ? 'government' : 'dialysis';

  // 2. Primary domain
  if (!match) {
    match = await matchAgainstDomain(primaryDomain, address, state, city, tenant);
  }

  // 3. Cross-domain fallback — try the other domain before parking in review.
  //    Records which domain matched via the match object's `domain` field and
  //    a `_cross_domain` reason suffix.
  if (!match) {
    const crossMatch = await matchAgainstDomain(secondaryDomain, address, state, city, tenant);
    if (crossMatch) {
      crossMatch.reason = `${crossMatch.reason}_cross_domain`;
      crossMatch.confidence = Math.min(crossMatch.confidence, 0.90);
      match = crossMatch;
    }
  }

  return { match, primaryDomain };
}

/**
 * Match a multi-property intake. Runs resolveAddressMatch per address, attaches
 * the intake to the FIRST matched property (the promoter is single-attach), and
 * records every per-address result in match_result so the review UI can see the
 * other properties an OM covers. matched_count > 1 signals a portfolio OM.
 */
async function matchMultiAddress(intakeId, pairs, state, city, snapshot) {
  const perAddress = [];
  for (const p of pairs) {
    if (!p.address) continue;
    const tenant = p.tenant || snapshot.tenant_name;
    const { match } = await resolveAddressMatch({ address: p.address, state, city, tenant });
    perAddress.push({
      address:     p.address,
      tenant:      tenant || null,
      status:      match ? match.status : 'unmatched',
      domain:      match?.domain ?? null,
      property_id: match?.property_id != null ? String(match.property_id) : null,
      confidence:  match?.confidence ?? 0,
      reason:      match?.reason || 'unmatched',
    });
  }

  const matchedOnes = perAddress.filter((r) => r.status === 'matched' && r.property_id != null);
  const primary = matchedOnes[0] || null;

  const aggregate = primary
    ? {
        status:             'matched',
        reason:             `${primary.reason}_multi`,
        confidence:         primary.confidence,
        property_id:        primary.property_id,
        domain:             primary.domain,
        multi_address:      true,
        address_count:      perAddress.length,
        matched_count:      matchedOnes.length,
        all_addresses:      perAddress,
        additional_matches: matchedOnes.slice(1),
      }
    : {
        status:        'unmatched',
        reason:        'multi_address_no_match',
        confidence:    0,
        property_id:   null,
        domain:        null,
        multi_address: true,
        address_count: perAddress.length,
        matched_count: 0,
        all_addresses: perAddress,
      };

  await writeMatchResult(intakeId, aggregate);
  return aggregate;
}

/**
 * Persist match result to staged_intake_matches and update the intake item status.
 */
async function writeMatchResult(intakeId, match) {
  // Write to staged_intake_matches — one row per matcher run; latest-by-
  // created_at is the authoritative match for the intake.
  const insertResult = await opsQuery('POST', 'staged_intake_matches', {
    intake_id:    intakeId,
    decision:     match.status === 'matched' ? 'auto_matched' : 'needs_review',
    reason:       match.reason || 'no_address_match',
    domain:       match.domain || null,
    property_id:  match.property_id != null ? String(match.property_id) : null,
    confidence:   match.confidence,
    match_result: match,
  });

  if (!insertResult.ok) {
    console.error('[intake-matcher] Failed to write match result:',
      insertResult.status, JSON.stringify(insertResult.data || {}).slice(0, 200));
  }

  // Update intake item status
  const patchResult = await opsQuery('PATCH',
    `staged_intake_items?intake_id=eq.${encodeURIComponent(intakeId)}`,
    { status: match.status === 'matched' ? 'matched' : 'review_required' }
  );

  if (!patchResult.ok) {
    console.error('[intake-matcher] Failed to update intake item status:', patchResult.data);
  }
}
