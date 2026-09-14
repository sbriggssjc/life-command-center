// W7.3 path C — guards the Outlook category-tagging receiver's deal resolution
// and parking. Pure logic over injected deps (no live DB).
//
// Invariants:
//   1. An explicit LCC:<hint> that resolves unambiguously → that deal.
//   2. An ambiguous hint → NOT resolved (ambiguous flag + candidates) so the
//      caller parks rather than guessing.
//   3. No hint → resolves the sender via lcc_resolve_contact.
//   4. Nothing resolves → method 'unresolved' (→ parked upstream).
//   5. parkUnresolved writes an idempotent research_tasks tag_unresolved row.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTaggedDeal, parkUnresolved } from '../api/_handlers/intake-tagged-comm.js';

describe('resolveTaggedDeal', () => {
  it('resolves an explicit unambiguous hint', async () => {
    const deps = {
      resolveDealByQuery: async () => ({ matched: 'exact', deal_entity_id: 'DEAL-H' }),
      opsQuery: async () => ({ ok: true, data: [] }),
    };
    const r = await resolveTaggedDeal({ hint: 'DaVita Tulsa' }, deps);
    assert.equal(r.deal_entity_id, 'DEAL-H');
    assert.equal(r.method, 'hint_exact');
    assert.equal(r.ambiguous, false);
  });

  it('flags an ambiguous hint as ambiguous (does not guess)', async () => {
    const deps = {
      resolveDealByQuery: async () => ({ matched: 'ambiguous', candidates: [{ entity_id: 'A' }, { entity_id: 'B' }] }),
      opsQuery: async () => ({ ok: true, data: [] }),
    };
    const r = await resolveTaggedDeal({ hint: 'DaVita' }, deps);
    assert.equal(r.deal_entity_id, null);
    assert.equal(r.ambiguous, true);
    assert.equal(r.candidates.length, 2);
  });

  it('falls back to the sender resolver when no hint', async () => {
    const deps = {
      resolveDealByQuery: async () => ({ matched: 'none' }),
      opsQuery: async (m, path, body) => {
        if (path === 'rpc/lcc_resolve_contact') return { ok: true, data: [{ party_entity_id: 'P9', primary_deal: 'DEAL-S' }] };
        return { ok: true, data: [] };
      },
    };
    const r = await resolveTaggedDeal({ from: 'broker@example.com', to: [] }, deps);
    assert.equal(r.deal_entity_id, 'DEAL-S');
    assert.equal(r.party_entity_id, 'P9');
    assert.equal(r.method, 'sender_resolver');
  });

  it('returns unresolved when nothing matches', async () => {
    const deps = {
      opsQuery: async (m, path) => {
        if (path === 'rpc/lcc_resolve_contact') return { ok: true, data: [{}] };
        return { ok: true, data: [] };
      },
    };
    const r = await resolveTaggedDeal({ from: 'nobody@nowhere.com', to: [] }, deps);
    assert.equal(r.deal_entity_id, null);
    assert.equal(r.method, 'unresolved');
  });
});

describe('parkUnresolved', () => {
  it('writes an idempotent tag_unresolved research task', async () => {
    const seen = [];
    const deps = { opsQuery: async (m, path, body) => { seen.push({ m, path, body }); return { ok: true, data: [{ id: 'RT1' }] }; } };
    const r = await parkUnresolved({
      workspaceId: 'WS-1', internetMsgId: 'MSG-1', subject: 'Re: pricing',
      from: 'x@y.com', hint: 'DaVita', candidates: [], reason: 'ambiguous_hint',
    }, deps);
    assert.equal(r.parked, true);
    const w = seen[0];
    assert.equal(w.m, 'POST');
    assert.ok(w.path.startsWith('research_tasks?on_conflict=source_table,source_record_id,research_type,domain'));
    assert.equal(w.body.research_type, 'tag_unresolved');
    assert.equal(w.body.source_table, 'outlook_tagged');
    assert.equal(w.body.source_record_id, 'MSG-1');
  });
});
