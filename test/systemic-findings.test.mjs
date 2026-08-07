// W8 U4 (Prompt 70) — Systemic-findings monthly report. Unit tests for the PURE
// deterministic aggregator (one per section, over fixture data), the W7.2-style
// FIGURE VALIDATOR (match/mismatch/regenerate), the snapshot/delta mechanism, and
// structural guards proving the tick opens a research_task (NOT a new review lane),
// the migration registers the flag OFF + the monthly cron, and no fabricated number
// can survive the validator.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  num, pct, computeDelta, severityByCount, fixUnitForSignature, FIX_UNIT_CATALOGUE,
  buildIngestFailureSection, buildFlowFailureSection, buildProvenanceSection,
  buildChainSection, buildPrecisionFloorSection, buildLaneThroughputSection,
  buildNamingHygieneSection, buildExtractionSection, PROV_UNRANKED_BASELINE,
  assembleReport, collectComputedValues, extractProseNumbers, validateFigures,
  normalizeNumberToken, buildNarrativePrompt, parseNarrativeJson,
  renderFindingsDoc, renderFixUnitStubs,
} from '../api/_shared/systemic-findings.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
describe('helpers', () => {
  it('num coerces safely', () => {
    assert.equal(num('42'), 42); assert.equal(num(null), 0); assert.equal(num('x'), 0); assert.equal(num(3.5), 3.5);
  });
  it('pct rounds to one decimal and guards zero denominator', () => {
    assert.equal(pct(1, 4), 25); assert.equal(pct(1, 3), 33.3); assert.equal(pct(5, 0), 0);
  });
  it('computeDelta returns null delta with no baseline', () => {
    assert.deepEqual(computeDelta(10, null), { delta: null, prev: null, direction: 'new' });
    assert.deepEqual(computeDelta(10, 4), { delta: 6, prev: 4, direction: 'up' });
    assert.deepEqual(computeDelta(4, 10), { delta: -6, prev: 10, direction: 'down' });
    assert.deepEqual(computeDelta(4, 4), { delta: 0, prev: 4, direction: 'flat' });
  });
  it('severityByCount ladders deterministically', () => {
    assert.equal(severityByCount(0), 'info');
    assert.equal(severityByCount(1), 'low');
    assert.equal(severityByCount(60), 'medium');
    assert.equal(severityByCount(600), 'high');
    assert.equal(severityByCount(5000), 'critical');
  });
});

describe('fix-unit catalogue', () => {
  it('maps known error codes to a fix-unit one-liner', () => {
    assert.match(fixUnitForSignature('PGRST204', 400), /column drift/i);
    assert.match(fixUnitForSignature('23505', 409), /collision/i);
    assert.match(fixUnitForSignature('23503', 409), /FK violation/i);
    assert.ok(FIX_UNIT_CATALOGUE['42P10']);
  });
  it('unknown labels get a generic caller-trace stub (never a guessed root cause)', () => {
    const s = fixUnitForSignature('propagateToDomainDbDirect:x', 400);
    assert.match(s, /trace this caller path/i);
    assert.match(s, /propagateToDomainDbDirect:x/);
  });
  it('null label ⇒ no fix-unit', () => { assert.equal(fixUnitForSignature('', 400), null); });
});

