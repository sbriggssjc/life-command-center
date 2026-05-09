// ============================================================================
// Bridge handlers — Salesforce
// Life Command Center — Phase 1
// ----------------------------------------------------------------------------
// One handler per `enrichment_jobs.job_type`:
//
//   salesforce.account.upsert     → entities + external_identities
//   salesforce.contact.upsert     → entities + external_identities + unified_contacts.sf_*
//   salesforce.opportunity.upsert → entities.metadata.salesforce.opportunities[]
//   salesforce.activity.append    → salesforce_activity_log + unified_contacts touch counters
//
// All handlers return { ok, error?, result? } and never throw — the worker
// turns thrown errors into 'error' status anyway, but explicit is better.
//
// Reuses the existing pattern from api/_shared/salesforce-sync.js:
//   - external_identities upsert keyed on (workspace_id, source_system,
//     source_type, external_id) with Prefer=resolution=merge-duplicates.
//   - entities.metadata.salesforce JSONB merge for sidebar deep-links.
// ============================================================================

import { opsQuery, pgFilterVal } from './ops-db.js';

const SF_INSTANCE_URL = process.env.SF_INSTANCE_URL || '';

// ---- helpers --------------------------------------------------------------

function deepLink(kind, sfId) {
  if (!SF_INSTANCE_URL || !sfId) return null;
  return `${SF_INSTANCE_URL.replace(/\/+$/, '')}/lightning/r/${kind}/${sfId}/view`;
}

