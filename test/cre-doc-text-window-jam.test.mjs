// DOC1 — the CRE doc-text backlog scan had a FIXED WINDOW and no cursor.
//
// `fetchEligibleCreDocs` read the newest `cap*4` = 60 registry rows and diffed
// out the ones already extracted. Once those 60 were done the diff was empty
// FOREVER: `eligible: 0`, HTTP 200 every 30 minutes, over 695 waiting documents
// (ids 2 -> 2317) whose only consumer — bov-extract — starved. Dead-End
// playbook Class 12, third instance (P135 fixed window, P136 same-120-nightly).
//
// These tests pin the four properties that make the fix a fix rather than a
// bigger constant:
//   1. the scan ASCENDS (it can reach id 2) and pages on a keyset cursor
//   2. it TERMINATES on a page budget and SAYS SO (`scan_capped`)
//   3. a byte-fetch failure — the ONE ok:false return extractDocumentText has —
//      leaves a DATED negative marker, so oldest-first cannot jam on it (P136)
//   4. that marker EXPIRES, and nothing else in the sidecar is re-admitted
//
// Every assertion below was mutation-verified RED against the pre-fix code or a
// deliberately broken variant. Source-shape assertions STRIP COMMENTS first —
// this file's own subject matter names `id.desc` and `fetch_failed` repeatedly,
// so a raw-source grep would pass over the very regression it exists to catch
// (the A5c / N18 / B1 lesson).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.OPS_SUPABASE_URL = 'https://ops.test.local';
process.env.OPS_SUPABASE_KEY = 'service-key';

const {
  fetchEligibleCreDocs,
  runPropertyDocText,
  CRE_SCAN_PAGE_SIZE,
  CRE_RETRY_REASONS,
  CRE_RETRY_AFTER_HOURS,
} = await import('../api/_shared/cre-property-doc-text.js');

const WORKER_SRC = readFileSync(new URL('../api/_shared/cre-property-doc-text.js', import.meta.url), 'utf8');

/** Strip // and block comments so a fix's own prose cannot satisfy a grep. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const NOW = Date.parse('2026-09-01T12:00:00Z');
const HOUR = 3600 * 1000;

/**
 * A fake registry of `n` lease rows with ids 1..n, plus a sidecar map
 * { [id]: {needs_ocr, reason, extracted_at} }. Serves the two PostgREST reads
 * fetchEligibleCreDocs issues, honouring `id=gt.<cursor>` and `limit=`.
 */
function makeOps({ ids, sidecar = {}, calls = [], sidecarOk = true }) {
  return async (method, path) => {
    calls.push(path);
    if (path.startsWith('lcc_cre_property_documents?')) {
      const after = Number(/[?&]id=gt\.(\d+)/.exec(path)?.[1] ?? -1);
      const limit = Number(/[?&]limit=(\d+)/.exec(path)?.[1] ?? 1000);
      const page = ids.filter((id) => id > after).sort((a, b) => a - b).slice(0, limit);
      return { ok: true, data: page.map((id) => ({ id, cre_property_id: id * 10, document_type: 'lease', file_name: `f${id}.pdf`, source_url: `/sites/x/${id}.pdf` })) };
    }
    if (path.startsWith('lcc_cre_property_document_text?')) {
      if (!sidecarOk) return { ok: false, status: 500, data: { message: 'probe blew up' } };
      const inList = /document_id=in\.\(([^)]*)\)/.exec(path)?.[1] || '';
      const wanted = inList.split(',').filter(Boolean).map(Number);
      return { ok: true, data: wanted.filter((id) => sidecar[id]).map((id) => ({ document_id: id, ...sidecar[id] })) };
    }
    throw new Error(`unexpected path ${path}`);
  };
}

// ---------------------------------------------------------------------------
// 1. It reaches the bottom of the backlog.
// ---------------------------------------------------------------------------

