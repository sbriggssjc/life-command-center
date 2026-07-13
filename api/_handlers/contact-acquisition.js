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
// R20 (2026-06-15) — person-is-its-own-contact (the near-free unlock). Before
// the SF pass, a Pass-1 self-stamp runs over the SAME contactless set: for a
// cadence seeded ON a person who already carries an email/phone on the entity
// record, stamp contact_id = entity_id (the person IS the contact). This needs
// no Salesforce, so it runs even when the SF flow is unconfigured. Auditing the
// "cold" cadences live 2026-06-15 found ~200 such person-with-contact rows that
// were sitting un-actionable in P-CONTACT purely because contact_id was null.
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
import { ensureEntityLink, looksLikePersonName } from '../_shared/entity-link.js';
import { getSalesforceContactsByAccount, isSalesforceConfigured } from '../_shared/salesforce.js';
import { linkPersonToEntity, stampCadenceContactById, stampContactOnActiveCadence, ACTIVE_CADENCE_PHASES } from '../_shared/contact-attach.js';

// Transient SF outages (unavailable) get a few retries; a definitive empty
// account (no_contacts / no_usable_contacts) is terminal — never re-hammered.
const MAX_UNAVAILABLE_ATTEMPTS = parseInt(process.env.CONTACT_ACQ_MAX_ATTEMPTS || '4', 10);

/**
 * R20 — person-is-its-own-contact eligibility. A cadence seeded ON an individual
 * (the owner IS a person) who already carries an email or phone on the entity
 * record needs no contact acquisition — the person IS the contact. This guard
 * decides whether such a cadence can self-stamp `contact_id = entity_id`.
 *
 * Boundaries (the same guard the P-CONTACT picker uses, so the two never
 * diverge): ONLY a `person`-typed entity (an org is never its own contact);
 * with a real email or phone on the record; not junk/orphan-flagged; and a
 * plausible HUMAN name (`looksLikePersonName` rejects firm-suffix / deal
 * artifacts mistyped as persons — e.g. "DAUM Commercial Real Estate Services").
 * Never fabricates contact data — only wires what's already on the record.
 */
