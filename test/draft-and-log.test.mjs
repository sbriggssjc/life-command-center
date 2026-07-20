// Draft & Log Action Engine (Topic F) — pure-logic tests.
//
// Covers the mode-aware SF completed-activity payload builder + the mode
// inference. These encode the SPEC's linking + privacy rules:
//   Mode A (bd):        minimal subject, status Completed, NO WhatId, nmType blank.
//   Mode B (marketing): WhatId = the SF Deal, normal detail.
// No I/O — the orchestrator (bridgeDraftAndLog) composes these with the existing
// render/draft/advance pieces, which are exercised live against the running app.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSalesforceActivityPayload, resolveDraftLogMode } from '../api/_shared/salesforce.js';

describe('resolveDraftLogMode — infer BD vs marketing', () => {
  it('explicit mode wins (bd / marketing, case-insensitive)', () => {
    assert.equal(resolveDraftLogMode({ mode: 'marketing' }), 'marketing');
    assert.equal(resolveDraftLogMode({ mode: 'BD' }), 'bd');
    // explicit bd even with a deal signal present
    assert.equal(resolveDraftLogMode({ mode: 'bd', sf_deal_id: '006x' }), 'bd');
  });
  it('a Deal/listing signal → marketing', () => {
    assert.equal(resolveDraftLogMode({ sf_deal_id: '006x' }), 'marketing');
    assert.equal(resolveDraftLogMode({ deal_id: '1' }), 'marketing');
    assert.equal(resolveDraftLogMode({ sf_listing_id: 'a0x' }), 'marketing');
    assert.equal(resolveDraftLogMode({ what_id: '001x' }), 'marketing');
  });
  it('no signal → bd (default)', () => {
    assert.equal(resolveDraftLogMode({}), 'bd');
    assert.equal(resolveDraftLogMode({ mode: 'nonsense' }), 'bd');
  });
});

describe('buildSalesforceActivityPayload — Mode A (BD prospecting)', () => {
  it('minimal completed touchpoint: LCC-BD subject, Completed, no WhatId, nmType blank', () => {
    const { mode, task } = buildSalesforceActivityPayload({
      mode: 'bd', whoId: '0038W00002PRo0iQAD', label: 'Boyd Watterson', touchNumber: 3
    });
    assert.equal(mode, 'bd');
    assert.equal(task.subject, 'LCC-BD · Boyd Watterson · Touchpoint 3');
    assert.equal(task.status, 'Completed');
    assert.equal(task.nmType, '');            // never an "Opportunity"
    assert.equal(task.whoId, '0038W00002PRo0iQAD');
    assert.equal(task.whatId, undefined);     // pre-deal — NEVER linked
  });
  it('BD drops WhatId even when one is passed (privacy: pre-deal, no link)', () => {
    const { task } = buildSalesforceActivityPayload({
      mode: 'bd', whoId: '003x', label: 'Acme', whatId: '001DEAL'
    });
    assert.equal(task.whatId, undefined);
  });
  it('no touch number → subject omits the number', () => {
    const { task } = buildSalesforceActivityPayload({ mode: 'bd', label: 'Acme' });
    assert.equal(task.subject, 'LCC-BD · Acme · Touchpoint');
  });
  it('non-positive / NaN touch number is ignored', () => {
    assert.equal(buildSalesforceActivityPayload({ label: 'A', touchNumber: 0 }).task.subject, 'LCC-BD · A · Touchpoint');
    assert.equal(buildSalesforceActivityPayload({ label: 'A', touchNumber: -2 }).task.subject, 'LCC-BD · A · Touchpoint');
    assert.equal(buildSalesforceActivityPayload({ label: 'A', touchNumber: 'x' }).task.subject, 'LCC-BD · A · Touchpoint');
  });
});

describe('buildSalesforceActivityPayload — Mode B (marketing a Deal)', () => {
  it('completed activity linked to the SF Deal (WhatId), normal detail', () => {
    const { mode, task } = buildSalesforceActivityPayload({
      mode: 'marketing', whoId: '003x', whatId: '006DEAL123', label: 'DaVita Chilton', touchNumber: 2
    });
    assert.equal(mode, 'marketing');
    assert.equal(task.subject, 'LCC-Mktg · DaVita Chilton · Marketing 2');
    assert.equal(task.status, 'Completed');
    assert.equal(task.whatId, '006DEAL123');  // linked to the Deal
    assert.equal(task.nmType, '');
  });
  it('marketing with no WhatId → no link (still a valid completed activity)', () => {
    const { task } = buildSalesforceActivityPayload({ mode: 'marketing', whoId: '003x', label: 'Deal' });
    assert.equal(task.whatId, undefined);
    assert.equal(task.subject, 'LCC-Mktg · Deal · Marketing');
  });
});