describe('fetchEligibleCreDocs — the scan advances past the newest rows', () => {
  it('returns the OLDEST undrained rows, not the newest window (the DOC1 defect)', async () => {
    // The live shape: 2,317 registry rows; everything above 2,250 already done.
    const ids = Array.from({ length: 2317 }, (_, i) => i + 1);
    const sidecar = {};
    for (const id of ids) if (id > 2250) sidecar[id] = { needs_ocr: false, reason: null, extracted_at: '2026-08-27T00:00:00Z' };

    const r = await fetchEligibleCreDocs({ limit: 15 }, { opsQuery: makeOps({ ids, sidecar }), now: () => NOW });

    assert.equal(r.ok, true);
    assert.equal(r.rows.length, 15, 'a saturated newest-window returns 0; an ascending scan returns a full batch');
    assert.deepEqual(r.rows.map((x) => x.id), Array.from({ length: 15 }, (_, i) => i + 1));
    assert.equal(r.scan_lowest_id, 1, 'the scan must START at the bottom of the population');
  });

  it('pages on a keyset cursor — never re-reads a page, never uses offset', async () => {
    const ids = Array.from({ length: 900 }, (_, i) => i + 1);
    // Only the very last id is undrained, so the scan must walk every page.
    const sidecar = {};
    for (const id of ids) if (id !== 900) sidecar[id] = { needs_ocr: false, reason: null, extracted_at: '2026-08-27T00:00:00Z' };

    const calls = [];
    const r = await fetchEligibleCreDocs({ limit: 15 }, { opsQuery: makeOps({ ids, sidecar, calls }), now: () => NOW });

    assert.deepEqual(r.rows.map((x) => x.id), [900]);
    const regCalls = calls.filter((p) => p.startsWith('lcc_cre_property_documents?'));
    assert.equal(regCalls.length, Math.ceil(900 / CRE_SCAN_PAGE_SIZE));
    const cursors = regCalls.map((p) => Number(/[?&]id=gt\.(\d+)/.exec(p)[1]));
    assert.deepEqual(cursors, [0, 200, 400, 600, 800], 'each page must resume from the last id seen');
    assert.ok(regCalls.every((p) => !/offset=/.test(p)), 'offset paging re-sorts the whole view every page (A5a)');
  });

  it('every registry page stays under the PostgREST 1000-row response cap', () => {
    assert.ok(CRE_SCAN_PAGE_SIZE < 1000, 'a stride at or above the cap silently SKIPS rows');
  });
});

// ---------------------------------------------------------------------------
// 2. It terminates, and says when the budget stopped it.
// ---------------------------------------------------------------------------

describe('fetchEligibleCreDocs — bounded, and honest about being bounded', () => {
  it('stops on the page budget and reports scan_capped so 0 is not read as empty', async () => {
    const ids = Array.from({ length: 5000 }, (_, i) => i + 1);
    const sidecar = {};
    for (const id of ids) sidecar[id] = { needs_ocr: false, reason: null, extracted_at: '2026-08-27T00:00:00Z' };

    const r = await fetchEligibleCreDocs({ limit: 15 }, { opsQuery: makeOps({ ids, sidecar }), scanMaxPages: 3, now: () => NOW });

    assert.equal(r.rows.length, 0);
    assert.equal(r.scan_pages, 3, 'the budget, not the population, ended the walk');
    assert.equal(r.scan_capped, true, 'eligible:0 under a capped scan is a FLOOR, not an empty queue');
    assert.equal(r.scan_exhausted, false);
  });

  it('reports scan_exhausted (and NOT capped) when it genuinely walked the whole population', async () => {
    const ids = [1, 2, 3];
    const r = await fetchEligibleCreDocs({ limit: 15 }, {
      opsQuery: makeOps({ ids, sidecar: { 1: { needs_ocr: false, reason: null, extracted_at: '2026-08-27T00:00:00Z' } } }),
      now: () => NOW,
    });
    assert.deepEqual(r.rows.map((x) => x.id), [2, 3]);
    assert.equal(r.scan_exhausted, true);
    assert.equal(r.scan_capped, false, 'a genuinely empty queue must be distinguishable from a truncated scan');
  });

  it('FAILS CLOSED when the sidecar probe errors — never drains a queue it could not verify', async () => {
    const ids = [1, 2, 3];
    const r = await fetchEligibleCreDocs({ limit: 15 }, { opsQuery: makeOps({ ids, sidecarOk: false }), now: () => NOW });
    assert.equal(r.ok, false, 'failing OPEN re-OCRs already-extracted documents and bills DocAI per page again');
    assert.equal(r.stage, 'sidecar_probe');
  });
});

