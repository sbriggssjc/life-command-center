// Bound the /api/* HTTP read-route responses so ChatGPT Actions / Copilot
// connectors never hit ResponseTooLargeError. Covers the pure guard + shapers
// in mcp/http-response-bound.js. The MCP (/mcp) surface never calls these, so
// its payloads stay full — this module only shrinks the HTTP layer.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const {
  MAX_HTTP_RESPONSE_CHARS,
  jsonLen,
  clampInt,
  deepTrim,
  enforceHttpResponseSize,
  shapeDailyBriefing,
  shapePropertyContext,
  boundHttpToolResult,
} = await import('../mcp/http-response-bound.js');

// A row big enough that a modest array of them blows past the ceiling.
function bigRow(i) {
  return {
    id: `id-${i}`,
    title: `Item ${i}`,
    status: 'open',
    due_date: '2026-08-01',
    priority: 'normal',
    entity_id: `e-${i}`,
    raw: { blob: 'x'.repeat(4000) }, // a heavy source-row blob
    note: 'y'.repeat(4000),
  };
}

describe('enforceHttpResponseSize — the generic guard', () => {
  it('returns the payload byte-identical when under the ceiling', () => {
    const small = { a: 1, items: [{ id: 1 }, { id: 2 }] };
    const out = enforceHttpResponseSize(small);
    assert.equal(out, small); // same reference — no-op path
    assert.equal(jsonLen(out) <= MAX_HTTP_RESPONSE_CHARS, true);
  });

  it('shrinks an over-ceiling payload under the cap and marks it truncated', () => {
    const big = { count: 200, items: Array.from({ length: 200 }, (_, i) => bigRow(i)) };
    assert.equal(jsonLen(big) > MAX_HTTP_RESPONSE_CHARS, true);
    const out = enforceHttpResponseSize(big);
    assert.equal(jsonLen(out) <= MAX_HTTP_RESPONSE_CHARS, true, 'under the ceiling after shrink');
    assert.equal(out.truncated, true);
    assert.equal(typeof out.truncation_note, 'string');
    assert.equal(out.count, 200); // scalar fields preserved
    // Trims the TAIL — keeps the highest-ranked head.
    assert.equal(out.items[0].id, 'id-0');
    assert.equal(out.items.length <= 10, true);
    // Heavy blobs dropped.
    assert.equal('raw' in out.items[0], false);
  });
});

describe('deepTrim — recursive bound', () => {
  it('caps arrays (tail dropped), drops heavy keys, truncates long strings', () => {
    const v = {
      list: Array.from({ length: 50 }, (_, i) => i),
      raw: 'should be dropped',
      embedding: [1, 2, 3],
      text: 'z'.repeat(5000),
      nested: { inner: Array.from({ length: 20 }, (_, i) => ({ i, base64: 'q'.repeat(100) })) },
    };
    const out = deepTrim(v, { arrayCap: 5, stringCap: 100, dropHeavy: true });
    assert.deepEqual(out.list, [0, 1, 2, 3, 4]);
    assert.equal('raw' in out, false);
    assert.equal('embedding' in out, false);
    assert.equal(out.text.length < 5000, true);
    assert.match(out.text, /chars\]$/);
    assert.equal(out.nested.inner.length, 5);
    assert.equal('base64' in out.nested.inner[0], false);
  });

  it('does not throw on null / primitives / cyclic-ish deep nesting', () => {
    assert.equal(deepTrim(null), null);
    assert.equal(deepTrim(5), 5);
    assert.equal(deepTrim('short'), 'short');
  });
});

describe('shapeDailyBriefing', () => {
  it('caps the fallback bands to the default 10 with display fields only', () => {
    const result = {
      source: 'action_items_fallback',
      urgent: Array.from({ length: 25 }, (_, i) => ({ ...bigRow(i), extra: 'noise' })),
      high: [],
      normal: [],
    };
    const out = shapeDailyBriefing(result, {});
    assert.equal(out.urgent.length, 10);
    // Display fields only — no `raw` / `extra`.
    assert.deepEqual(Object.keys(out.urgent[0]).sort(),
      ['due_date', 'entity_id', 'id', 'priority', 'status', 'title']);
  });

  it('honours an explicit limit and keeps the head', () => {
    const result = { urgent: Array.from({ length: 25 }, (_, i) => bigRow(i)), high: [], normal: [] };
    const out = shapeDailyBriefing(result, { limit: 3 });
    assert.equal(out.urgent.length, 3);
    assert.equal(out.urgent[0].id, 'id-0');
  });

  it('bounds the snapshot path (deep-trims the briefing row)', () => {
    const result = {
      source: 'daily_briefing_snapshot',
      briefing: { id: 1, items: Array.from({ length: 100 }, (_, i) => i), raw: 'x'.repeat(9999) },
    };
    const out = shapeDailyBriefing(result, {});
    assert.equal(out.briefing.items.length <= 10, true);
    assert.equal('raw' in out.briefing, false);
  });
});

