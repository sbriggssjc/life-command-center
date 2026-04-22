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

const DIALYSIS_KEYWORDS = /davita|fresenius|dialysis|kidney|renal/i;

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
// DOMAIN PROPERTY LOOKUP HELPERS
// ============================================================================

/**
 * Attempt exact address + state match against a domain's properties table.
 */
async function exactAddressMatch(domain, address, state) {
  const result = await domainQuery(domain, 'GET',
    `properties?address=eq.${encodeURIComponent(address)}` +
    `&state=eq.${encodeURIComponent(state)}` +
    `&select=property_id,address,tenant&limit=3`
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
  const result = await domainQuery(domain, 'GET',
    `properties?address=ilike.${encodeURIComponent(normalizedAddr)}` +
    `&state=eq.${encodeURIComponent(state)}` +
    `&select=property_id,address,tenant&limit=3`
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
  const result = await domainQuery(domain, 'GET',
    `properties?state=eq.${encodeURIComponent(state)}` +
    `&select=property_id,address,tenant&limit=50`
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

/**
 * Tenant + city + state fallback match when no address match found.
 */
async function tenantCityStateMatch(domain, tenant, city, state) {
  const filters = [`tenant=ilike.*${encodeURIComponent(tenant)}*`];
  if (city) filters.push(`city=ilike.${encodeURIComponent(city)}`);
  if (state) filters.push(`state=eq.${encodeURIComponent(state)}`);
  filters.push('select=property_id,address,tenant', 'limit=3');

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

async function matchAgainstLcc(address, state) {
  if (!address || !state) return null;
  const norm  = normalizeAddress(address);
  const noDir = stripDirectional(norm);

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
  const address = extractionSnapshot.address;
  // AI extractors commonly emit "Ohio" while domain DBs and LCC entities
  // store "OH". Normalize at the top so every downstream filter uses the
  // canonical 2-letter code.
  const state   = normalizeState(extractionSnapshot.state);
  const city    = extractionSnapshot.city;
  const tenant  = extractionSnapshot.tenant_name;

  if (!address && !tenant) {
    const noData = { status: 'no_data', confidence: 0, property_id: null };
    await writeMatchResult(intakeId, noData);
    return noData;
  }

  // 0. LCC-native entity lookup. The sidebar/CoStar pipeline often has
  //    already populated `entities` for this property — check there first
  //    so intake links to the same record the sidebar uses, regardless of
  //    whether the property also lives in a domain-specific DB.
  let match = address ? await matchAgainstLcc(address, state) : null;

  // 1. Determine primary domain — try dialysis first if tenant looks like dialysis
  const isDialysis = tenant && DIALYSIS_KEYWORDS.test(tenant);
  const primaryDomain = isDialysis ? 'dialysis' : 'government';
  const secondaryDomain = primaryDomain === 'dialysis' ? 'government' : 'dialysis';

  // 2. Primary domain
  if (!match) {
    match = await matchAgainstDomain(primaryDomain, address, state, city, tenant);
  }

  // 3. Fallback: try the other domain
  if (!match) {
    const crossMatch = await matchAgainstDomain(secondaryDomain, address, state, city, tenant);
    if (crossMatch) {
      crossMatch.reason = `${crossMatch.reason}_cross_domain`;
      crossMatch.confidence = Math.min(crossMatch.confidence, 0.90);
      match = crossMatch;
    }
  }

  if (!match) {
    match = { status: 'unmatched', confidence: 0, property_id: null, domain: primaryDomain };
  }

  await writeMatchResult(intakeId, match);
  return match;
}

/**
 * Persist match result to staged_intake_matches and update the intake item status.
 */
async function writeMatchResult(intakeId, match) {
  // Write to staged_intake_matches
  const insertResult = await opsQuery('POST', 'staged_intake_matches', {
    intake_id:    intakeId,
    decision:     match.status === 'matched' ? 'auto_matched' : 'needs_review',
    reason:       match.reason || 'no_address_match',
    property_id:  match.property_id || null,
    confidence:   match.confidence,
    match_result: match,
  });

  if (!insertResult.ok) {
    console.error('[intake-matcher] Failed to write match result:', insertResult.data);
  }

  // Update intake item status
  const patchResult = await opsQuery('PATCH',
    `staged_intake_items?intake_id=eq.${encodeURIComponent(intakeId)}`,
    { status: match.status === 'matched' ? 'matched' : 'review_needed' }
  );

  if (!patchResult.ok) {
    console.error('[intake-matcher] Failed to update intake item status:', patchResult.data);
  }
}
