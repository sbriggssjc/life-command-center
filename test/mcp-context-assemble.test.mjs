// Phase 2 Slice 3a.1 — MCP get_property_context assembles on a cache miss.
//
// The deployed MCP server only READ the context_packets cache and returned
// context_packet: null on a cold miss. These tests cover the new assemble-on-miss
// helper (mcp/context-assemble.js):
//   - a cache miss triggers POST /api/context?action=assemble and the returned
//     payload becomes context_packet;
//   - a fresh cache hit does NOT call assemble;
//   - an assemble error / timeout falls back to null without throwing;
//   - LCC_API_BASE unset → cache-only (no fetch call).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { assemblePropertyPacketViaApi, resolveContextPacket } = await import(
  '../mcp/context-assemble.js'
);

const ENTITY_ID = '9782c412-e9b7-4061-ac73-edc670b9273c';
const entity = { id: ENTITY_ID, workspace_id: 'ws-1' };

describe('assemblePropertyPacketViaApi — the HTTP assemble call', () => {
  it('POSTs /api/context?action=assemble and returns the payload-bearing body', async () => {
    let seen = null;
    const fetchImpl = async (url, opts) => {
      seen = { url, opts };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          packet_type: 'property',
          payload: { entity, documents: [{ document_id: 1 }] },
          token_count: 42,
          assembled_at: 'now',
          expires_at: 'later',
        }),
      };
    };

    const data = await assemblePropertyPacketViaApi({
      entityId: ENTITY_ID,
      workspaceId: 'ws-1',
      apiBase: 'https://app.example.com/',
      apiKey: 'secret-key',
      fetchImpl,
    });

    // URL trims the trailing slash and targets the assemble action
    assert.equal(seen.url, 'https://app.example.com/api/context?action=assemble');
    assert.equal(seen.opts.method, 'POST');
    assert.equal(seen.opts.headers['X-LCC-Key'], 'secret-key');
    assert.equal(seen.opts.headers['X-LCC-Workspace'], 'ws-1');
    assert.equal(seen.opts.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(seen.opts.body), {
      packet_type: 'property',
      entity_id: ENTITY_ID,
      entity_type: 'asset',
    });

    assert.ok(data.payload.documents);
    assert.equal(data.token_count, 42);
  });

  it('returns null WITHOUT calling fetch when LCC_API_BASE is unset', async () => {
    let called = false;
    const fetchImpl = async () => { called = true; throw new Error('should not be called'); };
    const data = await assemblePropertyPacketViaApi({
      entityId: ENTITY_ID,
      apiBase: '',
      apiKey: 'secret-key',
      fetchImpl,
    });
    assert.equal(called, false);
    assert.equal(data, null);
  });

  it('returns null on a non-2xx response (no throw)', async () => {
    const fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({}) });
    const data = await assemblePropertyPacketViaApi({
      entityId: ENTITY_ID,
      apiBase: 'https://app.example.com',
      apiKey: 'k',
      fetchImpl,
    });
    assert.equal(data, null);
  });

  it('returns null when the body carries no payload (no throw)', async () => {
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ error: 'nope' }) });
    const data = await assemblePropertyPacketViaApi({
      entityId: ENTITY_ID,
      apiBase: 'https://app.example.com',
      apiKey: 'k',
      fetchImpl,
    });
    assert.equal(data, null);
  });

  it('returns null when fetch throws / aborts (no throw, no hang)', async () => {
    const fetchImpl = async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
    const data = await assemblePropertyPacketViaApi({
      entityId: ENTITY_ID,
      apiBase: 'https://app.example.com',
      apiKey: 'k',
      fetchImpl,
      timeoutMs: 10,
    });
    assert.equal(data, null);
  });
});

describe('resolveContextPacket — miss assembles, hit short-circuits', () => {
  it('returns the cached row on a fresh hit WITHOUT assembling', async () => {
    let called = false;
    const assembleFn = async () => { called = true; return { payload: {} }; };
    const cachedRow = { packet_type: 'property', entity_id: ENTITY_ID, payload: { entity } };
    const { context_packet, assembled_on_miss } = await resolveContextPacket({
      cachedRow, entity, assembleFn,
    });
    assert.equal(called, false);
    assert.equal(assembled_on_miss, false);
    assert.equal(context_packet, cachedRow);
  });

  it('assembles + returns a non-null packet on a cache miss', async () => {
    let seenArgs = null;
    const assembleFn = async (args) => {
      seenArgs = args;
      return {
        payload: { entity, documents: [] },
        token_count: 7,
        assembled_at: 'now',
        expires_at: 'later',
      };
    };
    const { context_packet, assembled_on_miss } = await resolveContextPacket({
      cachedRow: null, entity, assembleFn,
    });
    assert.deepEqual(seenArgs, { entityId: ENTITY_ID, workspaceId: 'ws-1' });
    assert.equal(assembled_on_miss, true);
    assert.ok(context_packet);
    assert.equal(context_packet.packet_type, 'property');
    assert.equal(context_packet.entity_id, ENTITY_ID);
    assert.equal(context_packet.assembled_on_miss, true);
    assert.equal(context_packet.token_count, 7);
    assert.ok(context_packet.payload.documents);
  });

  it('falls back to null (no throw) when assembly fails', async () => {
    const assembleFn = async () => null; // assemblePropertyPacketViaApi returns null on failure
    const { context_packet, assembled_on_miss } = await resolveContextPacket({
      cachedRow: null, entity, assembleFn,
    });
    assert.equal(context_packet, null);
    assert.equal(assembled_on_miss, false);
  });
});