describe('shapePropertyContext', () => {
  const makeResult = () => ({
    entity: { id: 'ent-1', name: 'ACME LLC', entity_type: 'asset', metadata: { k: 'v' } },
    active_tasks: Array.from({ length: 30 }, (_, i) => ({ id: i })),
    tenant_guarantor: {
      tenants: Array.from({ length: 20 }, (_, i) => ({ id: i })),
      guarantors: Array.from({ length: 20 }, (_, i) => ({ id: i })),
    },
    gov_data: {
      gsa_leases: Array.from({ length: 50 }, (_, i) => ({ id: i, raw: 'x'.repeat(50) })),
      ownership_history: Array.from({ length: 50 }, (_, i) => ({ id: i })),
      prospect_lead: { id: 1 },
    },
    context_packet: {
      documents: Array.from({ length: 40 }, (_, i) => ({ id: i })),
      raw: 'x'.repeat(30000),
      comps: Array.from({ length: 40 }, (_, i) => ({ id: i })),
    },
  });

  it('default: caps nested arrays and drops context_packet raw blobs', () => {
    const out = shapePropertyContext(makeResult(), {});
    assert.equal(out.active_tasks.length, 8);
    assert.equal(out.tenant_guarantor.tenants.length, 8);
    assert.equal(out.gov_data.gsa_leases.length, 8);
    assert.equal('raw' in out.context_packet, false);
    assert.equal(out.context_packet.comps.length, 8);
    assert.equal(typeof out.context_packet_note, 'string');
  });

  it('verbose:true returns the full packet (no shaping)', () => {
    const out = shapePropertyContext(makeResult(), { verbose: true });
    assert.equal(out.active_tasks.length, 30);
    assert.equal('raw' in out.context_packet, true);
    assert.equal(out.context_packet_note, undefined);
  });

  it('sections selects top-level keys and always keeps entity identity', () => {
    const out = shapePropertyContext(makeResult(), { sections: ['gov_data'] });
    assert.equal('gov_data' in out, true);
    assert.equal('active_tasks' in out, false);
    assert.equal(out.entity.id, 'ent-1'); // identity retained
    assert.deepEqual(out.sections_selected, ['gov_data']);
  });

  it('an error / not-found payload is left untouched', () => {
    const err = { error: 'Property not found', address: '123 Main' };
    assert.equal(shapePropertyContext(err, {}), err);
  });
});

describe('boundHttpToolResult — shaper + guard, per tool', () => {
  it('a tool without a shaper under the ceiling is a no-op (same reference)', () => {
    const r = { query: 'acme', count: 1, entities: [{ id: 'x' }] };
    assert.equal(boundHttpToolResult('search_entities', r, {}), r);
  });

  it('property-context is shaped then bounded under the ceiling', () => {
    const big = {
      entity: { id: 'e', name: 'n' },
      context_packet: { raw: 'x'.repeat(80000), comps: Array.from({ length: 200 }, (_, i) => ({ i })) },
      gov_data: { gsa_leases: Array.from({ length: 500 }, (_, i) => ({ i, blob: 'y'.repeat(200) })) },
    };
    assert.equal(jsonLen(big) > MAX_HTTP_RESPONSE_CHARS, true);
    const out = boundHttpToolResult('get_property_context', big, {});
    assert.equal(jsonLen(out) <= MAX_HTTP_RESPONSE_CHARS, true);
    assert.equal('raw' in out.context_packet, false); // dropped by the shaper
  });

  it('daily-briefing is bounded even when the shaped bands are still large', () => {
    // A pathological row where a single display field is huge — the guard still caps it.
    const result = {
      urgent: Array.from({ length: 25 }, (_, i) => ({ id: i, title: 'T'.repeat(6000) })),
      high: [], normal: [],
    };
    const out = boundHttpToolResult('get_daily_briefing', result, {});
    assert.equal(jsonLen(out) <= MAX_HTTP_RESPONSE_CHARS, true);
  });
});

describe('clampInt', () => {
  it('applies default + bounds', () => {
    assert.equal(clampInt(undefined, 10, 1, 50), 10);
    assert.equal(clampInt('3', 10, 1, 50), 3);
    assert.equal(clampInt(999, 10, 1, 50), 50);
    assert.equal(clampInt(0, 10, 1, 50), 1);
    assert.equal(clampInt('abc', 10, 1, 50), 10);
  });
});
