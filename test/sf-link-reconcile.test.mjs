// CONNECTIVITY #3 — planSfLinkReconcile (the pure per-owner decision core).
// Covers: clean attach, already-linked (15↔18 match), conflict (different SF
// link on the entity), collision (id on another entity), dup-sfid (one id on
// two owner entities), and unbridged skip. No IO — maps are injected.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planSfLinkReconcile, planSfWriteback } from '../api/_handlers/sf-link-reconcile.js';
import { toSf18 } from '../api/_shared/sf-id.js';

// Two real-shaped 15-char Account ids and their canonical 18-char forms.
const SF_A_15 = '0011I00000h7mHE';
const SF_A_18 = toSf18(SF_A_15);          // 0011I00000h7mHEQAY
const SF_B_15 = '0011I00000h7yOi';
const SF_B_18 = toSf18(SF_B_15);          // 0011I00000h7yOiQAI

function facts(list) { const m = new Map(); for (const f of list) m.set(f.id, f); return m; }

describe('planSfLinkReconcile', () => {
  it('clean attach: bridged owner, no SF link, id not on any other entity', () => {
    const plan = planSfLinkReconcile({
      domain: 'dia',
      owners: [{ true_owner_id: 't1', name: 'Acme', sf15: SF_A_15, sf18: SF_A_18, entity_id: 'e1' }],
      entityFacts: facts([{ id: 'e1', name: 'Acme', workspace_id: 'w1' }]),
      sfByEntity: new Map(),
      sf18Holders: new Map(),
    });
    assert.equal(plan.attaches.length, 1);
    assert.equal(plan.attaches[0].owner_entity_id, 'e1');
    assert.equal(plan.attaches[0].sf18, SF_A_18);
    assert.equal(plan.conflicts.length + plan.collisions.length + plan.dups.length, 0);
  });

  it('already-linked: entity carries the SAME account (15↔18) → no attach', () => {
    const plan = planSfLinkReconcile({
      domain: 'gov',
      owners: [{ true_owner_id: 't1', name: 'Acme', sf15: SF_A_15, sf18: SF_A_18, entity_id: 'e1' }],
      entityFacts: facts([{ id: 'e1', name: 'Acme', workspace_id: 'w1' }]),
      sfByEntity: new Map([['e1', SF_A_18]]),   // already the 18-char form
      sf18Holders: new Map([[SF_A_18, new Set(['e1'])]]),
    });
    assert.equal(plan.attaches.length, 0);
    assert.equal(plan.alreadyLinked, 1);
  });

  it('conflict: entity already linked to a DIFFERENT account', () => {
    const plan = planSfLinkReconcile({
      domain: 'dia',
      owners: [{ true_owner_id: 't1', name: 'Acme', sf15: SF_A_15, sf18: SF_A_18, entity_id: 'e1' }],
      entityFacts: facts([{ id: 'e1', name: 'Acme', workspace_id: 'w1' }]),
      sfByEntity: new Map([['e1', SF_B_18]]),   // a DIFFERENT account
      sf18Holders: new Map([[SF_B_18, new Set(['e1'])]]),
    });
    assert.equal(plan.attaches.length, 0);
    assert.equal(plan.conflicts.length, 1);
    assert.equal(plan.conflicts[0].lcc_sf_id, SF_B_18);
    assert.equal(plan.conflicts[0].domain_sf_id, SF_A_18);
  });

  it('collision: id already lives on a DIFFERENT entity → surface, never attach', () => {
    const plan = planSfLinkReconcile({
      domain: 'gov',
      owners: [{ true_owner_id: 't1', name: 'Acme', sf15: SF_A_15, sf18: SF_A_18, entity_id: 'e1' }],
      entityFacts: facts([{ id: 'e1', name: 'Acme', workspace_id: 'w1' }, { id: 'e2', name: 'Acme Holdings', workspace_id: 'w1' }]),
      sfByEntity: new Map(),                      // e1 has no SF link
      sf18Holders: new Map([[SF_A_18, new Set(['e2'])]]),  // but e2 holds the id
    });
    assert.equal(plan.attaches.length, 0);
    assert.equal(plan.collisions.length, 1);
    assert.equal(plan.collisions[0].owner_entity_id, 'e1');
    assert.equal(plan.collisions[0].other_entity_id, 'e2');
  });

  it('dup-sfid: one SF id on two owner entities → dup group, no attach', () => {
    const plan = planSfLinkReconcile({
      domain: 'dia',
      owners: [
        { true_owner_id: 't1', name: 'Acme', sf15: SF_A_15, sf18: SF_A_18, entity_id: 'e1' },
        { true_owner_id: 't2', name: 'Acme LLC', sf15: SF_A_15, sf18: SF_A_18, entity_id: 'e2' },
      ],
      entityFacts: facts([{ id: 'e1', name: 'Acme', workspace_id: 'w1' }, { id: 'e2', name: 'Acme LLC', workspace_id: 'w1' }]),
      sfByEntity: new Map(),
      sf18Holders: new Map(),
    });
    assert.equal(plan.attaches.length, 0);
    assert.equal(plan.dups.length, 1);
    assert.equal(plan.dups[0].entities.length, 2);
  });

  it('two owners → SAME entity is NOT a dup (one entity), attaches once', () => {
    const plan = planSfLinkReconcile({
      domain: 'dia',
      owners: [
        { true_owner_id: 't1', name: 'Acme', sf15: SF_A_15, sf18: SF_A_18, entity_id: 'e1' },
        { true_owner_id: 't2', name: 'Acme', sf15: SF_A_15, sf18: SF_A_18, entity_id: 'e1' },
      ],
      entityFacts: facts([{ id: 'e1', name: 'Acme', workspace_id: 'w1' }]),
      sfByEntity: new Map(),
      sf18Holders: new Map(),
    });
    assert.equal(plan.dups.length, 0);
    assert.equal(plan.attaches.length, 1);
  });

  it('unbridged owner (no entity) is counted, never attached', () => {
    const plan = planSfLinkReconcile({
      domain: 'gov',
      owners: [{ true_owner_id: 't1', name: 'Ghost', sf15: SF_A_15, sf18: SF_A_18, entity_id: null }],
      entityFacts: new Map(),
      sfByEntity: new Map(),
      sf18Holders: new Map(),
    });
    assert.equal(plan.attaches.length, 0);
    assert.equal(plan.unbridged, 1);
  });
});

