// ============================================================================
// Entities API — Canonical business entities (person, org, asset)
// Life Command Center — Phase 2
//
// GET    /api/entities                  — list/search entities
// GET    /api/entities?id=<uuid>        — get entity with external identities
// POST   /api/entities                  — create entity
// PATCH  /api/entities?id=<uuid>        — update entity
// POST   /api/entities?action=link      — link external identity to entity
// GET    /api/entities?action=search&q= — search by name across types
// ============================================================================

import { authenticate, requireRole, handleCors } from './_shared/auth.js';
import { opsQuery, paginationParams, requireOps } from './_shared/ops-db.js';
import { ENTITY_TYPES, DOMAINS, isValidEnum } from './_shared/lifecycle.js';

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (requireOps(res)) return;

  const user = await authenticate(req, res);
  if (!user) return;

  const workspaceId = req.headers['x-lcc-workspace'] || user.memberships[0]?.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context' });

  const membership = user.memberships.find(m => m.workspace_id === workspaceId);
  if (!membership) return res.status(403).json({ error: 'Not a member of this workspace' });

  // GET
  if (req.method === 'GET') {
    const { id, action, q, entity_type, domain } = req.query;

    // Single entity with related data
    if (id) {
      const result = await opsQuery('GET',
        `entities?id=eq.${id}&workspace_id=eq.${workspaceId}&select=*,external_identities(*),entity_aliases(*),entity_relationships!entity_relationships_from_entity_id_fkey(*)`
      );
      if (!result.ok || !result.data?.length) {
        return res.status(404).json({ error: 'Entity not found' });
      }
      return res.status(200).json({ entity: result.data[0] });
    }

    // Search by name
    if (action === 'search' && q) {
      const searchTerm = q.replace(/[%_]/g, '').trim();
      if (searchTerm.length < 2) {
        return res.status(400).json({ error: 'Search term must be at least 2 characters' });
      }

      let path = `entities?workspace_id=eq.${workspaceId}&or=(name.ilike.*${encodeURIComponent(searchTerm)}*,canonical_name.ilike.*${encodeURIComponent(searchTerm.toLowerCase())}*)&select=id,entity_type,name,domain,city,state,email,org_type,asset_type`;
      if (entity_type && isValidEnum(entity_type, ENTITY_TYPES)) {
        path += `&entity_type=eq.${entity_type}`;
      }
      if (domain && isValidEnum(domain, DOMAINS)) {
        path += `&domain=eq.${domain}`;
      }
      path += '&limit=50&order=name';

      const result = await opsQuery('GET', path);
      return res.status(200).json({ entities: result.data || [], count: result.count });
    }

    // List with filters
    let path = `entities?workspace_id=eq.${workspaceId}&select=id,entity_type,name,domain,city,state,email,org_type,asset_type,created_at`;
    if (entity_type && isValidEnum(entity_type, ENTITY_TYPES)) {
      path += `&entity_type=eq.${entity_type}`;
    }
    if (domain && isValidEnum(domain, DOMAINS)) {
      path += `&domain=eq.${domain}`;
    }
    path += paginationParams(req.query);

    const result = await opsQuery('GET', path);
    return res.status(200).json({ entities: result.data || [], count: result.count });
  }

  // POST — create entity or link external identity
  if (req.method === 'POST') {
    if (!requireRole(user, 'operator', workspaceId)) {
      return res.status(403).json({ error: 'Operator role required' });
    }

    // Link external identity
    if (req.query.action === 'link') {
      const { entity_id, source_system, source_type, external_id, external_url, metadata } = req.body || {};
      if (!entity_id || !source_system || !source_type || !external_id) {
        return res.status(400).json({ error: 'entity_id, source_system, source_type, and external_id are required' });
      }

      const result = await opsQuery('POST', 'external_identities', {
        workspace_id: workspaceId,
        entity_id,
        source_system,
        source_type,
        external_id,
        external_url: external_url || null,
        metadata: metadata || {},
        last_synced_at: new Date().toISOString()
      }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });

      if (!result.ok) {
        return res.status(result.status).json({ error: 'Failed to link identity', detail: result.data });
      }

      return res.status(201).json({ identity: Array.isArray(result.data) ? result.data[0] : result.data });
    }

    // Create entity
    const { entity_type, name, domain: entityDomain, ...fields } = req.body || {};

    if (!entity_type || !isValidEnum(entity_type, ENTITY_TYPES)) {
      return res.status(400).json({ error: `entity_type must be one of: ${ENTITY_TYPES.join(', ')}` });
    }
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'name is required' });
    }

    // Build canonical name for dedup
    const canonical_name = name.trim().toLowerCase()
      .replace(/\b(llc|inc|corp|ltd|co|company|group|partners|lp|llp)\b\.?/gi, '')
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const entity = {
      workspace_id: workspaceId,
      entity_type,
      name: name.trim(),
      canonical_name,
      domain: entityDomain || null,
      created_by: user.id,
      ...pickEntityFields(entity_type, fields)
    };

    const result = await opsQuery('POST', 'entities', entity);
    if (!result.ok) {
      return res.status(result.status).json({ error: 'Failed to create entity', detail: result.data });
    }

    return res.status(201).json({ entity: Array.isArray(result.data) ? result.data[0] : result.data });
  }

  // PATCH — update entity
  if (req.method === 'PATCH') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id query parameter required' });

    if (!requireRole(user, 'operator', workspaceId)) {
      return res.status(403).json({ error: 'Operator role required' });
    }

    const { name, domain: entityDomain, tags, metadata, ...fields } = req.body || {};
    const updates = { updated_at: new Date().toISOString() };

    if (name) {
      updates.name = name.trim();
      updates.canonical_name = name.trim().toLowerCase()
        .replace(/\b(llc|inc|corp|ltd|co|company|group|partners|lp|llp)\b\.?/gi, '')
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }
    if (entityDomain !== undefined) updates.domain = entityDomain;
    if (tags !== undefined) updates.tags = tags;
    if (metadata !== undefined) updates.metadata = metadata;

    // Pick type-appropriate fields
    const allowedFields = ['description', 'first_name', 'last_name', 'title', 'phone', 'email',
      'org_type', 'address', 'city', 'state', 'zip', 'county', 'latitude', 'longitude', 'asset_type'];
    for (const f of allowedFields) {
      if (fields[f] !== undefined) updates[f] = fields[f];
    }

    const result = await opsQuery('PATCH',
      `entities?id=eq.${id}&workspace_id=eq.${workspaceId}`,
      updates
    );
    if (!result.ok) return res.status(result.status).json({ error: 'Failed to update entity' });

    return res.status(200).json({ entity: Array.isArray(result.data) ? result.data[0] : result.data });
  }

  return res.status(405).json({ error: `Method ${req.method} not allowed` });
}

/** Pick only fields relevant to the entity type */
function pickEntityFields(type, fields) {
  const picked = {};
  const common = ['description'];
  const person = ['first_name', 'last_name', 'title', 'phone', 'email'];
  const org = ['org_type'];
  const asset = ['address', 'city', 'state', 'zip', 'county', 'latitude', 'longitude', 'asset_type'];

  const allowed = [...common,
    ...(type === 'person' ? person : []),
    ...(type === 'organization' ? org : []),
    ...(type === 'asset' ? asset : [])
  ];

  for (const f of allowed) {
    if (fields[f] !== undefined) picked[f] = fields[f];
  }
  return picked;
}
