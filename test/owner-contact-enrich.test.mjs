// CONTACT-SELECTION Slice 3 — owner-contact enrichment worker tests.
//
// Covers the deps-injected per-owner core (processOwnerEnrichmentRow): the
// attach-named-person path, the manager-entity drill-through, the
// already-linked short-circuit, a guard rejection, and the flagged external
// adapters (unconfigured no-op vs. a configured resolve → attach).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isOwnerNameRestated } from '../api/_shared/entity-link.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
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

// ORE Build 2 (2026-07-23) — reconcile-on-write (enqueue after an attach) +
// the address dimension feeding the address-reverse adapter input.
describe('ORE Build 2 — reconcile-on-write + address-dimension adapter feed', () => {
  it('enqueues the owner for reconcile after a successful attach (best-effort)', async () => {
    const enqueued = [];
    const { deps } = recordingDeps({ enqueueReconcile: async (id, reason) => { enqueued.push([id, reason]); } });
    const out = await processOwnerEnrichmentRow(
      { ...ownerBase, active_contact_name: 'Charles Lomangino', active_authority_level: 2, active_contact_entity_id: null }, deps);
    assert.equal(out.outcome, 'attached');
    assert.deepEqual(enqueued, [['own-1', 'contact_attached']]);
  });

  it('does NOT enqueue when nothing attached (drill-through / research)', async () => {
    const enqueued = [];
    const { deps } = recordingDeps({ enqueueReconcile: async (id, r) => { enqueued.push([id, r]); } });
    const out = await processOwnerEnrichmentRow(
      { ...ownerBase, active_contact_name: 'Boyd Watterson Asset Management LLC', active_authority_level: 2, active_contact_entity_id: null }, deps);
    assert.equal(out.outcome, 'manager_drillthrough');
    assert.equal(enqueued.length, 0);
  });

  it('is byte-identical when no enqueueReconcile dep is injected (never throws)', async () => {
    const { deps } = recordingDeps();   // no enqueueReconcile
    const out = await processOwnerEnrichmentRow(
      { ...ownerBase, active_contact_name: 'Jane Smith', active_authority_level: 3, active_contact_entity_id: null }, deps);
    assert.equal(out.outcome, 'attached');
  });

  it('address-reverse adapter is fed the owner notice address from the dimension', async () => {
    let sawRow = null;
    const { deps } = recordingDeps({
      getOwnerNoticeAddress: async () => '123 Main St, Denver, CO',
      addressLookup: async (row) => { sawRow = row; return { ok: true, person_name: 'John Q Owner', role: 'economic_owner_contact' }; },
    });
    const out = await processOwnerEnrichmentRow(
      { ...ownerBase, active_contact_name: null, active_contact_entity_id: null, enrichment_action: 'address_reverse_lookup' }, deps);
    // the adapter saw the sourced notice address, then a resolve → attach
    assert.equal(sawRow.notice_address, '123 Main St, Denver, CO');
    assert.equal(out.outcome, 'attached');
    assert.equal(out.source, 'address');
  });

  it('address sourcing is skipped when no getOwnerNoticeAddress dep (unconfigured adapter path)', async () => {
    let sawRow = null;
    const { deps } = recordingDeps({
      addressLookup: async (row) => { sawRow = row; return { ok: false, reason: 'unconfigured' }; },
    });
    const out = await processOwnerEnrichmentRow(
      { ...ownerBase, active_contact_name: null, active_contact_entity_id: null, enrichment_action: 'address_reverse_lookup' }, deps);
    assert.equal(sawRow.notice_address, undefined);   // never sourced → adapter no-ops
    assert.notEqual(out.outcome, 'attached');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('P163 — a phantom contact is not a link', () => {
  // The owner's own name minted as a person, no email, no phone. Measured live
  // 2026-08-21: 168 such owners holding $242.7M of annual rent, headed by LCC's
  // single largest owner (Boyd Watterson Asset Management, 198 assets, $179.8M),
  // whose "decision-maker" was a person entity named "Boyd Watterson".
  const linked = { entity_id: 'e1', owner_name: 'Acme Holdings LLC',
    active_contact_name: 'Jane Real', active_contact_entity_id: 'p1' };
  const phantom = { entity_id: 'e2', owner_name: 'Boyd Watterson Asset Management, LLC',
    active_contact_name: 'Boyd Watterson', active_contact_entity_id: 'p2',
    active_contact_is_phantom: true };

  it('a genuine link still short-circuits to already_linked', async () => {
    const out = await processOwnerEnrichmentRow(linked, {});
    assert.equal(out.outcome, 'already_linked');
  });

  it('a PHANTOM link does NOT short-circuit — it goes on to be worked', async () => {
    // It must get past the guard. What it resolves to depends on injected deps;
    // the assertion is only that it is no longer dismissed as already-linked.
    let out;
    try { out = await processOwnerEnrichmentRow(phantom, {}); }
    catch (e) { out = { outcome: 'threw:' + (e && e.message) }; }
    assert.notEqual(out.outcome, 'already_linked',
      'a phantom must not be reported as already linked — that is what hid $242.7M');
  });

  it('classifyEnrichRow mirrors the same rule (dry-run must not disagree)', () => {
    assert.equal(classifyEnrichRow(linked), 'already_linked');
    assert.notEqual(classifyEnrichRow(phantom), 'already_linked');
  });

  it('the flag is FETCHED, not assumed — COLS selects it and the null-filter is gone', async () => {
    // ⚠️ THE INERT-FIX TRAP THIS UNIT NEARLY SHIPPED. The batch path filtered
    // `&active_contact_entity_id=is.null` at query time, so phantoms (which HAVE
    // a contact id) were never fetched at all — the guard above would have been
    // correct and completely unreachable, while measuring as shipped. The view
    // now owns that predicate, so the handler must NOT repeat it, and must select
    // the phantom column or the guard reads undefined.
    const src = readFileSync(join(root, 'api/_handlers/owner-contact-enrich.js'), 'utf8');
    assert.match(src, /active_contact_is_phantom'/, 'COLS must select active_contact_is_phantom');
    assert.doesNotMatch(src, /'&active_contact_entity_id=is\.null'/,
      'the handler must not re-exclude phantoms; v_owner_contact_enrich_queue owns that rule');
    // Both single-owner paths stamp the flag, since the pivot TABLE lacks it.
    assert.match(src, /const stampPhantom = async \(row\) =>/, 'stampPhantom is defined once');
    assert.equal((src.match(/await stampPhantom\(/g) || []).length, 2,
      'stampPhantom must be applied on BOTH single-owner paths (GET preview and POST run) — '
      + 'stamping only one leaves the phantom gate live on one path and dead on the other');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('P163 — a phantom must not be re-attached to itself', () => {
  // ⚠️ THE LOOP THIS ALMOST SHIPPED. Getting a phantom PAST the already_linked
  // guard is only half the job. The phantom's name IS the company's own name and
  // is shaped like a person ("Boyd Watterson"), so looksLikePersonName says yes
  // and the ATTACH branch would re-link the same phantom, PATCH
  // active_contact_entity_id back to the same id, and return `attached` — a
  // fabricated success and a self-healing loop that would make P162+P163 look
  // like they worked while changing nothing.
  const phantom = {
    entity_id: 'e9', owner_name: 'Boyd Watterson Asset Management, LLC',
    active_contact_name: 'Boyd Watterson', active_contact_entity_id: 'p9',
    active_contact_is_phantom: true, active_authority_level: 1,
  };

  it('never routes a phantom to the ATTACH branch', async () => {
    let attachCalled = false;
    const deps = {
      looksLikePersonName: () => true,        // the phantom DOES look like a person
      normalizePersonName: (n) => n,
      ensureEntityLink: async () => { attachCalled = true; return { entity_id: 'p9' }; },
      runExternalEnrichment: async () => ({ outcome: 'external_attempted' }),
    };
    try { await processOwnerEnrichmentRow(phantom, deps); } catch (_e) { /* deps are partial */ }
    assert.equal(attachCalled, false,
      'attachPersonToOwner must never be reached for a phantom — that is the re-attach loop');
  });

  it('never routes a phantom to the MANAGER-DRILL branch either', () => {
    // authority_level 1 satisfies the drill condition, so only the explicit
    // phantom check keeps it out. Drilling would mint the owner's OWN name as a
    // manager org.
    const src = readFileSync(join(root, 'api/_handlers/owner-contact-enrich.js'), 'utf8');
    // Format-tolerant (see the note on the isPerson assertion above): P164
    // inserted `&& !restatesOwner` between these two anchors and broke the
    // original strict-whitespace regex.
    assert.match(src, /!row\.active_contact_is_phantom[\s\S]{0,120}?&& Number\(row\.active_authority_level\)/,
      'the manager-drill branch must exclude phantoms');
    // Format-tolerant on purpose: this assertion originally pinned the exact
    // single-line shape of the isPerson expression and broke the moment P164
    // split it across three lines — the same "assert the relationship, not the
    // address" lesson, here applied to source shape rather than file location.
    assert.match(src, /const isPerson =[\s\S]{0,200}?!row\.active_contact_is_phantom/,
      'the isPerson test must exclude phantoms');
  });
});


// ───────────────────────────────────────────────────────────────────────────
describe('P164 — never mint the owner\'s own name as its decision-maker', () => {
  // The PRODUCER-side fix. P163b stopped existing phantoms re-attaching; the
  // hourly tick was still minting ~5 NEW ones per hour (measured live: pivot
  // updated_at 19:25:13-19:25:30 on 2026-08-21), so clearing the 168 historical
  // phantoms without this would have regrown the population at ~120/day.
  it('blocks a contact whose every token is already in the owner name', () => {
    for (const [person, owner] of [
      ['Boyd Watterson', 'Boyd Watterson Asset Management, LLC'], // LCC's largest owner, $179.8M
      ['Trammell Crow', 'Trammell Crow Co'],
      ['Molasky Group', 'Molasky Group'],
    ]) {
      assert.equal(isOwnerNameRestated(person, owner), true, `${person} @ ${owner} must be blocked`);
    }
  });

  it('⚠️ does NOT block a real principal at a founder-named firm', () => {
    // The destructive false positive. These are REAL contacts on live owners —
    // blocking them would delete exactly the people worth the most. A genuine
    // principal almost always carries a given name the firm does not.
    for (const [person, owner] of [
      ['Sadiki Cole', 'Cole Capital Partners'],
      ['Cole Abdie', 'Velocity Capital'],
      ['Robert Parsekian', 'Parsada Ventures'],
      ['Sam Zell', 'Zell Group'],
      ['John Smith', 'Smith Properties LLC'],
    ]) {
      assert.equal(isOwnerNameRestated(person, owner), false, `${person} @ ${owner} must NOT be blocked`);
    }
  });

  it('requires real material on both sides — a single token is not evidence', () => {
    assert.equal(isOwnerNameRestated('Watterson', 'Boyd Watterson LLC'), false);
    assert.equal(isOwnerNameRestated('Boyd Watterson', 'LLC'), false);
    assert.equal(isOwnerNameRestated('', 'Anything LLC'), false);
    assert.equal(isOwnerNameRestated(null, null), false);
  });

  it('is wired into BOTH name-shaped branches of the worker', () => {
    // Attach would mint the phantom; manager-drill would mint the owner's own
    // name as a manager org. Same defect, two hats.
    const src = readFileSync(join(root, 'api/_handlers/owner-contact-enrich.js'), 'utf8');
    assert.match(src, /const restatesOwner = /, 'the guard is evaluated');
    assert.match(src, /&& !restatesOwner;/, 'the ATTACH branch excludes it');
    assert.match(src, /!row\.active_contact_is_phantom && !restatesOwner/, 'the DRILL branch excludes it');
    assert.match(src, /isOwnerNameRestated/, 'imported from the shared guard module, not re-implemented');
  });
});
