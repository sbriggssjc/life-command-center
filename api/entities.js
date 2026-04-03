// ============================================================================
// Entities API — Canonical business entities (person, org, asset)
// Life Command Center — Phase 2
//
// GET    /api/entities                        — list/search entities
// GET    /api/entities?id=<uuid>              — get entity with external identities
// POST   /api/entities                        — create entity
// PATCH  /api/entities?id=<uuid>              — update entity
// POST   /api/entities?action=link            — link external identity to entity
// GET    /api/entities?action=search&q=       — search by name across types
// GET    /api/entities?action=duplicates      — find duplicate candidates
// POST   /api/entities?action=merge           — merge two entities (manager+)
// POST   /api/entities?action=add_alias       — add alias for entity
// GET    /api/entities?action=quality         — data quality dashboard
// ============================================================================

import { authenticate, requireRole, handleCors } from './_shared/auth.js';
import { opsQuery, paginationParams, requireOps, withErrorHandler } from './_shared/ops-db.js';
import { ENTITY_TYPES, DOMAINS, isValidEnum } from './_shared/lifecycle.js';

function pageMeta(page, perPage, totalCount) {
  const totalPages = Math.ceil((totalCount || 0) / perPage);
  return {
    page,
    per_page: perPage,
    total: totalCount || 0,
    total_pages: totalPages,
    has_next: page < totalPages,
    has_prev: page > 1
  };
}

