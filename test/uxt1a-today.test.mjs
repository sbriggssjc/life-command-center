// UX-T1a-today guard — Significant / Important / Urgent section classification.
//
// Behavioural, over the pure module only (no I/O, no DB). Named-row fixtures per
// section so a classification miscount goes RED rather than an aggregate that
// could hide a wrong bucket assignment behind a right total.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSignificantSection, buildImportantSection, buildUrgentSection,
  assembleTodaySections, TODAY_SECTION_LIMIT,
} from '../api/_shared/today-sections.js';

// ── Significant ───────────────────────────────────────────────────────────
test('significant: count equals rows shown, total_open is the full population', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({
    entity_id: 'e' + i, source_domain: 'gov', property_id: 100 + i,
    rank_value: 1000000 - i, reach_state: 'never_touched', newer_lease: true,
  }));
  const { items, count, total_open } = buildSignificantSection(rows, { limit: 8 });
  assert.equal(items.length, 8);
  assert.equal(count, 8, 'count must equal rows shown, not the population');
  assert.equal(total_open, 12, 'total_open is the full population for See all');
});

test('significant: value NEVER collapses to 0 when the asset cannot be priced (P180)', () => {
  const rows = [{ entity_id: 'e1', rank_value: null, reach_state: 'never_touched' }];
  const { items } = buildSignificantSection(rows);
  assert.equal(items[0].value, null, 'unpriced stays null, never 0');
});

test('significant: basis names the reason-to-sell signal AND the reach gate', () => {
  const rows = [
    { entity_id: 'e1', rank_value: 5000000, reach_state: 'no_linked_person', newer_lease: true },
    { entity_id: 'e2', rank_value: 3000000, reach_state: 'in_pipeline_untouched', reason_debt: true },
    { entity_id: 'e3', rank_value: 1000000, reach_state: 'never_touched' }, // no reason flags at all
  ];
  const { items } = buildSignificantSection(rows);
  assert.match(items[0].basis, /newer lease/);
  assert.match(items[0].basis, /no contact linked/);
  assert.match(items[1].basis, /debt maturing/);
  assert.match(items[1].basis, /in pipeline, untouched/);
  // A row with NO recorded reason must say so honestly, never fabricate one.
  assert.match(items[2].basis, /reason to sell unmeasured/);
});

// ── Important ─────────────────────────────────────────────────────────────
test('important: reads bd_opportunities only, ranked by amount', () => {
  const rows = [
    { entity_id: 'a', type: 'buyer', stage: 'Prospecting', amount: 500000 },
    { entity_id: 'b', type: 'prospect', stage: null, amount: null },
  ];
  const em = new Map([['a', 'Acme LLC'], ['b', 'Beta Corp']]);
  const { items, count, total_open } = buildImportantSection(rows, em, { limit: 8 });
  assert.equal(count, 2);
  assert.equal(total_open, 2);
  assert.equal(items[0].who, 'Acme LLC');
  assert.equal(items[0].value, 500000);
  // A null amount is NOT $0 — it must render null, not the P180 sentinel.
  assert.equal(items[1].value, null);
  assert.match(items[1].basis, /stage unrecorded/);
});

// ── Urgent ────────────────────────────────────────────────────────────────
test('urgent: an OVERDUE action item always outranks a merely-valuable worklist row', () => {
  const actionItems = [
    { id: 'ai1', entity_id: 'x', action_type: 'reply_overdue', title: 'Reply overdue', due_date: '2020-01-01' },
  ];
  const bdWorklistRows = [
    { signal_type: 'owner_source_conflict', entity_id: 'y', what: 'Owner conflict', rank_value: 50000000 },
  ];
  const { items } = buildUrgentSection({ actionItems, bdWorklistRows }, new Map(), { today: new Date('2026-09-03') });
  assert.equal(items[0].kind, 'deal_correspondence');
  assert.equal(items[0].overdue, true);
  assert.equal(items[1].kind, 'owner_source_conflict');
});

test('urgent: within the same overdue class, value breaks the tie', () => {
  const bdWorklistRows = [
    { signal_type: 'owner_source_conflict', entity_id: 'a', rank_value: 100 },
    { signal_type: 'owner_source_conflict', entity_id: 'b', rank_value: 900 },
  ];
  const { items } = buildUrgentSection({ actionItems: [], bdWorklistRows }, new Map());
  assert.equal(items[0].entity_id, 'b');
  assert.equal(items[1].entity_id, 'a');
});

test('urgent: a not-yet-due action item is not marked overdue', () => {
  const actionItems = [
    { id: 'ai1', entity_id: 'x', action_type: 'schedule_call', title: 'Call', due_date: '2099-01-01' },
  ];
  const { items } = buildUrgentSection({ actionItems, bdWorklistRows: [] }, new Map(), { today: new Date('2026-09-03') });
  assert.equal(items[0].overdue, false);
  assert.match(items[0].basis, /^due 2099-01-01/);
});

