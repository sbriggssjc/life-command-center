// Shared Subject/Entity Resolver
// Phase 2 extraction: one envelope for resolved / ambiguous / not-on-file.

function enc(v) {
  return encodeURIComponent(String(v));
}

function isUuid(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || '').trim());
}

export function normalizeSubjectDomain(v) {
  const d = String(v || '').toLowerCase().trim();
  if (d === 'dia' || d === 'dialysis') return 'dia';
  if (d === 'gov' || d === 'government') return 'gov';
  if (d === 'cms' || d === 'medicare') return 'cms';
  return null;
}

function longDomain(short) {
  return short === 'gov' ? 'government' : 'dialysis';
}

function normalizeAddressLite(addr) {
  if (!addr) return '';
  return String(addr).split(',')[0].trim()
    .replace(/\bStreet\b/gi, 'St').replace(/\bAvenue\b/gi, 'Ave')
    .replace(/\bBoulevard\b/gi, 'Blvd').replace(/\bDrive\b/gi, 'Dr')
    .replace(/\bRoad\b/gi, 'Rd').replace(/\bLane\b/gi, 'Ln')
    .replace(/\bCourt\b/gi, 'Ct').replace(/\bPlace\b/gi, 'Pl')
    .replace(/\bHighway\b/gi, 'Hwy').replace(/\bParkway\b/gi, 'Pkwy')
    .replace(/\bCircle\b/gi, 'Cir').replace(/\bTrail\b/gi, 'Trl')
    .replace(/\s+/g, ' ').toLowerCase();
}

const ABBREV_MAP = {
  S: 'South', N: 'North', E: 'East', W: 'West',
  St: 'Street', Ave: 'Avenue', Blvd: 'Boulevard', Dr: 'Drive', Rd: 'Road',
};
const EXPAND_MAP = {};
const CONTRACT_MAP = {};
for (const [abbr, full] of Object.entries(ABBREV_MAP)) {
  EXPAND_MAP[abbr.toLowerCase()] = full;
  CONTRACT_MAP[full.toLowerCase()] = abbr;
}

function expandAddress(address) {
  return String(address || '').replace(/\b(\w+)\b/g, (match) => {
    const expanded = EXPAND_MAP[match.toLowerCase()];
    if (!expanded) return match;
    return match[0] === match[0].toUpperCase() ? expanded : expanded.toLowerCase();
  });
}

function contractAddress(address) {
  return String(address || '').replace(/\b(\w+)\b/g, (match) => CONTRACT_MAP[match.toLowerCase()] || match);
}

function uniqBy(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of arr || []) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function isJunkEntityRow(e) {
  const v = e?.metadata?.junk_name_flagged;
  return v === true || v === 'true';
}

function entityHasSf(e) {
  return (e?.external_identities || []).some((x) => x.source_system === 'salesforce' || x.source_system === 'sf');
}

function entityCandidate(entity, extra = {}) {
  if (!entity) return null;
  return {
    id: entity.id,
    entity_id: entity.id,
    type: entity.entity_type || extra.type || null,
    name: entity.name || null,
    address: entity.address || null,
    city: entity.city || null,
    state: entity.state || null,
    domain: entity.domain || extra.domain || null,
    confidence: extra.confidence ?? 0.9,
    resolved_via: extra.resolved_via || null,
    ...extra,
  };
}

function propertyCandidate(property, extra = {}) {
  if (!property) return null;
  return {
    id: `${extra.domain || property.domain || 'domain'}:${property.property_id}`,
    property_id: property.property_id,
    type: 'asset',
    name: property.address || property.name || null,
    address: property.address || null,
    city: property.city || null,
    state: property.state || null,
    domain: extra.domain || property.domain || null,
    confidence: extra.confidence ?? 0.86,
    resolved_via: extra.resolved_via || 'domain_property_address',
    domain_property: { domain: extra.domain || property.domain || null, ...property },
  };
}

function envelope(status, fields = {}) {
  const candidates = Array.isArray(fields.candidates) ? fields.candidates.filter(Boolean) : [];
  return {
    status,
    entity: fields.entity ?? null,
    type: fields.type ?? fields.entity?.entity_type ?? fields.candidate?.type ?? null,
    confidence: fields.confidence ?? (status === 'resolved' ? 1 : 0),
    resolved_via: fields.resolved_via ?? null,
    candidates,
    ...(fields.domain_property ? { domain_property: fields.domain_property } : {}),
    ...(fields.raw_ref !== undefined ? { raw_ref: fields.raw_ref } : {}),
    ...(fields.error ? { error: fields.error } : {}),
    ...(fields.note ? { note: fields.note } : {}),
  };
}

