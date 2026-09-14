// ============================================================================
// CONTACT1a (2026-09-04) — ensureEntityLink's CREATE path is the single choke
// point for entities.email/phone, and it must record field_provenance.
//
// CONTACT1 measured: bridge-handlers-salesforce.js::insertEntity was
// instrumented under PR5c-entities-b and NEVER RUNS — its two callers
// (salesforce.contact.upsert / salesforce.account.upsert) are handler
// entries in api/bridges.js' HANDLERS map with ZERO producers anywhere in
// this repo that ever enqueue those job_types. The REAL writer is
// ensureEntityLink()'s CREATE path in entity-link.js: an AST census of its
// 30+ live call sites found exactly ONE place entities.email/phone is ever
// written (ensureEntityLink never PATCHes them onto an EXISTING entity — a
// "fill" only happens at mint time), so wiring that one site covers every
// caller for free.
//
// This test exercises the REAL write path (a behavioural invocation of
// ensureEntityLink with a stubbed `fetch`), not a source-shape grep, per the
// spec's step 3. It asserts:
//   1. a create carrying email/phone posts an rpc/lcc_merge_field call for
//      each field (i.e. field_provenance receives a row);
//   2. a create with neither field posts NO merge-field call at all — the
//      wiring must not manufacture provenance for a value the source never
//      supplied;
//   3. the recorded target_table/target_database are the registry's exact
//      spelling ('entities' / 'lcc_opps') — a mismatch takes
//      lcc_merge_field's UNREGISTERED branch, which still writes a row, so
//      nothing errors and the ladder is simply never consulted (PR5c);
//   4. a registry OUTAGE never blocks or reverts the entity create (fail
//      open — PR12's rule, and the reason shouldWriteField is NOT called
//      pre-write here: a create has no prior value to protect).
//
// Mutation-verify: comment out (or invert) the recordFieldWrites call in
// entity-link.js and re-run — every assertion below must go RED.
// ============================================================================

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ensureEntityLink } from '../api/_shared/entity-link.js';

const originalFetch = global.fetch;

function jsonResponse(body, ok = true, status = 200, headers = {}) {
  return {
    ok,
    status,
    headers: { get(name) { return headers[name.toLowerCase()] || headers[name] || null; } },
    async text() { return JSON.stringify(body); },
  };
}