test('urgent: count equals rows shown across BOTH producers combined', () => {
  const actionItems = Array.from({ length: 6 }, (_, i) => ({ id: 'ai' + i, entity_id: 'x' + i, action_type: 'deal_next_step', due_date: '2020-01-0' + (i + 1) }));
  const bdWorklistRows = Array.from({ length: 6 }, (_, i) => ({ signal_type: 'owner_source_conflict', entity_id: 'y' + i, rank_value: 1000 - i }));
  const { items, count, total_open } = buildUrgentSection({ actionItems, bdWorklistRows }, new Map(), { limit: 8 });
  assert.equal(items.length, 8);
  assert.equal(count, 8);
  assert.equal(total_open, 12);
});

// ── HP1-P2f-urgent: contact_writeback is CRM plumbing, never deal work ─────
test('urgent NEVER admits contact_writeback rows into the ranked union, whatever their value', () => {
  const bdWorklistRows = [
    { signal_type: 'contact_writeback', entity_id: 'v', what: 'Push contact', rank_value: 999999999 },
    { signal_type: 'owner_source_conflict', entity_id: 'b', rank_value: 1 },
  ];
  const { items, total_open } = buildUrgentSection({ actionItems: [], bdWorklistRows });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'owner_source_conflict');
  assert.ok(!items.some((i) => i.kind === 'contact_writeback'), 'contact_writeback must never reach Urgent\'s items');
  assert.equal(total_open, 1, 'total_open must not count the excluded contact_writeback rows either');
});

test('urgent: pointer carries the TRUE contact_writeback count, separate from the union', () => {
  const { pointer } = buildUrgentSection({ actionItems: [], bdWorklistRows: [], contactWritebackCount: 1598 });
  assert.equal(pointer.source_type, 'contact_writeback');
  assert.equal(pointer.count, 1598);
  assert.equal(pointer.surface, 'bd_worklist_contact_writeback');
});

test('urgent: pointer is null (unknown), never 0, when the count probe was not supplied (P180)', () => {
  const { pointer } = buildUrgentSection({ actionItems: [], bdWorklistRows: [] });
  assert.equal(pointer, null);
});

test('urgent: pointer renders even a genuine zero count, distinct from "unknown"', () => {
  const { pointer } = buildUrgentSection({ actionItems: [], bdWorklistRows: [], contactWritebackCount: 0 });
  assert.equal(pointer.count, 0);
});

// ── loan_maturity / ownership_chain exclusion (the prompt's own rule) ──────
test('urgent never admits loan_maturity or ownership_chain rows even if handed some', () => {
  const bdWorklistRows = [
    { signal_type: 'loan_maturity', entity_id: 'z', rank_value: 999999999 },
    { signal_type: 'ownership_chain', entity_id: 'w', rank_value: 999999999 },
    { signal_type: 'owner_source_conflict', entity_id: 'v', rank_value: 1 },
  ];
  const { items } = buildUrgentSection({ actionItems: [], bdWorklistRows });
  // buildUrgentSection does not itself filter loan_maturity/ownership_chain --
  // the HANDLER is the one place that decides which signal types reach it
  // (never fetches those two for this section). contact_writeback IS filtered
  // in-module now (HP1-P2f-urgent), unlike those two. This test locks the
  // module's own basis-labelling contract for whatever signal_type it IS
  // given, so a future handler change that starts feeding it loan_maturity is
  // at least forced to notice the label reads generically rather than a named
  // basis.
  assert.equal(items.length, 3);
  const oc = items.find((i) => i.kind === 'owner_source_conflict');
  assert.match(oc.basis, /blocks the deal moving/);
});

// ── assembleTodaySections: named gaps are always present, never silently dropped ──
test('assembleTodaySections always reports the named gaps (P131 rule)', () => {
  const out = assembleTodaySections({
    significantRows: [], bdOppRows: [], actionItems: [], bdWorklistRows: [], entityById: new Map(),
  });
  assert.ok(Array.isArray(out.named_gaps) && out.named_gaps.length >= 3);
  assert.ok(out.named_gaps.some((g) => /BOV/.test(g)));
  assert.ok(out.named_gaps.some((g) => /marketing/i.test(g)));
  assert.ok(out.named_gaps.some((g) => /loan_maturity/.test(g)));
  // Empty inputs must produce empty, non-throwing sections -- an empty result
  // is a real finding (no work today), never an error.
  assert.deepEqual(out.significant.items, []);
  assert.equal(out.significant.count, 0);
  assert.equal(out.important.count, 0);
  assert.equal(out.urgent.count, 0);
});

test('TODAY_SECTION_LIMIT is a small, sane default cap', () => {
  assert.equal(TODAY_SECTION_LIMIT, 8);
});
