// W4.3 follow-up — SF-link candidate review lane. Unit tests for the PURE
// verdict core (planSfLinkVerdict + parsers) plus structural guards that the
// admin.js verdict handler + /api/review-counts lane are wired the way the
// non-negotiables require (no IO — the planner is injected the live SF id).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  planSfLinkVerdict, sfLinkColumn, sfLinkTarget,
  parseConflictExistingId, sfLinkLabelVerdict,
} from '../api/_handlers/sf-link-review.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// A gov true_owners candidate row (the common two-way case).
function govCtx(over = {}) {
  return Object.assign({
    domain: 'gov', queue_id: 7, source_table: 'true_owners', source_id: 'to-1',
    owner_name: 'Cowperwood Holdings LLC', canonical_name: 'cowperwood holdings',
    state: 'IL', property_count: 3,
    sf_account_id_resolved: '0011I00000h7mHE', sf_account_name_resolved: 'Cowperwood Holdings',
    score_resolved: 0.851, conflict_existing_id: null,
  }, over);
}

describe('parseConflictExistingId', () => {
  it('lifts the id out of the w4_3 conflict last_error', () => {
    assert.equal(parseConflictExistingId('w4_3_conflict_existing_sf_company_id_0011I00001IDS36'), '0011I00001IDS36');
  });
  it('returns null for a non-conflict / empty / absent last_error', () => {
    assert.equal(parseConflictExistingId('human_rejected_w4_3'), null);
    assert.equal(parseConflictExistingId(''), null);
    assert.equal(parseConflictExistingId(null), null);
    assert.equal(parseConflictExistingId('w4_3_conflict_existing_sf_company_id_'), null);
  });
});

describe('sfLinkColumn / sfLinkTarget', () => {
  it('gov owners link via sf_account_id; dia via sf_company_id', () => {
    assert.equal(sfLinkColumn('gov'), 'sf_account_id');
    assert.equal(sfLinkColumn('government'), 'sf_account_id');
    assert.equal(sfLinkColumn('dia'), 'sf_company_id');
    assert.equal(sfLinkColumn('dialysis'), 'sf_company_id');
  });
  it('source_table maps to the right table + pk column', () => {
    assert.deepEqual(sfLinkTarget('true_owners'), { table: 'true_owners', idColumn: 'true_owner_id' });
    assert.deepEqual(sfLinkTarget('recorded_owners'), { table: 'recorded_owners', idColumn: 'recorded_owner_id' });
    // default (missing/unknown) falls back to true_owners (every dia row is one).
    assert.deepEqual(sfLinkTarget(undefined), { table: 'true_owners', idColumn: 'true_owner_id' });
  });
});

describe('sfLinkLabelVerdict — reuses the owner_reconcile enum exactly', () => {
  it('only ever emits same_party | distinct | null', () => {
    assert.equal(sfLinkLabelVerdict('approve'), 'same_party');
    assert.equal(sfLinkLabelVerdict('switch'), 'same_party');
    assert.equal(sfLinkLabelVerdict('reject'), 'distinct');
    assert.equal(sfLinkLabelVerdict('keep_existing'), 'distinct');
    assert.equal(sfLinkLabelVerdict('research'), null);
  });
});

