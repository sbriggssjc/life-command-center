// ============================================================================
// Domain Expansion API — Register, manage, and validate domain verticals
// Life Command Center — Phase 7: Domain Expansion Framework
//
// GET  /api/domains?action=list               — list registered domains
// GET  /api/domains?action=get&id=            — get domain with data sources + mappings
// GET  /api/domains?action=templates          — list available domain templates
// POST /api/domains?action=register           — register a new domain
// POST /api/domains?action=add_source         — add data source to domain
// POST /api/domains?action=add_entity_mapping — add entity mapping
// POST /api/domains?action=add_queue_config   — add queue configuration
// POST /api/domains?action=validate           — validate domain connections
// POST /api/domains?action=apply_template     — apply a domain template
// POST /api/domains?action=toggle             — activate/deactivate domain
// POST /api/domains?action=sync_entities      — trigger entity sync from domain sources
// ============================================================================

import { authenticate, requireRole, handleCors } from './_shared/auth.js';
import { opsQuery, requireOps, withErrorHandler } from './_shared/ops-db.js';

export default withErrorHandler(async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (requireOps(res)) return;

  const user = await authenticate(req, res);
  if (!user) return;

  const workspaceId = req.headers['x-lcc-workspace'] || user.memberships[0]?.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context' });

  const { action } = req.query;

  if (req.method === 'GET') {
    switch (action) {
      case 'list':      return listDomains(req, res, workspaceId);
      case 'get':       return getDomain(req, res, workspaceId);
      case 'templates': return listTemplates(req, res);
      default: return res.status(400).json({ error: 'GET action: list, get, templates' });
    }
  }

  if (req.method === 'POST') {
    if (!requireRole(user, 'manager', workspaceId)) {
      return res.status(403).json({ error: 'Manager role required for domain management' });
    }

    switch (action) {
      case 'register':           return registerDomain(req, res, user, workspaceId);
      case 'add_source':         return addDataSource(req, res, workspaceId);
      case 'add_entity_mapping': return addEntityMapping(req, res, workspaceId);
      case 'add_queue_config':   return addQueueConfig(req, res, workspaceId);
      case 'validate':           return validateDomain(req, res, workspaceId);
      case 'apply_template':     return applyTemplate(req, res, user, workspaceId);
      case 'toggle':             return toggleDomain(req, res, workspaceId);
      case 'sync_entities':      return syncDomainEntities(req, res, user, workspaceId);
      default: return res.status(400).json({ error: 'Invalid POST action' });
    }
  }

  return res.status(405).json({ error: `${req.method} not allowed` });
});

// ============================================================================
// LIST — all domains for workspace
// ============================================================================

async function listDomains(req, res, workspaceId) {
  const result = await opsQuery('GET',
    `domains?workspace_id=eq.${workspaceId}&select=*,domain_data_sources(id,display_name,source_type,is_active),domain_entity_mappings(id,source_table,target_entity_type),domain_queue_configs(id,queue_type,source_table)&order=display_name`
  );
  return res.status(200).json({ domains: result.data || [] });
}

// ============================================================================
// GET — single domain with full config
// ============================================================================

async function getDomain(req, res, workspaceId) {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id required' });

  const result = await opsQuery('GET',
    `domains?id=eq.${id}&workspace_id=eq.${workspaceId}&select=*,domain_data_sources(*),domain_entity_mappings(*),domain_queue_configs(*)`
  );
  if (!result.data?.length) return res.status(404).json({ error: 'Domain not found' });
  return res.status(200).json({ domain: result.data[0] });
}

// ============================================================================
// REGISTER — create a new domain
// ============================================================================

async function registerDomain(req, res, user, workspaceId) {
  const { slug, display_name, description, color, icon, config } = req.body || {};
  if (!slug || !display_name) return res.status(400).json({ error: 'slug and display_name required' });

  // Validate slug format
  if (!/^[a-z][a-z0-9_]{1,30}$/.test(slug)) {
    return res.status(400).json({ error: 'slug must be lowercase letters/numbers/underscores, 2-31 chars' });
  }

  // Check for duplicate
  const existing = await opsQuery('GET', `domains?workspace_id=eq.${workspaceId}&slug=eq.${slug}&select=id`);
  if (existing.data?.length) return res.status(409).json({ error: `Domain "${slug}" already exists` });

  const result = await opsQuery('POST', 'domains', {
    workspace_id: workspaceId,
    slug,
    display_name,
    description: description || null,
    color: color || null,
    icon: icon || null,
    config: config || {}
  });

  if (!result.ok) return res.status(500).json({ error: 'Failed to create domain' });
  return res.status(201).json({ domain: (result.data || [])[0] });
}

