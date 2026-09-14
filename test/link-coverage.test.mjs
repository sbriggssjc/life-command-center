// W9.5 (Prompt 97) — link-coverage planner tests. Pure builders on fixtures,
// snapshot/delta, U4 Connectedness section wiring + regression severity, plus
// read-only structural guards (this unit writes NOTHING except its snapshot).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  coveragePct, linkMetric, coverageRow, assembleCoverage,
  buildConnectednessSection, renderCoverageDoc, producerForLink,
} from '../api/_shared/link-coverage.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Live-grounded fixture rows (2026-08-12).
const RAW = [
  { link_name: 'recorded_to_true', domain: 'dia', group: 'chain', total: 7212, linked: 7100 },
  { link_name: 'true_to_contact', domain: 'dia', group: 'chain', total: 7107, linked: 2280 },
  { link_name: 'contact_to_sf_contact_id', domain: 'gov', group: 'chain', total: 15669, linked: 905 },
  { link_name: 'cross_domain_contacts_resolved', domain: 'lcc', group: 'mirror', total: 0, linked: 0 },
  { link_name: 'correspondence_entity_owner_llc', domain: 'lcc', group: 'correspondence', total: 241, linked: 6 },
];

describe('coveragePct', () => {
  it('one decimal; null denominator ⇒ null (uncounted, not 0%)', () => {
    assert.equal(coveragePct(7100, 7212), 98.4);
    assert.equal(coveragePct(0, 0), null);
    assert.equal(coveragePct(5, 0), null);
    assert.equal(coveragePct(6, 241), 2.5);
  });
});

describe('coverageRow', () => {
  it('measured=false when total<=0; pct null; direction new', () => {
    const r = coverageRow({ link_name: 'x', domain: 'lcc', total: 0, linked: 0 });
    assert.equal(r.measured, false);
    assert.equal(r.pct, null);
    assert.equal(r.regressed, false);
  });
  it('computes delta vs prior row and flags a regression on a DROP', () => {
    const prev = { link_name: 'true_to_contact', domain: 'dia', pct: 40.0 };
    const r = coverageRow({ link_name: 'true_to_contact', domain: 'dia', total: 7107, linked: 2280 }, prev);
    assert.equal(r.pct, 32.1);
    assert.equal(r.delta_pct, -7.9);
    assert.equal(r.direction, 'down');
    assert.equal(r.regressed, true);
  });
  it('an IMPROVEMENT is up and not a regression', () => {
    const prev = { link_name: 'true_to_contact', domain: 'dia', pct: 20.0 };
    const r = coverageRow({ link_name: 'true_to_contact', domain: 'dia', total: 7107, linked: 2280 }, prev);
    assert.equal(r.direction, 'up');
    assert.equal(r.regressed, false);
  });
});

describe('assembleCoverage', () => {
  it('unifies rows, tallies measured/regressed, finds weakest link', () => {
    const cov = assembleCoverage(RAW, { period: '2026-08' });
    assert.equal(cov.links.length, 5);
    assert.equal(cov.totals.measured, 4); // cross_domain_contacts (total 0) is unmeasured
    assert.equal(cov.totals.unmeasured, 1);
    // weakest measured pct is correspondence_entity_owner_llc @ 2.5%
    assert.equal(cov.totals.weakest_link.link, 'correspondence_entity_owner_llc');
    assert.equal(cov.totals.weakest_link.pct, 2.5);
  });
  it('deltas come from the prior snapshot links (matched by domain+link)', () => {
    const m1 = assembleCoverage(RAW, { period: '2026-08' });
    // month 2: dia true_to_contact drops 2280→2000
    const raw2 = RAW.map((r) => (r.link_name === 'true_to_contact' && r.domain === 'dia')
      ? { ...r, linked: 2000 } : r);
    const m2 = assembleCoverage(raw2, { period: '2026-09', prevLinks: m1.links });
    const l = m2.links.find((x) => x.link_name === 'true_to_contact' && x.domain === 'dia');
    assert.equal(l.prev_pct, 32.1);
    assert.equal(l.pct, 28.1);
    assert.ok(l.delta_pct < 0);
    assert.equal(l.regressed, true);
    assert.equal(m2.totals.regressed, 1);
    assert.equal(m2.totals.worst_regression.link, 'true_to_contact');
  });
});

