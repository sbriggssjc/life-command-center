// Tier 3 Phase 1 — shared review primitives. Unit-tests the pure planners and
// the lane rationalization map (the DOM modal wrappers are not loaded in node —
// the file guards everything behind `typeof document`).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  planMerge,
  planFollowup,
  laneForDecisionType,
  rollupLaneCounts,
  LCC_DECISION_LANE_MAP,
  LCC_REVIEW_LANES,
} from '../review-shared.js';

const UUID_A = '11111111-1111-1111-1111-111111111111';
const UUID_B = '22222222-2222-2222-2222-222222222222';

describe('planMerge — entity', () => {
  it('routes to the single entity merge endpoint with survivor=target, loser=source', () => {
    const p = planMerge({ kind: 'entity', survivor: { id: UUID_A, name: 'Keep Co' }, loser: { id: UUID_B, name: 'Dup Co' } });
    assert.equal(p.ok, true);
    assert.equal(p.method, 'POST');
    assert.equal(p.endpoint, '/api/entities?action=merge');
    assert.deepEqual(p.body, { target_id: UUID_A, source_id: UUID_B });
    assert.match(p.confirmText, /Dup Co/);
    assert.match(p.confirmText, /Keep Co/);
  });

  it('rejects non-UUID entity ids', () => {
    const p = planMerge({ kind: 'entity', survivor: { id: '123' }, loser: { id: '456' } });
    assert.equal(p.ok, false);
    assert.match(p.error, /UUID/);
  });

  it('rejects merging a record into itself', () => {
    const p = planMerge({ kind: 'entity', survivor: { id: UUID_A }, loser: { id: UUID_A } });
    assert.equal(p.ok, false);
    assert.match(p.error, /itself/);
  });

  it('requires both ids', () => {
    assert.equal(planMerge({ kind: 'entity', survivor: { id: UUID_A } }).ok, false);
  });
});

describe('planMerge — property', () => {
  it('routes dia to consolidate-property with keep/drop ids', () => {
    const p = planMerge({ kind: 'property', domain: 'dia', survivor: { id: 100, name: 'A' }, loser: { id: 200, name: 'B' } });
    assert.equal(p.ok, true);
    assert.equal(p.endpoint, '/api/admin?_route=consolidate-property&domain=dia');
    assert.deepEqual(p.body, { keep_id: 100, drop_id: 200 });
  });

  it('routes gov', () => {
    const p = planMerge({ kind: 'property', domain: 'gov', survivor: { id: '5' }, loser: { id: '6' } });
    assert.equal(p.ok, true);
    assert.equal(p.endpoint, '/api/admin?_route=consolidate-property&domain=gov');
    assert.deepEqual(p.body, { keep_id: 5, drop_id: 6 });
  });

  it('requires a valid domain', () => {
    const p = planMerge({ kind: 'property', survivor: { id: 1 }, loser: { id: 2 } });
    assert.equal(p.ok, false);
    assert.match(p.error, /domain/);
  });

  it('requires numeric property ids', () => {
    const p = planMerge({ kind: 'property', domain: 'dia', survivor: { id: 'abc' }, loser: { id: 'def' } });
    assert.equal(p.ok, false);
    assert.match(p.error, /numeric/);
  });
});

describe('planMerge — contact', () => {
  it('routes to the contacts merge endpoint with keep/merge ids', () => {
    const p = planMerge({ kind: 'contact', survivor: { id: 'c-keep', name: 'Keep' }, loser: { id: 'c-drop', name: 'Drop' } });
    assert.equal(p.ok, true);
    assert.equal(p.endpoint, '/api/contacts?action=merge');
    assert.deepEqual(p.body, { keep_id: 'c-keep', merge_id: 'c-drop' });
  });

  it('passes the queue_id through when provided', () => {
    const p = planMerge({ kind: 'contact', queueId: 'q-9', survivor: { id: 'a' }, loser: { id: 'b' } });
    assert.equal(p.body.queue_id, 'q-9');
  });

  it('omits queue_id when absent', () => {
    const p = planMerge({ kind: 'contact', survivor: { id: 'a' }, loser: { id: 'b' } });
    assert.equal('queue_id' in p.body, false);
  });

  it('rejects merging a contact into itself', () => {
    const p = planMerge({ kind: 'contact', survivor: { id: 'a' }, loser: { id: 'a' } });
    assert.equal(p.ok, false);
  });
});

describe('planMerge — guards', () => {
  it('rejects an unknown kind', () => {
    const p = planMerge({ kind: 'lease', survivor: { id: UUID_A }, loser: { id: UUID_B } });
    assert.equal(p.ok, false);
    assert.match(p.error, /entity.*property.*contact/);
  });
});