// ============================================================================
// ADD DATA SOURCE
// ============================================================================

async function addDataSource(req, res, workspaceId) {
  const { domain_id, source_type, display_name, connection_config, api_proxy_path } = req.body || {};
  if (!domain_id || !source_type || !display_name) {
    return res.status(400).json({ error: 'domain_id, source_type, display_name required' });
  }

  const VALID_TYPES = ['supabase', 'api', 'csv', 'manual', 'webhook'];
  if (!VALID_TYPES.includes(source_type)) {
    return res.status(400).json({ error: `source_type must be: ${VALID_TYPES.join(', ')}` });
  }

  const result = await opsQuery('POST', 'domain_data_sources', {
    domain_id,
    workspace_id: workspaceId,
    source_type,
    display_name,
    connection_config: connection_config || {},
    api_proxy_path: api_proxy_path || null
  });

  if (!result.ok) return res.status(500).json({ error: 'Failed to add data source' });
  return res.status(201).json({ data_source: (result.data || [])[0] });
}

// ============================================================================
// ADD ENTITY MAPPING — how domain records map to canonical entities
// ============================================================================

async function addEntityMapping(req, res, workspaceId) {
  const { domain_id, source_table, target_entity_type, field_mapping, filter_expression } = req.body || {};
  if (!domain_id || !source_table || !target_entity_type || !field_mapping) {
    return res.status(400).json({ error: 'domain_id, source_table, target_entity_type, field_mapping required' });
  }

  // Validate field_mapping has required canonical fields
  const requiredFields = ['name'];
  for (const f of requiredFields) {
    if (!field_mapping[f]) {
      return res.status(400).json({ error: `field_mapping must include: ${requiredFields.join(', ')}` });
    }
  }

  const result = await opsQuery('POST', 'domain_entity_mappings', {
    domain_id,
    workspace_id: workspaceId,
    source_table,
    target_entity_type,
    field_mapping,
    filter_expression: filter_expression || null
  });

  if (!result.ok) return res.status(500).json({ error: 'Failed to add entity mapping' });
  return res.status(201).json({ entity_mapping: (result.data || [])[0] });
}

// ============================================================================
// ADD QUEUE CONFIG — how domain records feed into queues
// ============================================================================

async function addQueueConfig(req, res, workspaceId) {
  const { domain_id, queue_type, source_table, title_template, priority_expression, filter_expression, config } = req.body || {};
  if (!domain_id || !queue_type || !source_table || !title_template) {
    return res.status(400).json({ error: 'domain_id, queue_type, source_table, title_template required' });
  }

  const result = await opsQuery('POST', 'domain_queue_configs', {
    domain_id,
    workspace_id: workspaceId,
    queue_type,
    source_table,
    title_template,
    priority_expression: priority_expression || null,
    filter_expression: filter_expression || null,
    config: config || {}
  });

  if (!result.ok) return res.status(500).json({ error: 'Failed to add queue config' });
  return res.status(201).json({ queue_config: (result.data || [])[0] });
}

// ============================================================================
// VALIDATE — check domain connections are live
// ============================================================================

async function validateDomain(req, res, workspaceId) {
  const { domain_id } = req.body || {};
  if (!domain_id) return res.status(400).json({ error: 'domain_id required' });

  // Fetch domain and sources
  const domainRes = await opsQuery('GET',
    `domains?id=eq.${domain_id}&workspace_id=eq.${workspaceId}&select=*,domain_data_sources(*)`
  );
  if (!domainRes.data?.length) return res.status(404).json({ error: 'Domain not found' });

  const domain = domainRes.data[0];
  const sources = domain.domain_data_sources || [];
  const results = [];

  for (const src of sources) {
    const check = { source_id: src.id, display_name: src.display_name, source_type: src.source_type };

    if (src.source_type === 'supabase' && src.api_proxy_path) {
      try {
        // Probe the proxy endpoint
        const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
        const protocol = req.headers['x-forwarded-proto'] || 'https';
        const probe = await fetch(`${protocol}://${host}${src.api_proxy_path}?table=_probe&limit=0`);
        check.status = probe.ok || probe.status === 400 ? 'connected' : 'error';
        check.message = probe.ok ? 'Connected' : `HTTP ${probe.status}`;
      } catch (e) {
        check.status = 'error';
        check.message = e.message;
      }
    } else if (src.source_type === 'manual') {
      check.status = 'connected';
      check.message = 'Manual source — always available';
    } else {
      check.status = 'unknown';
      check.message = 'Cannot validate this source type automatically';
    }

    // Update last_verified_at
    if (check.status === 'connected') {
      await opsQuery('PATCH', `domain_data_sources?id=eq.${src.id}`, {
        last_verified_at: new Date().toISOString()
      });
    }

    results.push(check);
  }

  const allConnected = results.every(r => r.status === 'connected');
  return res.status(200).json({
    domain_id,
    domain_slug: domain.slug,
    status: allConnected ? 'healthy' : 'degraded',
    sources: results
  });
}

