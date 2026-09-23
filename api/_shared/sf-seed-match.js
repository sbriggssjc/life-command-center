// ============================================================================
// SF-BRIDGE1 (2026-09-23) — an OM that carries a Salesforce seed can follow
// its deal to the property.
// ----------------------------------------------------------------------------
// A document staged by the intake-salesforce-files edge function carries
// seed_data = { sf_entity_type: 'Listing__c' | 'Opportunity', sf_entity_id,
// source_vertical }. Before this, matching used ONLY the extracted address, so
// our own Findlay OM (Listing__c a0jVs00000GuTfdIAF → Opportunity
// 006Vs00000hhYfCIAU → LCC asset entity → dia 51194) parked `unmatched` the
// moment the extractor missed the address.
//
// Resolution is by ID at every hop, never by name:
//   Listing__c  → <domain>.sf_listing_staging.sf_deal_id  (the Opportunity)
//   Opportunity → bd_opportunities.sf_opp_id → entity_id
//   entity_id   → external_identities(source_type='asset', source_system dia|gov)
//
// Precedence (reconcileSeedWithAddressMatch — pure, tested):
//   seed resolved + no extracted address          → the seed IS the match
//   seed resolved + address agrees                → match (seed-corroborated)
//   seed resolved + address disagrees             → review, both candidates;
//                                                   never silently pick one
//   seed points at the other vertical             → refused; the address
//                                                   match stands on its own
//                                                   (GOV-AVAIL1's guard still
//                                                   runs at promotion)
//   seed unresolved                               → address match unchanged
// ============================================================================

import { civicNumbersAgree, seedVerticalDomain, streetKey } from './intake-address-guard.js';