// ---------------------------------------------------------------------------
describe('section builders (fixtures)', () => {
  it('ingest failures: totals + top-N clusters + fix-units + severity', () => {
    const clusters = [
      { domain: 'dialysis', http_status: 400, label: 'PGRST204', cnt: 3722 },
      { domain: 'dialysis', http_status: 409, label: '23505', cnt: 1837 },
      { domain: 'government', http_status: 400, label: '42P10', cnt: 243 },
    ];
    const s = buildIngestFailureSection(clusters, { iwf_total: 11890, iwf_30d: 11866 }, null);
    assert.equal(s.key, 'ingest_failures');
    assert.equal(s.code_error, true);
    const total = s.findings.find((f) => f.metric === 'ingest_write_failures_total');
    assert.equal(total.value, 11890);
    assert.equal(total.severity, 'critical');
    assert.equal(s.clusters.length, 3);
    assert.match(s.clusters[0].fix_unit, /column drift/i);
    assert.equal(s.clusters[0].severity, 'critical');
  });
  it('ingest failures respect topN', () => {
    const clusters = Array.from({ length: 20 }, (_, i) => ({ domain: 'd', http_status: 400, label: 'L' + i, cnt: 100 - i }));
    const s = buildIngestFailureSection(clusters, { iwf_total: 999, iwf_30d: 999 }, null, { topN: 5 });
    assert.equal(s.clusters.length, 5);
  });
  it('flow failures: totals + unresolved + per-flow fix-units', () => {
    const s = buildFlowFailureSection(
      [{ flow_name: 'Unflag Completed Email Tasks', error_kind: 'has_failed', cnt: 524 }],
      { frf_total: 829, frf_unresolved: 1 }, null);
    assert.equal(s.findings.find((f) => f.metric === 'flow_run_failures_total').value, 829);
    assert.match(s.clusters[0].fix_unit, /Power Automate flow/i);
  });
  it('provenance: drift above baseline is high + code_error; at baseline is info', () => {
    const at = buildProvenanceSection({ unranked: 33, conflicts: 1156 }, null);
    assert.equal(at.findings[0].severity, 'info');
    assert.equal(at.code_error, false);
    const drift = buildProvenanceSection({ unranked: 40, conflicts: 10 }, null);
    assert.equal(drift.findings[0].severity, 'high');
    assert.equal(drift.code_error, true);
    assert.match(drift.findings[0].fix_unit, /field_source_priority/);
    assert.equal(PROV_UNRANKED_BASELINE, 33);
  });
  it('chain: complete_pct + incomplete + U3 drain from health details', () => {
    const s = buildChainSection({ total: 3783, complete: 311, incomplete: 3472,
      gaps: [{ seg: 'no_prior_owners_recorded', cnt: 2179 }, { seg: 'complete', cnt: 311 }],
      u3: { open_proposals: 5, applied_total: 2 } }, null);
    assert.equal(s.findings.find((f) => f.metric === 'ownership_chains_incomplete').value, 3472);
    assert.equal(s.findings.find((f) => f.metric === 'ownership_chain_complete_pct').value, pct(311, 3783));
    assert.equal(s.findings.find((f) => f.metric === 'u3_link_proposals_open').value, 5);
    // 'complete' gap is filtered from the gap clusters.
    assert.ok(!s.clusters.some((c) => /complete/.test(c.metric)));
  });
  it('precision floors: drop ratio is informational, not an alarm', () => {
    const s = buildPrecisionFloorSection({ deal_dropped: 8, u3_dropped: 3, u3_open: 5, u3_applied: 2 }, null);
    assert.ok(s.findings.every((f) => f.severity === 'info'));
    assert.equal(s.findings.find((f) => f.metric === 'u3_link_proposals_dropped').value, 3);
  });
  it('lane throughput: junk accept rate + U2 label seeding', () => {
    const s = buildLaneThroughputSection({
      junk: [{ status: 'confirmed', cnt: 8 }, { status: 'dismissed', cnt: 2 }, { status: 'proposed', cnt: 5 }],
      dup: [{ status: 'proposed', cnt: 4 }],
      labels: [{ seeder: 'w8_u2_ollama_pair', verdict: 'same_party', cnt: 3 }, { seeder: 'sf_link_review', verdict: 'distinct', cnt: 40 }],
    }, null);
    assert.equal(s.findings.find((f) => f.metric === 'junk_review_human_accept_pct').value, pct(8, 10));
    assert.equal(s.findings.find((f) => f.metric === 'entity_match_labels_from_u2').value, 3);
  });
  it('naming hygiene: null source is honest zero + note', () => {
    const s = buildNamingHygieneSection(null, null);
    assert.equal(s.findings[0].value, 0);
    assert.match(s.note, /No U1 apply-pass snapshot/);
    const s2 = buildNamingHygieneSection({ total: 6500, known_abbreviation: 4000, address_as_name: 2500 }, null);
    assert.equal(s2.findings[0].value, 6500);
  });
  it('extraction: low stamp coverage is a medium code-error fix-unit', () => {
    const s = buildExtractionSection({ total_30d: 567, stamped: 2, ollama: 2, fell_back: 0 }, null);
    const stamped = s.findings.find((f) => f.metric === 'extraction_provider_stamped');
    assert.equal(stamped.severity, 'medium');
    assert.match(stamped.fix_unit, /_provider stamp/);
  });
});