describe('planSfLinkVerdict', () => {
  it('link happy path (clean attach): current null → write + provenance + same_party label', () => {
    const p = planSfLinkVerdict({ domain: 'gov', verdict: 'approve', ctx: govCtx(), currentSfId: null });
    assert.equal(p.ok, true);
    assert.equal(p.conflict, false);
    assert.equal(p.writeSource, true);
    assert.equal(p.idempotent, false);
    assert.equal(p.landedSfId, '0011I00000h7mHE');
    assert.equal(p.sfColumn, 'sf_account_id');
    assert.equal(p.sourceTable, 'true_owners');
    assert.equal(p.queueStatus, 'linked');
    assert.equal(p.queueLastError, null);
    assert.equal(p.provenance, true);
    assert.equal(p.makeLabel, true);
    assert.equal(p.labelVerdict, 'same_party');
    assert.equal(p.rawVerdict, 'approve');
  });

  it('link idempotent no-op: current already equals candidate (15↔18) → success, no source write', () => {
    // 18-char form of the candidate 15-char id.
    const p = planSfLinkVerdict({ domain: 'gov', verdict: 'approve', ctx: govCtx(),
      currentSfId: '0011I00000h7mHEQAY' });
    assert.equal(p.ok, true);
    assert.equal(p.conflict, false);
    assert.equal(p.idempotent, true);
    assert.equal(p.writeSource, false);     // no clobber — idempotent
    assert.equal(p.provenance, false);
    assert.equal(p.queueStatus, 'linked');
    assert.equal(p.makeLabel, true);         // still labels the confirmed pair
    assert.equal(p.labelVerdict, 'same_party');
  });

  it('null-guard conflict: current holds a DIFFERENT id → no write, conflict, no label', () => {
    const p = planSfLinkVerdict({ domain: 'dia', verdict: 'approve', ctx: govCtx({ domain: 'dia' }),
      currentSfId: '0011I00001IDS36' });   // a different existing id
    assert.equal(p.conflict, true);
    assert.equal(p.conflictExistingId, '0011I00001IDS36');
    assert.equal(p.writeSource, false);
    assert.equal(p.makeLabel, false);        // NOT recorded — the UI re-renders three-way
    assert.equal(p.queueStatus, null);       // queue left needs_review
  });

  it('reject (not a match): no write, queue → no_match, distinct label', () => {
    const p = planSfLinkVerdict({ domain: 'gov', verdict: 'reject', ctx: govCtx(), currentSfId: null });
    assert.equal(p.ok, true);
    assert.equal(p.writeSource, false);
    assert.equal(p.queueStatus, 'no_match');
    assert.equal(p.queueLastError, 'human_rejected_w4_3');
    assert.equal(p.makeLabel, true);
    assert.equal(p.labelVerdict, 'distinct');
    assert.equal(p.rawVerdict, 'reject');
  });

  it('keep existing (conflict card): NO source write, queue keeps existing id, distinct label', () => {
    const ctx = govCtx({ domain: 'dia', conflict_existing_id: '0011I00001IDS36' });
    const p = planSfLinkVerdict({ domain: 'dia', verdict: 'keep_existing', ctx, currentSfId: '0011I00001IDS36' });
    assert.equal(p.ok, true);
    assert.equal(p.writeSource, false);       // does NOT touch true_owners
    assert.equal(p.queueStatus, 'linked');
    assert.equal(p.queueLastError, 'human_kept_existing_w4_3');
    assert.equal(p.queueResolvedId, '0011I00001IDS36');
    assert.equal(p.queueResolvedName, null);  // clears the candidate name
    assert.equal(p.makeLabel, true);
    assert.equal(p.labelVerdict, 'distinct'); // the CANDIDATE pair is distinct
    assert.equal(p.landedSfId, '0011I00001IDS36');
  });

  it('switch (deliberate three-way override): overwrites, provenance, same_party label', () => {
    const ctx = govCtx({ domain: 'dia', conflict_existing_id: '0011I00001IDS36' });
    const p = planSfLinkVerdict({ domain: 'dia', verdict: 'switch', ctx, currentSfId: '0011I00001IDS36' });
    assert.equal(p.ok, true);
    assert.equal(p.writeSource, true);        // the ONE overwrite path (not the Link button)
    assert.equal(p.landedSfId, '0011I00000h7mHE');
    assert.equal(p.provenance, true);         // old_value audit preserved by the handler
    assert.equal(p.queueStatus, 'linked');
    assert.equal(p.makeLabel, true);
    assert.equal(p.labelVerdict, 'same_party');
    assert.equal(p.rawVerdict, 'switch');
  });

  it('research: leave the queue row needs_review, no write, no label', () => {
    const p = planSfLinkVerdict({ domain: 'gov', verdict: 'research', ctx: govCtx(), currentSfId: null });
    assert.equal(p.verdictKind, 'research');
    assert.equal(p.writeSource, false);
    assert.equal(p.queueStatus, null);
    assert.equal(p.makeLabel, false);
  });

  it('rejects an approve with no candidate id, and an unknown verdict', () => {
    const noCand = planSfLinkVerdict({ domain: 'gov', verdict: 'approve',
      ctx: govCtx({ sf_account_id_resolved: null }), currentSfId: null });
    assert.equal(noCand.ok, false);
    const bogus = planSfLinkVerdict({ domain: 'gov', verdict: 'frobnicate', ctx: govCtx(), currentSfId: null });
    assert.equal(bogus.ok, false);
    const keepNoExisting = planSfLinkVerdict({ domain: 'dia', verdict: 'keep_existing', ctx: govCtx(), currentSfId: null });
    assert.equal(keepNoExisting.ok, false);
  });
});

// ── Structural guards: the handler + review-counts wiring the non-negotiables need ──
describe('admin.js wiring — sf_link_candidate', () => {
  const admin = readFileSync(join(root, 'api/admin.js'), 'utf8');

  it('is a federated decision type with a subject_ref + verdict branch', () => {
    assert.match(admin, /FEDERATED_DECISION_TYPES\s*=\s*new Set\(\[[\s\S]*'sf_link_candidate'[\s\S]*\]\)/);
    assert.match(admin, /case 'sf_link_candidate':\s*return[\s\S]*'sf_link:'/);
    assert.match(admin, /decision\.decision_type === 'sf_link_candidate'/);
  });

  it('review-counts exposes a live sf_link_candidate lane over BOTH domains', () => {
    assert.match(admin, /domCount\('gov', 'v_sf_link_review_queue'\)/);
    assert.match(admin, /domCount\('dia', 'v_sf_link_review_queue'\)/);
    assert.match(admin, /key: 'sf_link_candidate'/);
  });

  it('provenance uses the human source tag + CHECK-legal target_database', () => {
    assert.match(admin, /source: 'sf_link_review_human'/);
    assert.match(admin, /dom === 'gov' \? 'gov_db' : 'dia_db'/);
  });

  it('a failed label write surfaces a 502 error (never silently proceeds)', () => {
    assert.match(admin, /label_write_failed/);
  });

  it('writes the entity_match_labels row with the sf_link_review seeder', () => {
    assert.match(admin, /seeder: 'sf_link_review'/);
  });
});