describe('buildConnectednessSection (U4 wiring)', () => {
  it('one info finding per link in month 1 (no baseline ⇒ no regression)', () => {
    const cov = assembleCoverage(RAW, { period: '2026-08' });
    const sec = buildConnectednessSection(cov, null);
    assert.equal(sec.key, 'connectedness');
    assert.equal(sec.findings.length, 5);
    assert.ok(sec.findings.every((f) => f.severity === 'info'));
    assert.equal(sec.code_error, false);
    // metric label shape
    assert.ok(sec.findings.some((f) => f.metric === linkMetric('dia', 'recorded_to_true')));
    // unmeasured link renders value 'n/a'
    const na = sec.findings.find((f) => f.metric === linkMetric('lcc', 'cross_domain_contacts_resolved'));
    assert.equal(na.value, 'n/a');
  });
  it('a DROP vs the prior U4 section ⇒ high severity + a fix-unit naming the link', () => {
    const cov = assembleCoverage(RAW, { period: '2026-08' });
    const prevSection = {
      key: 'connectedness',
      findings: [{ metric: linkMetric('dia', 'true_to_contact'), value: 40.0 }],
    };
    const sec = buildConnectednessSection(cov, prevSection);
    const dropped = sec.findings.find((f) => f.metric === linkMetric('dia', 'true_to_contact'));
    assert.equal(dropped.severity, 'high');
    assert.ok(dropped.delta < 0);
    assert.match(dropped.fix_unit, /Propagation regression/);
    assert.match(dropped.fix_unit, /true_to_contact/);
    assert.equal(sec.code_error, true); // regression yields a ready fix-unit stub
  });
  it('null coverage ⇒ honest empty section, never throws', () => {
    const sec = buildConnectednessSection(null, null);
    assert.equal(sec.findings.length, 0);
    assert.match(sec.note, /uncounted/);
  });
});

describe('producerForLink + renderCoverageDoc', () => {
  it('names a known producer, generic stub otherwise', () => {
    assert.match(producerForLink('true_to_sf'), /SF/);
    assert.match(producerForLink('unknown_link'), /writer that fills/);
  });
  it('renders a deterministic markdown table', () => {
    const cov = assembleCoverage(RAW, { period: '2026-08' });
    const md = renderCoverageDoc(cov, { generatedAt: '2026-08-12T00:00:00Z' });
    assert.match(md, /# Link-coverage — 2026-08/);
    assert.match(md, /recorded_to_true/);
    assert.match(md, /Read-only measure/);
  });
});

// ---------------------------------------------------------------------------
describe('W9.5 structural guards — read-only, unified view, no flag/lane', () => {
  const admin = readFileSync(join(root, 'api/admin.js'), 'utf8');
  const server = readFileSync(join(root, 'server.js'), 'utf8');
  const lccMig = readFileSync(join(root, 'supabase/migrations/20260828120000_lcc_w9_5_link_coverage.sql'), 'utf8');
  const diaMig = readFileSync(join(root, 'supabase/migrations/dialysis/20260828120000_dia_w9_5_chain_coverage.sql'), 'utf8');
  const govMig = readFileSync(join(root, 'supabase/migrations/government/20260828120000_gov_w9_5_chain_coverage.sql'), 'utf8');

  it('the tick is mounted in server.js and dispatched in admin.js', () => {
    assert.match(server, /\/api\/link-coverage-tick/);
    assert.match(admin, /case 'link-coverage-tick':\s*return handleLinkCoverageTick/);
  });
  it('the ONLY write is the snapshot upsert — no domain PATCH/POST to owner tables', () => {
    // Isolate the coverage handler + its helpers (up to the U4 section header).
    const start = admin.indexOf('async function fetchDomainChainCoverage');
    const end = admin.indexOf('// W8 U4 (Prompt 70) — Systemic-findings monthly report tick.');
    const block = admin.slice(start, end);
    assert.ok(start > 0 && end > start, 'coverage block located');
    // The lone write path is the snapshot table upsert.
    assert.match(block, /lcc_w9_5_link_coverage_snapshot\?on_conflict=period/);
    // No writes to any domain owner/contact table from this unit.
    assert.doesNotMatch(block, /domainQuery\([^,]+,\s*'(POST|PATCH|DELETE)'/);
  });
  it('coverage reads use SELECT-only GETs against the coverage views', () => {
    const start = admin.indexOf('async function fetchDomainChainCoverage');
    const end = admin.indexOf('async function fetchMirrorRows');
    const block = admin.slice(start, end);
    assert.match(block, /v_' \+ dom \+ '_w9_5_chain_coverage/);
    assert.match(block, /v_lcc_w9_5_link_coverage/);
  });
  it('migrations add the unified view + snapshot, no feature flag, no cron', () => {
    assert.match(lccMig, /CREATE OR REPLACE VIEW public\.v_lcc_w9_5_link_coverage/);
    assert.match(lccMig, /CREATE TABLE IF NOT EXISTS public\.lcc_w9_5_link_coverage_snapshot/);
    assert.match(lccMig, /period\s+text NOT NULL UNIQUE/);
    // Read-only measure: no flag registered, no second cron scheduled.
    assert.doesNotMatch(lccMig, /feature_flags_registry/);
    assert.doesNotMatch(lccMig, /cron\.schedule/);
  });
  it('domain views project counts-only (link_name,total,linked,pct) and grant anon', () => {
    for (const m of [diaMig, govMig]) {
      assert.match(m, /GRANT SELECT.*TO anon/);
      // The OUTER projection (the view's exposed columns) is counts-only — no
      // owner/contact identity column reaches a consumer. Isolate the final SELECT.
      const proj = m.slice(m.lastIndexOf('SELECT link_name'), m.indexOf('FROM links'));
      assert.ok(proj.length > 0, 'final projection located');
      assert.match(proj, /link_name/);
      assert.match(proj, /total/);
      assert.match(proj, /linked/);
      assert.match(proj, /pct/);
      assert.doesNotMatch(proj, /\b(email|phone|owner_name|contact_name|address)\b/i);
    }
  });
});