// ---------------------------------------------------------------------------
describe('assembleReport + month-over-month deltas', () => {
  const inputs = {
    ingest_clusters: [{ domain: 'd', http_status: 400, label: 'PGRST204', cnt: 100 }],
    flow_clusters: [{ flow_name: 'F', error_kind: 'has_failed', cnt: 10 }],
    windows: { iwf_total: 100, iwf_30d: 100, frf_total: 10, frf_unresolved: 0 },
    provenance: { unranked: 33, conflicts: 5 },
    chain: { total: 10, complete: 4, incomplete: 6, gaps: [], u3: {} },
    precision: { deal_dropped: 1, u3_dropped: 0, u3_open: 0, u3_applied: 0 },
    lanes: { junk: [], dup: [], labels: [] },
    naming_hygiene: null,
    extraction: { total_30d: 10, stamped: 10, ollama: 10, fell_back: 0 },
  };
  it('assembles 8 sections + flattened findings + severity totals', () => {
    const r = assembleReport(inputs, { period: '2026-08', now: '2026-08-07T00:00:00Z' });
    assert.equal(r.sections.length, 8);
    assert.equal(r.totals.sections, 8);
    assert.ok(r.totals.findings > 0);
    assert.ok(r.totals.by_severity);
  });
  it('delta is null in month 1, computed in month 2 from prior sections', () => {
    const m1 = assembleReport(inputs, { period: '2026-08' });
    const t1 = m1.sections[0].findings.find((f) => f.metric === 'ingest_write_failures_total');
    assert.equal(t1.delta, null);
    const inputs2 = { ...inputs, windows: { ...inputs.windows, iwf_total: 150, iwf_30d: 150 } };
    const m2 = assembleReport(inputs2, { period: '2026-09', prevSections: m1.sections });
    const t2 = m2.sections[0].findings.find((f) => f.metric === 'ingest_write_failures_total');
    assert.equal(t2.value, 150);
    assert.equal(t2.delta, 50);
    assert.equal(t2.prev, 100);
  });
});

// ---------------------------------------------------------------------------
describe('figure validator (W7.2-style)', () => {
  const report = assembleReport({
    ingest_clusters: [{ domain: 'd', http_status: 400, label: 'PGRST204', cnt: 3722 }],
    flow_clusters: [], windows: { iwf_total: 11890, iwf_30d: 11866, frf_total: 829, frf_unresolved: 1 },
    provenance: { unranked: 33, conflicts: 1156 },
    chain: { total: 3783, complete: 311, incomplete: 3472, gaps: [], u3: {} },
    precision: { deal_dropped: 8, u3_dropped: 0, u3_open: 0, u3_applied: 0 },
    lanes: { junk: [], dup: [], labels: [] }, naming_hygiene: null,
    extraction: { total_30d: 567, stamped: 2, ollama: 2, fell_back: 0 },
  }, { period: '2026-08' });
  const computed = collectComputedValues(report);

  it('extractProseNumbers pulls currency/percent/int, ignores ISO dates', () => {
    const nums = extractProseNumbers('On 2026-08-07 there were 11,890 failures, $3,722 and 33% of 567.');
    const norm = nums.map(normalizeNumberToken);
    assert.ok(norm.includes('11890'));
    assert.ok(norm.includes('3722'));
    assert.ok(norm.includes('33'));
    assert.ok(norm.includes('567'));
    assert.ok(!norm.includes('2026')); // date stripped
  });
  it('passes prose that uses ONLY computed numbers', () => {
    const prose = 'There were 11890 ingest write failures (11866 in 30 days) and 1156 conflicts. 3472 chains are incomplete.';
    const v = validateFigures(prose, computed);
    assert.equal(v.ok, true, JSON.stringify(v.unmatched));
  });
  it('flags a fabricated number not in the computed set', () => {
    const prose = 'There were 11890 failures but really 99999 records were corrupted.';
    const v = validateFigures(prose, computed);
    assert.equal(v.ok, false);
    assert.ok(v.unmatched.includes('99999'));
  });
  it('allows commas + $ + % formatting of a computed value', () => {
    const v = validateFigures('Total was 11,890 across the platform.', computed);
    assert.equal(v.ok, true);
  });
  it('allows period parts + small window constants', () => {
    const v = validateFigures('In 2026-08 over the last 30 days, top 3 clusters.', computed);
    assert.equal(v.ok, true);
  });
});

