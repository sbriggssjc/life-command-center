// ============================================================================
// External user mappings — bridge between source-system user ids and LCC users
// Life Command Center — Phase 1.5
// ----------------------------------------------------------------------------
// Used by:
//   - Salesforce activity handler (resolves OwnerId → users.id at ingest time)
//   - SharePoint document handler (resolves lastModifiedBy.user.id → users.id)
//   - Backfill admin action (re-resolves historical rows after the fact)
//
// The resolver is intentionally cheap — every call hits the unique index on
// (workspace_id, source_system, external_id). Misses fall through to an
// email-based auto-match, with the result (positive or 'unmatched') written
// back so subsequent calls don't retry the same lookup.
// ============================================================================

import { opsQuery, isOpsConfigured, pgFilterVal } from './ops-db.js';

/**
 * Resolve an LCC user_id for a (source_system, external_id) tuple.
 * Returns the user_id, or null if no match is possible.
 *
 * Behavior:
 *   1. Look up existing mapping. If found and user_id is set, return it.
 *      If found but match_method='unmatched' (or user_id is null),
 *      return null without retrying the email lookup — avoids hammering
 *      for hopeless cases.
 *   2. No mapping yet → try to auto-match by email against `users`. Insert
 *      the mapping row with the result.
 *   3. Return whatever we resolved.
 *
 * Safe to call from any handler. Never throws.
 */
export async function resolveExternalUser({
  workspaceId,
  sourceSystem,
  externalId,
  externalEmail = null,
  externalName  = null
}) {
  if (!workspaceId || !sourceSystem || !externalId) return null;
  if (!isOpsConfigured()) return null;

  // 1) Existing mapping?
  const existingR = await opsQuery('GET',
    `external_user_mappings?workspace_id=eq.${pgFilterVal(workspaceId)}` +
    `&source_system=eq.${pgFilterVal(sourceSystem)}` +
    `&external_id=eq.${pgFilterVal(externalId)}` +
    `&select=id,user_id,match_method&limit=1`,
    null, { countMode: 'none' }
  );
  if (existingR.ok && existingR.data?.length) {
    return existingR.data[0].user_id || null;
  }

  // 2) Auto-match by email.
  let resolvedUserId = null;
  let confidence     = null;
  if (externalEmail) {
    const userR = await opsQuery('GET',
      `users?email=ilike.${pgFilterVal(externalEmail)}&is_active=eq.true&select=id&limit=1`,
      null, { countMode: 'none' }
    );
    if (userR.ok && userR.data?.length) {
      resolvedUserId = userR.data[0].id;
      confidence     = 1.0;
    }
  }

  // 3) Insert mapping row (idempotent via the unique index).
  try {
    await opsQuery('POST',
      'external_user_mappings?on_conflict=workspace_id,source_system,external_id',
      {
        workspace_id:    workspaceId,
        source_system:   sourceSystem,
        external_id:     externalId,
        external_email:  externalEmail || null,
        external_name:   externalName  || null,
        user_id:         resolvedUserId,
        match_method:    resolvedUserId ? 'auto' : 'unmatched',
        confidence
      },
      { headers: { Prefer: 'resolution=merge-duplicates' } }
    );
  } catch (err) {
    console.warn('[external-user-mappings] insert failed (non-fatal):',
      err?.message || err);
  }

  return resolvedUserId;
}

/**
 * Backfill `salesforce_activity_log.actor_user_id` for rows where it's
 * still null. Iterates over `v_unmapped_sf_owners`, resolves each owner
 * via `resolveExternalUser`, then bulk-PATCHes activity rows that share
 * that sf_owner_id.
 *
 * Returns { owners_seen, owners_mapped, owners_unmapped, rows_updated }.
 */
export async function backfillSalesforceActorMappings(workspaceId, options = {}) {
  const result = { owners_seen: 0, owners_mapped: 0, owners_unmapped: 0, rows_updated: 0 };
  if (!workspaceId || !isOpsConfigured()) return result;
  const limit = Math.min(options.limit || 200, 1000);

  const ownersR = await opsQuery('GET',
    `v_unmapped_sf_owners?workspace_id=eq.${pgFilterVal(workspaceId)}` +
    `&order=activity_count.desc&limit=${limit}`,
    null, { countMode: 'estimated' }
  );
  if (!ownersR.ok) {
    result.error = `unmapped_owners_fetch_failed:${ownersR.status}`;
    return result;
  }

  for (const owner of ownersR.data || []) {
    result.owners_seen++;
    const userId = await resolveExternalUser({
      workspaceId,
      sourceSystem:   'salesforce',
      externalId:     owner.sf_owner_id,
      externalEmail:  owner.sf_owner_email,
      externalName:   owner.sf_owner_name
    });

    if (!userId) {
      result.owners_unmapped++;
      continue;
    }

    result.owners_mapped++;
    const upd = await opsQuery('PATCH',
      `salesforce_activity_log?workspace_id=eq.${pgFilterVal(workspaceId)}` +
      `&sf_owner_id=eq.${pgFilterVal(owner.sf_owner_id)}` +
      `&actor_user_id=is.null`,
      { actor_user_id: userId }
    );
    if (upd.ok && Array.isArray(upd.data)) {
      result.rows_updated += upd.data.length;
    }
  }
  return result;
}