// ============================================================================
// TOGGLE — activate/deactivate domain
// ============================================================================

async function toggleDomain(req, res, workspaceId) {
  const { domain_id, is_active } = req.body || {};
  if (!domain_id || typeof is_active !== 'boolean') {
    return res.status(400).json({ error: 'domain_id and is_active (boolean) required' });
  }

  await opsQuery('PATCH', `domains?id=eq.${domain_id}&workspace_id=eq.${workspaceId}`, {
    is_active, updated_at: new Date().toISOString()
  });

  return res.status(200).json({ domain_id, is_active });
}

// ============================================================================
// SYNC ENTITIES — generic sync from domain data sources to canonical entities
// ============================================================================

async function syncDomainEntities(req, res, user, workspaceId) {
  const { domain_id } = req.body || {};
  if (!domain_id) return res.status(400).json({ error: 'domain_id required' });

  // Fetch domain with mappings
  const domainRes = await opsQuery('GET',
    `domains?id=eq.${domain_id}&workspace_id=eq.${workspaceId}&select=*,domain_data_sources(*),domain_entity_mappings(*)`
  );
  if (!domainRes.data?.length) return res.status(404).json({ error: 'Domain not found' });

  const domain = domainRes.data[0];
  const mappings = domain.domain_entity_mappings || [];
  const sources = domain.domain_data_sources || [];

  if (!mappings.length) {
    return res.status(400).json({ error: 'No entity mappings configured for this domain' });
  }

  let created = 0, updated = 0, errors = 0;

  for (const mapping of mappings) {
    if (!mapping.is_active) continue;

    // Find the data source with a proxy path
    const source = sources.find(s => s.is_active && s.api_proxy_path);
    if (!source) { errors++; continue; }

    try {
      // Query domain database through proxy — need absolute URL for serverless fetch
      const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const baseUrl = `${protocol}://${host}`;
      let proxyUrl = `${baseUrl}${source.api_proxy_path}?table=${encodeURIComponent(mapping.source_table)}&limit=500`;
      if (mapping.filter_expression) proxyUrl += `&filter=${encodeURIComponent(mapping.filter_expression)}`;

      const proxyRes = await fetch(proxyUrl, {
        headers: {
          'Content-Type': 'application/json',
          'x-lcc-workspace': workspaceId
        }
      });

      if (!proxyRes.ok) { errors++; continue; }
      const proxyData = await proxyRes.json();
      const records = proxyData.data || proxyData || [];

      // Apply field mapping to each record and upsert canonical entity
      for (const record of records) {
        const mapped = applyFieldMapping(record, mapping.field_mapping);
        if (!mapped.name) continue;

        // Check if entity already exists (by external identity)
        const externalId = mapped._external_id || record.id;
        const existingRes = await opsQuery('GET',
          `external_identities?source_system=eq.${domain.slug}&external_id=eq.${externalId}&select=entity_id&limit=1`
        );

        if (existingRes.data?.length) {
          // Update existing entity
          const entityId = existingRes.data[0].entity_id;
          await opsQuery('PATCH', `entities?id=eq.${entityId}`, {
            name: mapped.name,
            canonical_name: buildCanonicalName(mapped.name),
            entity_type: mapping.target_entity_type,
            domain: domain.slug,
            status: mapped.status || 'active',
            city: mapped.city || null,
            state: mapped.state || null,
            address: mapped.address || null,
            metadata: mapped._metadata || {},
            updated_at: new Date().toISOString()
          });
          updated++;
        } else {
          // Create new entity
          const entityRes = await opsQuery('POST', 'entities', {
            workspace_id: workspaceId,
            name: mapped.name,
            canonical_name: buildCanonicalName(mapped.name),
            entity_type: mapping.target_entity_type,
            domain: domain.slug,
            status: mapped.status || 'active',
            city: mapped.city || null,
            state: mapped.state || null,
            address: mapped.address || null,
            metadata: mapped._metadata || {},
            created_by: user.id
          });

          if (entityRes.ok && entityRes.data?.[0]) {
            // Create external identity link
            await opsQuery('POST', 'external_identities', {
              workspace_id: workspaceId,
              entity_id: entityRes.data[0].id,
              source_system: domain.slug,
              source_type: mapping.source_table,
              external_id: externalId,
              last_synced_at: new Date().toISOString()
            });
            created++;
          } else {
            errors++;
          }
        }
      }
    } catch (e) {
      console.error(`Domain sync error for ${mapping.source_table}:`, e);
      errors++;
    }
  }

  // Log activity
  await opsQuery('POST', 'activity_events', {
    workspace_id: workspaceId,
    actor_id: user.id,
    category: 'sync',
    title: `Synced domain "${domain.display_name}": ${created} created, ${updated} updated, ${errors} errors`,
    source_type: 'system',
    domain: domain.slug,
    visibility: 'shared',
    occurred_at: new Date().toISOString()
  });

  return res.status(200).json({
    domain_id, domain_slug: domain.slug,
    created, updated, errors,
    workflow: 'domain_sync'
  });
}