// ---------------------------------------------------------------------------
// 3. The negative marker — what makes oldest-first safe.
// ---------------------------------------------------------------------------

describe('the deferred-retry marker (P136) — a fetch failure must leave a trace', () => {
  it('writes a DATED needs_ocr marker when the byte fetch fails', async () => {
    const writes = [];
    const r = await runPropertyDocText(7, {
      registryRow: { id: 7, cre_property_id: 70, document_type: 'lease', source_url: '/sites/x/7.pdf' },
      extractDocumentText: async () => ({ ok: false, reason: 'fetch_failed', detail: 'sharepoint_fetch_unset' }),
      opsQuery: async (method, path, body) => {
        if (method === 'POST') { writes.push(body); return { ok: true }; }
        return { ok: true, data: [] };   // sidecarStatus: absent
      },
      now: () => NOW,
    });

    assert.equal(r.outcome, 'fetch_failed');
    assert.equal(r.retry_marked, true);
    assert.equal(writes.length, 1, 'no row written means the doc returns to the head of the queue forever');
    const row = writes[0];
    assert.equal(row.document_id, 7);
    assert.equal(row.reason, 'fetch_failed');
    assert.equal(row.needs_ocr, true, 'needs_ocr=true keeps it out of bov-extract AND v_lcc_cre_bov_ready');
    assert.equal(row.raw_text, null);
    assert.ok(row.extracted_at, 'undated it cannot expire, and a permanent exclusion is the P136 defect');
  });

  it('marks an extraction THROW the same way — an exception also leaves no row otherwise', async () => {
    const writes = [];
    const r = await runPropertyDocText(8, {
      registryRow: { id: 8, cre_property_id: 80, document_type: 'dd', source_url: '/sites/x/8.pdf' },
      extractDocumentText: async () => { throw new Error('boom'); },
      opsQuery: async (method, path, body) => {
        if (method === 'POST') { writes.push(body); return { ok: true }; }
        return { ok: true, data: [] };
      },
      now: () => NOW,
    });
    assert.equal(r.outcome, 'error');
    assert.equal(r.retry_marked, true);
    assert.equal(writes[0].reason, 'extract_error');
  });

  it('NEVER clobbers an extracted sidecar with a marker (the deps.force path)', async () => {
    const writes = [];
    const r = await runPropertyDocText(9, {
      force: true,
      registryRow: { id: 9, cre_property_id: 90, document_type: 'om', source_url: '/sites/x/9.pdf' },
      extractDocumentText: async () => ({ ok: false, reason: 'fetch_failed' }),
      opsQuery: async (method, path, body) => {
        if (method === 'POST') { writes.push(body); return { ok: true }; }
        return { ok: true, data: [{ needs_ocr: false }] };   // sidecarStatus: 'done'
      },
      now: () => NOW,
    });
    assert.equal(r.retry_marked, false);
    assert.equal(writes.length, 0, 'overwriting real text with a marker destroys the extraction');
  });
});

// ---------------------------------------------------------------------------
// 4. The marker expires, and nothing else does.
// ---------------------------------------------------------------------------

