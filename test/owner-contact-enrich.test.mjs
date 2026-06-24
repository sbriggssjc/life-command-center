// CONTACT-SELECTION Slice 3 — owner-contact enrichment worker tests.
//
// Covers the deps-injected per-owner core (processOwnerEnrichmentRow): the
// attach-named-person path, the manager-entity drill-through, the
// already-linked short-circuit, a guard rejection, and the flagged external
// adapters (unconfigured no-op vs. a configured resolve → attach).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { processOwnerEnrichmentRow, classifyEnrichRow } from '../api/_handlers/owner-contact-enrich.js';

function recordingDeps(overrides = {}) {
  const calls = { ensure: [], link: [], stamp: [], patch: [] };
  const deps = {
    // use the REAL looksLikePersonName (entity-link.js) — the worker's default —
    // so the person-vs-firm split matches production.
    ensureEntityLink: async (a) => { calls.ensure.push(a); return { ok: true, entityId: (a.sourceType === 'organization' ? 'org-' : 'person-') + a.seedFields.name }; },
    linkPersonToEntity: async (a) => { calls.link.push(a); return { ok: true }; },
    stampContactOnActiveCadence: async (a) => { calls.stamp.push(a); return { ok: true }; },
    opsQuery: async (m, p, b) => { calls.patch.push([m, p, b]); return { ok: true, data: [] }; },
    ...overrides,
  };
  return { deps, calls };
}

const ownerBase = { entity_id: 'own-1', owner_name: 'Acme Holdings LLC', workspace_id: 'ws-1' };