// ============================================================================
// APPLY TEMPLATE — bootstrap a domain from a predefined template
// ============================================================================

async function applyTemplate(req, res, user, workspaceId) {
  const { template_id } = req.body || {};
  if (!template_id) return res.status(400).json({ error: 'template_id required' });

  const template = DOMAIN_TEMPLATES[template_id];
  if (!template) return res.status(404).json({ error: `Template "${template_id}" not found` });

  // Check if domain already exists
  const existing = await opsQuery('GET', `domains?workspace_id=eq.${workspaceId}&slug=eq.${template.slug}&select=id`);
  if (existing.data?.length) {
    return res.status(409).json({ error: `Domain "${template.slug}" already exists. Use register + manual config instead.` });
  }

  // Create domain
  const domainRes = await opsQuery('POST', 'domains', {
    workspace_id: workspaceId,
    slug: template.slug,
    display_name: template.display_name,
    description: template.description,
    color: template.color,
    icon: template.icon,
    config: template.config || {}
  });

  if (!domainRes.ok) return res.status(500).json({ error: 'Failed to create domain' });
  const domain = domainRes.data[0];

  // Create data sources
  for (const src of (template.data_sources || [])) {
    await opsQuery('POST', 'domain_data_sources', {
      domain_id: domain.id,
      workspace_id: workspaceId,
      ...src
    });
  }

  // Create entity mappings
  for (const mapping of (template.entity_mappings || [])) {
    await opsQuery('POST', 'domain_entity_mappings', {
      domain_id: domain.id,
      workspace_id: workspaceId,
      ...mapping
    });
  }

  // Create queue configs
  for (const qc of (template.queue_configs || [])) {
    await opsQuery('POST', 'domain_queue_configs', {
      domain_id: domain.id,
      workspace_id: workspaceId,
      ...qc
    });
  }

  return res.status(201).json({
    domain,
    sources_created: (template.data_sources || []).length,
    mappings_created: (template.entity_mappings || []).length,
    queue_configs_created: (template.queue_configs || []).length,
    workflow: 'apply_template'
  });
}

// ============================================================================
// TEMPLATES — list available templates
// ============================================================================

function listTemplates(req, res) {
  const templates = Object.entries(DOMAIN_TEMPLATES).map(([id, t]) => ({
    id,
    slug: t.slug,
    display_name: t.display_name,
    description: t.description,
    color: t.color,
    icon: t.icon,
    sources: (t.data_sources || []).length,
    mappings: (t.entity_mappings || []).length,
    queue_configs: (t.queue_configs || []).length
  }));
  return res.status(200).json({ templates });
}

// ============================================================================
// FIELD MAPPING — apply column mapping from domain record to canonical entity
// ============================================================================