// ---------------------------------------------------------------------------
describe('narrative prompt + parse', () => {
  it('prompt forbids inventing numbers and lists computed values', () => {
    const r = assembleReport({ ingest_clusters: [], flow_clusters: [], windows: {},
      provenance: { unranked: 33, conflicts: 0 }, chain: { total: 0, complete: 0, incomplete: 0, gaps: [], u3: {} },
      precision: {}, lanes: {}, naming_hygiene: null, extraction: {} }, { period: '2026-08' });
    const p = buildNarrativePrompt(r);
    assert.match(p, /ONLY numbers that appear/i);
    assert.match(p, /STRICT JSON/);
    assert.match(p, /2026-08/);
  });
  it('parseNarrativeJson tolerates ```json fences', () => {
    const j = parseNarrativeJson('```json\n{"executive_summary":"x","sections":{"chain":"y"}}\n```');
    assert.equal(j.executive_summary, 'x');
    assert.equal(j.sections.chain, 'y');
  });
  it('parseNarrativeJson returns null on garbage', () => {
    assert.equal(parseNarrativeJson('not json'), null);
  });
});

// ---------------------------------------------------------------------------
describe('doc renderer', () => {
  const report = assembleReport({
    ingest_clusters: [{ domain: 'd', http_status: 400, label: 'PGRST204', cnt: 3722 }],
    flow_clusters: [], windows: { iwf_total: 3722, iwf_30d: 3722 },
    provenance: { unranked: 40, conflicts: 5 },
    chain: { total: 10, complete: 4, incomplete: 6, gaps: [], u3: {} },
    precision: {}, lanes: {}, naming_hygiene: null, extraction: {},
  }, { period: '2026-08' });
  it('renders a stock header when narrative is null + includes fix-unit stubs', () => {
    const md = renderFindingsDoc(report, null, { generatedAt: '2026-08-07' });
    assert.match(md, /# Systemic-findings report — 2026-08/);
    assert.match(md, /Deterministic summary/);
    assert.match(md, /Candidate fix-units/);
    assert.match(md, /the doc IS the consumer/i);
  });
  it('uses the model narrative when provided', () => {
    const md = renderFindingsDoc(report, { executive_summary: 'EXEC', sections: { provenance: 'PROV' } }, {});
    assert.match(md, /EXEC/);
    assert.match(md, /PROV/);
  });
  it('renderFixUnitStubs de-dupes + orders most-severe first', () => {
    const stubs = renderFixUnitStubs(report);
    assert.match(stubs, /1\. \*\*/);
    assert.match(stubs, /PGRST204/);
  });
});

// ---------------------------------------------------------------------------
describe('structural guards — no new lane, flag off, monthly cron', () => {
  const admin = readFileSync(join(root, 'api/admin.js'), 'utf8');
  const server = readFileSync(join(root, 'server.js'), 'utf8');
  const mig = readFileSync(join(root, 'supabase/migrations/20260807190000_lcc_w8_u4_systemic_findings.sql'), 'utf8');

  it('tick is mounted + dispatched', () => {
    assert.match(server, /\/api\/systemic-findings-tick/);
    assert.match(admin, /case 'systemic-findings-tick':\s*return handleSystemicFindingsTick/);
  });
  it('the consumer is a research_task, NOT a new Decision-Center lane', () => {
    // opens a research task…
    assert.match(admin, /openResearchTask\(/);
    assert.match(admin, /research_type: 'systemic_findings_report'|researchType: 'systemic_findings_report'/);
    // …and does NOT register a federated decision type for U4 (no line that
    // references the federated-lane list mentions a systemic-findings lane).
    const fedLines = admin.split('\n').filter((l) => /FEDERATED_DECISION_TYPES|_DC_FEDERATED/.test(l));
    assert.ok(!fedLines.some((l) => /systemic_findings|w8_u4/.test(l)),
      'U4 must not register a Decision-Center lane');
  });
  it('narrative is figure-validated before it can ship', () => {
    assert.match(admin, /validateFigures|draftSystemicNarrative/);
    assert.match(admin, /collectComputedValues/);
  });
  it('migration registers the flag OFF in-migration (36y) + monthly cron', () => {
    assert.match(mig, /W8_U4_FINDINGS_REPORT/);
    assert.match(mig, /'off'/);
    assert.match(mig, /'0 5 1 \* \*'/);          // monthly, 1st, 05:00 UTC
    assert.match(mig, /lcc_w8_u4_findings_snapshot/);
    assert.match(mig, /v_lcc_w8_u4_findings_health/);
  });
  it('the snapshot table is the delta baseline (period UNIQUE)', () => {
    assert.match(mig, /period\s+text NOT NULL UNIQUE/);
  });
});