// C1d — Unit 4, the LCC->dia writeback direction.
describe('planSfWriteback', () => {
  it('fills a candidate with exactly one resolved Account, no tombstone, not an operator', () => {
    const plan = planSfWriteback({
      candidates: [{ true_owner_id: 't1', entity_id: 'e1', sf18: SF_A_18, tombstoned: false,
        isOperator: false, existingDomainSfId: null, sfAccountCount: 1 }],
    });
    assert.equal(plan.fills.length, 1);
    assert.equal(plan.fills[0].sf18, SF_A_18);
    assert.deepEqual(plan.skipped, { no_entity: 0, tombstoned: 0, operator: 0, already_set: 0, ambiguous_or_none: 0 });
  });

  it('skips no_entity when the true_owner never bridged to an entity', () => {
    const plan = planSfWriteback({
      candidates: [{ true_owner_id: 't1', entity_id: null, sf18: null, tombstoned: true,
        isOperator: false, existingDomainSfId: null, sfAccountCount: 0 }],
    });
    assert.equal(plan.fills.length, 0);
    assert.equal(plan.skipped.no_entity, 1);
  });

  it('skips a P113 operator, never fills even with one clean Account', () => {
    const plan = planSfWriteback({
      candidates: [{ true_owner_id: 't1', entity_id: 'e1', sf18: SF_A_18, tombstoned: false,
        isOperator: true, existingDomainSfId: null, sfAccountCount: 1 }],
    });
    assert.equal(plan.fills.length, 0);
    assert.equal(plan.skipped.operator, 1);
  });

  it('skips already_set — fill-blanks only, never overwrite', () => {
    const plan = planSfWriteback({
      candidates: [{ true_owner_id: 't1', entity_id: 'e1', sf18: SF_A_18, tombstoned: false,
        isOperator: false, existingDomainSfId: SF_B_18, sfAccountCount: 1 }],
    });
    assert.equal(plan.fills.length, 0);
    assert.equal(plan.skipped.already_set, 1);
  });

  it('skips ambiguous_or_none when the entity holds zero or more than one Account', () => {
    const zero = planSfWriteback({
      candidates: [{ true_owner_id: 't1', entity_id: 'e1', sf18: null, tombstoned: false,
        isOperator: false, existingDomainSfId: null, sfAccountCount: 0 }],
    });
    assert.equal(zero.fills.length, 0);
    assert.equal(zero.skipped.ambiguous_or_none, 1);

    const multi = planSfWriteback({
      candidates: [{ true_owner_id: 't1', entity_id: 'e1', sf18: SF_A_18, tombstoned: false,
        isOperator: false, existingDomainSfId: null, sfAccountCount: 2 }],
    });
    assert.equal(multi.fills.length, 0);
    assert.equal(multi.skipped.ambiguous_or_none, 1);
  });

  it('never guesses: an ambiguous candidate is never silently promoted to a fill', () => {
    const plan = planSfWriteback({
      candidates: [
        { true_owner_id: 't1', entity_id: 'e1', sf18: SF_A_18, tombstoned: false, isOperator: false, existingDomainSfId: null, sfAccountCount: 1 },
        { true_owner_id: 't2', entity_id: 'e2', sf18: SF_B_18, tombstoned: false, isOperator: false, existingDomainSfId: null, sfAccountCount: 3 },
      ],
    });
    assert.equal(plan.fills.length, 1);
    assert.equal(plan.fills[0].true_owner_id, 't1');
    assert.equal(plan.skipped.ambiguous_or_none, 1);
  });
});
