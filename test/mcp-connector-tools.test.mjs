// Prompt 58 — regression coverage for the two broken connector tools:
//   A. get_property_context returned not_on_file (raw_ref {}) for on-file
//      properties because the free-text reference arrived under an alias key the
//      handler never read.
//   B. search_entities crashed with "Cannot read properties of undefined
//      (reading 'replace')" when the query arrived under an alias / as a bare
//      string.
// Both are now routed through firstNonEmptyString(). These tests drive the real
// TOOL_HANDLERS with a stubbed fetch that emulates the Supabase REST layer.

import test from 'node:test';
import assert from 'node:assert/strict';

// Env must be set before importing server.js (it reads env at module load).
process.env.OPS_SUPABASE_URL = 'https://ops.example.co';
process.env.OPS_SUPABASE_KEY = 'ops-key';
process.env.DIA_SUPABASE_URL = 'https://dia.example.co';
process.env.DIA_SUPABASE_KEY = 'dia-key';

const PROP_ID = '31964';
const ASSET_ENTITY_ID = '11111111-1111-1111-1111-111111111111';

// A minimal Supabase-REST stub. Routes by the DB host + PostgREST path so the
// dia property lookup, the external_identities join, and the ops entity fetch
// all resolve to a single on-file dialysis property + its LCC asset entity.
function stubFetch() {
  return async (url) => {
    const u = new URL(url);
    const path = u.pathname.replace('/rest/v1/', '') + u.search;
    const json = (data) => ({
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () => JSON.stringify(data),
    });

    // dia domain: properties?address=ilike.*1050 old camp rd*
    if (u.host.startsWith('dia') && path.startsWith('properties?')) {
      if (/1050/i.test(decodeURIComponent(path)) || /old%20camp|old\s*camp/i.test(path)) {
        return json([{ property_id: PROP_ID, address: '1050 Old Camp Rd', city: 'The Villages', state: 'FL', tenant: 'DaVita' }]);
      }
      return json([]);
    }

    // ops: external_identities linking the dia property -> the LCC asset entity
    if (path.startsWith('external_identities?')) {
      if (path.includes(`external_id=eq.${PROP_ID}`)) {
        return json([{ entity_id: ASSET_ENTITY_ID, source_system: 'dia', source_type: 'asset', external_id: PROP_ID }]);
      }
      return json([]);
    }

    // ops: entities?id=in.(...) -> the asset entity row
    if (path.startsWith('entities?id=in.') && path.includes(ASSET_ENTITY_ID)) {
      return json([{
        id: ASSET_ENTITY_ID, entity_type: 'asset', name: '1050 Old Camp Rd',
        address: '1050 Old Camp Rd', city: 'The Villages', state: 'FL', domain: 'dia',
        external_identities: [{ source_system: 'dia', source_type: 'asset', external_id: PROP_ID }],
      }]);
    }

    // search_entities: entities?or=(name.ilike.*davita*,...) -> DaVita org matches
    if (path.startsWith('entities?or=') && /davita/i.test(decodeURIComponent(path))) {
      return json([
        { id: 'org-1', entity_type: 'organization', name: 'DaVita Inc.', domain: 'dia', external_identities: [] },
        { id: 'org-2', entity_type: 'organization', name: 'DaVita Healthcare Partners', domain: 'dia', external_identities: [] },
      ]);
    }

    // Everything else (value map, context packets, action_items, rpc, etc.) -> empty.
    return json([]);
  };
}

let TOOL_HANDLERS;
let firstNonEmptyString;
const realFetch = global.fetch;

test.before(async () => {
  global.fetch = stubFetch();
  ({ TOOL_HANDLERS, firstNonEmptyString } = await import('../mcp/server.js'));
});

test.after(() => { global.fetch = realFetch; });

function parseToolResult(res) {
  // handlers return { content: [{ type:'text', text }] } (textResult shape).
  const text = res?.content?.[0]?.text ?? (typeof res === 'string' ? res : JSON.stringify(res));
  return JSON.parse(text);
}

test('firstNonEmptyString picks the first non-empty alias, else null', () => {
  assert.equal(firstNonEmptyString(undefined, '', '  ', 'DaVita'), 'DaVita');
  assert.equal(firstNonEmptyString(null, undefined), null);
  assert.equal(firstNonEmptyString(31964), '31964');
});

test('get_property_context resolves an on-file property from the { address } key', async () => {
  const out = parseToolResult(await TOOL_HANDLERS.get_property_context({ address: '1050 Old Camp Rd, The Villages, FL' }));
  assert.notEqual(out.status, 'not_on_file');
  assert.equal(String(out.entity?.id), ASSET_ENTITY_ID);
});

test('get_property_context resolves the same property from an alias key (query) — the raw_ref {} regression', async () => {
  const out = parseToolResult(await TOOL_HANDLERS.get_property_context({ query: '1050 Old Camp Rd, The Villages, FL' }));
  assert.notEqual(out.status, 'not_on_file', 'alias key must resolve, not false not_on_file');
  assert.equal(String(out.entity?.id), ASSET_ENTITY_ID);
  // raw_ref must carry the reference now (was {} before the fix).
  assert.ok(out.resolution?.raw_ref || out.entity, 'reference must reach the resolver');
});

test('get_property_context resolves from a bare string argument', async () => {
  const out = parseToolResult(await TOOL_HANDLERS.get_property_context('1050 Old Camp Rd, The Villages, FL'));
  assert.notEqual(out.status, 'not_on_file');
  assert.equal(String(out.entity?.id), ASSET_ENTITY_ID);
});

test('search_entities returns matches for a plain query without throwing', async () => {
  const out = parseToolResult(await TOOL_HANDLERS.search_entities({ query: 'DaVita' }));
  assert.ok(Array.isArray(out.entities));
  assert.ok(out.entities.length >= 1);
  assert.match(out.entities[0].name, /DaVita/);
});

test('search_entities does not crash when the query arrives under an alias or as a bare string', async () => {
  const viaAlias = parseToolResult(await TOOL_HANDLERS.search_entities({ request: 'search for DaVita operator entities' }));
  // "search for DaVita ..." contains 'davita' so the stub returns matches; the
  // point is it must not throw on a missing `query` key.
  assert.ok(Array.isArray(viaAlias.entities));

  const viaBare = parseToolResult(await TOOL_HANDLERS.search_entities('DaVita'));
  assert.ok(Array.isArray(viaBare.entities));
  assert.ok(viaBare.entities.length >= 1);
});

test('search_entities returns a clean error (no crash) when no query is provided', async () => {
  const out = parseToolResult(await TOOL_HANDLERS.search_entities({}));
  assert.match(out.error || '', /required/i);
});