export function isSelfContactablePerson(entity) {
  if (!entity || entity.entity_type !== 'person') return false;
  const email = entity.email && String(entity.email).trim();
  const phone = entity.phone && String(entity.phone).trim();
  if (!email && !phone) return false;
  const md = entity.metadata;
  if (md && (md.junk_name_flagged === true || md.orphan_flagged === true)) return false;
  if (!looksLikePersonName(entity.name)) return false;
  return true;
}

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
  const selfStampLimit = Math.min(200, Math.max(1,
    parseInt(req.query.self_stamp_limit || process.env.CONTACT_ACQ_SELF_STAMP_LIMIT || '100', 10)));
  const configured = isSalesforceConfigured();

  const result = {
    mode: dryRun ? 'dry_run' : 'apply',
    sf_configured: configured,
    scanned_cadences: 0,
    self_stamp_eligible: 0,   // R20: person-is-own-contact set
    self_stamped: 0,
    sf_mapped: 0,
    candidates: 0,
    acquired: 0,
    contacts_created: 0,
    no_contacts: 0,
    unavailable: 0,
    // Phase 2 (2026-07-13) — the worklist SF cheap-win pass (owners with an SF
    // Account identity but no cadence at all; not covered by the contactless-
    // cadence passes above).
    worklist_sf_mapped: 0,
    worklist_acquired: 0,
    worklist_contacts_created: 0,
    worklist_cadences_seeded: 0,
    worklist_no_contacts: 0,
    items: [],
  };

  // Step A — contactless overdue active cadences. Shared by BOTH passes (the
  // R20 self-stamp pass and the SF-acquisition pass). Over-fetch so the
  // already-exhausted rows can be filtered out in JS and we still fill the
  // per-tick budget with workable candidates.
  const nowIso = new Date().toISOString();
  const overFetch = Math.min(600, Math.max(limit, selfStampLimit) * 6);
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

  // Step B — entity facts (type/email/phone/metadata/workspace/name) for the
  // self-stamp pass, and the SF ACCOUNT identity map for the acquisition pass.
  // The SF map is only needed when SF is configured.
  const entityById = new Map();
  const sfByEntity = new Map();
  for (let i = 0; i < entityIds.length; i += 100) {
    const slice = entityIds.slice(i, i + 100);
    const inList = slice.map(pgFilterVal).join(',');
    const enRes = await opsQuery('GET', 'entities?id=in.(' + inList + ')'
      + '&select=id,workspace_id,name,entity_type,email,phone,metadata');
    if (enRes.ok && Array.isArray(enRes.data)) {
      for (const row of enRes.data) entityById.set(row.id, row);
    }
    if (configured) {
      const eiRes = await opsQuery('GET', 'external_identities?source_system=eq.salesforce&source_type=eq.Account'
        + '&entity_id=in.(' + inList + ')&select=entity_id,external_id');
      if (eiRes.ok && Array.isArray(eiRes.data)) {
        for (const row of eiRes.data) {
          if (row.entity_id && row.external_id && !sfByEntity.has(row.entity_id)) sfByEntity.set(row.entity_id, row.external_id);
        }
      }
    }
  }

  const deadline = Date.now() + parseInt(process.env.CONTACT_ACQ_BUDGET_MS || '20000', 10);

  // ── Pass 1 (R20): self-stamp the person-is-own-contact set. ───────────────
  // A person entity with its own email/phone IS the contact. Stamp
  // contact_id = entity_id so the cadence becomes reachable + draftable. Needs
  // NO Salesforce, so it runs whether or not SF is configured. Idempotent
  // (guarded on contact_id IS NULL by the fetch; a re-tick can't double-stamp
  // because the row leaves the contactless set once stamped).
  const selfStamped = new Set();
  const selfEligible = [];
  for (const entityId of entityIds) {
    const e = entityById.get(entityId);
    if (!isSelfContactablePerson(e)) continue;
    selfEligible.push({ entity_id: entityId, entity_name: e.name, cadence_id: perEntity.get(entityId).id });
  }
  result.self_stamp_eligible = selfEligible.length;
  const selfWork = selfEligible.slice(0, selfStampLimit);
  let anyWrite = false;
  if (dryRun) {
    for (const s of selfWork) {
      result.items.push({ pass: 'self_stamp', entity_id: s.entity_id, entity_name: s.entity_name, cadence_id: s.cadence_id });
    }
  } else {
    for (const s of selfWork) {
      if (Date.now() > deadline) { result.budget_stopped = true; break; }
      const cad = perEntity.get(s.entity_id);
      const up = await stampCadenceContactById(s.cadence_id, {
        contactEntityId: s.entity_id,        // the person is their own contact
        existingMetadata: cad.metadata || {},
        acquisitionMeta: { status: 'self_contact', via: 'person_self_contact', last_attempt_at: new Date().toISOString() },
      });
      if (up.ok) {
        result.self_stamped++; anyWrite = true; selfStamped.add(s.entity_id);
        result.items.push({ pass: 'self_stamp', entity_id: s.entity_id, entity_name: s.entity_name, cadence_id: s.cadence_id, outcome: 'self_stamped' });
      } else {
        result.items.push({ pass: 'self_stamp', entity_id: s.entity_id, entity_name: s.entity_name, cadence_id: s.cadence_id, outcome: 'stamp_failed', detail: up.detail });
      }
    }
  }

  // ── Pass 2: SF contact acquisition (only when SF is configured). ──────────
  let anyAcquired = false;
  if (!configured) {
    result.note = result.self_stamp_eligible
      ? 'salesforce_not_configured — SF acquisition inert; self-contact pass ran'
      : 'salesforce_not_configured — SF acquisition inert; no self-contactable persons either';
    if (anyWrite) { try { await opsQuery('POST', 'rpc/lcc_refresh_priority_queue_resolved', {}); } catch (_e) { /* soft */ } }
    return res.status(200).json(result);
  }

  const candidates = [];
  for (const entityId of entityIds) {
    if (selfStamped.has(entityId)) continue;   // already given its own contact (Pass 1)
    const accountId = sfByEntity.get(entityId);
    if (!accountId) continue;   // no SF account + not self-contactable → cold set (out of scope)
    const cad = perEntity.get(entityId);
    const meta = entityById.get(entityId) || {};
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
    for (const c of work) {
      result.items.push({ pass: 'sf_acquire', entity_id: c.entity_id, entity_name: c.entity_name, sf_account_id: c.sf_account_id, cadence_id: c.cadence_id });
    }
  } else {
    // Drain, bounded by the same wall-clock budget (SF flow calls are serial HTTP).
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
      result.items.push({ pass: 'sf_acquire', entity_id: c.entity_id, entity_name: c.entity_name, sf_account_id: c.sf_account_id, outcome: out.outcome, contacts_created: out.contacts_created || 0 });
    }
  }

  // ── Pass 3 (Phase 2): the worklist SF cheap-win. ──────────────────────────
  // The highest-value BD targets (the "Owners Missing a Contact" worklist) can't
  // enter the pipeline via Passes 1/2 because they carry NO cadence — Pass 2
  // only walks contactless CADENCES. Grounded live 2026-07-13: 269 worklist
  // owners carry an SF Account identity (38 of them ≥ $1M) — a cheap contact
  // path (getSalesforceContactsByAccount) that was going unused. Pull their SF
  // contacts + attach via the shared contact-attach helper, seeding a
  // value-gated cadence (the maybeSeedValuableCadence wire) so the freshly-
  // contacted owner surfaces at the TOP of the value-ranked focus session.
  const processedEntities = new Set(selfStamped);
  for (const c of work) processedEntities.add(c.entity_id);
  await runWorklistSfPass({ result, dryRun, limit, deadline, user, processedEntities,
    setAcquired: () => { anyAcquired = true; } });

  // Staleness hook: self-stamped + acquired entities just became reachable —
  // refresh the queue cache so they leave P-CONTACT within the request instead
  // of waiting the */5 cron.
  if (anyWrite || anyAcquired) {
    try { await opsQuery('POST', 'rpc/lcc_refresh_priority_queue_resolved', {}); } catch (_e) { /* soft */ }
  }

  return res.status(200).json(result);
}

