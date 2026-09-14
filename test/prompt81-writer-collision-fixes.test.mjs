// Prompt 81 — Ops cleanup: zombie-flow logging + dedup/FK/ON-CONFLICT writer
// fixes. Structural + behavioral regression guards proving each of the five
// items stays fixed (the writers keep colliding again silently otherwise).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// ── Item 1: flow-failure clusters count only OPEN (resolved_at IS NULL) rows ──
describe('item 1 — U4 flow cluster view ignores resolved/retired-flow rows', () => {
  const mig = read('supabase/migrations/20260808130000_lcc_prompt81_flow_cluster_resolved_filter.sql');
  it('the migration filters resolved_at IS NULL', () => {
    assert.match(mig, /CREATE OR REPLACE VIEW public\.v_lcc_w8_u4_flow_failure_clusters/);
    assert.match(mig, /WHERE\s+resolved_at IS NULL/);
  });
  it('output columns are unchanged so admin.js reader is unaffected', () => {
    for (const c of ['flow_name', 'error_kind', 'error_code', 'cnt', 'cnt_30d', 'last_seen']) {
      assert.match(mig, new RegExp(c));
    }
  });
});

// ── Item 4: gov 42P10 ON CONFLICT fixes ──────────────────────────────────────
describe('item 4 — 42P10 ON CONFLICT inference mismatches removed', () => {
  it('intake-document-notify upserts on the REAL index (property_id,file_name), not content_hash', () => {
    const src = read('api/_handlers/intake-document-notify.js');
    assert.ok(!src.includes('on_conflict=property_id,content_hash'),
      'the non-existent (property_id,content_hash) on_conflict must be gone');
    assert.match(src, /on_conflict=property_id,file_name/);
  });
  it('gov available_listings no longer upserts on the non-inferable PARTIAL index', () => {
    const src = read('api/_handlers/sidebar-pipeline.js');
    assert.ok(!src.includes('available_listings?on_conflict=property_id,listing_source,listing_status,listing_date'),
      'the partial-index on_conflict upsert must be replaced with a plain insert + race fallback');
    assert.match(src, /upsertGovListings:raceMerge/);
  });
});

// ── Items 2 & 5: 23505 dedup-respect folds ───────────────────────────────────
describe('items 2 & 5 — 23505 collisions fold into the dedup path', () => {
  const sidebar = read('api/_handlers/sidebar-pipeline.js');
  it('domainQuery supports suppressFailureCodes for handled collisions', () => {
    const dd = read('api/_shared/domain-db.js');
    assert.match(dd, /suppressFailureCodes/);
    // Handled codes are NOT recorded as ingest_write_failures.
    assert.match(dd, /opts\.suppressFailureCodes\.includes\(pgCode\)/);
  });
  it('sidebar contact inserts go through the dedup-respect helper', () => {
    assert.match(sidebar, /async function insertContactOrReuse/);
    assert.match(sidebar, /async function patchContactSafe/);
    // No raw contacts POST remains on the four upsertSidebarContacts sites.
    assert.ok(!/const r = await domainQuery\(domain, 'POST', 'contacts', row\);/.test(sidebar),
      'raw contact INSERTs must route through insertContactOrReuse');
  });
  it('contact reuse fill-blanks never re-writes a unique column (email/phone/name)', () => {
    // _contactFillFields lists only non-unique descriptive columns.
    assert.match(sidebar, /function _contactFillFields\(col\)\s*\{\s*return \['company', 'title', 'website', 'address', 'city', 'state', col\.role\]/);
  });
  it('property_documents plain fallbacks fold via on_conflict merge (not a bare INSERT)', () => {
    for (const p of ['api/_handlers/property-doc-writeback.js',
                     'api/_handlers/intake-promoter.js']) {
      const s = read(p);
      assert.ok(!/'POST', 'property_documents', (base|row)\)/.test(s),
        `${p}: bare property_documents INSERT fallback must be gone`);
    }
    // sidebar doc-links fallback also folds + suppresses.
    assert.match(sidebar, /property_documents\?on_conflict=property_id,file_name', row,[\s\S]*?suppressFailureCodes: \['23505'\]/);
  });
  it('recorded_owner + true_owner collisions refetch by the CONSTRAINT key and suppress', () => {
    // recorded_owners POST suppresses + refetches by the exact colliding key.
    assert.match(sidebar, /'POST', 'recorded_owners', ownerData,[\s\S]*?suppressFailureCodes: \['23505'\]/);
    assert.match(sidebar, /Key \\\(\(\[\^\)\]\+\)\\\)=\\\(\(\[\^\)\]\*\)\\\)/);
    // gov + dia true_owners fresh-insert paths fold on 23505.
    assert.match(sidebar, /ensureTrueOwner:createFresh/);
    assert.match(sidebar, /ensureTrueOwner:dia/);
  });
});

// ── Item 3: 23503 property_documents FK guard ────────────────────────────────
describe('item 3 — property_documents writes guard the FK parent', () => {
  it('domain-db exports domainPropertyExists', async () => {
    const dd = read('api/_shared/domain-db.js');
    assert.match(dd, /export async function domainPropertyExists/);
  });
  it('insertLccDocument + attachEnrichDocument skip cleanly on a dangling property_id', () => {
    const wb = read('api/_handlers/property-doc-writeback.js');
    const pr = read('api/_handlers/intake-promoter.js');
    assert.match(wb, /domainPropertyExists\(domain, base\.property_id\)/);
    assert.match(wb, /skipped: 'missing_property'/);
    assert.match(pr, /domainPropertyExists\(domain, base\.property_id\)/);
    assert.match(pr, /skipped: 'missing_property'/);
  });
});

// ── Behavioral: domainPropertyExists is proceed-on-unknown ───────────────────
describe('domainPropertyExists contract', () => {
  it('returns null (unknown → caller proceeds) when the domain is not configured', async () => {
    // No DIA/GOV creds in this test env → domainQuery short-circuits to 503,
    // which must map to null, never a false "absent" that drops a write.
    delete process.env.DIA_SUPABASE_URL;
    delete process.env.GOV_SUPABASE_URL;
    const { domainPropertyExists } = await import('../api/_shared/domain-db.js');
    assert.equal(await domainPropertyExists('dialysis', 12345), null);
    assert.equal(await domainPropertyExists('government', ''), null);
    assert.equal(await domainPropertyExists('dialysis', null), null);
  });
});
