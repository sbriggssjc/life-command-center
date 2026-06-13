// api/_handlers/contact-acquisition.js
// ============================================================================
// R16 Unit 1 — Salesforce contact-acquisition worker
// ----------------------------------------------------------------------------
// The conversion point of the outreach loop. Grounded live 2026-06-13: 395
// prospecting cadences, 0 with a contact; 67 of those entities carry a
// Salesforce ACCOUNT identity (external_identities source_system='salesforce',
// source_type='Account') — meaning the human contacts almost certainly already
// exist in Salesforce and just aren't pulled into LCC.
//
// This worker auto-acquires them: for each contactless overdue cadence whose
// entity has an SF account identity, it calls the EXISTING
// find_contacts_by_account flow, creates each returned SF contact as a person
// entity (via ensureEntityLink — guards + SF-identity mirror), links
// person→entity, and stamps the PRIMARY contact onto the cadence so it becomes
// outreach-ready. A dead contactless cadence turns into one the operator can
// actually draft an email for.
//
//   GET  → dry-run (no SF calls, no writes) — reports what WOULD be processed.
//   POST → drain (bounded by `limit` + a wall-clock budget).
//
// Outcome-truthful + don't-re-hammer: an entity where SF returns no contacts is
// marked on the cadence (metadata.contact_acquisition) so it isn't re-hit every
// tick, and it falls to the P-CONTACT lane (Unit 2 gate) for manual
// acquisition. Feature-flagged: no-ops cleanly when the SF flow is unconfigured
// (same posture as every other SF-dependent path).
//
// Reuses (never forks): getSalesforceContactsByAccount (SF flow),
// ensureEntityLink (person create + guards + identity mirror), and the
// contact-attach helpers (linkPersonToEntity / stampCadenceContactById) shared
// with the interactive P-CONTACT picker.
// ============================================================================

import { authenticate } from '../_shared/auth.js';
import { opsQuery, pgFilterVal } from '../_shared/ops-db.js';
import { ensureEntityLink } from '../_shared/entity-link.js';
import { getSalesforceContactsByAccount, isSalesforceConfigured } from '../_shared/salesforce.js';
import { linkPersonToEntity, stampCadenceContactById, ACTIVE_CADENCE_PHASES } from '../_shared/contact-attach.js';

// Transient SF outages (unavailable) get a few retries; a definitive empty
// account (no_contacts / no_usable_contacts) is terminal — never re-hammered.
const MAX_UNAVAILABLE_ATTEMPTS = parseInt(process.env.CONTACT_ACQ_MAX_ATTEMPTS || '4', 10);

/** Has a prior tick already exhausted this cadence's SF acquisition attempts? */
export function isAcqExhausted(metadata) {
  const a = metadata && metadata.contact_acquisition;
  if (!a || !a.status) return false;
  if (a.status === 'acquired') return true;                 // already done
  if (a.status === 'no_contacts' || a.status === 'no_usable_contacts') return true; // definitive empty
  if (a.status === 'unavailable' && Number(a.attempts || 0) >= MAX_UNAVAILABLE_ATTEMPTS) return true;
  return false;
}

/**
 * Process ONE candidate (entity + its most-overdue contactless cadence + the
 * mapped SF account). Pure orchestration over injected deps so it unit-tests
 * without mocking fetch across many endpoints.
 *
 * deps:
 *   getSfContacts(accountId) -> { ok, contacts:[{Id,Name,Title,Email}], reason }
 *   ensurePerson(contact)    -> { ok, entity:{id,...} } | { ok:false, skipped }
 *   linkPerson(entityId, personId) -> { ok }
 *   stampCadence(cadenceId, { contactEntityId?, sfContactId?, acquisitionMeta }) -> { ok }
 */
