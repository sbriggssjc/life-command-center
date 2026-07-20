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