describe('marker expiry — the exclusion clears itself, and only for retry reasons', () => {
  const REG = [1, 2, 3, 4, 5];

  it('re-admits a STALE retry marker and holds a FRESH one', async () => {
    const stale = new Date(NOW - (CRE_RETRY_AFTER_HOURS + 1) * HOUR).toISOString();
    const fresh = new Date(NOW - 1 * HOUR).toISOString();
    const sidecar = {
      1: { needs_ocr: true, reason: 'fetch_failed', extracted_at: stale },
      2: { needs_ocr: true, reason: 'fetch_failed', extracted_at: fresh },
      3: { needs_ocr: true, reason: 'extract_error', extracted_at: stale },
      4: { needs_ocr: false, reason: null, extracted_at: stale },
      5: { needs_ocr: false, reason: null, extracted_at: stale },
    };
    const r = await fetchEligibleCreDocs({ limit: 15 }, { opsQuery: makeOps({ ids: REG, sidecar }), now: () => NOW });
    assert.deepEqual(r.rows.map((x) => x.id), [1, 3]);
    assert.equal(r.retry_admitted, 2);
  });

  it('a retried marker refreshes its timestamp — that is what advances the cursor', async () => {
    // If the head did NOT self-refresh, a wholly-unfetchable backlog would
    // re-try the same oldest `cap` rows every tick and never reach row cap+1.
    const stale = new Date(NOW - (CRE_RETRY_AFTER_HOURS + 1) * HOUR).toISOString();
    const sidecar = Object.fromEntries(REG.map((id) => [id, { needs_ocr: true, reason: 'fetch_failed', extracted_at: stale }]));
    const first = await fetchEligibleCreDocs({ limit: 2 }, { opsQuery: makeOps({ ids: REG, sidecar }), now: () => NOW });
    assert.deepEqual(first.rows.map((x) => x.id), [1, 2]);

    // The tick re-marks what it just attempted (writeDeferredMarker upserts).
    for (const id of [1, 2]) sidecar[id].extracted_at = new Date(NOW).toISOString();
    const second = await fetchEligibleCreDocs({ limit: 2 }, { opsQuery: makeOps({ ids: REG, sidecar }), now: () => NOW + 60_000 });
    assert.deepEqual(second.rows.map((x) => x.id), [3, 4], 'the next tick must move on, not re-try the same head');
  });

  it('NEVER re-admits a terminal OCR outcome — those are decisions, not deferrals', async () => {
    const stale = new Date(NOW - 400 * 24 * HOUR).toISOString();
    const sidecar = {
      1: { needs_ocr: true, reason: 'ocr_non_ok', extracted_at: stale },
      2: { needs_ocr: true, reason: 'over_ocr_cap', extracted_at: stale },
      3: { needs_ocr: false, reason: 'thin_ocr_result', extracted_at: stale },
      4: { needs_ocr: true, reason: 'no_text_layer', extracted_at: stale },
      5: { needs_ocr: false, reason: null, extracted_at: stale },
    };
    const r = await fetchEligibleCreDocs({ limit: 15 }, { opsQuery: makeOps({ ids: REG, sidecar }), now: () => NOW });
    assert.deepEqual(r.rows, [], 're-admitting these re-bills DocAI for an answer we already have');
    assert.deepEqual([...CRE_RETRY_REASONS].sort(), ['extract_error', 'fetch_failed']);
  });
});

// ---------------------------------------------------------------------------
// 5. Source shape — the regressions a behavioural test cannot see.
// ---------------------------------------------------------------------------

describe('source shape (comments stripped)', () => {
  const src = stripComments(WORKER_SRC);

  it('the registry scan orders ASCENDING — descending is the DOC1 defect', () => {
    assert.ok(/order=id\.asc/.test(src), 'expected order=id.asc in the candidate scan');
    assert.ok(!/order=id\.desc/.test(src), 'order=id.desc can never reach the bottom of the backlog');
  });

  it('the scan is keyset-driven and does NOT over-fetch a fixed multiple of the batch', () => {
    assert.ok(/id=gt\.\$\{cursor\}/.test(src), 'expected an id=gt.<cursor> keyset predicate');
    assert.ok(!/limit=\$\{cap \* 4\}/.test(src), 'a bigger constant window moves the jam to row N+1 (P136)');
  });

  it('this worker never touches the DOMAIN document store (cron 160 is a different lane)', () => {
    assert.ok(!/property_documents(?!_)/.test(src.replace(/lcc_cre_property_documents/g, '')),
      'the deed lane is 325/325 and correct — DOC1 must not widen it');
  });
});