function buildCanonicalName(name) {
  return name.trim().toLowerCase()
    .replace(/\b(llc|inc|corp|ltd|co|company|group|partners|lp|llp)\b\.?/gi, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function applyFieldMapping(record, mapping) {
  const result = {};
  for (const [canonicalField, sourceExpr] of Object.entries(mapping)) {
    if (typeof sourceExpr === 'string') {
      // Simple field reference: "name" → record.name
      // Template: "{city}, {state}" → interpolated
      if (sourceExpr.includes('{')) {
        result[canonicalField] = sourceExpr.replace(/\{(\w+)\}/g, (_, field) => record[field] || '');
      } else {
        result[canonicalField] = record[sourceExpr];
      }
    } else if (typeof sourceExpr === 'object' && sourceExpr.concat) {
      // Array: concat multiple fields
      result[canonicalField] = sourceExpr.map(f => record[f]).filter(Boolean).join(' ');
    }
  }
  return result;
}

// ============================================================================
// DOMAIN TEMPLATES — predefined configurations for common verticals
// ============================================================================

const DOMAIN_TEMPLATES = {
  // ---- GOVERNMENT (existing) ----
  government: {
    slug: 'government',
    display_name: 'Government Properties',
    description: 'Federal, state, and local government real estate — GSA, VA, DOD, and municipal assets',
    color: '#10b981',
    icon: 'building-government',
    config: {
      sectors: ['federal', 'state', 'municipal', 'military'],
      property_types: ['office', 'warehouse', 'land', 'mixed_use', 'courthouse', 'lab'],
      lease_types: ['gsa_lease', 'oba', 'direct', 'sbp']
    },
    data_sources: [
      {
        source_type: 'supabase',
        display_name: 'Government Supabase',
        connection_config: { project: 'gov', env_url: 'GOV_SUPABASE_URL', env_key: 'GOV_SUPABASE_KEY' },
        api_proxy_path: '/api/gov-query'
      }
    ],
    entity_mappings: [
      {
        source_table: 'properties',
        target_entity_type: 'asset',
        field_mapping: {
          name: '{address} - {city}, {state}',
          address: 'address',
          city: 'city',
          state: 'state',
          status: 'pipeline_status',
          _external_id: 'id',
          _metadata: { source_fields: ['zip', 'square_footage', 'agency', 'lease_number', 'expiration_date'] }
        },
        filter_expression: null
      },
      {
        source_table: 'players',
        target_entity_type: 'organization',
        field_mapping: {
          name: 'company_name',
          city: 'city',
          state: 'state',
          status: 'status',
          _external_id: 'id',
          _metadata: { source_fields: ['contact_name', 'phone', 'email', 'player_type'] }
        }
      }
    ],
    queue_configs: [
      {
        queue_type: 'pipeline',
        source_table: 'properties',
        title_template: '{address} - {city}, {state}',
        priority_expression: "CASE WHEN expiration_date < NOW() + INTERVAL '6 months' THEN 10 ELSE 50 END",
        filter_expression: "pipeline_status IN ('hot','warm','active')"
      },
      {
        queue_type: 'research',
        source_table: 'ownership_records',
        title_template: 'Verify ownership: {property_address}',
        filter_expression: "verified = false"
      }
    ]
  },

  // ---- DIALYSIS (existing) ----
  dialysis: {
    slug: 'dialysis',
    display_name: 'Dialysis Clinics',
    description: 'Dialysis clinic real estate — DaVita, Fresenius, independent providers, CMS data',
    color: '#f0abfc',
    icon: 'heart-pulse',
    config: {
      providers: ['davita', 'fresenius', 'us_renal', 'dialysis_clinic_inc', 'independent'],
      data_feeds: ['cms', 'npi']
    },
    data_sources: [
      {
        source_type: 'supabase',
        display_name: 'Dialysis Supabase',
        connection_config: { project: 'dia', env_url: 'DIA_SUPABASE_URL', env_key: 'DIA_SUPABASE_KEY' },
        api_proxy_path: '/api/dia-query'
      }
    ],
    entity_mappings: [
      {
        source_table: 'clinics',
        target_entity_type: 'asset',
        field_mapping: {
          name: '{provider_name} - {city}, {state}',
          address: 'address',
          city: 'city',
          state: 'state',
          status: 'status',
          _external_id: 'cms_id',
          _metadata: { source_fields: ['provider_name', 'cms_id', 'npi', 'stations', 'profit_status'] }
        }
      },
      {
        source_table: 'providers',
        target_entity_type: 'organization',
        field_mapping: {
          name: 'provider_name',
          status: 'status',
          _external_id: 'id'
        }
      }
    ],
    queue_configs: [
      {
        queue_type: 'pipeline',
        source_table: 'clinics',
        title_template: '{provider_name} - {city}, {state}',
        priority_expression: "CASE WHEN stations > 20 THEN 10 ELSE 40 END",
        filter_expression: "status IN ('lead','prospect')"
      }
    ]
  },

  // ---- EDUCATION / DAYCARE (new template) ----
  education_daycare: {
    slug: 'education_daycare',
    display_name: 'Education & Daycare',
    description: 'Childcare centers, preschools, and K-12 education real estate',
    color: '#fbbf24',
    icon: 'school',
    config: {
      sub_types: ['daycare', 'preschool', 'charter_school', 'private_school', 'tutoring_center'],
      licensing_bodies: ['state_dhs', 'naeyc', 'necpa'],
      key_metrics: ['licensed_capacity', 'enrollment', 'star_rating', 'annual_revenue']
    },
    data_sources: [
      {
        source_type: 'manual',
        display_name: 'Manual Entry',
        connection_config: {},
        api_proxy_path: null
      }
    ],
    entity_mappings: [
      {
        source_table: 'facilities',
        target_entity_type: 'asset',
        field_mapping: {
          name: '{facility_name} - {city}, {state}',
          address: 'address',
          city: 'city',
          state: 'state',
          status: 'pipeline_status',
          _external_id: 'license_number',
          _metadata: { source_fields: ['license_number', 'licensed_capacity', 'owner_name', 'sub_type', 'star_rating'] }
        }
      },
      {
        source_table: 'operators',
        target_entity_type: 'organization',
        field_mapping: {
          name: 'operator_name',
          city: 'hq_city',
          state: 'hq_state',
          _external_id: 'id',
          _metadata: { source_fields: ['total_locations', 'contact_name', 'contact_email'] }
        }
      }
    ],
    queue_configs: [
      {
        queue_type: 'pipeline',
        source_table: 'facilities',
        title_template: '{facility_name} - {city}, {state}',
        priority_expression: "CASE WHEN licensed_capacity > 100 THEN 10 WHEN licensed_capacity > 50 THEN 30 ELSE 50 END",
        filter_expression: "pipeline_status IN ('lead','prospect','active')"
      },
      {
        queue_type: 'research',
        source_table: 'facilities',
        title_template: 'Verify license: {facility_name}',
        filter_expression: "last_verified_at IS NULL OR last_verified_at < NOW() - INTERVAL '90 days'"
      }
    ]
  },

  // ---- URGENT CARE (new template) ----
  urgent_care: {
    slug: 'urgent_care',
    display_name: 'Urgent Care',
    description: 'Urgent care clinics, walk-in medical facilities, and freestanding ERs',
    color: '#f87171',
    icon: 'stethoscope',
    config: {
      sub_types: ['urgent_care', 'walk_in_clinic', 'freestanding_er', 'minute_clinic', 'occupational_health'],
      major_operators: ['afc', 'concentra', 'medexpress', 'patient_first', 'city_md'],
      key_metrics: ['daily_visits', 'providers_count', 'hours_of_operation', 'annual_revenue']
    },
    data_sources: [
      {
        source_type: 'manual',
        display_name: 'Manual Entry',
        connection_config: {},
        api_proxy_path: null
      }
    ],
    entity_mappings: [
      {
        source_table: 'clinics',
        target_entity_type: 'asset',
        field_mapping: {
          name: '{brand_name} - {city}, {state}',
          address: 'address',
          city: 'city',
          state: 'state',
          status: 'pipeline_status',
          _external_id: 'npi',
          _metadata: { source_fields: ['npi', 'brand_name', 'operator_name', 'daily_visits', 'lease_expiry'] }
        }
      },
      {
        source_table: 'operators',
        target_entity_type: 'organization',
        field_mapping: {
          name: 'operator_name',
          city: 'hq_city',
          state: 'hq_state',
          _external_id: 'id',
          _metadata: { source_fields: ['total_locations', 'states_operated', 'public_private'] }
        }
      }
    ],
    queue_configs: [
      {
        queue_type: 'pipeline',
        source_table: 'clinics',
        title_template: '{brand_name} - {city}, {state}',
        priority_expression: "CASE WHEN daily_visits > 80 THEN 10 WHEN daily_visits > 40 THEN 30 ELSE 50 END",
        filter_expression: "pipeline_status IN ('lead','prospect','active')"
      },
      {
        queue_type: 'research',
        source_table: 'clinics',
        title_template: 'Market analysis: {city}, {state} urgent care',
        filter_expression: "market_analyzed = false",
        config: { research_type: 'market_analysis' }
      }
    ]
  }
};