const DIRS = new Set(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']);
// true = same civic number AND same street name; false = either disagrees;
// null = cannot tell (a side has no parseable street line). A shared number on
// a different street ("1717 Main St" vs "1717 Medical Blvd") is a conflict.
export function subjectAddressesAgree(a, b) {
  const civic = civicNumbersAgree(a, b);
  if (civic === null) return null;
  if (civic === false) return false;
  const name = (x) => {
    const k = streetKey(x);
    if (!k) return null;
    return k.split(' ').slice(1).find((t) => !DIRS.has(t)) || null;
  };
  const na = name(a), nb = name(b);
  if (!na || !nb) return null;
  return na === nb;
}

const SHORT = { dialysis: 'dia', government: 'gov' };
const LONG = { dia: 'dialysis', gov: 'government' };
// Stages that mean the deal is our sell-side listing (mirrors deriveDealType).
const LISTING_STAGES = new Set(['listing_signed', 'off_market_listing', 'ela']);

export function parseSfSeed(seedData) {
  if (!seedData || typeof seedData !== 'object') return null;
  const type = String(seedData.sf_entity_type || '').trim();
  const id = String(seedData.sf_entity_id || '').trim();
  if (!id) return null;
  if (type === 'Listing__c') return { kind: 'listing', sfId: id, verticalDomain: seedVerticalDomain(seedData) };
  if (type === 'Opportunity' || /^006[A-Za-z0-9]{12,15}$/.test(id)) {
    return { kind: 'opportunity', sfId: id, verticalDomain: seedVerticalDomain(seedData) };
  }
  return null;   // Comp__c and anything else: a comp file is not our deal
}

/**
 * Resolve a Salesforce seed to one domain property. deps = { opsQuery, domainQuery }.
 * Returns { status: 'resolved'|'unresolved'|'refused', reason, … }.
 */
export async function resolveSfSeed(seedData, deps) {
  const seed = parseSfSeed(seedData);
  if (!seed) return { status: 'unresolved', reason: 'no_sf_seed' };
  const { opsQuery, domainQuery } = deps;
  const enc = encodeURIComponent;

  let sfOppId = seed.kind === 'opportunity' ? seed.sfId : null;
  if (seed.kind === 'listing') {
    const domains = seed.verticalDomain ? [seed.verticalDomain] : ['dialysis', 'government'];
    for (const d of domains) {
      const r = await domainQuery(d, 'GET',
        `sf_listing_staging?sf_listing_id=eq.${enc(seed.sfId)}&select=sf_deal_id&order=imported_at.desc&limit=5`);
      const hit = (r?.ok && Array.isArray(r.data) ? r.data : []).find((x) => x && x.sf_deal_id);
      if (hit) { sfOppId = hit.sf_deal_id; break; }
    }
    if (!sfOppId) return { status: 'unresolved', reason: 'listing_not_staged', sf_listing_id: seed.sfId };
  }

  const opp = await opsQuery('GET',
    `bd_opportunities?sf_opp_id=eq.${enc(sfOppId)}&select=id,entity_id,stage,type,is_open,deal_name&limit=1`);
  const o = opp?.ok && Array.isArray(opp.data) ? opp.data[0] : null;
  if (!o || !o.entity_id) return { status: 'unresolved', reason: 'opportunity_not_synced', sf_opp_id: sfOppId };

  const ids = await opsQuery('GET',
    `external_identities?entity_id=eq.${enc(o.entity_id)}&source_type=eq.asset&select=source_system,external_id&limit=10`);
  const assets = (ids?.ok && Array.isArray(ids.data) ? ids.data : [])
    .filter((r) => r && (r.source_system === 'dia' || r.source_system === 'gov') && r.external_id);
  const distinct = [...new Map(assets.map((a) => [a.source_system + ':' + a.external_id, a])).values()];
  const base = { sf_opp_id: sfOppId, bd_opportunity_id: o.id, entity_id: o.entity_id,
                 deal_name: o.deal_name || null, deal_stage: o.stage || null, deal_type: o.type || null };
  if (distinct.length === 0) return { status: 'unresolved', reason: 'deal_not_linked_to_property', ...base };
  if (distinct.length > 1) return { status: 'unresolved', reason: 'deal_linked_to_multiple_properties', ...base, assets: distinct };

  const asset = distinct[0];
  const domain = LONG[asset.source_system];
  if (seed.verticalDomain && seed.verticalDomain !== domain) {
    return { status: 'refused', reason: 'seed_cross_vertical', ...base,
             seed_vertical_domain: seed.verticalDomain, asset_domain: domain, property_id: String(asset.external_id) };
  }

  let propertyAddress = null;
  try {
    const p = await domainQuery(domain, 'GET',
      `properties?property_id=eq.${enc(asset.external_id)}&select=property_id,address&limit=1`);
    if (p?.ok && Array.isArray(p.data) && p.data[0]) propertyAddress = p.data[0].address || null;
  } catch { /* civic comparison degrades to unknown */ }

  return {
    status: 'resolved', reason: seed.kind === 'listing' ? 'sf_seed_listing' : 'sf_seed_opportunity',
    ...base, domain, property_id: String(asset.external_id), property_address: propertyAddress,
    own_listing: o.type === 'listing' || LISTING_STAGES.has(o.stage),
  };
}

// Turn an address match whose domain is 'lcc' (an LCC entity id) into its
// domain property, so it can be compared with the seed. Unknown → unchanged.
export async function translateLccMatch(match, deps) {
  if (!match || match.domain !== 'lcc' || !match.property_id) return match;
  try {
    const r = await deps.opsQuery('GET',
      `external_identities?entity_id=eq.${encodeURIComponent(match.property_id)}&source_type=eq.asset&select=source_system,external_id&limit=5`);
    const a = (r?.ok && Array.isArray(r.data) ? r.data : []).filter((x) => x && LONG[x.source_system]);
    if (a.length === 1) return { ...match, lcc_entity_id: match.property_id, domain: LONG[a[0].source_system], property_id: String(a[0].external_id) };
  } catch { /* leave unchanged */ }
  return match;
}

function seedNote(seed) {
  if (!seed) return null;
  const n = { status: seed.status, reason: seed.reason };
  for (const k of ['sf_opp_id', 'sf_listing_id', 'bd_opportunity_id', 'entity_id', 'domain', 'property_id',
                   'deal_stage', 'deal_type', 'own_listing', 'seed_vertical_domain', 'asset_domain']) {
    if (seed[k] !== undefined) n[k] = seed[k];
  }
  return n;
}

/**
 * Pure. addressMatch is the matcher's own verdict (possibly unmatched or
 * review_required with candidates). extractedAddress is the snapshot's subject
 * address (may be empty).
 */
export function reconcileSeedWithAddressMatch({ seed, addressMatch, extractedAddress }) {
  const am = addressMatch || { status: 'unmatched', confidence: 0, property_id: null, domain: null };
  if (!seed || seed.status !== 'resolved') {
    return seed && seed.reason !== 'no_sf_seed' ? { ...am, sf_seed: seedNote(seed) } : am;
  }

  const seedCand = { domain: seed.domain === 'dialysis' ? 'dia' : 'gov', property_id: seed.property_id,
                     address: seed.property_address || null, source: 'sf_seed', confidence: 0.9 };
  const sameProp = (m) => m && m.property_id != null && m.domain === seed.domain
    && String(m.property_id) === String(seed.property_id);
  const seedMatch = (reason, confidence) => ({
    status: 'matched', reason, confidence, domain: seed.domain, property_id: seed.property_id,
    sf_seed: seedNote(seed), address_match: am.status === 'matched' ? { domain: am.domain, property_id: am.property_id, reason: am.reason } : null,
  });
  const conflict = (reason) => ({
    status: 'review_required', reason, confidence: 0, property_id: null, domain: null,
    candidates: [seedCand, ...(am.property_id != null
      ? [{ domain: SHORT[am.domain] || am.domain, property_id: String(am.property_id), source: 'address_match', confidence: am.confidence || 0 }]
      : (Array.isArray(am.candidates) ? am.candidates : []))],
    sf_seed: seedNote(seed),
  });

  if (am.status === 'matched' && am.property_id != null) {
    if (sameProp(am)) return { ...am, reason: `${am.reason || 'address'}+sf_seed_agrees`, confidence: Math.max(0.95, am.confidence || 0), sf_seed: seedNote(seed) };
    return conflict('sf_seed_address_conflict');
  }

  const addr = typeof extractedAddress === 'string' ? extractedAddress.trim() : '';
  if (!addr) return seedMatch(seed.reason + '_no_extracted_address', 0.9);

  // Extracted an address, but the address matcher did not land. Does the
  // extracted address point at the seed's property? A near-miss candidate list
  // that contains the seed's property also counts as agreement.
  if (Array.isArray(am.candidates) && am.candidates.some((c) => c && String(c.property_id) === String(seed.property_id)
      && (LONG[c.domain] || c.domain) === seed.domain)) {
    return seedMatch(seed.reason + '_candidate_agrees', 0.9);
  }
  const civic = subjectAddressesAgree(addr, seed.property_address);
  if (civic === true) return seedMatch(seed.reason + '_address_agrees', 0.9);
  return conflict(civic === false ? 'sf_seed_address_conflict' : 'sf_seed_address_unverified');
}