export async function acquireForEntity(candidate, deps) {
  const nowIso = new Date().toISOString();
  const attempts = Number(candidate.attempts || 0) + 1;
  const r = await deps.getSfContacts(candidate.sf_account_id);

  if (!r || r.ok !== true) {
    const reason = (r && r.reason) || 'lookup_failed';
    const status = reason === 'sf_not_configured' ? 'not_configured' : 'unavailable';
    await deps.stampCadence(candidate.cadence_id, {
      acquisitionMeta: { status, attempts, last_attempt_at: nowIso, reason },
    });
    return { outcome: status, contacts_created: 0 };
  }

  const contacts = Array.isArray(r.contacts) ? r.contacts : [];
  if (contacts.length === 0) {
    await deps.stampCadence(candidate.cadence_id, {
      acquisitionMeta: { status: 'no_contacts', attempts, last_attempt_at: nowIso },
    });
    return { outcome: 'no_contacts', contacts_created: 0 };
  }

  // Create + link every returned SF contact as a person entity (guards reject
  // garbage names → that contact is skipped, never minted).
  const created = [];
  for (const c of contacts) {
    if (!c || !c.Id || !c.Name) continue;
    const el = await deps.ensurePerson(c);
    if (!el || !el.ok || !el.entity || !el.entity.id) continue;
    await deps.linkPerson(candidate.entity_id, el.entity.id);
    created.push({ contact_entity_id: el.entity.id, sf_contact_id: c.Id, name: c.Name });
  }

  if (created.length === 0) {
    await deps.stampCadence(candidate.cadence_id, {
      acquisitionMeta: { status: 'no_usable_contacts', attempts, last_attempt_at: nowIso },
    });
    return { outcome: 'no_contacts', contacts_created: 0 };
  }

  // Stamp the PRIMARY contact onto the cadence → outreach-ready.
  const primary = created[0];
  await deps.stampCadence(candidate.cadence_id, {
    contactEntityId: primary.contact_entity_id,
    sfContactId: primary.sf_contact_id,
    acquisitionMeta: { status: 'acquired', count: created.length, attempts, last_attempt_at: nowIso },
  });
  return { outcome: 'acquired', contacts_created: created.length, primary };
}

