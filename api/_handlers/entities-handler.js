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
// GET    /api/entities?action=lookup_asset&address=&city=&state= — find asset entity by address
// GET    /api/entities?action=duplicates      — find duplicate candidates
// POST   /api/entities?action=merge           — merge two entities (manager+)
// POST   /api/entities?action=add_alias       — add alias for entity
// GET    /api/entities?action=quality         — data quality dashboard
// POST   /api/entities?action=process_sidebar_extraction — unpack CRE sidebar metadata
// ============================================================================

import { authenticate, requireRole, handleCors } from '../_shared/auth.js';
import { opsQuery, paginationParams, requireOps, withErrorHandler } from '../_shared/ops-db.js';
import { ENTITY_TYPES, DOMAINS, isValidEnum } from '../_shared/lifecycle.js';
import { normalizeAddress } from '../_shared/entity-link.js';
import { writeListingCreatedSignal } from '../_shared/signals.js';
import { processSidebarExtraction, hasSidebarData } from './sidebar-pipeline.js';
import { domainQuery } from '../_shared/domain-db.js';

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

export const entitiesHandler = withErrorHandler(async function handler(req, res) {
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

    // Phase 3 + 4 — surface field_provenance skips/conflicts where the rule
    // is in warn/strict mode AND any (target_table,field_name,source) triple
    // that's been writing to field_provenance but isn't in
    // field_source_priority (schema drift). Drives the LCC Data Quality
    // UI's "Provenance conflicts" + "Unranked fields" panels.
    if (action === 'quality_provenance') {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
      const [actionable, summary, unranked] = await Promise.all([
        opsQuery('GET',
          `v_field_provenance_actionable?` +
          `select=provenance_id,recorded_at,target_database,target_table,record_pk_value,` +
          `field_name,attempted_value,attempted_source,attempted_priority,enforce_mode,` +
          `decision,decision_reason,current_source,current_value` +
          `&order=recorded_at.desc&limit=${limit}`
        ),
        // Summary: by target_table+field, how many would-have-blocked rows
        // in the last 7 days. We can't GROUP BY in PostgREST — fold in JS
        // after fetching the raw set with a higher cap (cheap, < 5k rows
        // expected even at peak).
        opsQuery('GET',
          `v_field_provenance_actionable?` +
          `select=target_table,field_name,enforce_mode,decision` +
          `&recorded_at=gte.${encodeURIComponent(new Date(Date.now() - 7 * 86400000).toISOString())}` +
          `&limit=5000`
        ),
        // Phase 4 — schema-drift detector. Unranked field writes from the
        // last 30 days (any source).
        opsQuery('GET',
          `v_field_provenance_unranked?` +
          `select=target_table,field_name,source,writes_30d,writes_succeeded,` +
          `writes_skipped,writes_conflicted,first_seen,last_seen,distinct_records,` +
          `distinct_sources_seen` +
          `&order=writes_30d.desc&limit=100`
        )
      ]);

      // Build the summary aggregate
      const summaryMap = new Map();
      for (const r of (summary.data || [])) {
        const key = `${r.target_table}|${r.field_name}|${r.enforce_mode}|${r.decision}`;
        summaryMap.set(key, (summaryMap.get(key) || 0) + 1);
      }
      const summaryRows = [...summaryMap.entries()]
        .map(([key, count]) => {
          const [target_table, field_name, enforce_mode, decision] = key.split('|');
          return { target_table, field_name, enforce_mode, decision, count };
        })
        .sort((a, b) => b.count - a.count);

      return res.status(200).json({
        actionable: actionable.data || [],
        summary_7d: summaryRows,
        unranked:   unranked.data || [],
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

    // Lookup a single asset entity by address (+ optional city/state).
    // Used by the property detail panel to surface CoStar-sourced lease
    // estimates from the entity's metadata JSONB.
    //
    // Round 76ek (2026-04-29): the address-only path is fragile against
    // tiny formatting differences ("Dr" vs "Drive" vs "Dr."), which caused
    // the sidebar to "lose" entities right after a successful save and show
    // the green Save button again as if nothing happened. We now try
    // stronger identity signals first when the caller supplies them:
    //   1) entity_id (exact)
    //   2) source_url (exact match against metadata->>'source_url')
    //   3) parcel_number (exact match against metadata->>'parcel_number')
    //   4) domain_property_id + domain (exact)
    //   5) address (case-insensitive, with light Drive↔Dr normalization)
    //   6) address (case-insensitive, exact equality — legacy fallback)
    // First non-empty result wins. This lets the sidebar identify a
    // CoStar-saved property from any of source_url/parcel/property_id even
    // if the address text on the live page has drifted.
    if (action === 'lookup_asset') {
      const select = 'id,entity_type,name,address,city,state,domain,asset_type,metadata';
      const baseFilter = `workspace_id=eq.${workspaceId}&entity_type=eq.asset`;
      const sanitize = (s) => String(s || '').trim().replace(/[%_*,()]/g, '');

      const tryQuery = async (extraFilter) => {
        const path = `entities?${baseFilter}&${extraFilter}&select=${select}&limit=1`;
        const r = await opsQuery('GET', path);
        return (r.data && r.data[0]) || null;
      };

      // 1) entity_id — caller already knows the row (e.g. immediately after save)
      if (req.query.entity_id) {
        const id = sanitize(req.query.entity_id);
        if (id) {
          const hit = await tryQuery(`id=eq.${encodeURIComponent(id)}`);
          if (hit) return res.status(200).json({ entity: hit, matched_via: 'entity_id' });
        }
      }

      // 2) source_url — most precise sidebar identity (CoStar listing URL, etc.)
      if (req.query.source_url) {
        const u = sanitize(req.query.source_url);
        if (u && u.length >= 8) {
          const hit = await tryQuery(`metadata->>source_url=eq.${encodeURIComponent(u)}`);
          if (hit) return res.status(200).json({ entity: hit, matched_via: 'source_url' });
        }
      }

      // 3) parcel_number — survives address re-spellings and re-listings
      if (req.query.parcel_number) {
        const parcel = sanitize(req.query.parcel_number);
        if (parcel && parcel.length >= 3) {
          const hit = await tryQuery(`metadata->>parcel_number=eq.${encodeURIComponent(parcel)}`);
          if (hit) return res.status(200).json({ entity: hit, matched_via: 'parcel_number' });
        }
      }

      // 4) domain_property_id + domain (only useful if caller already knows
      //    which dia/gov row this is — e.g. after a save bootstrap)
      if (req.query.domain_property_id && req.query.domain) {
        const pid = sanitize(req.query.domain_property_id);
        const dom = sanitize(req.query.domain);
        if (pid && dom) {
          const hit = await tryQuery(
            `metadata->>domain_property_id=eq.${encodeURIComponent(pid)}` +
            `&domain=eq.${encodeURIComponent(dom)}`
          );
          if (hit) return res.status(200).json({ entity: hit, matched_via: 'domain_property_id' });
        }
      }

      // 5) + 6) address fallbacks
      const rawAddress = (req.query.address || '').trim();
      if (rawAddress.length < 3) {
        return res.status(400).json({
          error: 'address query parameter required (min 3 chars), or supply entity_id/source_url/parcel_number/domain_property_id'
        });
      }
      const address = rawAddress.replace(/[%_*]/g, '');
      const cityFilter = req.query.city
        ? `&city=ilike.${encodeURIComponent(sanitize(req.query.city))}`
        : '';
      const stateFilter = req.query.state
        ? `&state=eq.${encodeURIComponent(sanitize(req.query.state))}`
        : '';

      // 5) address with Drive↔Dr normalization — covers the common drift
      //    we saw on 1507 Hillview where one row stored "Drive" and another
      //    stored "Dr". Build a wildcard pattern that matches either form.
      const STREET_ALIASES = [
        [/\b(drive)\b/i,    'Dr'],
        [/\b(dr\.?)\b/i,    'Drive'],
        [/\b(street)\b/i,   'St'],
        [/\b(st\.?)\b/i,    'Street'],
        [/\b(avenue)\b/i,   'Ave'],
        [/\b(ave\.?)\b/i,   'Avenue'],
        [/\b(boulevard)\b/i,'Blvd'],
        [/\b(blvd\.?)\b/i,  'Boulevard'],
        [/\b(road)\b/i,     'Rd'],
        [/\b(rd\.?)\b/i,    'Road'],
        [/\b(highway)\b/i,  'Hwy'],
        [/\b(hwy\.?)\b/i,   'Highway'],
        [/\b(parkway)\b/i,  'Pkwy'],
        [/\b(pkwy\.?)\b/i,  'Parkway'],
      ];
      const addressVariants = new Set([address]);
      for (const [re, alt] of STREET_ALIASES) {
        if (re.test(address)) {
          addressVariants.add(address.replace(re, alt));
        }
      }
      // Try each variant exact-equal first (cheap), then fall through to a
      // pattern match. Stop at the first hit.
      for (const variant of addressVariants) {
        const v = variant.replace(/[%_*]/g, '');
        const hit = await tryQuery(
          `address=ilike.${encodeURIComponent(v)}${cityFilter}${stateFilter}`
        );
        if (hit) {
          return res.status(200).json({
            entity: hit,
            matched_via: variant === address ? 'address' : 'address_alias',
          });
        }
      }

      // 6) Final widest pass — wildcard on the original address. Helps when
      //    the live-page address has a trailing period or apartment suffix
      //    the saved row doesn't have. Limited to 1 row so we don't return
      //    the wrong building for ambiguous fragments.
      const hit = await tryQuery(
        `address=ilike.*${encodeURIComponent(address)}*${cityFilter}${stateFilter}`
      );
      if (hit) return res.status(200).json({ entity: hit, matched_via: 'address_wildcard' });

      return res.status(200).json({ entity: null, matched_via: null });
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

    // On-demand sidebar extraction processing
    if (req.query.action === 'process_sidebar_extraction') {
      const { entity_id, force } = req.body || {};
      if (!entity_id) {
        return res.status(400).json({ error: 'entity_id is required' });
      }
      try {
        const result = await processSidebarExtraction(entity_id, workspaceId, user.id, { force: !!force });
        if (!result.ok) {
          return res.status(result.error === 'Entity not found' ? 404 : 500).json(result);
        }
        return res.status(200).json(result);
      } catch (err) {
        console.error('[Sidebar pipeline error]', err);
        return res.status(500).json({ error: 'Pipeline processing failed', detail: err?.message });
      }
    }

    // Round 76cx Phase 3: record a listing verification check
    // POST /api/entities?action=record_listing_verification
    // Body: { domain: 'dialysis'|'government', property_id, method, check_result,
    //         asking_price?, cap_rate?, source_url?, notes?, off_market_reason? }
    // Looks up active listings on the property and calls
    // public.lcc_record_listing_check() once per listing. Returns the
    // per-listing decision (state_transitioned + new_status) so the
    // sidebar can toast a meaningful summary.
    if (req.query.action === 'record_listing_verification') {
      const {
        domain,
        property_id,
        method,
        check_result,
        asking_price,
        cap_rate,
        source_url,
        notes,
        off_market_reason,
      } = req.body || {};

      if (!domain || !['dialysis', 'government'].includes(domain)) {
        return res.status(400).json({ error: 'domain must be "dialysis" or "government"' });
      }
      if (!property_id || !Number.isFinite(Number(property_id))) {
        return res.status(400).json({ error: 'property_id (number) is required' });
      }
      const validMethods = ['auto_scrape', 'manual_user', 'sidebar_capture', 'sold_imported'];
      if (!method || !validMethods.includes(method)) {
        return res.status(400).json({ error: `method must be one of ${validMethods.join(', ')}` });
      }
      const validResults = ['still_available', 'price_changed', 'off_market', 'sold', 'unreachable'];
      if (!check_result || !validResults.includes(check_result)) {
        return res.status(400).json({ error: `check_result must be one of ${validResults.join(', ')}` });
      }

      try {
        // Find active listings on this property in the chosen domain.
        // dia uses is_active boolean; gov uses listing_status text.
        const listingFilter = domain === 'dialysis'
          ? `is_active=eq.true`
          : `listing_status=eq.active`;
        const idColumn = 'listing_id';
        const listingsRes = await domainQuery(domain, 'GET',
          `available_listings?property_id=eq.${Number(property_id)}&${listingFilter}&select=${idColumn}&limit=20`);
        if (!listingsRes.ok) {
          return res.status(502).json({ error: 'failed to read available_listings', detail: listingsRes.data });
        }
        let listings = Array.isArray(listingsRes.data) ? listingsRes.data : [];

        // Round 76du: auto-create the listing on a sidebar verification when
        // the property has no active listings on file. The audit on
        // 5 Route 45 / Mannington NJ found that some sidebar captures miss
        // creating the available_listings row even when the source page is
        // an active for-sale listing. Rather than make the user click a
        // separate "create listing" button, treat a sidebar 'still_available'
        // verification with an asking_price as the implicit creation signal.
        let autoCreated = null;
        if (listings.length === 0
            && method === 'sidebar_capture'
            && check_result === 'still_available'
            && asking_price != null && Number(asking_price) > 0) {
          // Round 76dy: dia.available_listings has no data_source column (only
          // notes); gov uses listing_source not data_source. The prior
          // payload tried to insert data_source on both, which crashed dia
          // INSERTs with "column does not exist" → the verify button toast
          // showed "auto-create attempted but failed" on every click.
          const newListing = domain === 'dialysis'
            ? {
                property_id: Number(property_id),
                is_active: true,
                listing_date: new Date().toISOString().slice(0, 10),
                last_price: Number(asking_price),
                current_cap_rate: cap_rate != null ? Number(cap_rate) : null,
                listing_url: source_url || null,
                last_seen: new Date().toISOString().slice(0, 10),
                last_verified_at: new Date().toISOString(),
                notes: 'auto-created by LCC sidebar verify-still-available',
              }
            : {
                property_id: Number(property_id),
                listing_status: 'active',
                listing_date: new Date().toISOString().slice(0, 10),
                asking_price: Number(asking_price),
                asking_cap_rate: cap_rate != null ? Number(cap_rate) : null,
                source_url: source_url || null,
                first_seen_at: new Date().toISOString(),
                last_seen_at: new Date().toISOString(),
                last_verified_at: new Date().toISOString(),
                listing_source: 'lcc_sidebar_verify',
              };
          const createRes = await domainQuery(domain, 'POST', 'available_listings', newListing);
          if (createRes.ok) {
            const created = Array.isArray(createRes.data) ? createRes.data[0] : createRes.data;
            if (created?.listing_id) {
              autoCreated = created;
              listings = [{ listing_id: created.listing_id }];
              console.log(`[record_listing_verification] auto-created listing_id=${created.listing_id} for ${domain} property_id=${property_id}`);
            }
          } else {
            console.warn('[record_listing_verification] auto-create failed:', createRes.status, createRes.data);
          }
        }

        if (listings.length === 0) {
          return res.status(404).json({
            error: 'no active listings on this property',
            property_id,
            hint: asking_price ? 'auto-create attempted but failed' : 'pass asking_price to auto-create on first verify',
          });
        }

        const results = [];
        for (const l of listings) {
          const rpcRes = await domainQuery(domain, 'POST', 'rpc/lcc_record_listing_check', {
            p_listing_id: l.listing_id,
            p_method: method,
            p_check_result: check_result,
            p_asking_price: asking_price != null ? Number(asking_price) : null,
            p_cap_rate: cap_rate != null ? Number(cap_rate) : null,
            p_source_url: source_url || null,
            p_off_market_reason: off_market_reason || null,
            p_notes: notes || null,
            p_verified_by: user.id || null,
          });
          if (!rpcRes.ok) {
            results.push({ listing_id: l.listing_id, ok: false, error: rpcRes.data });
            continue;
          }
          // RPC returns a row with verification_id, status_history_id,
          // state_transitioned, new_status.
          const decision = Array.isArray(rpcRes.data) ? rpcRes.data[0] : rpcRes.data;
          results.push({ listing_id: l.listing_id, ok: true, ...decision });
        }
        const okCount = results.filter(r => r.ok).length;
        return res.status(200).json({
          ok: okCount > 0,
          property_id,
          domain,
          method,
          check_result,
          listings_verified: okCount,
          listings_total: listings.length,
          auto_created: autoCreated ? { listing_id: autoCreated.listing_id } : null,
          results,
        });
      } catch (err) {
        console.error('[record_listing_verification error]', err);
        return res.status(500).json({ error: 'Verification failed', detail: err?.message });
      }
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
    const { entity_type, name, domain: entityDomain, metadata, ...fields } = req.body || {};

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

    // Pre-insert dedup check for assets: match on normalized address + city.
    // Exact ilike on raw address misses common abbreviation variants
    // ("Street" vs "St", "Road" vs "Rd"), which lets CoStar create a duplicate
    // every time it spells a street type differently from the CMS record.
    const pickedFields = pickEntityFields(entity_type, fields);
    if (entity_type === 'asset' && pickedFields.address && pickedFields.city) {
      const normAddr = normalizeAddress(pickedFields.address);
      const rawAddr  = pickedFields.address.trim();
      const city = pickedFields.city.trim();
      const state = pickedFields.state;
      // Round 76s (2026-04-27): ilike on state matches 'SC' to stored
      // 'South Carolina' (and vice versa) — eq missed across format split.
      const stateClause = state ? `&state=ilike.${encodeURIComponent(state)}` : '';
      const dedupPath = `entities?entity_type=eq.asset` +
        `&address=ilike.${encodeURIComponent(normAddr)}` +
        `&city=ilike.${encodeURIComponent(city)}` +
        stateClause +
        `&workspace_id=eq.${workspaceId}` +
        `&select=id,domain,metadata` +
        `&order=domain.nullslast,updated_at.desc` +
        `&limit=5`;
      let dupCheck = await opsQuery('GET', dedupPath);
      // Round 76s: Fallback when normAddr ilike misses — try RAW address.
      // Same Round 76m bug pattern: ilike-without-wildcards is exact match,
      // so '3919 mayfair st' lookup misses '3919 Mayfair Street' stored.
      if ((!dupCheck.ok || !dupCheck.data?.length) && rawAddr && rawAddr !== normAddr) {
        const rawDedupPath = `entities?entity_type=eq.asset` +
          `&address=ilike.${encodeURIComponent(rawAddr)}` +
          `&city=ilike.${encodeURIComponent(city)}` +
          stateClause +
          `&workspace_id=eq.${workspaceId}` +
          `&select=id,domain,metadata` +
          `&order=domain.nullslast,updated_at.desc` +
          `&limit=5`;
        const rawDupCheck = await opsQuery('GET', rawDedupPath);
        if (rawDupCheck.ok && rawDupCheck.data?.length) dupCheck = rawDupCheck;
      }
      if (dupCheck.ok && dupCheck.data?.length) {
        // Among matches, prefer the one with domain + domain_property_id set
        const candidates = dupCheck.data;
        const existing = candidates.find(e =>
          e.domain &&
          e.metadata?.domain_property_id
        ) || candidates[0];

        // Found existing entity — update metadata with new extraction data.
        // Merge: prefer incoming non-null values over existing values.
        if (metadata && Object.keys(metadata).length > 0) {
          const existingMeta = existing.metadata || {};
          const incomingMeta = metadata;

          const mergedMeta = { ...existingMeta };
          for (const [key, val] of Object.entries(incomingMeta)) {
            if (val !== undefined && val !== null) {
              mergedMeta[key] = val;
            } else if (val === null) {
              // Explicit null clears stale bad values for tracked fields
              const TRACKED = ['cap_rate', 'noi', 'tenant_name', 'primary_tenant',
                'city', 'state', 'zip_code', 'parcel_number', 'assessed_value',
                'land_value', 'improvement_value'];
              if (TRACKED.includes(key)) mergedMeta[key] = null;
            }
          }
          mergedMeta._pipeline_status = null; // reset so pipeline re-runs

          const patchResult = await opsQuery(
            'PATCH',
            `entities?id=eq.${existing.id}&workspace_id=eq.${workspaceId}`,
            { metadata: mergedMeta, updated_at: new Date().toISOString() }
          );

          // Re-trigger pipeline with the fresh merged metadata
          if (patchResult.ok && hasSidebarData(mergedMeta)) {
            const patched = Array.isArray(patchResult.data)
              ? patchResult.data[0] : patchResult.data;
            if (patched?.id) {
              processSidebarExtraction(patched.id, workspaceId, user.id)
                .catch(err => console.error('[Dedup pipeline re-trigger]',
                  err?.message || err));
            }
          }
        }

        return res.status(200).json({ entity: existing, deduplicated: true });
      }
    }

    const entity = {
      workspace_id: workspaceId,
      entity_type,
      name: name.trim(),
      canonical_name,
      domain: entityDomain || null,
      created_by: user.id,
      metadata: metadata || {},
      ...pickedFields
    };

    // Store a normalized copy of the street address on assets so future
    // dedup lookups can match on an abbreviation-stable key.
    if (entity_type === 'asset' && pickedFields.address) {
      entity.normalized_address = normalizeAddress(pickedFields.address);
    }

    const result = await opsQuery('POST', 'entities', entity);
    if (!result.ok) {
      return res.status(result.status).json({ error: 'Failed to create entity', detail: result.data });
    }

    const created = Array.isArray(result.data) ? result.data[0] : result.data;

    // Fire-and-forget: signal for listing-as-BD pipeline when an asset/listing is created
    if (entity_type === 'asset' && created?.state) {
      writeListingCreatedSignal(created, user);
    }

    // Fire-and-forget: unpack sidebar extraction data (contacts, sales, domain classification)
    if (entity_type === 'asset' && created?.id && hasSidebarData(metadata)) {
      processSidebarExtraction(created.id, workspaceId, user.id)
        .catch(err => console.error('[Sidebar pipeline async error]', err?.message || err));
    }

    return res.status(201).json({ entity: created });
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

    const updated = Array.isArray(result.data) ? result.data[0] : result.data;

    // Fire-and-forget: if metadata was updated with new sidebar data, run the pipeline
    if (metadata && updated?.id && updated?.entity_type === 'asset' && hasSidebarData(metadata)) {
      processSidebarExtraction(updated.id, workspaceId, user.id)
        .catch(err => console.error('[Sidebar pipeline async error on PATCH]', err?.message || err));
    }

    return res.status(200).json({ entity: updated });
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