describe('planFollowup', () => {
  it('builds a generic /api/actions follow-up', () => {
    const p = planFollowup({ title: 'Review dup group', source: 'data_quality', context: { entity_id: 'x' } });
    assert.equal(p.ok, true);
    assert.equal(p.endpoint, '/api/actions');
    assert.equal(p.body.action_type, 'follow_up');
    assert.equal(p.body.title, 'Review dup group');
    assert.deepEqual(p.body.metadata, { source: 'data_quality', entity_id: 'x' });
  });

  it('passes assignee, due date and notes when provided', () => {
    const p = planFollowup({ title: 'Call owner', assigneeId: 'u1', dueDate: '2026-07-01', notes: 'ASAP' });
    assert.equal(p.body.assigned_to, 'u1');
    assert.equal(p.body.due_date, '2026-07-01');
    assert.equal(p.body.description, 'ASAP');
  });

  it('switches to research-task completion when researchTaskId is set', () => {
    const p = planFollowup({ title: 'Trace owner', researchTaskId: 'rt-9', notes: 'n', assigneeId: 'u2', dueDate: '2026-08-01' });
    assert.equal(p.ok, true);
    assert.equal(p.endpoint, '/api/workflows?action=research_followup');
    assert.equal(p.body.research_task_id, 'rt-9');
    assert.equal(p.body.followup_title, 'Trace owner');
    assert.equal(p.body.followup_description, 'n');
    assert.equal(p.body.assigned_to, 'u2');
    assert.equal(p.body.due_date, '2026-08-01');
  });

  it('requires a non-empty title', () => {
    assert.equal(planFollowup({ title: '   ' }).ok, false);
    assert.equal(planFollowup({}).ok, false);
  });
});

describe('lane rationalization map', () => {
  it('maps every Decision Center lane to one of the logical lanes', () => {
    // The full set of types the Decision Center renders today (+ the SOS key).
    const types = [
      'confirm_true_owner', 'confirm_buyer_parent', 'map_sf_parent_account',
      'merge_duplicate_entities', 'junk_entity_name', 'property_merge',
      'provenance_conflict', 'pending_update', 'intake_disposition',
      'match_disambiguation', 'cms_link_suspect', 'sos_owner_links',
      'implausible_value', 'llc_research_dead', 'availability_checker_botblock',
    ];
    const laneKeys = new Set(LCC_REVIEW_LANES.map((l) => l.lane));
    for (const t of types) {
      const lane = laneForDecisionType(t);
      assert.ok(lane, `no lane for ${t}`);
      assert.ok(laneKeys.has(lane), `lane ${lane} for ${t} not in LCC_REVIEW_LANES`);
    }
  });

  it('collapses 15 decision types into the 8 logical lanes', () => {
    assert.equal(LCC_REVIEW_LANES.length, 8);
    assert.equal(Object.keys(LCC_DECISION_LANE_MAP).length, 15);
  });

  it('flags the merge-capable lanes with their kind', () => {
    assert.equal(LCC_DECISION_LANE_MAP.merge_duplicate_entities.merges, 'entity');
    assert.equal(LCC_DECISION_LANE_MAP.junk_entity_name.merges, 'entity');
    assert.equal(LCC_DECISION_LANE_MAP.property_merge.merges, 'property');
    assert.equal(LCC_DECISION_LANE_MAP.confirm_true_owner.merges, false);
  });

  it('returns null for an unknown type', () => {
    assert.equal(laneForDecisionType('nope'), null);
  });

  it('rollupLaneCounts sums member type counts into the 8 lanes in order', () => {
    const rolled = rollupLaneCounts([
      { decision_type: 'merge_duplicate_entities', n: 3 },
      { decision_type: 'junk_entity_name', n: 5 },
      { decision_type: 'property_merge', n: 2 },
      { decision_type: 'confirm_true_owner', n: 10 },
      { decision_type: 'nope', n: 99 }, // unknown → ignored
    ]);
    assert.equal(rolled.length, 8);
    const entityLane = rolled.find((l) => l.lane === 'entity_merge');
    assert.equal(entityLane.n, 8);
    assert.deepEqual(entityLane.types.sort(), ['junk_entity_name', 'merge_duplicate_entities']);
    assert.equal(rolled.find((l) => l.lane === 'property_merge').n, 2);
    assert.equal(rolled.find((l) => l.lane === 'ownership').n, 10);
    assert.equal(rolled.find((l) => l.lane === 'intake').n, 0);
    // order preserved
    assert.equal(rolled[0].lane, 'ownership');
  });
});
