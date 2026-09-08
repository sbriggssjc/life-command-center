// UX-T1c-intake-cap (2026-09-08) — the intake_disposition lane must PAGE its
// source population, never fetch it through a single capped request.
//
// Measured 2026-09-08: `staged_intake_items` at status in (review_required,
// failed) held 1,011 rows; the handler fetched `limit=1000` ordered
// created_at.desc, so the 11 oldest (5 create_candidate) were never fetched,
// classified or shown. A5a class: a requested limit vs a capped response.
//
// Two layers, because a source grep alone is the documented "guard defeated by
// a name that legitimately appears elsewhere" footgun:
//   1. behavioural — pageIntakeReviewRows against a stub fetch
//   2. structural  — admin.js's intake branch calls the pager and carries no
//      bare `limit=1000` on staged_intake_items (comments stripped first: the
//      fix's own comment names the old literal while explaining it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  pageIntakeReviewRows, INTAKE_REVIEW_PAGE_SIZE, INTAKE_REVIEW_MAX_PAGES,
} from '../api/_shared/intake-classify.js';

function stubFetch(total, opts = {}) {
  const calls = [];
  return {
    calls,
    fetch: async (path) => {
      calls.push(path);
      const m = /limit=(\d+)&offset=(\d+)/.exec(path);
      const limit = Number(m[1]); const offset = Number(m[2]);
      if (opts.failAtOffset != null && offset >= opts.failAtOffset) return { ok: false, data: null };
      const n = Math.max(0, Math.min(limit, total - offset));
      return { ok: true, data: Array.from({ length: n }, (_, i) => ({ intake_id: offset + i })) };
    },
  };
}

test('a population above the PostgREST cap is fetched completely (1,011 → 2 pages, 1,011 rows)', async () => {
  const s = stubFetch(1011);
  const out = await pageIntakeReviewRows(s.fetch, 'staged_intake_items?select=x');
  assert.equal(out.rows.length, 1011);
  assert.equal(out.pages, 2);
  assert.equal(out.truncated, false);
  assert.equal(out.failed, false);
  // the 11 oldest rows — the ones the old handler dropped — are present
  assert.equal(out.rows[1010].intake_id, 1010);
  assert.match(s.calls[0], /limit=1000&offset=0$/);
  assert.match(s.calls[1], /limit=1000&offset=1000$/);
});

test('an exactly-full first page is NOT treated as the end (returned count decides, not requested)', async () => {
  const s = stubFetch(1000);
  const out = await pageIntakeReviewRows(s.fetch, 'p?select=x');
  assert.equal(out.rows.length, 1000);
  assert.equal(out.pages, 2, 'a full page must be followed by one more probe');
});

test('a short first page stops after one request', async () => {
  const s = stubFetch(37);
  const out = await pageIntakeReviewRows(s.fetch, 'p?select=x');
  assert.equal(out.rows.length, 37);
  assert.equal(out.pages, 1);
});

test('a failed page is reported, never silently read as an empty population', async () => {
  const s = stubFetch(2500, { failAtOffset: 1000 });
  const out = await pageIntakeReviewRows(s.fetch, 'p?select=x');
  assert.equal(out.failed, true);
  assert.equal(out.rows.length, 1000, 'rows already fetched are kept');
});

test('maxPages truncation is reported as truncated, not as complete', async () => {
  const s = stubFetch(5000);
  const out = await pageIntakeReviewRows(s.fetch, 'p?select=x', { maxPages: 3 });
  assert.equal(out.rows.length, 3000);
  assert.equal(out.truncated, true);
  assert.equal(INTAKE_REVIEW_PAGE_SIZE, 1000, 'stride must equal the PostgREST cap');
  assert.ok(INTAKE_REVIEW_MAX_PAGES >= 10);
});

// ── structural ─────────────────────────────────────────────────────────────
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

test('admin.js intake_disposition branch pages via pageIntakeReviewRows and carries no bare limit=1000', () => {
  const src = readFileSync(new URL('../api/admin.js', import.meta.url), 'utf8');
  const start = src.indexOf("if (type === 'intake_disposition') {");
  assert.ok(start > 0, 'intake_disposition branch present');
  const end = src.indexOf("if (type === 'property_merge') {", start);
  assert.ok(end > start, 'property_merge branch follows');
  const branch = stripComments(src.slice(start, end));
  assert.match(branch, /pageIntakeReviewRows\(/, 'branch must call the pager');
  assert.doesNotMatch(branch, /staged_intake_items\?[^\n]*limit=1000/, 'no single capped fetch');
  assert.match(branch, /intake_truncated/, 'truncation must be surfaced on the lane result');
  assert.match(src, /pageIntakeReviewRows,\s*\n\} from '\.\/_shared\/intake-classify\.js'/, 'pager imported');
});
