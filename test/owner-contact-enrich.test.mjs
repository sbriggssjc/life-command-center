// CONTACT-SELECTION Slice 3 — owner-contact enrichment worker tests.
//
// Covers the deps-injected per-owner core (processOwnerEnrichmentRow): the
// attach-named-person path, the manager-entity drill-through, the
// already-linked short-circuit, a guard rejection, and the flagged external
// adapters (unconfigured no-op vs. a configured resolve → attach).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { processOwnerEnrichmentRow, classifyEnrichRow, normalizePersonName, summarizeResolution } from '../api/_handlers/owner-contact-enrich.js';

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

// 2026-06-26 — free-attach drain fix: LAST-FIRST/all-caps name handling +
// silent-churn guard (every processed row advances the pivot so the FIFO drains).
describe('processOwnerEnrichmentRow — name normalization + silent-churn guard', () => {
  it('attaches a "LAST FIRST" all-caps recorder name, minted as "First Last"', async () => {
    const { deps, calls } = recordingDeps();
    const out = await processOwnerEnrichmentRow(
      { ...ownerBase, active_contact_name: 'LOMANGINO CHARLES', active_authority_level: 2, active_contact_role: 'MGR', active_contact_entity_id: null }, deps);
    assert.equal(out.outcome, 'attached');
    assert.equal(calls.ensure[0].sourceType, 'person');               // person, NOT org
    assert.equal(calls.ensure[0].seedFields.name, 'Charles Lomangino'); // reordered + title-cased
    assert.equal(out.contact_entity_id, 'person-Charles Lomangino');
    // the pivot PATCH writes the clean name + advances updated_at
    const pivotPatch = calls.patch.find(([m, p]) => m === 'PATCH' && p.includes('owner_contact_pivot'));
    assert.equal(pivotPatch[2].active_contact_name, 'Charles Lomangino');
    assert.ok(pivotPatch[2].updated_at);
  });

  it('normalizes an all-caps name carrying a middle initial', async () => {
    const { deps, calls } = recordingDeps();
    const out = await processOwnerEnrichmentRow(
      { ...ownerBase, active_contact_name: 'MOTISI MEEGAN T', active_authority_level: 2, active_contact_entity_id: null }, deps);
    assert.equal(out.outcome, 'attached');
    assert.equal(calls.ensure[0].seedFields.name, 'Meegan T Motisi');
  });

  it('a guard-rejected "person" advances the pivot (no re-churn) and is NEVER minted as an org', async () => {
    const { deps, calls } = recordingDeps();
    deps.ensureEntityLink = async (a) => { calls.ensure.push(a); return { ok: false, skipped: 'junk_entity_name' }; };
    const out = await processOwnerEnrichmentRow(
      { ...ownerBase, active_contact_name: 'View Less', active_authority_level: 2, active_contact_entity_id: null }, deps);
    assert.equal(out.outcome, 'guard_rejected');
    // only ONE ensureEntityLink call, and it was a PERSON — never fell into the
    // manager-drill branch to mint the person name as an organization.
    assert.equal(calls.ensure.length, 1);
    assert.equal(calls.ensure[0].sourceType, 'person');
    // the silent-churn guard stamped the pivot: updated_at advanced + disposition.
    const pivotPatch = calls.patch.find(([m, p]) => m === 'PATCH' && p.includes('owner_contact_pivot'));
    assert.ok(pivotPatch, 'pivot must be stamped so the FIFO does not re-serve the stuck row');
    assert.ok(pivotPatch[2].updated_at);
    assert.equal(pivotPatch[2].enrichment_action, 'manual_research');
    assert.equal(out.disposition, undefined);                          // disposition is internal, stripped before return
  });

  it('a non-attaching external terminal still advances the pivot', async () => {
    const { deps, calls } = recordingDeps({ sosLookup: async () => ({ ok: false, reason: 'unconfigured' }) });
    const out = await processOwnerEnrichmentRow(
      { ...ownerBase, active_contact_name: null, enrichment_action: 'sos_manager_lookup', active_contact_entity_id: null }, deps);
    assert.equal(out.outcome, 'manual_research');
    const pivotPatch = calls.patch.find(([m, p]) => m === 'PATCH' && p.includes('owner_contact_pivot'));
    assert.ok(pivotPatch && pivotPatch[2].updated_at, 'external terminal must advance updated_at');
  });
});

describe('normalizePersonName', () => {
  it('reorders all-caps LAST FIRST → First Last', () => {
    assert.equal(normalizePersonName('LOMANGINO CHARLES'), 'Charles Lomangino');
    assert.equal(normalizePersonName('POPACK MOSHE'), 'Moshe Popack');
    assert.equal(normalizePersonName('MOTISI MEEGAN T'), 'Meegan T Motisi');
  });
  it('leaves a mixed-case name in its existing order', () => {
    assert.equal(normalizePersonName('Anil Goel'), 'Anil Goel');
    assert.equal(normalizePersonName('Henry John A IV'), 'Henry John A IV');
  });
  it('is a no-op on non-strings / blanks', () => {
    assert.equal(normalizePersonName(null), null);
    assert.equal(normalizePersonName('   '), '   ');
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

// Phase 2 (2026-07-13) — the acquisition-cost breakdown so Scott can make the
// paid-adapter call with real numbers.
describe('summarizeResolution (Phase 2 acquisition-cost breakdown)', () => {
  it('splits a by_action tally into free / needs-adapter / manual / already-linked', () => {
    const out = summarizeResolution({
      attach_person: 60, manager_drillthrough: 15,           // free (no egress)
      sos_manager_lookup: 20, address_reverse_lookup: 16,    // need an adapter
      find_person_at_manager: 3, public_company_ir: 1,       // need an adapter
      manual_research: 4,                                    // manual
      already_linked: 2,                                     // done
    });
    assert.equal(out.free_resolvable, 75);
    assert.equal(out.needs_adapter, 40);
    assert.equal(out.manual_research, 4);
    assert.equal(out.already_linked, 2);
  });

  it('an unknown action falls into manual_research', () => {
    const out = summarizeResolution({ some_new_action: 3 });
    assert.equal(out.manual_research, 3);
    assert.equal(out.free_resolvable, 0);
    assert.equal(out.needs_adapter, 0);
  });
});
