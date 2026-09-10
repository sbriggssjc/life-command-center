import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planParentInheritance,
  summarizeParentInheritancePlan,
} from '../api/_shared/entity-parent-inheritance-planner.js';

function parentMap(rows) {
  const m = new Map();
  for (const r of rows) m.set(r.parent_entity_id, r);
  return m;
}

test('a subsidiary inherits when the parent has exactly one confirmed contact', () => {
  const proposals = [{ entity_id: 'sub-1', parent_entity_id: 'ngp' }];
  const parents = parentMap([
    { parent_entity_id: 'ngp', active_contact_entity_id: 'person-1', eligible_candidate_count: 1 },
  ]);
  const [d] = planParentInheritance(proposals, parents);
  assert.equal(d.action, 'inherit');
  assert.equal(d.contact_entity_id, 'person-1');
});

test('UIRC-shaped case: parent has multiple candidates and no confirmed contact -> needs_human, never guessed', () => {
  const proposals = [{ entity_id: 'sub-uirc-1', parent_entity_id: 'uirc' }];
  const parents = parentMap([
    { parent_entity_id: 'uirc', active_contact_entity_id: null, eligible_candidate_count: 7 },
  ]);
  const [d] = planParentInheritance(proposals, parents);
  assert.equal(d.action, 'needs_human');
  assert.equal(d.contact_entity_id, null);
  assert.equal(d.reason, 'parent_has_multiple_unresolved_candidates');
});

test('a parent with candidates but ALSO an already-confirmed contact still inherits (human already decided)', () => {
  const proposals = [{ entity_id: 'sub-uirc-2', parent_entity_id: 'uirc' }];
  const parents = parentMap([
    { parent_entity_id: 'uirc', active_contact_entity_id: 'person-9', eligible_candidate_count: 7 },
  ]);
  const [d] = planParentInheritance(proposals, parents);
  assert.equal(d.action, 'inherit');
  assert.equal(d.contact_entity_id, 'person-9');
});

test('a parent with no candidates and no contact reports no_parent_contact, not a false inherit', () => {
  const proposals = [{ entity_id: 'sub-2', parent_entity_id: 'newco' }];
  const parents = parentMap([
    { parent_entity_id: 'newco', active_contact_entity_id: null, eligible_candidate_count: 0 },
  ]);
  const [d] = planParentInheritance(proposals, parents);
  assert.equal(d.action, 'no_parent_contact');
  assert.equal(d.contact_entity_id, null);
});

test('unknown parent state is needs_human, never a silent skip', () => {
  const proposals = [{ entity_id: 'sub-3', parent_entity_id: 'ghost' }];
  const [d] = planParentInheritance(proposals, new Map());
  assert.equal(d.action, 'needs_human');
  assert.equal(d.reason, 'parent_state_unknown');
});

test('a subsidiary proposed against two different parents is flagged, never picks one silently', () => {
  const proposals = [
    { entity_id: 'sub-conflict', parent_entity_id: 'a' },
    { entity_id: 'sub-conflict', parent_entity_id: 'b' },
  ];
  const parents = parentMap([
    { parent_entity_id: 'a', active_contact_entity_id: 'p1', eligible_candidate_count: 1 },
    { parent_entity_id: 'b', active_contact_entity_id: 'p2', eligible_candidate_count: 1 },
  ]);
  const decisions = planParentInheritance(proposals, parents);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].action, 'needs_human');
  assert.equal(decisions[0].reason, 'subsidiary_proposed_against_multiple_parents');
});

test('rows missing entity_id or parent_entity_id are dropped, never processed', () => {
  const decisions = planParentInheritance(
    [{ entity_id: '' }, { parent_entity_id: 'x' }, {}],
    new Map()
  );
  assert.equal(decisions.length, 0);
});

test('summarizeParentInheritancePlan counts honestly and sums to the total', () => {
  const decisions = planParentInheritance(
    [
      { entity_id: 's1', parent_entity_id: 'p1' },
      { entity_id: 's2', parent_entity_id: 'p2' },
      { entity_id: 's3', parent_entity_id: 'p3' },
    ],
    parentMap([
      { parent_entity_id: 'p1', active_contact_entity_id: 'c1', eligible_candidate_count: 1 },
      { parent_entity_id: 'p2', active_contact_entity_id: null, eligible_candidate_count: 3 },
      { parent_entity_id: 'p3', active_contact_entity_id: null, eligible_candidate_count: 0 },
    ])
  );
  const s = summarizeParentInheritancePlan(decisions);
  assert.equal(s.total, 3);
  assert.equal(s.inherit, 1);
  assert.equal(s.needs_human, 1);
  assert.equal(s.no_parent_contact, 1);
  assert.equal(s.inherit + s.needs_human + s.no_parent_contact, s.total);
});