describe('processOwnerEnrichmentRow', () => {
  it('attaches a named person (authority 2) and points the pivot at it', async () => {
    const { deps, calls } = recordingDeps();
    const out = await processOwnerEnrichmentRow(
      { ...ownerBase, active_contact_name: 'Charles Lomangino', active_authority_level: 2, active_contact_role: 'manager', active_contact_entity_id: null }, deps);
    assert.equal(out.outcome, 'attached');
    assert.equal(out.contact_entity_id, 'person-Charles Lomangino');
    assert.equal(calls.ensure[0].sourceType, 'person');
    assert.equal(calls.link[0].entityId, 'own-1');
    assert.equal(calls.stamp[0].onlyContactless, true);          // never clobber an existing contact
    assert.ok(calls.patch.some(([, p]) => p.includes('owner_contact_pivot')));
  });

  it('already-linked owner short-circuits (no writes)', async () => {
    const { deps, calls } = recordingDeps();
    const out = await processOwnerEnrichmentRow({ ...ownerBase, active_contact_entity_id: 'person-x', active_contact_name: 'Jane Doe' }, deps);
    assert.equal(out.outcome, 'already_linked');
    assert.equal(calls.ensure.length, 0);
  });

  it('drills through a FIRM manager (not a person) to a managed_by org edge', async () => {
    const { deps, calls } = recordingDeps();
    const out = await processOwnerEnrichmentRow(
      { ...ownerBase, active_contact_name: 'Boyd Watterson Asset Management LLC', active_authority_level: 2, active_contact_entity_id: null }, deps);
    assert.equal(out.outcome, 'manager_drillthrough');
    assert.equal(calls.ensure[0].sourceType, 'organization');
    assert.equal(calls.link[0].role, 'manager');
    assert.ok(calls.patch.some(([, , b]) => b && b.enrichment_action === 'find_person_at_manager'));
  });

  it('guard rejection (ensureEntityLink skips) → guard_rejected, no link', async () => {
    const { deps, calls } = recordingDeps({ ensureEntityLink: async () => ({ ok: false, skipped: 'junk_entity_name' }) });
    const out = await processOwnerEnrichmentRow(
      { ...ownerBase, active_contact_name: 'View Less', active_authority_level: 2, active_contact_entity_id: null }, deps);
    assert.equal(out.outcome, 'guard_rejected');
    assert.equal(calls.link.length, 0);
  });

  it('contactless + everything unconfigured → falls through to manual_research (no writes)', async () => {
    // Slice-4 amendment: an unresolved owner is no longer a dead-end — it flows
    // through the chain to the manual-research terminal. With no manualResearch
    // dep injected, the terminal is the bare 'manual_research' outcome.
    const { deps, calls } = recordingDeps({ sosLookup: async () => ({ ok: false, reason: 'unconfigured' }) });
    const out = await processOwnerEnrichmentRow(
      { ...ownerBase, active_contact_name: null, enrichment_action: 'sos_manager_lookup', active_contact_entity_id: null }, deps);
    assert.equal(out.outcome, 'manual_research');
    assert.equal(calls.ensure.length, 0);
  });

  it('cross-ref runs FIRST and short-circuits the external adapters', async () => {
    let sosCalled = false;
    const { deps } = recordingDeps({
      crossRef: async () => ({ ok: true, person_name: 'Pat Sibling', role: 'principal' }),
      sosLookup: async () => { sosCalled = true; return { ok: false, reason: 'unconfigured' }; },
    });
    const out = await processOwnerEnrichmentRow(
      { ...ownerBase, active_contact_name: null, enrichment_action: 'sos_manager_lookup', active_contact_entity_id: null }, deps);
    assert.equal(out.outcome, 'attached');
    assert.equal(out.source, 'cross_reference');
    assert.equal(out.contact_entity_id, 'person-Pat Sibling');
    assert.equal(sosCalled, false); // cross-ref wins before any external call
  });

  it('web search resolves after the routed adapter misses → attach (source web)', async () => {
    const { deps } = recordingDeps({
      sosLookup: async () => ({ ok: false, reason: 'no_result' }),
      webSearch: async () => ({ ok: true, person_name: 'Dana Webfound', role: 'manager', confidence: 'high' }),
    });
    const out = await processOwnerEnrichmentRow(
      { ...ownerBase, active_contact_name: null, enrichment_action: 'sos_manager_lookup', active_contact_entity_id: null }, deps);
    assert.equal(out.outcome, 'attached');
    assert.equal(out.source, 'web');
  });

  it('all methods miss → manual_research_queued with breadcrumbs', async () => {
    let queued = null;
    const manualResearch = {
      check: async () => ({ open: false }),
      queue: async (_row, ctx) => { queued = ctx; return { ok: true, existed: false }; },
    };
    const { deps } = recordingDeps({ sosLookup: async () => ({ ok: false, reason: 'unconfigured' }), manualResearch });
    const out = await processOwnerEnrichmentRow(
      { ...ownerBase, active_contact_name: null, enrichment_action: 'sos_manager_lookup', active_contact_entity_id: null }, deps);
    assert.equal(out.outcome, 'manual_research_queued');
    assert.equal(out.queued, true);
    // breadcrumbs carry WHY each method failed
    assert.ok(queued.tried.some((t) => t.method === 'cross_reference'));
    assert.ok(queued.tried.some((t) => t.method === 'sos'));
    assert.ok(queued.tried.some((t) => t.method === 'web_search'));
  });

  it('manual row already open → manual_research_pending (no re-hammer of externals)', async () => {
    let sosCalled = false;
    const manualResearch = { check: async () => ({ open: true }), queue: async () => ({ ok: true }) };
    const { deps } = recordingDeps({ sosLookup: async () => { sosCalled = true; return { ok: false }; }, manualResearch });
    const out = await processOwnerEnrichmentRow(
      { ...ownerBase, active_contact_name: null, enrichment_action: 'sos_manager_lookup', active_contact_entity_id: null }, deps);
    assert.equal(out.outcome, 'manual_research_pending');
    assert.equal(sosCalled, false); // backoff skipped the external attempt
  });

  it('contactless + sos resolves a person → attach', async () => {
    const { deps } = recordingDeps({ sosLookup: async () => ({ ok: true, person_name: 'Pat Principal', role: 'managing_member' }) });
    const out = await processOwnerEnrichmentRow(
      { ...ownerBase, active_contact_name: null, enrichment_action: 'sos_manager_lookup', active_contact_entity_id: null }, deps);
    assert.equal(out.outcome, 'attached');
    assert.equal(out.source, 'sos');
    assert.equal(out.contact_entity_id, 'person-Pat Principal');
  });

  it('contactless + deed signatory resolves a person → attach (source deed)', async () => {
    const { deps } = recordingDeps({ deedParse: async () => ({ ok: true, person_name: 'Robert Hughes', role: 'manager', authority: 1 }) });
    const out = await processOwnerEnrichmentRow(
      { ...ownerBase, active_contact_name: null, enrichment_action: 'parse_deed_signatory', active_contact_entity_id: null }, deps);
    assert.equal(out.outcome, 'attached');
    assert.equal(out.source, 'deed');
    assert.equal(out.contact_entity_id, 'person-Robert Hughes');
  });

  it('public_company_ir routes to manual IR (no scraper)', async () => {
    const { deps } = recordingDeps();
    const out = await processOwnerEnrichmentRow(
      { ...ownerBase, active_contact_name: null, enrichment_action: 'public_company_ir', active_contact_entity_id: null }, deps);
    assert.equal(out.outcome, 'public_ir_manual');
  });
});

// Phase 5b — the shared classifier used by the batch dry-run AND the single-owner
// preview (they must never drift).
describe('classifyEnrichRow', () => {
  it('already-linked short-circuits', () => {
    assert.equal(classifyEnrichRow({ active_contact_entity_id: 'x' }), 'already_linked');
  });
  it('a named person → attach_person', () => {
    assert.equal(classifyEnrichRow({ active_contact_name: 'Jane Smith', active_authority_level: 3 }), 'attach_person');
  });
  it('a controlling firm (authority<=2, not a person name) → manager_drillthrough', () => {
    assert.equal(classifyEnrichRow({ active_contact_name: 'Acme Management LLC', active_authority_level: 2 }), 'manager_drillthrough');
  });
  it('contactless with a SOS hint → the enrichment_action', () => {
    assert.equal(classifyEnrichRow({ enrichment_action: 'sos_manager_lookup' }), 'sos_manager_lookup');
  });
  it('contactless with no signals → manual_research', () => {
    assert.equal(classifyEnrichRow({}), 'manual_research');
  });
});