/**
 * Pass 3 — acquire SF contacts for high-value worklist owners that carry an SF
 * Account identity but no cadence at all. Reuses acquireForEntity (the R16
 * core) with the shared stampContactOnActiveCadence stamp, which seeds a
 * value-gated cadence when the owner has none (the Phase-1 wire). A
 * successfully-acquired owner drops out of the (auto-retiring) worklist view, so
 * it is never re-processed; a genuinely-empty SF account falls to the enrichment
 * adapters / manual pick (its pivot now exists from the Phase-2 sweep).
 */
async function runWorklistSfPass({ result, dryRun, limit, deadline, user, processedEntities, setAcquired }) {
  // Value-ranked worklist owners (over-fetch so the already-processed + no-SF
  // ones can be filtered in JS and we still fill the per-tick budget).
  const overFetch = Math.min(600, limit * 6);
  const wRes = await opsQuery('GET',
    'v_owner_contact_worklist?select=entity_id,owner_name,workspace_id,rank_value'
    + '&order=rank_value.desc.nullslast&limit=' + overFetch);
  if (!wRes.ok || !Array.isArray(wRes.data) || wRes.data.length === 0) return;

  const byId = new Map();
  for (const w of wRes.data) {
    if (!w.entity_id || processedEntities.has(w.entity_id) || byId.has(w.entity_id)) continue;
    byId.set(w.entity_id, w);
  }
  const ids = Array.from(byId.keys());
  if (ids.length === 0) return;

  // SF Account identity map for the worklist owners.
  const sfByEntity = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const inList = ids.slice(i, i + 100).map(pgFilterVal).join(',');
    const eiRes = await opsQuery('GET', 'external_identities?source_system=eq.salesforce&source_type=eq.Account'
      + '&entity_id=in.(' + inList + ')&select=entity_id,external_id');
    if (eiRes.ok && Array.isArray(eiRes.data)) {
      for (const row of eiRes.data) {
        if (row.entity_id && row.external_id && !sfByEntity.has(row.entity_id)) sfByEntity.set(row.entity_id, row.external_id);
      }
    }
  }

  const owners = [];
  for (const id of ids) {
    const acct = sfByEntity.get(id);
    if (!acct) continue;
    const w = byId.get(id);
    owners.push({ entity_id: id, entity_name: w.owner_name || null, workspace_id: w.workspace_id || null, sf_account_id: acct, rank_value: w.rank_value });
  }
  result.worklist_sf_mapped = owners.length;

  const work = owners.slice(0, limit);
  if (dryRun) {
    for (const o of work) {
      result.items.push({ pass: 'worklist_sf', entity_id: o.entity_id, entity_name: o.entity_name, sf_account_id: o.sf_account_id, rank_value: o.rank_value });
    }
    return;
  }

  for (const o of work) {
    if (Date.now() > deadline) { result.budget_stopped = true; break; }
    const ws = o.workspace_id;
    let seedInfo = null;
    const deps = {
      getSfContacts: (accountId) => getSalesforceContactsByAccount(accountId),
      ensurePerson: (contact) => ensureEntityLink({
        workspaceId: ws, userId: user.id,
        sourceSystem: 'salesforce', sourceType: 'Contact', externalId: contact.Id,
        domain: 'lcc',
        seedFields: { name: contact.Name, email: contact.Email || undefined, title: contact.Title || undefined },
        metadata: { via: 'contact_acquisition_worklist', sf_account_id: o.sf_account_id },
      }),
      linkPerson: (entityId, personId) => linkPersonToEntity({
        workspaceId: ws, entityId, contactEntityId: personId,
        role: 'prospecting_contact', via: 'contact_acquisition_worklist',
      }),
      // The owner has no cadence — stampContactOnActiveCadence seeds a
      // value-gated one (maybeSeedValuableCadence) when a contact is stamped.
      // Failure/no-op metadata calls (no contact) are a no-op (no cadence yet).
      stampCadence: async (_cadenceId, args) => {
        if (!args || (!args.contactEntityId && !args.sfContactId)) return { ok: true };
        const s = await stampContactOnActiveCadence({
          entityId: o.entity_id, contactEntityId: args.contactEntityId, sfContactId: args.sfContactId,
          onlyContactless: true, seedIfValuable: true,
        });
        seedInfo = s;
        return { ok: !!s.ok };
      },
    };
    let out;
    try {
      out = await acquireForEntity({ cadence_id: null, entity_id: o.entity_id, sf_account_id: o.sf_account_id, attempts: 0 }, deps);
    } catch (e) {
      out = { outcome: 'unavailable', contacts_created: 0, error: String(e && e.message || e) };
    }
    if (out.outcome === 'acquired') {
      result.worklist_acquired++;
      result.worklist_contacts_created += out.contacts_created;
      if (seedInfo && seedInfo.seeded) result.worklist_cadences_seeded++;
      setAcquired();
    } else if (out.outcome === 'no_contacts') {
      result.worklist_no_contacts++;
    }
    result.items.push({ pass: 'worklist_sf', entity_id: o.entity_id, entity_name: o.entity_name,
      sf_account_id: o.sf_account_id, outcome: out.outcome, contacts_created: out.contacts_created || 0,
      cadence_seeded: !!(seedInfo && seedInfo.seeded) });
  }
}