// Lightweight canonicalization for entities.canonical_name. Good enough for
// dedup-by-name; replace with the project's tenant-canonical helper later.
function canonicalize(name) {
  if (!name) return '';
  return String(name).toLowerCase()
    .replace(/[.,]+/g, ' ')
    .replace(/\b(inc|llc|l\.?l\.?c\.?|ltd|corp|corporation|company|co|the|holdings?)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(s, max = 4000) {
  if (!s) return s;
  const str = String(s);
  return str.length > max ? str.slice(0, max) + '…[truncated]' : str;
}

/**
 * Look up an existing entity_id via external_identities.
 * Returns { entityId, externalIdentityId } or null.
 */
async function findEntityBySfId(workspaceId, sourceType, sfId) {
  if (!workspaceId || !sfId) return null;
  const r = await opsQuery('GET',
    `external_identities?workspace_id=eq.${pgFilterVal(workspaceId)}` +
    `&source_system=eq.salesforce&source_type=eq.${pgFilterVal(sourceType)}` +
    `&external_id=eq.${pgFilterVal(sfId)}&select=id,entity_id&limit=1`,
    null, { countMode: 'none' }
  );
  if (r.ok && Array.isArray(r.data) && r.data.length) {
    return { entityId: r.data[0].entity_id, externalIdentityId: r.data[0].id };
  }
  return null;
}

/**
 * Find a candidate entity by canonical_name (orgs) or email (persons)
 * before creating a fresh one. Avoids duplicating an entity LCC already
 * tracks under a different source.
 */
async function findEntityForUpsert({ workspaceId, entityType, name, email }) {
  if (entityType === 'person' && email) {
    const r = await opsQuery('GET',
      `entities?workspace_id=eq.${pgFilterVal(workspaceId)}` +
      `&entity_type=eq.person&email=ilike.${pgFilterVal(email)}` +
      `&select=id&limit=1`,
      null, { countMode: 'none' }
    );
    if (r.ok && r.data?.length) return r.data[0].id;
  }
  if (entityType === 'organization' && name) {
    const r = await opsQuery('GET',
      `entities?workspace_id=eq.${pgFilterVal(workspaceId)}` +
      `&entity_type=eq.organization` +
      `&canonical_name=eq.${pgFilterVal(canonicalize(name))}` +
      `&select=id&limit=1`,
      null, { countMode: 'none' }
    );
    if (r.ok && r.data?.length) return r.data[0].id;
  }
  return null;
}

async function insertEntity({ workspaceId, entityType, fields }) {
  const r = await opsQuery('POST', 'entities', {
    workspace_id:   workspaceId,
    entity_type:    entityType,
    name:           fields.name,
    canonical_name: canonicalize(fields.name),
    first_name:     fields.first_name || null,
    last_name:      fields.last_name || null,
    title:          fields.title || null,
    email:          fields.email || null,
    phone:          fields.phone || null,
    org_type:       fields.org_type || null,
    metadata:       fields.metadata || {}
  });
  if (!r.ok || !Array.isArray(r.data) || !r.data.length) {
    throw new Error(`entity insert failed: ${r.status}`);
  }
  return r.data[0].id;
}

/**
 * Upsert external_identities row + merge entities.metadata.salesforce.
 * Mirror of writeEntitySalesforceLink in salesforce-sync.js — extracted
 * here so handlers don't reach into that module's internals.
 */
async function linkSalesforce({ workspaceId, entityId, kind, sfId, sfName, accountId }) {
  const now = new Date().toISOString();

  await opsQuery('POST',
    'external_identities?on_conflict=workspace_id,source_system,source_type,external_id',
    {
      workspace_id:  workspaceId,
      entity_id:     entityId,
      source_system: 'salesforce',
      source_type:   kind,
      external_id:   sfId,
      external_url:  deepLink(kind, sfId),
      metadata: {
        sf_name:    sfName || null,
        sf_account: accountId || null,
        synced_via: 'phase1.bridge-handlers-salesforce'
      },
      last_synced_at: now
    },
    { headers: { Prefer: 'return=representation,resolution=merge-duplicates' } }
  );

  // Merge into entities.metadata.salesforce — keeps the sidebar one hop away
  // from a SF deep link without scanning external_identities.
  const read = await opsQuery('GET',
    `entities?id=eq.${entityId}&workspace_id=eq.${pgFilterVal(workspaceId)}&select=metadata&limit=1`,
    null, { countMode: 'none' }
  );
  if (read.ok && read.data?.length) {
    const existing = read.data[0].metadata || {};
    const sf = { ...(existing.salesforce || {}) };
    if (kind === 'Account') {
      sf.account_id   = sfId;
      sf.account_name = sfName || sf.account_name || null;
    } else if (kind === 'Contact') {
      sf.contact_id   = sfId;
      sf.contact_name = sfName || sf.contact_name || null;
      if (accountId) sf.account_id = sf.account_id || accountId;
    }
    sf.last_synced_at = now;
    await opsQuery('PATCH',
      `entities?id=eq.${entityId}&workspace_id=eq.${pgFilterVal(workspaceId)}`,
      { metadata: { ...existing, salesforce: sf } }
    );
  }
}

// ---- account.upsert -------------------------------------------------------

export async function handleSalesforceAccountUpsert(job) {
  const p = job.payload || {};
  const workspaceId = job.workspace_id;
  const sfId = p.Id || job.external_id;
  if (!sfId) return { ok: false, error: 'missing_sf_id' };

  let entityId = (await findEntityBySfId(workspaceId, 'Account', sfId))?.entityId;
  if (!entityId) {
    entityId = await findEntityForUpsert({
      workspaceId, entityType: 'organization', name: p.Name
    });
  }
  if (!entityId) {
    entityId = await insertEntity({
      workspaceId, entityType: 'organization',
      fields: {
        name:     p.Name || `Salesforce Account ${sfId}`,
        org_type: p.Type || null,
        metadata: {
          salesforce: {
            account_id:   sfId,
            account_name: p.Name || null,
            industry:     p.Industry || null,
            phone:        p.Phone || null,
            website:      p.Website || null,
            billing_address: p.BillingStreet ? {
              street: p.BillingStreet, city: p.BillingCity,
              state:  p.BillingState,  zip:  p.BillingPostalCode,
              country: p.BillingCountry
            } : null
          }
        }
      }
    });
  }

  await linkSalesforce({
    workspaceId, entityId, kind: 'Account',
    sfId, sfName: p.Name || null
  });

  return { ok: true, result: { entity_id: entityId, sf_account_id: sfId } };
}

// ---- contact.upsert -------------------------------------------------------

export async function handleSalesforceContactUpsert(job) {
  const p = job.payload || {};
  const workspaceId = job.workspace_id;
  const sfId = p.Id || job.external_id;
  if (!sfId) return { ok: false, error: 'missing_sf_id' };

  // 1) entity (person)
  let entityId = (await findEntityBySfId(workspaceId, 'Contact', sfId))?.entityId;
  if (!entityId) {
    entityId = await findEntityForUpsert({
      workspaceId, entityType: 'person', email: p.Email
    });
  }
  if (!entityId) {
    const name = p.Name || [p.FirstName, p.LastName].filter(Boolean).join(' ').trim() || `Salesforce Contact ${sfId}`;
    entityId = await insertEntity({
      workspaceId, entityType: 'person',
      fields: {
        name,
        first_name: p.FirstName || null,
        last_name:  p.LastName || null,
        title:      p.Title || null,
        email:      p.Email || null,
        phone:      p.Phone || p.MobilePhone || null,
        metadata: { salesforce: { contact_id: sfId, contact_name: name, account_id: p.AccountId || null } }
      }
    });
  }

  await linkSalesforce({
    workspaceId, entityId, kind: 'Contact',
    sfId, sfName: p.Name || null, accountId: p.AccountId || null
  });

  // 2) unified_contacts soft-merge (only if email present — email is the
  //    dedup key. SF Contacts without email are landed as entity-only.)
  let unifiedId = null;
  if (p.Email) {
    const find = await opsQuery('GET',
      `unified_contacts?email=ilike.${pgFilterVal(p.Email)}&select=unified_id,sf_contact_id&limit=1`,
      null, { countMode: 'none' }
    );
    if (find.ok && find.data?.length) {
      unifiedId = find.data[0].unified_id;
      await opsQuery('PATCH',
        `unified_contacts?unified_id=eq.${unifiedId}`,
        {
          sf_contact_id:  sfId,
          sf_account_id:  p.AccountId || null,
          sf_last_synced: new Date().toISOString(),
          last_synced_sf: new Date().toISOString(),
          // Soft-fill: only set fields that weren't manually edited; the
          // field_sources provenance map can govern this in v2. For now
          // we set conservatively — title and phone are commonly stale,
          // so we don't overwrite from SF.
          first_name:   p.FirstName || null,
          last_name:    p.LastName || null
        }
      );
    } else {
      const ins = await opsQuery('POST', 'unified_contacts', {
        contact_class:  'business',
        first_name:     p.FirstName || null,
        last_name:      p.LastName || null,
        email:          p.Email,
        phone:          p.Phone || null,
        mobile_phone:   p.MobilePhone || null,
        title:          p.Title || null,
        sf_contact_id:  sfId,
        sf_account_id:  p.AccountId || null,
        sf_last_synced: new Date().toISOString(),
        last_synced_sf: new Date().toISOString(),
        match_method:   'sf_import',
        match_confidence: 1.0
      });
      if (ins.ok && ins.data?.length) unifiedId = ins.data[0].unified_id;
    }
  }

  return { ok: true, result: { entity_id: entityId, sf_contact_id: sfId, unified_id: unifiedId } };
}

// ---- opportunity.upsert ---------------------------------------------------

export async function handleSalesforceOpportunityUpsert(job) {
  const p = job.payload || {};
  const workspaceId = job.workspace_id;
  const sfId = p.Id || job.external_id;
  if (!sfId) return { ok: false, error: 'missing_sf_id' };
  if (!p.AccountId) return { ok: true, result: { skipped: 'no_account_link' } };

  // Resolve the parent Account entity. If the account hasn't been ingested
  // yet, defer this opportunity by re-enqueuing with a delay.
  const acctEntity = await findEntityBySfId(workspaceId, 'Account', p.AccountId);
  if (!acctEntity?.entityId) {
    return {
      ok: false,
      error: `account_not_yet_ingested:${p.AccountId}` // worker will retry with backoff
    };
  }

  // Append/replace the opportunity in entities.metadata.salesforce.opportunities[]
  const read = await opsQuery('GET',
    `entities?id=eq.${acctEntity.entityId}&workspace_id=eq.${pgFilterVal(workspaceId)}&select=metadata&limit=1`,
    null, { countMode: 'none' }
  );
  if (!read.ok || !read.data?.length) return { ok: false, error: 'account_entity_read_failed' };

  const meta = read.data[0].metadata || {};
  const sf = { ...(meta.salesforce || {}) };
  const opps = Array.isArray(sf.opportunities) ? [...sf.opportunities] : [];
  const idx = opps.findIndex(o => o.id === sfId);
  const oppRow = {
    id:          sfId,
    name:        p.Name || null,
    stage:       p.StageName || null,
    amount:      p.Amount ?? null,
    close_date:  p.CloseDate || null,
    probability: p.Probability ?? null,
    type:        p.Type || null,
    owner_id:    p.OwnerId || null,
    last_modified: p.LastModifiedDate || null,
    url:         deepLink('Opportunity', sfId)
  };
  if (idx >= 0) opps[idx] = oppRow; else opps.push(oppRow);
  sf.opportunities = opps.slice(-50); // cap retained list per account

  await opsQuery('PATCH',
    `entities?id=eq.${acctEntity.entityId}&workspace_id=eq.${pgFilterVal(workspaceId)}`,
    { metadata: { ...meta, salesforce: sf } }
  );

  return { ok: true, result: { account_entity_id: acctEntity.entityId, sf_opportunity_id: sfId } };
}

// ---- activity.append ------------------------------------------------------

function deriveActivityCategory(p) {
  // Salesforce Task: TaskSubtype in ('Task','Call','Email','ListEmail').
  // Event:           EventSubtype in ('Event','Meeting').
  // Plus legacy Type/CallType fields. Map to our category enum.
  const sub = (p.TaskSubtype || p.EventSubtype || '').toLowerCase();
  const typ = (p.Type || '').toLowerCase();
  if (sub === 'call' || typ === 'call' || p.CallType) return 'call';
  if (sub === 'email' || sub === 'listemail' || typ === 'email') return 'email';
  if (sub === 'meeting' || sub === 'event' || typ === 'meeting') return 'meeting';
  if (p.IsTask === true || p.IsTask === 'true') return 'task';
  return 'other';
}

export async function handleSalesforceActivityAppend(job) {
  const p = job.payload || {};
  const workspaceId = job.workspace_id;
  const sfId = p.Id || job.external_id;
  if (!sfId) return { ok: false, error: 'missing_sf_id' };

  // Resolve LCC entities for the WhoId (Contact) and WhatId (Account/Opp).
  // These are nullable — many SF activities aren't linked to a tracked entity,
  // and that's fine; the row still goes into salesforce_activity_log so we
  // can compute "did anyone touch this account" later via the SF id.
  const [contactE, accountE] = await Promise.all([
    p.WhoId   ? findEntityBySfId(workspaceId, 'Contact', p.WhoId) : null,
    p.AccountId ? findEntityBySfId(workspaceId, 'Account', p.AccountId)
                : (p.WhatId ? findEntityBySfId(workspaceId, 'Account', p.WhatId) : null)
  ]);

  const category = deriveActivityCategory(p);
  const occurredAt = p.LastModifiedDate || p.ActivityDate || p.CreatedDate || new Date().toISOString();

  // Upsert into salesforce_activity_log on (workspace_id, sf_activity_id).
  await opsQuery('POST',
    'salesforce_activity_log?on_conflict=workspace_id,sf_activity_id',
    {
      workspace_id:        workspaceId,
      sf_activity_id:      sfId,
      sf_activity_type:    p.IsTask === false ? 'Event' : 'Task',
      sf_subject:          p.Subject || null,
      sf_call_type:        p.CallType || null,
      sf_status:           p.Status || null,
      sf_priority:         p.Priority || null,
      sf_activity_date:    p.ActivityDate || null,
      sf_owner_id:         p.OwnerId || 'unknown',
      sf_owner_name:       p.OwnerName || p._OwnerName || null,
      sf_owner_email:      p.OwnerEmail || p._OwnerEmail || null,
      sf_who_id:           p.WhoId || null,
      sf_what_id:          p.WhatId || null,
      contact_entity_id:   contactE?.entityId || null,
      account_entity_id:   accountE?.entityId || null,
      category,
      description:         truncate(p.Description, 4000),
      occurred_at:         occurredAt,
      sf_last_modified_at: p.LastModifiedDate || null,
      metadata:            { raw_subtype: p.TaskSubtype || p.EventSubtype || null }
    },
    { headers: { Prefer: 'resolution=merge-duplicates' } }
  );

  // Refresh unified_contacts touch metrics if we can identify the contact
  // by sf_contact_id. Fields updated:
  //   call    → last_call_date, total_calls += 1
  //   email   → last_email_date, total_emails_sent += 1
  //   meeting → last_meeting_date
  // Other categories don't bump counters.
  if (p.WhoId && (category === 'call' || category === 'email' || category === 'meeting')) {
    const find = await opsQuery('GET',
      `unified_contacts?sf_contact_id=eq.${pgFilterVal(p.WhoId)}&select=unified_id,total_calls,total_emails_sent&limit=1`,
      null, { countMode: 'none' }
    );
    if (find.ok && find.data?.length) {
      const u = find.data[0];
      const patch = {};
      if (category === 'call') {
        patch.last_call_date = occurredAt;
        patch.total_calls    = (u.total_calls || 0) + 1;
      } else if (category === 'email') {
        patch.last_email_date     = occurredAt;
        patch.total_emails_sent   = (u.total_emails_sent || 0) + 1;
      } else if (category === 'meeting') {
        patch.last_meeting_date = occurredAt;
      }
      await opsQuery('PATCH',
        `unified_contacts?unified_id=eq.${u.unified_id}`,
        patch
      );
    }
  }

  return {
    ok: true,
    result: {
      sf_activity_id: sfId,
      category,
      account_entity_id: accountE?.entityId || null,
      contact_entity_id: contactE?.entityId || null
    }
  };
}