describe('buildSalesforceActivityPayload — label hygiene + passthrough', () => {
  it('collapses whitespace, defaults to "Account" when empty', () => {
    assert.equal(buildSalesforceActivityPayload({ label: '  Foo   Bar ' }).task.subject, 'LCC-BD · Foo Bar · Touchpoint');
    assert.equal(buildSalesforceActivityPayload({}).task.subject, 'LCC-BD · Account · Touchpoint');
    assert.equal(buildSalesforceActivityPayload({ label: '   ' }).task.subject, 'LCC-BD · Account · Touchpoint');
  });
  it('truncates an over-long label to ≤80 chars', () => {
    const long = 'X'.repeat(200);
    const { task } = buildSalesforceActivityPayload({ label: long });
    // subject = "LCC-BD · " + label(≤80) + " · Touchpoint"
    assert.ok(task.subject.includes('X'.repeat(80)));
    assert.ok(!task.subject.includes('X'.repeat(81)));
  });
  it('passes through activityDate + idempotencyKey', () => {
    const { task } = buildSalesforceActivityPayload({
      label: 'A', activityDate: '2026-09-07', idempotencyKey: 'dl:e1:2026-07-20:3'
    });
    assert.equal(task.activityDate, '2026-09-07');
    assert.equal(task.idempotencyKey, 'dl:e1:2026-07-20:3');
  });
});

describe('buildSalesforceActivityPayload — comments (SF-visible Description)', () => {
  it('BD: non-empty, privacy-safe reference line, no strategy/account detail, nm_type blank', () => {
    const { task } = buildSalesforceActivityPayload({
      mode: 'bd', whoId: '0038W00002PRo0iQAD', label: 'Boyd Watterson', touchNumber: 3, ref: 'ent-abc123'
    });
    assert.ok(task.comments && task.comments.length > 0);           // non-empty
    assert.equal(task.comments, 'LCC-BD · Touchpoint 3 · ent-abc123');
    // Privacy: the account NAME (a strategy/intent leak) never rides the comment.
    assert.ok(!task.comments.includes('Boyd Watterson'));
    // No strategy/intent verbs — only the opaque LCC pointer + touch label.
    assert.equal(task.nmType, '');                                  // still blank
  });
  it('marketing: non-empty, LCC-Mktg reference to the LCC deal/listing record', () => {
    const { task } = buildSalesforceActivityPayload({
      mode: 'marketing', whoId: '003x', whatId: '006DEAL123',
      label: 'DaVita Chilton', touchNumber: 2, ref: 'deal-xyz789'
    });
    assert.ok(task.comments && task.comments.length > 0);           // non-empty
    assert.equal(task.comments, 'LCC-Mktg · Marketing Outreach 2 · deal-xyz789');
    assert.equal(task.nmType, '');                                  // still blank
  });
  it('N mirrors the subject counter (omitted when absent); comment non-empty without a ref', () => {
    const bd = buildSalesforceActivityPayload({ label: 'Acme' });   // no touch, no ref
    assert.equal(bd.task.subject, 'LCC-BD · Acme · Touchpoint');
    assert.equal(bd.task.comments, 'LCC-BD · Touchpoint');          // still non-empty
    const mk = buildSalesforceActivityPayload({ mode: 'marketing', label: 'Deal' });
    assert.equal(mk.task.comments, 'LCC-Mktg · Marketing Outreach');
  });
  it('an explicit comments string overrides the default (whitespace collapsed; blank falls back)', () => {
    const over = buildSalesforceActivityPayload({ mode: 'bd', touchNumber: 1, comments: '  custom   note ' });
    assert.equal(over.task.comments, 'custom note');
    const blank = buildSalesforceActivityPayload({ mode: 'bd', touchNumber: 1, ref: 'e1', comments: '   ' });
    assert.equal(blank.task.comments, 'LCC-BD · Touchpoint 1 · e1');  // blank override → default
  });
});

describe('buildSalesforceActivityPayload — sample payloads (eyeball the comments)', () => {
  it('prints a BD and a marketing payload', () => {
    const bd = buildSalesforceActivityPayload({
      mode: 'bd', whoId: '0038W00002PRo0iQAD', label: 'Boyd Watterson', touchNumber: 3, ref: 'ent-abc123'
    });
    const mk = buildSalesforceActivityPayload({
      mode: 'marketing', whoId: '003x', whatId: '006DEAL123',
      label: 'DaVita Chilton', touchNumber: 2, ref: 'deal-xyz789'
    });
    console.log('BD payload:', JSON.stringify(bd, null, 2));
    console.log('Marketing payload:', JSON.stringify(mk, null, 2));
    assert.ok(bd.task.comments && mk.task.comments);
  });
});
