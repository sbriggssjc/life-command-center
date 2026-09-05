// ============================================================================
// CONTACT1b (2026-09-05) — the entities.email/phone contact ladder governed
// only ONE of the 14 write sites the census found (ensureEntityLink's
// CREATE path, CONTACT1a). This unit:
//
//   1. Extracts the per-write recordContactFieldWrites() helper
//      (api/_shared/entity-link.js) that CONTACT1a's inline block used to
//      own alone, so the OTHER governed sites don't re-derive the same
//      (targetDb, targetTable, source-mapping, non-null-only) shape.
//   2. Wires it into six UPDATE-path sites the census found ungoverned:
//      sidebar-pipeline.js::unpackContacts, intake.js's existing-contact
//      fill-blank, operations.js::bridgeSetContactEmail,
//      operations.js::bridgeUpdateEntity, and both PATCH sites in
//      admin.js's owner_contact_attach_review verdict handler.
//   3. Instruments admin.js::handleJunkBucket's parse_contact verdict.
//   4. Leaves TWO sites deliberately ungoverned, with a reason recorded in
//      place: admin.js's tm_misparse_unstamp (clears email to null as part
//      of an already-ledgered reversal — recording it as a "write" under
//      any source name would misrepresent a CLEAR as a source's positive
//      claim), and lease-extractor.js's writeEntityContact (its own header
//      comment already states the reasoning: entities is the BD graph, not
//      a curated domain table, so this is graph enrichment, not a
//      provenance-ledger write — CONTACT1b confirms that reasoning still
//      holds rather than re-deciding it).
//
// Part A is a BEHAVIOURAL test of the extracted helper (a stubbed fetch),
// per this repo's standing rule that a source-shape grep alone is not a
// guard. Part B is a source census over the six instrumented call sites
// PLUS the two deliberate exclusions, anchored on the exported symbol name
// (a stable identity token, never a line number or character window —
// per the block-slice footgun this file's CLAUDE.md documents repeatedly).
//
// Mutation-verify: delete or invert any recordContactFieldWrites() call
// added by this unit, or delete the export from entity-link.js, and the
// corresponding assertion below must go RED.
// ============================================================================

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { recordContactFieldWrites } from '../api/_shared/entity-link.js';

const originalFetch = global.fetch;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function jsonResponse(body, ok = true, status = 200, headers = {}) {
  return {
    ok,
    status,
    headers: { get(name) { return headers[name.toLowerCase()] || headers[name] || null; } },
    async text() { return JSON.stringify(body); },
  };
}

// Strip JS line + block comments before matching, per this repo's standing
// rule (A5c/N18/B1/OCR1c): a fix's own comments quoting the old shape or
// naming the banned token must not satisfy a raw-source grep.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function readStripped(relPath) {
  return stripComments(readFileSync(path.join(repoRoot, relPath), 'utf8'));
}

describe('CONTACT1b — recordContactFieldWrites (behavioural)', () => {
  afterEach(() => { global.fetch = originalFetch; });

  it('records one lcc_merge_field call per non-null governed field, mapped through the registry source name', async () => {
    process.env.OPS_SUPABASE_URL = 'https://ops.example.com';
    process.env.OPS_SUPABASE_KEY = 'test-key';
    const calls = [];
    global.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes('/rpc/lcc_merge_field') && opts.method === 'POST') {
        const body = JSON.parse(opts.body);
        calls.push(body);
        return jsonResponse([{
          provenance_id: 'p-1', decision: 'write', decision_reason: 'no_prior_provenance',
          current_value: null, current_source: null, current_priority: null,
          new_priority: 60, enforce_mode: 'record_only',
        }]);
      }
      throw new Error(`Unexpected fetch: ${opts.method} ${u}`);
    };

    const result = await recordContactFieldWrites({
      recordPk: 'entity-9',
      source: 'costar',
      workspaceId: 'ws-1',
      fields: { email: 'jane@example.com', phone: '918-555-0100', title: 'VP' },
    });

    assert.equal(result.recorded, 2, 'title is not a CONTACT1a/1b-governed field and must not be recorded');
    assert.equal(calls.length, 2);
    const byField = Object.fromEntries(calls.map((c) => [c.p_field_name, c]));
    assert.equal(byField.email.p_value, 'jane@example.com');
    assert.equal(byField.phone.p_value, '918-555-0100');
    for (const c of calls) {
      assert.equal(c.p_target_table, 'entities');
      assert.equal(c.p_target_database, 'lcc_opps');
      assert.equal(c.p_record_pk, 'entity-9');
      // 'costar' maps to the registered rung spelling, same map CONTACT1a uses.
      assert.equal(c.p_source, 'costar_sidebar');
    }
  });

  it('records nothing when fields carries no governed non-null value (a caller need not pre-filter)', async () => {
    let called = false;
    global.fetch = async () => { called = true; return jsonResponse([]); };
    const result = await recordContactFieldWrites({
      recordPk: 'entity-1', source: 'manual', workspaceId: 'ws-1',
      fields: { title: 'VP', metadata: {}, email: '' },
    });
    assert.equal(result.recorded, 0);
    assert.equal(result.failed, 0);
    assert.equal(called, false, 'no governed non-null field ⇒ no RPC call at all');
  });

  it('a registry outage is recorded as failed, never thrown (fail-open, PR12)', async () => {
    global.fetch = async () => jsonResponse({ message: 'registry unreachable' }, false, 500);
    const result = await recordContactFieldWrites({
      recordPk: 'entity-1', source: 'manual', workspaceId: 'ws-1', fields: { email: 'a@b.com' },
    });
    assert.equal(result.recorded, 0);
    assert.equal(result.failed, 1);
  });

  it('passes source verbatim through when unrecognised, per PR5 "unregistered is a branch, not a drop"', async () => {
    let sentSource = null;
    global.fetch = async (url, opts = {}) => {
      if (String(url).includes('/rpc/lcc_merge_field')) {
        sentSource = JSON.parse(opts.body).p_source;
        return jsonResponse([{ decision: 'write' }]);
      }
      throw new Error('unexpected fetch');
    };
    await recordContactFieldWrites({
      recordPk: 'entity-1', source: 'intake_email', workspaceId: 'ws-1', fields: { email: 'a@b.com' },
    });
    assert.equal(sentSource, 'intake_email');
  });
});