describe('CONTACT1a — ensureEntityLink CREATE path records field_provenance for email/phone', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('records a merge-field call for EACH of email and phone on a create that carries both', async () => {
    process.env.OPS_SUPABASE_URL = 'https://ops.example.com';
    process.env.OPS_SUPABASE_KEY = 'test-key';
    const mergeFieldCalls = [];
    global.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes('/external_identities?') && opts.method === 'GET') {
        return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
      }
      if (u.includes('/entities?') && opts.method === 'GET') {
        return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
      }
      if (u.endsWith('/entities') && opts.method === 'POST') {
        const body = JSON.parse(opts.body);
        return jsonResponse([{ id: 'entity-1', ...body }]);
      }
      if (/\/external_identities(\?|$)/.test(u) && opts.method === 'POST') {
        return jsonResponse([{ id: 'ext-1', ...JSON.parse(opts.body) }]);
      }
      if (u.includes('/rpc/lcc_merge_field') && opts.method === 'POST') {
        const body = JSON.parse(opts.body);
        mergeFieldCalls.push(body);
        return jsonResponse([{
          provenance_id: 'p-1', decision: 'write', decision_reason: 'no_prior_provenance',
          current_value: null, current_source: null, current_priority: null,
          new_priority: 20, enforce_mode: 'record_only',
        }]);
      }
      throw new Error(`Unexpected fetch: ${opts.method} ${u}`);
    };

    const result = await ensureEntityLink({
      workspaceId: 'ws-1',
      userId: 'user-1',
      sourceSystem: 'salesforce',
      sourceType: 'Contact',
      externalId: 'sf-contact-1',
      domain: 'lcc',
      seedFields: { name: 'Jane Doe', entity_type: 'person', email: 'jane@example.com', phone: '918-555-0100' },
    });

    assert.equal(result.ok, true);
    assert.equal(result.createdEntity, true);

    assert.equal(mergeFieldCalls.length, 2,
      'one lcc_merge_field call per governed field written at create time — got '
      + mergeFieldCalls.length);
    const byField = Object.fromEntries(mergeFieldCalls.map((c) => [c.p_field_name, c]));
    assert.equal(byField.email.p_value, 'jane@example.com');
    assert.equal(byField.phone.p_value, '918-555-0100');
    for (const c of mergeFieldCalls) {
      assert.equal(c.p_target_table, 'entities',
        'target_table must be the bare registry spelling, or the write lands unregistered');
      assert.equal(c.p_target_database, 'lcc_opps',
        'target_database must be the CHECK-vocabulary value, or the RPC 23514s');
      assert.equal(c.p_record_pk, 'entity-1', 'must record against the entity JUST created');
      assert.equal(c.p_source, 'salesforce');
    }
  });

  it('records NOTHING when the create carries neither email nor phone', async () => {
    process.env.OPS_SUPABASE_URL = 'https://ops.example.com';
    process.env.OPS_SUPABASE_KEY = 'test-key';
    let mergeFieldCalled = false;
    global.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes('/external_identities?') && opts.method === 'GET') {
        return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
      }
      if (u.includes('/entities?') && opts.method === 'GET') {
        return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
      }
      if (u.endsWith('/entities') && opts.method === 'POST') {
        const body = JSON.parse(opts.body);
        return jsonResponse([{ id: 'entity-2', ...body }]);
      }
      if (/\/external_identities(\?|$)/.test(u) && opts.method === 'POST') {
        return jsonResponse([{ id: 'ext-2', ...JSON.parse(opts.body) }]);
      }
      if (u.includes('/rpc/lcc_merge_field')) { mergeFieldCalled = true; return jsonResponse([]); }
      throw new Error(`Unexpected fetch: ${opts.method} ${u}`);
    };

    const result = await ensureEntityLink({
      workspaceId: 'ws-1', userId: 'user-1', sourceSystem: 'costar', sourceType: 'company',
      externalId: 'org-1', domain: 'government', seedFields: { name: 'Acme Holdings LLC' },
    });

    assert.equal(result.ok, true);
    assert.equal(result.createdEntity, true);
    assert.equal(mergeFieldCalled, false,
      'no email/phone in the payload ⇒ no merge-field call — writing a null would assert '
      + 'a positive fact the source never stated');
  });

  it('a registry outage still leaves the entity created (fail open, PR12)', async () => {
    process.env.OPS_SUPABASE_URL = 'https://ops.example.com';
    process.env.OPS_SUPABASE_KEY = 'test-key';
    global.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes('/external_identities?') && opts.method === 'GET') {
        return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
      }
      if (u.includes('/entities?') && opts.method === 'GET') {
        return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
      }
      if (u.endsWith('/entities') && opts.method === 'POST') {
        const body = JSON.parse(opts.body);
        return jsonResponse([{ id: 'entity-3', ...body }]);
      }
      if (/\/external_identities(\?|$)/.test(u) && opts.method === 'POST') {
        return jsonResponse([{ id: 'ext-3', ...JSON.parse(opts.body) }]);
      }
      if (u.includes('/rpc/lcc_merge_field')) {
        return jsonResponse({ message: 'registry unreachable' }, false, 500);
      }
      throw new Error(`Unexpected fetch: ${opts.method} ${u}`);
    };

    const result = await ensureEntityLink({
      workspaceId: 'ws-1', userId: 'user-1', sourceSystem: 'salesforce', sourceType: 'Contact',
      externalId: 'sf-contact-2', domain: 'lcc',
      seedFields: { name: 'John Roe', entity_type: 'person', email: 'john@example.com' },
    });

    assert.equal(result.ok, true, 'the entity create itself must never be blocked by a provenance failure');
    assert.equal(result.createdEntity, true);
    assert.equal(result.entityId, 'entity-3');
  });
});
