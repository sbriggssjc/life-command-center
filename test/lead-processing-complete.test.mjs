// lead-processing-complete.js — the Deno-side auto-archive emitter for the lead
// channels (news_alert / rcm[CREXi] / loopnet). Proves the pure logic the
// lead-ingest edge handler shares (no drift), mirroring the Node
// api/_shared/processing-complete.js contract.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  targetFolderForLead, buildProcessingRow, LEAD_MOVE_OUTCOMES, LEAD_OUTCOMES,
} from '../supabase/functions/lead-ingest/processing-complete.js';

describe('targetFolderForLead — lead outcome → Outlook folder', () => {
  it('filed → Processed/Leads (never Processed/Deals, whatever the vertical)', () => {
    assert.equal(targetFolderForLead('filed'), 'Processed/Leads');
  });
  it('duplicate → Processed/Duplicates', () => {
    assert.equal(targetFolderForLead('duplicate'), 'Processed/Duplicates');
  });
  it('needs_review → null (left in place)', () => {
    assert.equal(targetFolderForLead('needs_review'), null);
  });
  it('unknown outcome → null', () => {
    assert.equal(targetFolderForLead('whatever'), null);
  });
});

describe('buildProcessingRow — row + event descriptor', () => {
  const base = {
    workspaceId: 'ws-1',
    internetMessageId: '<abc@news>',
    graphRestId: 'AAMk-graph-id',
    channel: 'news_alert',
    domain: 'dialysis',
    sourceRef: 'AAMk-graph-id',
    subject: 'Google Alert - DaVita',
  };

  it('filed lead → Processed/Leads, move_status pending, channel/domain recorded', () => {
    const { row, event } = buildProcessingRow({ ...base, outcome: 'filed' });
    assert.equal(row.outcome, 'filed');
    assert.equal(row.target_folder, 'Processed/Leads');
    assert.equal(row.move_status, 'pending');
    assert.equal(row.channel, 'news_alert');
    assert.equal(row.domain, 'dialysis');          // vertical is metadata only
    assert.equal(row.internet_message_id, '<abc@news>');
    assert.equal(row.graph_rest_id, 'AAMk-graph-id');
    assert.equal(row.source_type, 'lead_email');
    assert.deepEqual(event, {
      internet_message_id: '<abc@news>',
      outcome: 'filed',
      target_folder: 'Processed/Leads',
      move_status: 'pending',
    });
  });

  it('duplicate → Processed/Duplicates, pending', () => {
    const { row } = buildProcessingRow({ ...base, outcome: 'duplicate' });
    assert.equal(row.target_folder, 'Processed/Duplicates');
    assert.equal(row.move_status, 'pending');
  });

  it('needs_review → null folder, skipped (no move)', () => {
    const { row } = buildProcessingRow({ ...base, outcome: 'needs_review' });
    assert.equal(row.target_folder, null);
    assert.equal(row.move_status, 'skipped');
  });

  it('falls back to graphRestId/sourceRef as the message key when no internet id', () => {
    const { row } = buildProcessingRow({
      workspaceId: 'ws-1', outcome: 'filed', graphRestId: 'graph-x',
    });
    assert.equal(row.internet_message_id, 'graph-x');
    const { row: row2 } = buildProcessingRow({
      workspaceId: 'ws-1', outcome: 'filed', sourceRef: 'src-y',
    });
    assert.equal(row2.internet_message_id, 'src-y');
  });

  it('rcm (CREXi) + loopnet channels also file to Processed/Leads', () => {
    for (const channel of ['crexi', 'rcm', 'loopnet']) {
      const { row } = buildProcessingRow({
        workspaceId: 'ws-1', internetMessageId: 'm', outcome: 'filed', channel,
      });
      assert.equal(row.target_folder, 'Processed/Leads', channel);
      assert.equal(row.channel, channel);
    }
  });

  it('defaults channel to "lead" when omitted', () => {
    const { row } = buildProcessingRow({
      workspaceId: 'ws-1', internetMessageId: 'm', outcome: 'filed',
    });
    assert.equal(row.channel, 'lead');
  });

  it('returns null when no workspace or no message key (un-attributable / un-movable)', () => {
    assert.equal(buildProcessingRow({ outcome: 'filed', internetMessageId: 'm' }), null);
    assert.equal(buildProcessingRow({ workspaceId: 'ws-1', outcome: 'filed' }), null);
  });

  it('returns null on an invalid outcome', () => {
    assert.equal(
      buildProcessingRow({ workspaceId: 'ws-1', internetMessageId: 'm', outcome: 'bogus' }),
      null,
    );
  });

  it('truncates a long subject to 500 chars', () => {
    const { row } = buildProcessingRow({
      workspaceId: 'ws-1', internetMessageId: 'm', outcome: 'filed',
      subject: 'x'.repeat(900),
    });
    assert.equal(row.subject.length, 500);
  });
});

describe('outcome sets', () => {
  it('move outcomes require a Power Automate move', () => {
    assert.ok(LEAD_MOVE_OUTCOMES.has('filed'));
    assert.ok(LEAD_MOVE_OUTCOMES.has('duplicate'));
    assert.ok(!LEAD_MOVE_OUTCOMES.has('needs_review'));
  });
  it('valid outcomes', () => {
    assert.deepEqual([...LEAD_OUTCOMES].sort(), ['duplicate', 'filed', 'needs_review']);
  });
});