describe('CONTACT1b — source census of the write-site coverage decision', () => {
  it('entity-link.js exports recordContactFieldWrites and the CONTACT1a constants it is built from', () => {
    const src = readStripped('api/_shared/entity-link.js');
    assert.match(src, /export\s+async\s+function\s+recordContactFieldWrites\s*\(/);
    assert.match(src, /export\s+function\s+contact1aProvenanceSource\s*\(/);
    assert.match(src, /export\s+const\s+CONTACT1A_TARGET_DB/);
  });

  it('sidebar-pipeline.js unpackContacts calls it on the fill-blank enrichment PATCH', () => {
    const src = readStripped('api/_handlers/sidebar-pipeline.js');
    assert.match(src, /recordContactFieldWrites\s*\(\s*\{/,
      'the UPDATE-path twin of CONTACT1a must record provenance on the second-capture enrichment PATCH');
  });

  it('intake.js records provenance on the existing-contact fill-blank PATCH', () => {
    const src = readStripped('api/intake.js');
    assert.match(src, /recordContactFieldWrites\s*\(\s*\{/);
  });

  it('operations.js records provenance on both bridgeSetContactEmail and bridgeUpdateEntity', () => {
    const src = readStripped('api/operations.js');
    const matches = src.match(/recordContactFieldWrites\s*\(\s*\{/g) || [];
    assert.ok(matches.length >= 2,
      `expected >=2 recordContactFieldWrites call sites in operations.js, found ${matches.length}`);
  });

  it('admin.js records provenance on the junk-bucket parse_contact verdict and both owner_contact_attach_review branches', () => {
    const src = readStripped('api/admin.js');
    const matches = src.match(/recordContactFieldWrites\s*\(\s*\{/g) || [];
    assert.ok(matches.length >= 3,
      `expected >=3 recordContactFieldWrites call sites in admin.js, found ${matches.length}`);
  });

  it('admin.js tm_misparse_unstamp (a null CLEAR inside an already-ledgered reversal) is deliberately NOT instrumented', () => {
    const src = readStripped('api/admin.js');
    // Anchor on the reversal's own distinctive literal, not a line number.
    const idx = src.indexOf('tm_misparse_unstamp');
    assert.ok(idx >= 0, 'the tm_misparse_unstamp reversal block must still exist for this assertion to mean anything');
    const window = src.slice(idx, idx + 1500);
    assert.doesNotMatch(window, /recordContactFieldWrites/,
      'a CLEAR performed as part of an already-ledgered reversal must not be recorded as a source write');
  });

  it('lease-extractor.js writeEntityContact keeps its documented BD-graph-enrichment exemption', () => {
    const src = readStripped('api/_handlers/lease-extractor.js');
    const idx = src.indexOf('writeEntityContact');
    assert.ok(idx >= 0, 'writeEntityContact must still exist for this assertion to mean anything');
    const window = src.slice(idx, idx + 1500);
    assert.doesNotMatch(window, /recordContactFieldWrites/,
      'writeEntityContact is deliberately exempt (BD-graph enrichment, not a curated-table write) — ' +
      'CONTACT1b confirmed the reasoning rather than re-deciding it');
  });
});
