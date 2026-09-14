// ============================================================================
// SF Task maintenance — the two writes that let LCC own the pursuit list,
// plus the compliance-audit read.
// ----------------------------------------------------------------------------
// Doctrine under test (Scott, 2026-08-17): LCC is the operational source of
// truth for Team Briggs BD; Salesforce carries the MINIMUM compliance artifact
// and nothing more. So these assert two things beyond "does it work":
//   1. each write sends the id plus ONE field — no enrichment leaks across;
//   2. the audit read is a READ (it must not be usable to write SF state back).
// ============================================================================
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const MOD = '../api/_shared/salesforce.js';
const TASK_ID = '00TVs00000AbCdEfGh';   // 18-char, Task key prefix
const OWNER_ID = '005Vs00000AbCdEfGh';

let sent;            // the last body posted to the flow
let reply;           // what the fake flow returns
const origFetch = globalThis.fetch;
const origUrl = process.env.SF_LOOKUP_WEBHOOK_URL;

beforeEach(() => {
  sent = null;
  reply = { ok: true };
  process.env.SF_LOOKUP_WEBHOOK_URL = 'https://example.invalid/flow';
  globalThis.fetch = async (_url, opts) => {
    sent = JSON.parse(opts.body);
    return { ok: true, status: 200, text: async () => JSON.stringify(reply) };
  };
});
afterEach(() => {
  globalThis.fetch = origFetch;
  if (origUrl === undefined) delete process.env.SF_LOOKUP_WEBHOOK_URL;
  else process.env.SF_LOOKUP_WEBHOOK_URL = origUrl;
});

describe('updateSalesforceTaskDue — push the due date, touch nothing else', () => {
  it('sends the id + ActivityDate and NOTHING else', async () => {
    const { updateSalesforceTaskDue } = await import(MOD);
    const r = await updateSalesforceTaskDue({ sfTaskId: TASK_ID, activityDate: '2026-09-30' });
    assert.equal(r.ok, true);
    assert.deepEqual(Object.keys(sent).sort(),
      ['activity_date', 'operation', 'sf_task_id'],
      'the compliance contract is id + ONE field; any extra key is enrichment leaking into SF');
    assert.equal(sent.operation, 'update_task_due');
    assert.equal(sent.activity_date, '2026-09-30');
  });

  it('REFUSES a missing date rather than defaulting to today', async () => {
    // createSalesforceTask defaults to today, which is right when OPENING a task
    // and wrong here: it would silently re-date a live customer pursuit.
    const { updateSalesforceTaskDue } = await import(MOD);
    const r = await updateSalesforceTaskDue({ sfTaskId: TASK_ID });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'bad_activity_date');
    assert.equal(sent, null, 'must not call the flow at all');
  });

  it('rejects a malformed task id before calling out', async () => {
    const { updateSalesforceTaskDue } = await import(MOD);
    const r = await updateSalesforceTaskDue({ sfTaskId: 'nope', activityDate: '2026-09-30' });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'bad_task_id');
    assert.equal(sent, null);
  });

  it('is a no-op when Salesforce is not configured', async () => {
    delete process.env.SF_LOOKUP_WEBHOOK_URL;
    const { updateSalesforceTaskDue } = await import(MOD);
    const r = await updateSalesforceTaskDue({ sfTaskId: TASK_ID, activityDate: '2026-09-30' });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'sf_not_configured');
  });
});

describe('closeSalesforceTask — status only', () => {
  it('sends the id + Status and NOTHING else', async () => {
    const { closeSalesforceTask } = await import(MOD);
    const r = await closeSalesforceTask({ sfTaskId: TASK_ID });
    assert.equal(r.ok, true);
    assert.deepEqual(Object.keys(sent).sort(), ['operation', 'sf_task_id', 'status']);
    assert.equal(sent.operation, 'close_task');
    assert.equal(sent.status, 'Completed', 'default closes the pursuit task');
  });

  it('never sends subject / type / comments — closing must not rewrite the record', async () => {
    const { closeSalesforceTask } = await import(MOD);
    await closeSalesforceTask({ sfTaskId: TASK_ID, status: 'Completed' });
    for (const k of ['subject', 'nm_type', 'comments', 'who_id', 'what_id']) {
      assert.ok(!(k in sent), `close_task must not carry ${k}`);
    }
  });

  it('propagates a flow failure instead of reporting success', async () => {
    reply = { ok: false, reason: 'sf_update_failed' };
    const { closeSalesforceTask } = await import(MOD);
    const r = await closeSalesforceTask({ sfTaskId: TASK_ID });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'sf_update_failed');
  });
});

describe('getOpenTasksForCompliance — an AUDIT read, not a sync', () => {
  it('defaults to the seller-prospect marker and normalises the SJC field', async () => {
    reply = { ok: true, tasks: [{
      Id: TASK_ID, WhoId: '003X', WhatId: '001X', Subject: 'Call',
      Status: 'Open', ActivityDate: '2026-07-15',
      SJC_Type_sjc__c: 'Opportunity', OwnerId: OWNER_ID,
    }] };
    const { getOpenTasksForCompliance } = await import(MOD);
    const r = await getOpenTasksForCompliance({ ownerIds: [OWNER_ID] });
    assert.equal(sent.operation, 'open_tasks_by_owner');
    assert.equal(sent.nm_type, 'Opportunity', 'seller prospect is the default audit scope');
    assert.equal(r.tasks.length, 1);
    // The API name is SJC_Type_sjc__c (a Stan Johnson Company leftover); the
    // label is "NM Type". Callers should never have to know that.
    assert.equal(r.tasks[0].nm_type, 'Opportunity');
    assert.equal(r.tasks[0].activity_date, '2026-07-15');
  });

  it('nmType: null audits every open task regardless of type', async () => {
    const { getOpenTasksForCompliance } = await import(MOD);
    await getOpenTasksForCompliance({ ownerIds: [OWNER_ID], nmType: null });
    assert.equal(sent.nm_type, null);
  });

  it('drops malformed owner ids rather than passing them into SOQL', async () => {
    const { getOpenTasksForCompliance } = await import(MOD);
    await getOpenTasksForCompliance({ ownerIds: [OWNER_ID, "005'; DROP--", ''] });
    assert.deepEqual(sent.owner_ids, [OWNER_ID]);
  });

  it('returns [] rather than throwing when the flow answers with an unknown shape', async () => {
    reply = { ok: true };            // no tasks/records key
    const { getOpenTasksForCompliance } = await import(MOD);
    const r = await getOpenTasksForCompliance({ ownerIds: [OWNER_ID] });
    assert.equal(r.ok, true);
    assert.deepEqual(r.tasks, []);
  });
});