export default withErrorHandler(async function handler(req, res) {
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

    // Duplicate candidates — entities with matching canonical names or similar names
    if (action === 'duplicates') {
      const result = await opsQuery('GET',
        `entities?workspace_id=eq.${workspaceId}&select=id,entity_type,name,canonical_name,domain,city,state&order=canonical_name,name`
      );
      const entities = result.data || [];

      // Group by canonical_name to find exact duplicates
      const byCanonical = {};
      for (const e of entities) {
        const key = e.canonical_name || e.name.toLowerCase();
        if (!byCanonical[key]) byCanonical[key] = [];
        byCanonical[key].push(e);
      }

      const duplicates = [];
      for (const [canonical, group] of Object.entries(byCanonical)) {
        if (group.length > 1) {
          duplicates.push({
            canonical_name: canonical,
            match_type: 'exact_canonical',
            count: group.length,
            entities: group
          });
        }
      }

      // Also find near-matches using prefix similarity (first 10 chars)
      const prefixGroups = {};
      for (const e of entities) {
        const prefix = (e.canonical_name || '').substring(0, 10);
        if (prefix.length >= 5) {
          if (!prefixGroups[prefix]) prefixGroups[prefix] = [];
          prefixGroups[prefix].push(e);
        }
      }
      const nearMatches = [];
      for (const [prefix, group] of Object.entries(prefixGroups)) {
        if (group.length > 1) {
          // Only include if not already caught by exact match
          const canonicals = new Set(group.map(e => e.canonical_name));
          if (canonicals.size > 1) {
            nearMatches.push({
              prefix,
              match_type: 'prefix_similarity',
              count: group.length,
              entities: group
            });
          }
        }
      }

      return res.status(200).json({
        exact_duplicates: duplicates,
        near_matches: nearMatches,
        total_entities: entities.length,
        duplicate_groups: duplicates.length,
        near_match_groups: nearMatches.length
      });
    }

    // Data quality dashboard
    if (action === 'quality') {
      const [entities, identities, aliases, orphanedActions, orphanedInbox] = await Promise.all([
        opsQuery('GET', `entities?workspace_id=eq.${workspaceId}&select=id,entity_type,name,domain,email,phone,address,city,state`),
        opsQuery('GET', `external_identities?workspace_id=eq.${workspaceId}&select=id,entity_id,source_system,last_synced_at`),
        opsQuery('GET', `entity_aliases?workspace_id=eq.${workspaceId}&select=id,entity_id`),
        opsQuery('GET', `action_items?workspace_id=eq.${workspaceId}&entity_id=is.null&status=neq.cancelled&select=id&limit=100`),
        opsQuery('GET', `inbox_items?workspace_id=eq.${workspaceId}&status=in.(new,triaged)&select=id&limit=100`)
      ]);

      const entityList = entities.data || [];
      const identityList = identities.data || [];
      const linkedEntityIds = new Set(identityList.map(i => i.entity_id));
      const staleThreshold = new Date(Date.now() - 7 * 86400000).toISOString();
      const staleIdentities = identityList.filter(i => i.last_synced_at && i.last_synced_at < staleThreshold);

      // Entities missing key fields by type
      const missingFields = {
        persons_without_email: entityList.filter(e => e.entity_type === 'person' && !e.email).length,
        persons_without_phone: entityList.filter(e => e.entity_type === 'person' && !e.phone).length,
        assets_without_address: entityList.filter(e => e.entity_type === 'asset' && !e.address).length,
        assets_without_state: entityList.filter(e => e.entity_type === 'asset' && !e.state).length,
        entities_without_domain: entityList.filter(e => !e.domain).length
      };

      return res.status(200).json({
        total_entities: entityList.length,
        by_type: {
          person: entityList.filter(e => e.entity_type === 'person').length,
          organization: entityList.filter(e => e.entity_type === 'organization').length,
          asset: entityList.filter(e => e.entity_type === 'asset').length
        },
        linked_to_external: linkedEntityIds.size,
        unlinked: entityList.length - linkedEntityIds.size,
        total_identities: identityList.length,
        stale_identities: staleIdentities.length,
        total_aliases: (aliases.data || []).length,
        missing_fields: missingFields,
        orphaned_actions: (orphanedActions.data || []).length,
        orphaned_inbox: (orphanedInbox.data || []).length,
        checked_at: new Date().toISOString()
      });
    }

    if (action === 'quality_details') {
      const [duplicates, unlinked, stale, completeness, orphaned, precedence] = await Promise.all([
        opsQuery('GET', `v_duplicate_candidates?workspace_id=eq.${workspaceId}&limit=25`),
        opsQuery('GET', `v_unlinked_entities?workspace_id=eq.${workspaceId}&limit=25`),
        opsQuery('GET', `v_stale_identities?workspace_id=eq.${workspaceId}&limit=25`),
        opsQuery('GET', `v_entity_completeness?workspace_id=eq.${workspaceId}&order=completeness_score.asc&limit=25`),
        opsQuery('GET', `v_orphaned_actions?workspace_id=eq.${workspaceId}&limit=25`),
        opsQuery('GET', `source_precedence?workspace_id=eq.${workspaceId}&order=precedence.desc&limit=25`)
      ]);

      return res.status(200).json({
        duplicate_candidates: duplicates.data || [],
        unlinked_entities: unlinked.data || [],
        stale_identities: stale.data || [],
        low_completeness: (completeness.data || []).filter(row => (row.completeness_score || 0) < 60),
        orphaned_actions: orphaned.data || [],
        source_precedence: precedence.data || []
      });
    }

    // Search by name
    if (action === 'search' && q) {
      const searchTerm = q.replace(/[%_]/g, '').trim();
      if (searchTerm.length < 2) {
        return res.status(400).json({ error: 'Search term must be at least 2 characters' });
      }

      let path = `entities?workspace_id=eq.${workspaceId}&or=(name.ilike.*${encodeURIComponent(searchTerm)}*,canonical_name.ilike.*${encodeURIComponent(searchTerm.toLowerCase())}*)&select=id,entity_type,name,domain,city,state,email,phone,address,org_type,asset_type,external_identities(source_system,source_type,external_id)`;
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
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const perPage = Math.min(Math.max(parseInt(req.query.per_page) || parseInt(req.query.limit) || 50, 1), 100);
    const offset = (page - 1) * perPage;

    let path = `entities?workspace_id=eq.${workspaceId}&select=id,entity_type,name,domain,city,state,email,org_type,asset_type,created_at`;
    if (entity_type && isValidEnum(entity_type, ENTITY_TYPES)) {
      path += `&entity_type=eq.${entity_type}`;
    }
    if (domain && isValidEnum(domain, DOMAINS)) {
      path += `&domain=eq.${domain}`;
    }
    const rawOrder = req.query.order || 'created_at.desc';
    const safeOrder = /^[a-zA-Z0-9_.,]+$/.test(rawOrder) ? rawOrder : 'created_at.desc';
    path += `&limit=${perPage}&offset=${offset}&order=${safeOrder}`;

    const result = await opsQuery('GET', path);
    return res.status(200).json({
      entities: result.data || [],
      count: result.count,
      pagination: pageMeta(page, perPage, result.count)
    });
  }

  // POST — create entity or link external identity
  if (req.method === 'POST') {
    if (!requireRole(user, 'operator', workspaceId)) {
      return res.status(403).json({ error: 'Operator role required' });
    }

    // Add alias
    if (req.query.action === 'add_alias') {
      const { entity_id, alias_name, source } = req.body || {};
      if (!entity_id || !alias_name) {
        return res.status(400).json({ error: 'entity_id and alias_name are required' });
      }

      const alias_canonical = alias_name.trim().toLowerCase()
        .replace(/\b(llc|inc|corp|ltd|co|company|group|partners|lp|llp)\b\.?/gi, '')
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      const result = await opsQuery('POST', 'entity_aliases', {
        workspace_id: workspaceId,
        entity_id,
        alias_name: alias_name.trim(),
        alias_canonical,
        source: source || 'manual'
      }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });

      if (!result.ok) {
        return res.status(result.status).json({ error: 'Failed to add alias', detail: result.data });
      }
      return res.status(201).json({ alias: Array.isArray(result.data) ? result.data[0] : result.data });
    }

    if (req.query.action === 'set_precedence') {
      const { field_name, source_system, precedence } = req.body || {};
      const parsed = Number(precedence);
      if (!field_name || !source_system || Number.isNaN(parsed)) {
        return res.status(400).json({ error: 'field_name, source_system, and numeric precedence are required' });
      }

      const result = await opsQuery('POST', 'source_precedence', {
        workspace_id: workspaceId,
        field_name: String(field_name).trim(),
        source_system: String(source_system).trim(),
        precedence: parsed
      }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });

      if (!result.ok) {
        return res.status(result.status).json({ error: 'Failed to set source precedence', detail: result.data });
      }
      return res.status(201).json({ precedence: Array.isArray(result.data) ? result.data[0] : result.data });
    }

    // Merge two entities — moves all relationships, identities, aliases, actions, inbox items to target
    if (req.query.action === 'merge') {
      if (!requireRole(user, 'manager', workspaceId)) {
        return res.status(403).json({ error: 'Manager role required to merge entities' });
      }

      const { target_id, source_id } = req.body || {};
      if (!target_id || !source_id) {
        return res.status(400).json({ error: 'target_id and source_id are required' });
      }
      if (target_id === source_id) {
        return res.status(400).json({ error: 'Cannot merge entity with itself' });
      }

      // Verify both entities exist
      const [targetRes, sourceRes] = await Promise.all([
        opsQuery('GET', `entities?id=eq.${target_id}&workspace_id=eq.${workspaceId}&select=id,name`),
        opsQuery('GET', `entities?id=eq.${source_id}&workspace_id=eq.${workspaceId}&select=id,name`)
      ]);

      if (!targetRes.data?.length) return res.status(404).json({ error: 'Target entity not found' });
      if (!sourceRes.data?.length) return res.status(404).json({ error: 'Source entity not found' });

      const targetEntity = targetRes.data[0];
      const sourceEntity = sourceRes.data[0];

      // Move external identities from source to target
      await opsQuery('PATCH',
        `external_identities?entity_id=eq.${source_id}&workspace_id=eq.${workspaceId}`,
        { entity_id: target_id }
      );

      // Move aliases from source to target
      await opsQuery('PATCH',
        `entity_aliases?entity_id=eq.${source_id}&workspace_id=eq.${workspaceId}`,
        { entity_id: target_id }
      );

      // Add source name as alias on target
      const sourceCanonical = sourceEntity.name.trim().toLowerCase()
        .replace(/\b(llc|inc|corp|ltd|co|company|group|partners|lp|llp)\b\.?/gi, '')
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      await opsQuery('POST', 'entity_aliases', {
        workspace_id: workspaceId,
        entity_id: target_id,
        alias_name: sourceEntity.name,
        alias_canonical: sourceCanonical,
        source: `merged_from:${source_id}`
      }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });

      // Move relationships
      await opsQuery('PATCH',
        `entity_relationships?from_entity_id=eq.${source_id}&workspace_id=eq.${workspaceId}`,
        { from_entity_id: target_id }
      );
      await opsQuery('PATCH',
        `entity_relationships?to_entity_id=eq.${source_id}&workspace_id=eq.${workspaceId}`,
        { to_entity_id: target_id }
      );

      // Move action items
      await opsQuery('PATCH',
        `action_items?entity_id=eq.${source_id}&workspace_id=eq.${workspaceId}`,
        { entity_id: target_id }
      );

      // Move activity events
      await opsQuery('PATCH',
        `activity_events?entity_id=eq.${source_id}&workspace_id=eq.${workspaceId}`,
        { entity_id: target_id }
      );

      // Move watchers
      await opsQuery('PATCH',
        `watchers?entity_id=eq.${source_id}&workspace_id=eq.${workspaceId}`,
        { entity_id: target_id }
      );

      // Log merge activity
      await opsQuery('POST', 'activity_events', {
        workspace_id: workspaceId,
        actor_id: user.id,
        entity_id: target_id,
        category: 'system',
        title: `Merged entity "${sourceEntity.name}" into "${targetEntity.name}"`,
        source_type: 'system',
        visibility: 'shared',
        metadata: {
          merge_source_id: source_id,
          merge_source_name: sourceEntity.name,
          merge_target_id: target_id,
          merge_target_name: targetEntity.name
        },
        occurred_at: new Date().toISOString()
      });

      // Delete source entity (all moved relationships now point to target)
      await opsQuery('DELETE',
        `entities?id=eq.${source_id}&workspace_id=eq.${workspaceId}`
      );

      return res.status(200).json({
        merged: true,
        target: targetEntity,
        source_removed: sourceEntity,
        message: `"${sourceEntity.name}" merged into "${targetEntity.name}". Source entity deleted.`
      });
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
});

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