// ── HTTP entrypoint ─────────────────────────────────────────────────────────
export async function handleContactAcquisitionTick(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET (dry-run) or POST only' });
  }
  const user = await authenticate(req, res);
  if (!user) return;

  const dryRun = req.method === 'GET';
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '25', 10)));
  const configured = isSalesforceConfigured();

  const result = {
    mode: dryRun ? 'dry_run' : 'apply',
    sf_configured: configured,
    scanned_cadences: 0,
    sf_mapped: 0,
    candidates: 0,
    acquired: 0,
    contacts_created: 0,
    no_contacts: 0,
    unavailable: 0,
    items: [],
  };

  // Feature flag: no-op cleanly when the SF flow isn't wired (same posture as
  // the buyer-contact picker / folder-feed channels).
  if (!configured) {
    result.note = 'salesforce_not_configured — worker is inert until SF_LOOKUP_WEBHOOK_URL is set';
    return res.status(200).json(result);
  }

  // Step A — contactless overdue active cadences. Over-fetch so the
  // already-exhausted (no_contacts) rows can be filtered out in JS and we still
  // fill the per-tick budget with workable candidates.
  const nowIso = new Date().toISOString();
  const overFetch = Math.min(400, limit * 6);
  const cadRes = await opsQuery('GET',
    'touchpoint_cadence?contact_id=is.null&sf_contact_id=is.null'
    + '&next_touch_due=lte.' + encodeURIComponent(nowIso)
    + '&phase=in.(' + ACTIVE_CADENCE_PHASES.join(',') + ')'
    + '&entity_id=not.is.null'
    + '&select=id,entity_id,bd_opportunity_id,next_touch_due,domain,phase,metadata'
    + '&order=next_touch_due.asc.nullslast&limit=' + overFetch);
  if (!cadRes.ok) {
    return res.status(cadRes.status || 500).json({ error: 'Failed to list cadences', detail: cadRes.data });
  }
  const cadRows = Array.isArray(cadRes.data) ? cadRes.data : [];
  result.scanned_cadences = cadRows.length;

  // One cadence per entity per tick (the most overdue), skipping the exhausted.
  const perEntity = new Map();
  for (const c of cadRows) {
    if (isAcqExhausted(c.metadata)) continue;
    if (!perEntity.has(c.entity_id)) perEntity.set(c.entity_id, c);
  }
  const entityIds = Array.from(perEntity.keys());
  if (entityIds.length === 0) {
    return res.status(200).json(result);
  }

  // Step B — which of those entities carry an SF ACCOUNT identity, and their
  // workspace (needed for entity creation). Batch both lookups.
  const sfByEntity = new Map();
  const wsByEntity = new Map();
  for (let i = 0; i < entityIds.length; i += 100) {
    const slice = entityIds.slice(i, i + 100);
    const inList = slice.map(pgFilterVal).join(',');
    const eiRes = await opsQuery('GET', 'external_identities?source_system=eq.salesforce&source_type=eq.Account'
      + '&entity_id=in.(' + inList + ')&select=entity_id,external_id');
    if (eiRes.ok && Array.isArray(eiRes.data)) {
      for (const row of eiRes.data) {
        if (row.entity_id && row.external_id && !sfByEntity.has(row.entity_id)) sfByEntity.set(row.entity_id, row.external_id);
      }
    }
    const enRes = await opsQuery('GET', 'entities?id=in.(' + inList + ')&select=id,workspace_id,name');
    if (enRes.ok && Array.isArray(enRes.data)) {
      for (const row of enRes.data) wsByEntity.set(row.id, { workspace_id: row.workspace_id, name: row.name });
    }
  }

  const candidates = [];
  for (const entityId of entityIds) {
    const accountId = sfByEntity.get(entityId);
    if (!accountId) continue;   // no SF account → out of scope (the 328 cold set)
    const cad = perEntity.get(entityId);
    const meta = wsByEntity.get(entityId) || {};
    candidates.push({
      cadence_id: cad.id,
      entity_id: entityId,
      entity_name: meta.name || null,
      workspace_id: meta.workspace_id || null,
      sf_account_id: accountId,
      next_touch_due: cad.next_touch_due,
      existing_metadata: cad.metadata || {},
      attempts: (cad.metadata && cad.metadata.contact_acquisition && cad.metadata.contact_acquisition.attempts) || 0,
    });
  }
  result.sf_mapped = candidates.length;

  const work = candidates.slice(0, limit);
  result.candidates = work.length;

  if (dryRun) {
    result.items = work.map(c => ({ entity_id: c.entity_id, entity_name: c.entity_name, sf_account_id: c.sf_account_id, cadence_id: c.cadence_id }));
    return res.status(200).json(result);
  }

  // Drain, bounded by a wall-clock budget (SF flow calls are serial HTTP).
  const deadline = Date.now() + parseInt(process.env.CONTACT_ACQ_BUDGET_MS || '20000', 10);
  let anyAcquired = false;
  for (const c of work) {
    if (Date.now() > deadline) { result.budget_stopped = true; break; }
    const ws = c.workspace_id;
    const deps = {
      getSfContacts: (accountId) => getSalesforceContactsByAccount(accountId),
      ensurePerson: (contact) => ensureEntityLink({
        workspaceId: ws, userId: user.id,
        sourceSystem: 'salesforce', sourceType: 'Contact', externalId: contact.Id,
        domain: 'lcc',
        seedFields: { name: contact.Name, email: contact.Email || undefined, title: contact.Title || undefined },
        metadata: { via: 'contact_acquisition', sf_account_id: c.sf_account_id },
      }),
      linkPerson: (entityId, personId) => linkPersonToEntity({
        workspaceId: ws, entityId, contactEntityId: personId,
        role: 'prospecting_contact', via: 'contact_acquisition',
      }),
      stampCadence: (cadenceId, args) => stampCadenceContactById(cadenceId, Object.assign({ existingMetadata: c.existing_metadata }, args)),
    };
    let out;
    try {
      out = await acquireForEntity(c, deps);
    } catch (e) {
      out = { outcome: 'unavailable', contacts_created: 0, error: String(e && e.message || e) };
    }
    if (out.outcome === 'acquired') { result.acquired++; result.contacts_created += out.contacts_created; anyAcquired = true; }
    else if (out.outcome === 'no_contacts') result.no_contacts++;
    else result.unavailable++;
    result.items.push({ entity_id: c.entity_id, entity_name: c.entity_name, sf_account_id: c.sf_account_id, outcome: out.outcome, contacts_created: out.contacts_created || 0 });
  }

  // Staleness hook: acquired entities just became reachable — refresh the queue
  // cache so they leave P-CONTACT within the request instead of waiting 5 min.
  if (anyAcquired) {
    try { await opsQuery('POST', 'rpc/lcc_refresh_priority_queue_resolved', {}); } catch (_e) { /* soft */ }
  }

  return res.status(200).json(result);
}