async function safeQuery(fn, method, path, fallback = []) {
  if (!fn) return { data: fallback };
  try {
    return await fn(method, path);
  } catch {
    return { data: fallback };
  }
}

async function fetchValueMap(ids, opsQuery) {
  const map = new Map();
  const clean = (ids || []).filter(Boolean);
  if (!clean.length || !opsQuery) return map;
  const r = await safeQuery(
    opsQuery,
    'GET',
    `v_priority_queue_enriched?entity_id=in.(${clean.map(enc).join(',')})&select=entity_id,rank_annual_rent`,
    []
  );
  for (const row of r.data || []) {
    const val = Number(row.rank_annual_rent) || 0;
    if (val > (map.get(row.entity_id) || 0)) map.set(row.entity_id, val);
  }
  return map;
}

async function rankEntities(rows, opsQuery, canonicalId = null) {
  const list = uniqBy((rows || []).filter((e) => !isJunkEntityRow(e)), (e) => e.id);
  const valueMap = await fetchValueMap(list.map((e) => e.id), opsQuery);
  list.sort((a, b) => {
    if (canonicalId) {
      if (a.id === canonicalId && b.id !== canonicalId) return -1;
      if (b.id === canonicalId && a.id !== canonicalId) return 1;
    }
    const va = valueMap.get(a.id) || 0;
    const vb = valueMap.get(b.id) || 0;
    if (vb !== va) return vb - va;
    const sa = entityHasSf(a) ? 1 : 0;
    const sb = entityHasSf(b) ? 1 : 0;
    if (sb !== sa) return sb - sa;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
  return { rows: list, valueMap };
}

async function fetchEntitiesByIds(ids, opsQuery, select) {
  const clean = [...new Set((ids || []).filter(Boolean))];
  if (!clean.length) return [];
  const r = await safeQuery(opsQuery, 'GET', `entities?id=in.(${clean.map(enc).join(',')})&select=${select}`, []);
  return r.data || [];
}

async function entityForPropertyIdentity(dom, propertyId, opsQuery, select) {
  const idRes = await safeQuery(
    opsQuery,
    'GET',
    `external_identities?source_system=eq.${enc(dom)}&source_type=eq.asset` +
      `&external_id=eq.${enc(propertyId)}&select=entity_id,source_system,source_type,external_id`,
    []
  );
  const ids = uniqBy(idRes.data || [], (r) => r.entity_id).map((r) => r.entity_id);
  const entities = await fetchEntitiesByIds(ids, opsQuery, select);
  return entities.map((entity) => ({ entity, dom, property_id: propertyId }));
}

async function resolveCanonicalParent(name, opsQuery, select) {
  if (!name || !opsQuery) return null;
  try {
    const r = await opsQuery('POST', 'rpc/lcc_match_buyer_parent_by_name', { p_name: String(name) });
    const row = r.ok && Array.isArray(r.data) ? r.data[0] : null;
    if (!row?.parent_entity_id) return null;
    const er = await safeQuery(opsQuery, 'GET', `entities?id=eq.${enc(row.parent_entity_id)}&select=${select}`, []);
    const entity = er.data?.[0] || null;
    return entity ? { entity, parent_name: row.parent_name || entity.name } : null;
  } catch {
    return null;
  }
}

function domainFnsFor(opts, short) {
  if (opts.domainQueries?.[short]) return opts.domainQueries[short];
  if (opts.domainQuery) {
    return (method, path) => opts.domainQuery(longDomain(short), method, path);
  }
  if (short === 'dia' && opts.diaQuery) return opts.diaQuery;
  if (short === 'gov' && opts.govQuery) return opts.govQuery;
  return null;
}

function domainAvailable(opts, short) {
  if (opts.domainAvailable) return !!opts.domainAvailable(short);
  if (opts.getDomainCredentials) return !!opts.getDomainCredentials(longDomain(short));
  return !!domainFnsFor(opts, short);
}

async function findDomainPropertiesByAddress(address, opts, domain = null) {
  const domains = domain ? [domain] : ['dia', 'gov'];
  const variants = [...new Set([
    address,
    expandAddress(address),
    contractAddress(address),
    normalizeAddressLite(address),
  ].filter(Boolean))];
  const out = [];
  for (const dom of domains) {
    if (!domainAvailable(opts, dom)) continue;
    const q = domainFnsFor(opts, dom);
    const extra = dom === 'gov' ? ',agency' : ',tenant,operator,chain_canonical';
    for (const variant of variants) {
      const r = await safeQuery(
        q,
        'GET',
        `properties?address=ilike.*${enc(variant)}*&select=property_id,address,city,state${extra}&limit=25`,
        []
      );
      for (const p of r.data || []) out.push({ domain: dom, property: p });
    }
  }
  return uniqBy(out, (x) => `${x.domain}:${x.property.property_id}`);
}

async function resolveProperty(ref, opts) {
  const opsQuery = opts.opsQuery;
  const raw = ref;
  const input = typeof ref === 'object' && ref !== null ? ref : { q: ref };
  let entity_id = input.entity_id || input.entityId || null;
  let address = input.address || null;
  let property_id = input.property_id || input.propertyId || null;
  let domain = normalizeSubjectDomain(input.domain);
  const q = input.q || input.ref || input.name || null;

  if (!entity_id && !address && !property_id && q) {
    const trimmed = String(q).trim();
    const domainProperty = trimmed.match(/^(dia|dialysis|gov|government):(.+)$/i);
    if (domainProperty) {
      domain = normalizeSubjectDomain(domainProperty[1]);
      property_id = domainProperty[2];
    } else if (/^\d+$/.test(trimmed)) {
      property_id = trimmed;
    } else if (isUuid(trimmed) || /^[a-z]+:/i.test(trimmed)) {
      entity_id = trimmed;
    } else {
      address = trimmed;
    }
  }

  const select = opts.propertyEntitySelect ||
    '*,external_identities(*),entity_relationships!entity_relationships_from_entity_id_fkey(*)';

  if (entity_id) {
    const r = await safeQuery(opsQuery, 'GET', `entities?id=eq.${enc(entity_id)}&entity_type=eq.asset&select=${select}`, []);
    const entity = r.data?.[0] || null;
    if (!entity) return envelope('not_on_file', { raw_ref: raw, type: 'asset', error: 'Property not found' });
    return envelope('resolved', {
      raw_ref: raw,
      entity,
      type: 'asset',
      confidence: 1,
      resolved_via: 'entity_id',
      candidates: [entityCandidate(entity, { confidence: 1, resolved_via: 'entity_id' })],
    });
  }

  if (property_id !== null && property_id !== undefined && String(property_id).trim() !== '') {
    const domains = domain ? [domain] : ['dia', 'gov'];
    const identityHits = [];
    for (const dom of domains) identityHits.push(...await entityForPropertyIdentity(dom, property_id, opsQuery, select));
    const ranked = await rankEntities(identityHits.map((x) => x.entity), opsQuery);
    const candidates = ranked.rows.map((entity) => {
      const hit = identityHits.find((x) => x.entity.id === entity.id);
      return entityCandidate(entity, {
        domain: hit?.dom || entity.domain,
        property_id,
        confidence: 1,
        resolved_via: 'property_identity',
      });
    });
    if (candidates.length > 1) {
      return envelope('ambiguous', { raw_ref: raw, type: 'asset', confidence: 0, resolved_via: 'property_identity', candidates });
    }
    if (candidates.length === 1) {
      return envelope('resolved', {
        raw_ref: raw,
        entity: ranked.rows[0],
        type: 'asset',
        confidence: 1,
        resolved_via: 'property_identity',
        candidates,
      });
    }
  }

  if (address) {
    const domainHits = await findDomainPropertiesByAddress(address, opts, domain);
    const entityHits = [];
    for (const hit of domainHits) {
      const linked = await entityForPropertyIdentity(hit.domain, hit.property.property_id, opsQuery, select);
      if (linked.length) entityHits.push(...linked);
    }
    const ranked = await rankEntities(entityHits.map((x) => x.entity), opsQuery);
    const entityCandidates = ranked.rows.map((entity) => {
      const hit = entityHits.find((x) => x.entity.id === entity.id);
      return entityCandidate(entity, {
        domain: hit?.dom || entity.domain,
        property_id: hit?.property_id,
        confidence: 0.96,
        resolved_via: 'domain_property_identity',
      });
    });
    if (entityCandidates.length > 1) {
      return envelope('ambiguous', { raw_ref: raw, type: 'asset', confidence: 0, resolved_via: 'domain_property_identity', candidates: entityCandidates });
    }
    if (entityCandidates.length === 1) {
      return envelope('resolved', {
        raw_ref: raw,
        entity: ranked.rows[0],
        type: 'asset',
        confidence: 0.96,
        resolved_via: 'domain_property_identity',
        candidates: entityCandidates,
      });
    }

    const opsRes = await safeQuery(
      opsQuery,
      'GET',
      `entities?entity_type=eq.asset&or=(address.ilike.*${enc(address)}*,name.ilike.*${enc(address)}*)` +
        `&select=${select}&limit=25`,
      []
    );
    const opsRanked = await rankEntities(opsRes.data || [], opsQuery);
    const opsCandidates = opsRanked.rows.map((entity) => entityCandidate(entity, {
      confidence: 0.9,
      resolved_via: 'asset_address_name',
    }));
    if (opsCandidates.length > 1) {
      return envelope('ambiguous', { raw_ref: raw, type: 'asset', confidence: 0, resolved_via: 'asset_address_name', candidates: opsCandidates });
    }
    if (opsCandidates.length === 1) {
      return envelope('resolved', {
        raw_ref: raw,
        entity: opsRanked.rows[0],
        type: 'asset',
        confidence: 0.9,
        resolved_via: 'asset_address_name',
        candidates: opsCandidates,
      });
    }

    const domainCandidates = domainHits.map((hit) => propertyCandidate(hit.property, {
      domain: hit.domain,
      confidence: 0.86,
      resolved_via: 'domain_property_address',
    }));
    if (domainCandidates.length > 1) {
      return envelope('ambiguous', { raw_ref: raw, type: 'asset', confidence: 0, resolved_via: 'domain_property_address', candidates: domainCandidates });
    }
    if (domainCandidates.length === 1) {
      return envelope('resolved', {
        raw_ref: raw,
        entity: null,
        type: 'asset',
        confidence: 0.86,
        resolved_via: 'domain_property_address',
        candidates: domainCandidates,
        domain_property: domainCandidates[0].domain_property,
        note: 'No LCC asset entity for this property yet; resolved directly from a domain database.',
      });
    }
  }

  return envelope('not_on_file', { raw_ref: raw, type: 'asset', error: 'Property not found' });
}

async function resolveContact(ref, opts) {
  const opsQuery = opts.opsQuery;
  const raw = ref;
  const input = typeof ref === 'object' && ref !== null ? ref : { q: ref };
  let entity_id = input.entity_id || input.entityId || null;
  let email = input.email || null;
  let name = input.name || null;
  const q = input.q || input.ref || null;
  if (!entity_id && !email && !name && q) {
    const trimmed = String(q).trim();
    if (isUuid(trimmed) || /^[a-z]+:/i.test(trimmed)) entity_id = trimmed;
    else if (trimmed.includes('@')) email = trimmed;
    else name = trimmed;
  }

  const select = opts.contactEntitySelect || '*,metadata,external_identities(*)';

  if (entity_id) {
    const r = await safeQuery(opsQuery, 'GET', `entities?id=eq.${enc(entity_id)}&select=${select}`, []);
    const entity = r.data?.[0] || null;
    if (!entity || isJunkEntityRow(entity)) return envelope('not_on_file', { raw_ref: raw, error: 'Contact not found' });
    return envelope('resolved', {
      raw_ref: raw,
      entity,
      type: entity.entity_type || 'person',
      confidence: 1,
      resolved_via: 'entity_id',
      candidates: [entityCandidate(entity, { confidence: 1, resolved_via: 'entity_id' })],
    });
  }

  if (email) {
    const r = await safeQuery(
      opsQuery,
      'GET',
      `entities?entity_type=eq.person&email=eq.${enc(email)}&select=${select}&limit=25`,
      []
    );
    const ranked = await rankEntities(r.data || [], opsQuery);
    const candidates = ranked.rows.map((entity) => entityCandidate(entity, { confidence: 0.98, resolved_via: 'email' }));
    if (candidates.length > 1) return envelope('ambiguous', { raw_ref: raw, type: 'person', confidence: 0, resolved_via: 'email', candidates });
    if (candidates.length === 1) return envelope('resolved', { raw_ref: raw, entity: ranked.rows[0], type: ranked.rows[0].entity_type, confidence: 0.98, resolved_via: 'email', candidates });
  }

  if (name) {
    const canonical = await resolveCanonicalParent(name, opsQuery, select);
    if (canonical?.entity) {
      return envelope('resolved', {
        raw_ref: raw,
        entity: canonical.entity,
        type: canonical.entity.entity_type,
        confidence: 0.98,
        resolved_via: 'canonical_buyer_parent',
        candidates: [entityCandidate(canonical.entity, {
          confidence: 0.98,
          resolved_via: 'canonical_buyer_parent',
          canonical_parent_name: canonical.parent_name,
        })],
      });
    }
    const r = await safeQuery(
      opsQuery,
      'GET',
      `entities?or=(name.ilike.*${enc(name)}*,canonical_name.ilike.*${enc(String(name).toLowerCase())}*)&select=${select}&limit=25`,
      []
    );
    const ranked = await rankEntities(r.data || [], opsQuery);
    const candidates = ranked.rows.map((entity) => entityCandidate(entity, { confidence: 0.88, resolved_via: 'contact_name' }));
    if (candidates.length > 1) return envelope('ambiguous', { raw_ref: raw, confidence: 0, resolved_via: 'contact_name', candidates });
    if (candidates.length === 1) return envelope('resolved', { raw_ref: raw, entity: ranked.rows[0], type: ranked.rows[0].entity_type, confidence: 0.88, resolved_via: 'contact_name', candidates });
  }

  return envelope('not_on_file', { raw_ref: raw, error: 'Contact not found' });
}

export async function logSubjectResolution(envelopeResult, opts = {}) {
  const logRow = {
    raw_ref: opts.raw_ref ?? envelopeResult?.raw_ref ?? null,
    status: envelopeResult?.status || 'not_on_file',
    chosen_entity: envelopeResult?.entity?.id || envelopeResult?.domain_property?.property_id || null,
    candidates_n: Array.isArray(envelopeResult?.candidates) ? envelopeResult.candidates.length : 0,
    tool: opts.tool || null,
  };

  if (typeof opts.log === 'function') {
    try {
      await opts.log(logRow, envelopeResult);
    } catch {
      // Logging must never change resolver behavior.
    }
    return logRow;
  }
  if (opts.opsQuery) {
    const payload = {
      surface: opts.surface || 'unknown',
      tool: logRow.tool,
      raw_request: typeof logRow.raw_ref === 'string' ? logRow.raw_ref : JSON.stringify(logRow.raw_ref),
      raw_args: typeof logRow.raw_ref === 'object' ? logRow.raw_ref : { ref: logRow.raw_ref },
      resolved_subject: {
        chosen_entity: logRow.chosen_entity,
        candidates_n: logRow.candidates_n,
      },
      resolution_status: logRow.status,
      confidence: envelopeResult?.confidence ?? null,
      alternatives: envelopeResult?.candidates || [],
    };
    await opts.opsQuery('POST', 'interpretation_logs', payload).catch(() => {});
  }
  if (opts.console !== false) {
    console.log('[subject-resolver]', JSON.stringify(logRow));
  }
  return logRow;
}

export async function resolveSubject(ref, opts = {}) {
  const type = opts.type || opts.subject_type || opts.kind || 'entity';
  let result;
  if (type === 'property' || type === 'asset') {
    result = await resolveProperty(ref, opts);
  } else if (type === 'contact' || type === 'person' || type === 'organization') {
    result = await resolveContact(ref, opts);
  } else {
    result = envelope('not_on_file', { raw_ref: ref, error: `Unsupported resolver type: ${type}` });
  }
  await logSubjectResolution(result, { ...opts, raw_ref: ref });
  return result;
}

export function resolutionHttpStatus(result) {
  if (result?.status === 'ambiguous') return 409;
  if (result?.status === 'not_on_file') return 404;
  return 200;
}
