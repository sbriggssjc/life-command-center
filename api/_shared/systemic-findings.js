// ============================================================================
// W8 U4 (Prompt 70, 2026-08-07) — Systemic-findings monthly report: the pure,
// deterministic aggregator + the W7.2-style figure validator + the doc renderer.
//
// The hygiene campaign's REPORTING layer. U1/U2/U3 each emit a signal stream that
// is logged but never synthesized; this unit aggregates those streams (plus the
// pre-existing ingest/flow failure logs, provenance drift, chain completeness, and
// extraction health) into ONE monthly "systemic defects" document that feeds the
// W6.6 audit.
//
// DOCTRINE (non-negotiable, mirrors W7.2):
//   * NUMBERS ARE COMPUTED DETERMINISTICALLY here (no LLM). Every figure in the
//     report is a plain aggregation of rows the DB already holds.
//   * Ollama drafts ONLY the narrative prose FROM the computed table. A figure
//     validator (validateFigures) checks that every number in the prose appears in
//     the computed value set — a mismatch means the model fabricated/mangled a
//     number, so the narrative is regenerated once and then dropped in favour of a
//     stock header + the raw tables. NEVER ship a fabricated number.
//
// This module is PURE (no IO, no Date.now) so it is fully fixture-testable. The
// admin.js tick handler does the DB reads (opsQuery over the pre-grouped U4 views)
// and passes raw section inputs in; timestamps are injected.
// ============================================================================

import { buildConnectednessSection } from './link-coverage.js';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
export function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

export function pct(n, d) {
  const den = num(d);
  if (den <= 0) return 0;
  return Math.round((num(n) / den) * 1000) / 10; // one decimal
}

// Month-over-month delta vs the prior snapshot's value for the same metric.
// prev === null/undefined ⇒ no prior month ⇒ delta null (honest: "no baseline yet").
export function computeDelta(current, prev) {
  if (prev == null) return { delta: null, prev: null, direction: 'new' };
  const d = num(current) - num(prev);
  return { delta: d, prev: num(prev), direction: d > 0 ? 'up' : d < 0 ? 'down' : 'flat' };
}

// Severity heuristic. Deterministic thresholds per section — NO LLM. The report is
// an operator triage sheet; severity is "how loudly should a human look at this".
export const SEVERITY = ['info', 'low', 'medium', 'high', 'critical'];

export function severityByCount(count, { medium = 50, high = 500, critical = 2000 } = {}) {
  const c = num(count);
  if (c >= critical) return 'critical';
  if (c >= high) return 'high';
  if (c >= medium) return 'medium';
  if (c > 0) return 'low';
  return 'info';
}

// ---------------------------------------------------------------------------
// Fix-unit catalogue: a systemic ERROR SIGNATURE → a ready-to-send Claude Code
// prompt one-liner ("candidate fix-unit"). Deterministic string map keyed by the
// error label / code. Unknown signatures get a generic stub, never a guess at the
// root cause.
// ---------------------------------------------------------------------------
export const FIX_UNIT_CATALOGUE = {
  PGRST204: 'Schema/column drift — a writer sends a field the target table lacks (PostgREST PGRST204). Fix-unit: audit the named domain writer\'s field list against the live table columns; drop or rename the stray field (fill-blanks-safe).',
  '23505': 'Unique/dedup collision (Postgres 23505) — an INSERT hit a live unique index. Fix-unit: fold the colliding row into the dedup path (mark superseded) instead of aborting the write, per the R37 dedup-respect rule.',
  '23503': 'FK violation (Postgres 23503) — a write references a parent that is missing or was repointed. Fix-unit: move all backrefs onto the survivor BEFORE the delete, or create/resolve the parent first.',
  '42P10': 'ON CONFLICT inference mismatch (Postgres 42P10) — the conflict target does not match a unique index/constraint. Fix-unit: use the index-inference/expression form matching the live unique index (not ON CONSTRAINT).',
  '23P01': 'Exclusion-constraint violation (Postgres 23P01). Fix-unit: check the overlapping-range/partial-index guard the writer must respect before insert.',
  '42703': 'Undefined column (Postgres 42703) — a query names a column that does not exist (schema drift). Fix-unit: reconcile the writer/query column list with the migration that renamed/added the column.',
};

export function fixUnitForSignature(label, httpStatus) {
  if (!label) return null;
  const key = String(label).trim();
  if (FIX_UNIT_CATALOGUE[key]) return FIX_UNIT_CATALOGUE[key];
  // Code-shaped labels (e.g. a caller tag like `propagateToDomainDbDirect:field`)
  // get a generic, honest stub pointing at the caller, not a guessed root cause.
  return 'Recurring write failure at `' + key + '`' + (httpStatus ? ' (HTTP ' + httpStatus + ')' : '')
    + '. Fix-unit: trace this caller path; confirm whether it is a schema drift, a dedup collision, or a stale field, then patch the single writer.';
}

// ---------------------------------------------------------------------------
// Section builders — one per report section. Each is PURE: (raw, prev) → section.
// `prev` is the same section object from the prior monthly snapshot (or null).
// A section shape: { key, title, findings:[{metric,value,delta,severity,fix_unit}],
//                    clusters?:[...], note, code_error }.
// `code_error:true` marks a section whose findings should be rendered as fix-unit
// stubs for Claude Code.
// ---------------------------------------------------------------------------
function prevMetric(prev, metric) {
  if (!prev || !Array.isArray(prev.findings)) return null;
  const m = prev.findings.find((f) => f.metric === metric);
  return m ? num(m.value) : null;
}

export function buildIngestFailureSection(clusters, windows, prev, opts = {}) {
  const topN = opts.topN || 10;
  const rows = Array.isArray(clusters) ? clusters.slice(0, topN) : [];
  const total = windows ? num(windows.iwf_total) : rows.reduce((a, r) => a + num(r.cnt), 0);
  const d30 = windows ? num(windows.iwf_30d) : 0;
  const findings = [{
    metric: 'ingest_write_failures_total', value: total,
    ...computeDelta(total, prevMetric(prev, 'ingest_write_failures_total')),
    severity: severityByCount(total, { medium: 100, high: 1000, critical: 5000 }),
  }, {
    metric: 'ingest_write_failures_30d', value: d30,
    ...computeDelta(d30, prevMetric(prev, 'ingest_write_failures_30d')),
    severity: severityByCount(d30, { medium: 100, high: 1000, critical: 5000 }),
  }];
  const cl = rows.map((r) => {
    const label = r.label || r.error_code || '';
    const metric = [r.domain, r.http_status, label].filter(Boolean).join(' · ');
    return {
      metric, value: num(r.cnt), last_seen: r.last_seen || null,
      severity: severityByCount(r.cnt, { medium: 50, high: 500, critical: 2000 }),
      fix_unit: fixUnitForSignature(label, r.http_status),
    };
  });
  return {
    key: 'ingest_failures', title: 'Ingest write-failure clusters', code_error: true,
    findings, clusters: cl,
    note: total === 0 ? 'No ingest write failures logged.'
      : total + ' ingest write failures logged (' + d30 + ' in the last 30 days); top ' + cl.length + ' error signatures below.',
  };
}

export function buildFlowFailureSection(clusters, windows, prev, opts = {}) {
  const topN = opts.topN || 10;
  const rows = Array.isArray(clusters) ? clusters.slice(0, topN) : [];
  const total = windows ? num(windows.frf_total) : rows.reduce((a, r) => a + num(r.cnt), 0);
  const unresolved = windows ? num(windows.frf_unresolved) : 0;
  const findings = [{
    metric: 'flow_run_failures_total', value: total,
    ...computeDelta(total, prevMetric(prev, 'flow_run_failures_total')),
    severity: severityByCount(total, { medium: 50, high: 300, critical: 1000 }),
  }, {
    metric: 'flow_run_failures_unresolved', value: unresolved,
    ...computeDelta(unresolved, prevMetric(prev, 'flow_run_failures_unresolved')),
    severity: severityByCount(unresolved, { medium: 20, high: 100, critical: 400 }),
  }];
  const cl = rows.map((r) => ({
    metric: [r.flow_name, r.error_kind, r.error_code].filter(Boolean).join(' · '),
    value: num(r.cnt), last_seen: r.last_seen || null,
    severity: severityByCount(r.cnt, { medium: 25, high: 200, critical: 500 }),
    fix_unit: 'Power Automate flow `' + (r.flow_name || '?') + '` recurring failure. Fix-unit: inspect the flow run history for the failing action; a persistent failure is an integration break, not a data defect.',
  }));
  return {
    key: 'flow_failures', title: 'Power Automate flow-run failure clusters', code_error: true,
    findings, clusters: cl,
    note: total === 0 ? 'No flow-run failures logged.'
      : total + ' flow-run failures logged (' + unresolved + ' unresolved); top ' + cl.length + ' flows below.',
  };
}

export const PROV_UNRANKED_BASELINE = 33;

export function buildProvenanceSection(raw, prev) {
  const unranked = num(raw && raw.unranked);
  const conflicts = num(raw && raw.conflicts);
  // Drift ABOVE the known W6.6 baseline (33) is the real signal — a writer added
  // without a field_source_priority row. At/below baseline is expected.
  const drift = Math.max(0, unranked - PROV_UNRANKED_BASELINE);
  const findings = [{
    metric: 'field_provenance_unranked', value: unranked,
    ...computeDelta(unranked, prevMetric(prev, 'field_provenance_unranked')),
    severity: drift > 0 ? 'high' : 'info',
    fix_unit: drift > 0
      ? 'field_provenance drift: ' + unranked + ' unranked (baseline ' + PROV_UNRANKED_BASELINE + '). Fix-unit: a writer/source was added without a field_source_priority row — register the missing (target_table, field_name, source) rows so v_field_provenance_unranked returns to baseline.'
      : null,
  }, {
    metric: 'field_provenance_conflicts', value: conflicts,
    ...computeDelta(conflicts, prevMetric(prev, 'field_provenance_conflicts')),
    severity: severityByCount(conflicts, { medium: 50, high: 500, critical: 2000 }),
  }];
  return {
    key: 'provenance', title: 'Provenance drift + conflicts', code_error: drift > 0,
    findings,
    note: 'Unranked provenance ' + unranked + ' (W6.6 baseline ' + PROV_UNRANKED_BASELINE + ', drift ' + drift + '); '
      + conflicts + ' field-value conflicts pending in the Decision Center provenance lanes.',
  };
}

export function buildChainSection(raw, prev) {
  const total = num(raw && raw.total);
  const complete = num(raw && raw.complete);
  const incomplete = num(raw && raw.incomplete);
  const completePct = pct(complete, total);
  const gaps = Array.isArray(raw && raw.gaps) ? raw.gaps : [];
  // U3 drain (from v_lcc_w8_u3_link_health.details).
  const u3 = (raw && raw.u3) || {};
  const findings = [{
    metric: 'ownership_chains_incomplete', value: incomplete,
    ...computeDelta(incomplete, prevMetric(prev, 'ownership_chains_incomplete')),
    severity: severityByCount(incomplete, { medium: 100, high: 1000, critical: 3000 }),
  }, {
    metric: 'ownership_chain_complete_pct', value: completePct,
    ...computeDelta(completePct, prevMetric(prev, 'ownership_chain_complete_pct')),
    severity: completePct < 25 ? 'high' : completePct < 60 ? 'medium' : 'low',
  }, {
    metric: 'u3_link_proposals_open', value: num(u3.open_proposals),
    ...computeDelta(num(u3.open_proposals), prevMetric(prev, 'u3_link_proposals_open')),
    severity: 'info',
  }, {
    metric: 'u3_link_proposals_applied', value: num(u3.applied_total),
    ...computeDelta(num(u3.applied_total), prevMetric(prev, 'u3_link_proposals_applied')),
    severity: 'info',
  }];
  const gapRows = gaps.filter((g) => (g.seg || g.missing_segments) !== 'complete').map((g) => ({
    metric: 'chain_gap · ' + (g.seg || g.missing_segments || '?'), value: num(g.cnt),
    severity: severityByCount(g.cnt, { medium: 100, high: 1000, critical: 3000 }),
  }));
  return {
    key: 'chain', title: 'Ownership-chain completeness + U3 drain',
    findings, clusters: gapRows,
    note: complete + '/' + total + ' chains complete (' + completePct + '%); ' + incomplete
      + ' incomplete. U3 link-propagation: ' + num(u3.open_proposals) + ' open / ' + num(u3.applied_total) + ' applied.',
  };
}

// Precision floor: the dropped-proposal ratios. A HIGH drop share is a healthy
// validator (it caught fabrication); a report metric, not an alarm — so severity
// stays informational unless a producer is emitting only drops.
export function buildPrecisionFloorSection(raw, prev) {
  const dealDropped = num(raw && raw.deal_dropped);
  const u3Dropped = num(raw && raw.u3_dropped);
  const u3Applied = num(raw && raw.u3_applied);
  const u3Proposed = num(raw && raw.u3_open) + u3Applied;
  const dropRatio = pct(u3Dropped, u3Dropped + u3Proposed);
  const findings = [{
    metric: 'w7_4_deal_analysis_dropped', value: dealDropped,
    ...computeDelta(dealDropped, prevMetric(prev, 'w7_4_deal_analysis_dropped')),
    severity: 'info',
  }, {
    metric: 'u3_link_proposals_dropped', value: u3Dropped,
    ...computeDelta(u3Dropped, prevMetric(prev, 'u3_link_proposals_dropped')),
    severity: 'info',
  }, {
    metric: 'u3_drop_ratio_pct', value: dropRatio,
    ...computeDelta(dropRatio, prevMetric(prev, 'u3_drop_ratio_pct')),
    severity: 'info',
  }];
  return {
    key: 'precision_floors', title: 'Precision floors (validator drop ratios)',
    findings,
    note: 'W7.4 deal-analysis drops: ' + dealDropped + '. U3 link-proposal drops: ' + u3Dropped
      + ' (' + dropRatio + '% of scored). A high drop share = the verbatim validator working, not a defect.',
  };
}

// U1/U2 lane throughput + human accept rates. junk: {status→cnt}; dup: {status→cnt};
// labels: array {seeder, verdict, cnt}.
export function buildLaneThroughputSection(raw, prev) {
  const junk = tallyByStatus(raw && raw.junk);
  const dup = tallyByStatus(raw && raw.dup);
  const labels = Array.isArray(raw && raw.labels) ? raw.labels : [];
  const junkDecided = num(junk.confirmed) + num(junk.dismissed) + num(junk.retired) + num(junk.rejected);
  const junkAccept = pct(num(junk.confirmed) + num(junk.retired), junkDecided);
  const dupDecided = num(dup.same_party) + num(dup.distinct) + num(dup.rejected) + num(dup.dispositioned);
  const ollamaLabels = labels.filter((l) => l.seeder === 'w8_u2_ollama_pair').reduce((a, l) => a + num(l.cnt), 0);
  const findings = [{
    metric: 'junk_review_open', value: num(junk.proposed) + num(junk.open),
    ...computeDelta(num(junk.proposed) + num(junk.open), prevMetric(prev, 'junk_review_open')),
    severity: 'info',
  }, {
    metric: 'junk_review_human_accept_pct', value: junkAccept,
    ...computeDelta(junkAccept, prevMetric(prev, 'junk_review_human_accept_pct')),
    severity: 'info',
  }, {
    metric: 'dup_pair_open', value: num(dup.proposed) + num(dup.needs_human),
    ...computeDelta(num(dup.proposed) + num(dup.needs_human), prevMetric(prev, 'dup_pair_open')),
    severity: 'info',
  }, {
    metric: 'entity_match_labels_from_u2', value: ollamaLabels,
    ...computeDelta(ollamaLabels, prevMetric(prev, 'entity_match_labels_from_u2')),
    severity: 'info',
  }];
  return {
    key: 'lane_throughput', title: 'U1/U2 lane throughput + human accept rates',
    findings,
    note: 'U1 junk-review: ' + (num(junk.proposed) + num(junk.open)) + ' open, ' + junkDecided
      + ' decided (' + junkAccept + '% accepted). U2 dup-pairs: ' + (num(dup.proposed) + num(dup.needs_human))
      + ' open, ' + dupDecided + ' decided; ' + ollamaLabels + ' training labels seeded from w8_u2_ollama_pair.',
  };
}

function tallyByStatus(rows) {
  const out = {};
  if (Array.isArray(rows)) for (const r of rows) out[String(r.status || r.verdict || '?')] = num(r.cnt);
  else if (rows && typeof rows === 'object') for (const k of Object.keys(rows)) out[k] = num(rows[k]);
  return out;
}

// Prompt 80 — match-disambiguation assist accuracy. `raw` = the per-month rows
// from v_lcc_w8_u4_match_assist_accuracy (period, measured, agreed, disagreed).
// Reports the all-time measured sample + agreement accuracy (the meaningful
// signal — accuracy accrues slowly, one verdict at a time). Honest zeros before
// any verdict is measured. A high accuracy after a REAL sample is the future
// gate for auto-resolving the top-confidence band — this section only MEASURES.
export function buildMatchAssistSection(raw, prev) {
  const monthRows = Array.isArray(raw) ? raw : [];
  let measured = 0; let agreed = 0;
  for (const r of monthRows) { measured += num(r.measured); agreed += num(r.agreed); }
  const accuracy = pct(agreed, measured);
  const findings = [{
    metric: 'match_assist_verdicts_measured', value: measured,
    ...computeDelta(measured, prevMetric(prev, 'match_assist_verdicts_measured')), severity: 'info',
  }, {
    metric: 'match_assist_agreed', value: agreed,
    ...computeDelta(agreed, prevMetric(prev, 'match_assist_agreed')), severity: 'info',
  }, {
    metric: 'match_assist_accuracy_pct', value: accuracy,
    ...computeDelta(accuracy, prevMetric(prev, 'match_assist_accuracy_pct')), severity: 'info',
  }];
  return {
    key: 'match_assist', title: 'Match-disambiguation assist accuracy',
    findings,
    note: measured === 0
      ? 'No measured match_disambiguation verdicts against an assist yet — accuracy uncounted (assist off, or no card with an assist has been worked).'
      : measured + ' verdicts measured against the Ollama pre-rank assist; ' + agreed + ' agreed with its top pick ('
        + accuracy + '% accuracy). A high accuracy after a real sample is the future gate for auto-resolving the top-confidence band — not yet.',
  };
}

export function buildNamingHygieneSection(raw, prev) {
  // raw = the naming_hygiene_backlog rollup persisted by the U1 apply tick
  // (junk_review_batch.details.naming_hygiene_backlog), or null when U1 has not
  // run an apply pass yet. Honest: a null source ⇒ 0 with an explicit note.
  const roll = raw && typeof raw === 'object' ? raw : {};
  const total = num(roll.total);
  const abbrev = num(roll.known_abbreviation);
  const address = num(roll.address_as_name);
  const findings = [{
    metric: 'naming_hygiene_backlog_total', value: total,
    ...computeDelta(total, prevMetric(prev, 'naming_hygiene_backlog_total')),
    severity: severityByCount(total, { medium: 500, high: 3000, critical: 10000 }),
  }, {
    metric: 'naming_hygiene_known_abbreviation', value: abbrev,
    ...computeDelta(abbrev, prevMetric(prev, 'naming_hygiene_known_abbreviation')), severity: 'info',
  }, {
    metric: 'naming_hygiene_address_as_name', value: address,
    ...computeDelta(address, prevMetric(prev, 'naming_hygiene_address_as_name')), severity: 'info',
  }];
  return {
    key: 'naming_hygiene', title: 'Naming-hygiene backlog',
    findings,
    note: (raw == null
      ? 'No U1 apply-pass snapshot available yet — backlog uncounted this period.'
      : total + ' real-but-malformed entity names counted (abbrev ' + abbrev + ' / address-as-name ' + address
        + '); a future rename unit, NOT junk (never enqueued).'),
  };
}

export function buildExtractionSection(raw, prev) {
  const total = num(raw && raw.total_30d);
  const stamped = num(raw && raw.stamped);
  const ollama = num(raw && raw.ollama);
  const fellBack = num(raw && raw.fell_back);
  const stampPct = pct(stamped, total);
  const fallbackPct = pct(fellBack, stamped);
  const findings = [{
    metric: 'extractions_30d', value: total,
    ...computeDelta(total, prevMetric(prev, 'extractions_30d')), severity: 'info',
  }, {
    metric: 'extraction_provider_stamped', value: stamped,
    ...computeDelta(stamped, prevMetric(prev, 'extraction_provider_stamped')),
    // Low stamp coverage is itself a systemic gap the kickoff flagged.
    severity: (total > 0 && stampPct < 50) ? 'medium' : 'info',
    fix_unit: (total > 0 && stampPct < 50)
      ? 'Provider attribution gap: only ' + stamped + '/' + total + ' extractions carry a _provider stamp. Fix-unit: ensure every invokeExtractionAI extraction path writes the post-61 _provider stamp so the ollama/cloud mix is measurable.'
      : null,
  }, {
    metric: 'extraction_ollama_share', value: ollama,
    ...computeDelta(ollama, prevMetric(prev, 'extraction_ollama_share')), severity: 'info',
  }, {
    metric: 'extraction_fallback_pct', value: fallbackPct,
    ...computeDelta(fallbackPct, prevMetric(prev, 'extraction_fallback_pct')), severity: 'info',
  }];
  return {
    key: 'extraction', title: 'Extraction provider mix + fallback rate',
    findings,
    note: total + ' extractions in 30d; ' + stamped + ' provider-stamped (' + stampPct + '%), ' + ollama
      + ' ollama, ' + fellBack + ' cloud-fallback (' + fallbackPct + '% of stamped).',
  };
}

// ---------------------------------------------------------------------------
// Assemble the full report from the section inputs. Pure; `now` injected.
// `prevSections` = the prior snapshot's `sections` array (or null).
// ---------------------------------------------------------------------------
export function assembleReport(inputs, { period, now = null, prevSections = null } = {}) {
  const prevBy = {};
  if (Array.isArray(prevSections)) for (const s of prevSections) prevBy[s.key] = s;
  // Per-section resilience (Prompt 73): each builder runs in its own try/catch so a
  // single throwing section contributes a loud {section, error} entry to
  // `section_errors` instead of killing the whole tick. Honest partial > silent death.
  const builders = [
    ['ingest_failures', () => buildIngestFailureSection(inputs.ingest_clusters, inputs.windows, prevBy.ingest_failures)],
    ['flow_failures', () => buildFlowFailureSection(inputs.flow_clusters, inputs.windows, prevBy.flow_failures)],
    ['provenance', () => buildProvenanceSection(inputs.provenance, prevBy.provenance)],
    ['chain', () => buildChainSection(inputs.chain, prevBy.chain)],
    ['precision_floors', () => buildPrecisionFloorSection(inputs.precision, prevBy.precision_floors)],
    ['lane_throughput', () => buildLaneThroughputSection(inputs.lanes, prevBy.lane_throughput)],
    ['match_assist', () => buildMatchAssistSection(inputs.match_assist, prevBy.match_assist)],
    ['naming_hygiene', () => buildNamingHygieneSection(inputs.naming_hygiene, prevBy.naming_hygiene)],
    ['extraction', () => buildExtractionSection(inputs.extraction, prevBy.extraction)],
    // W9.5 — cross-DB propagation integrity. inputs.connectedness is the unified
    // link-coverage object (or null when the tick could not compute it).
    ['connectedness', () => buildConnectednessSection(inputs.connectedness, prevBy.connectedness)],
  ];
  const sections = [];
  const sectionErrors = [];
  for (const [key, fn] of builders) {
    try {
      sections.push(fn());
    } catch (e) {
      sectionErrors.push({ section: key, error: (e && e.message) ? e.message : String(e) });
    }
  }
  const findingsFlat = [];
  for (const s of sections) {
    for (const f of s.findings) findingsFlat.push({ section: s.key, ...f });
    for (const c of (s.clusters || [])) findingsFlat.push({ section: s.key, cluster: true, ...c });
  }
  const codeErrors = sections.filter((s) => s.code_error);
  const bySeverity = {};
  for (const f of findingsFlat) bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
  return {
    period: period || null,
    generated_at: now || null,
    sections,
    section_errors: sectionErrors,
    findings_flat: findingsFlat,
    totals: {
      sections: sections.length,
      findings: findingsFlat.length,
      code_error_sections: codeErrors.length,
      section_errors: sectionErrors.length,
      by_severity: bySeverity,
    },
  };
}

// ---------------------------------------------------------------------------
// FIGURE VALIDATOR (W7.2-style). The narrative prose is checked against the set of
// numbers the aggregator actually computed. Any number in the prose that is not a
// computed value (nor an explicitly-allowed incidental — the period, doc constants,
// small ordinals) is UNMATCHED → the narrative is treated as fabricated.
// ---------------------------------------------------------------------------
export function normalizeNumberToken(tok) {
  return String(tok == null ? '' : tok).replace(/[$,%\s]/g, '').replace(/\.0+$/, '');
}

// Every numeric value the report legitimately contains (values, deltas, prevs,
// totals, pcts), normalized, as a Set of strings.
export function collectComputedValues(report, extraAllowed = []) {
  const set = new Set();
  const add = (v) => {
    if (v == null) return;
    const n = normalizeNumberToken(v);
    if (n === '' || Number.isNaN(Number(n))) return;
    set.add(n);
    // Also allow the absolute value of a negative delta (prose says "fell by 12").
    if (n.startsWith('-')) set.add(n.slice(1));
  };
  for (const f of report.findings_flat || []) {
    add(f.value); add(f.delta); add(f.prev);
  }
  const t = report.totals || {};
  add(t.sections); add(t.findings); add(t.code_error_sections);
  for (const k of Object.keys(t.by_severity || {})) add(t.by_severity[k]);
  // Period parts (2026, 08) + campaign constants that legitimately appear in prose.
  if (report.period) for (const part of String(report.period).split(/[^0-9]+/)) add(part);
  for (const e of extraAllowed) add(e);
  // Small ordinals / window constants the narrative may reference structurally.
  for (const c of [0, 1, 2, 3, 24, 30, 90, PROV_UNRANKED_BASELINE]) add(c);
  return set;
}

// Pull candidate number tokens from prose. Matches integers, decimals, currency and
// percentages; ignores numbers embedded in a YYYY-MM-DD date or an [E#]/#id token.
export function extractProseNumbers(prose) {
  const text = String(prose == null ? '' : prose)
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')   // ISO dates
    .replace(/\b\d{4}-\d{2}\b/g, ' ');         // YYYY-MM
  const out = [];
  const re = /-?\$?\d[\d,]*(?:\.\d+)?%?/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[0]);
  return out;
}

export function validateFigures(prose, computedValues) {
  const nums = extractProseNumbers(prose);
  const unmatched = [];
  for (const raw of nums) {
    const n = normalizeNumberToken(raw);
    if (n === '') continue;
    if (!computedValues.has(n)) unmatched.push(raw);
  }
  return { ok: unmatched.length === 0, checked: nums.length, unmatched };
}

// ---------------------------------------------------------------------------
// Narrative prompt (surface clean_assist). The model gets ONLY the computed table
// and is told, in strong terms, to use no number that is not present. The figure
// validator is the enforcement — the prompt is the request.
// ---------------------------------------------------------------------------
export function buildNarrativePrompt(report) {
  const lines = [];
  lines.push('You are drafting the narrative for a monthly SYSTEMIC-DEFECTS report for a commercial-real-estate data platform.');
  lines.push('You are given a table of COMPUTED numbers. Write a short executive summary (3-5 sentences) then one short paragraph per section.');
  lines.push('ABSOLUTE RULE: use ONLY numbers that appear verbatim in the COMPUTED TABLE below. Never invent, round, extrapolate, or combine numbers into a new figure. If you would need a number that is not in the table, describe it in words instead. No number may appear in your prose that is not in the table.');
  lines.push('Return STRICT JSON: {"executive_summary": "...", "sections": {"<section_key>": "...", ...}}. No prose outside the JSON.');
  lines.push('');
  lines.push('COMPUTED TABLE (period ' + (report.period || 'n/a') + '):');
  for (const s of report.sections) {
    lines.push('## ' + s.key + ' — ' + s.title);
    for (const f of s.findings) {
      lines.push('- ' + f.metric + ' = ' + f.value
        + (f.delta != null ? ' (delta ' + f.delta + ')' : '')
        + ' [severity ' + f.severity + ']');
    }
    for (const c of (s.clusters || []).slice(0, 8)) {
      lines.push('- cluster: ' + c.metric + ' = ' + c.value);
    }
  }
  return lines.join('\n');
}

// Parse the narrative JSON the model returns (tolerant of ```json fences).
export function parseNarrativeJson(text) {
  if (!text) return null;
  let s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;
  try { return JSON.parse(s.slice(first, last + 1)); } catch (_e) { return null; }
}

// ---------------------------------------------------------------------------
// Doc renderer → the monthly markdown. narrative may be null (stock header) or the
// validated {executive_summary, sections} object.
// ---------------------------------------------------------------------------
function sevBadge(s) {
  return ({ critical: '🔴', high: '🟠', medium: '🟡', low: '🔵', info: '⚪' })[s] || '⚪';
}

function fmtDelta(f) {
  if (f.delta == null) return '—';
  if (f.delta === 0) return '±0';
  return (f.delta > 0 ? '+' : '') + f.delta;
}

export function renderFindingsDoc(report, narrative, opts = {}) {
  const L = [];
  const period = report.period || 'unknown';
  L.push('# Systemic-findings report — ' + period);
  L.push('');
  L.push('> W8 U4 (hygiene campaign reporting layer). Numbers are computed **deterministically** from the live signal streams; the narrative is drafted by the local model FROM those numbers and figure-validated (every prose number must match a computed value).');
  L.push('');
  if (opts.generatedAt) L.push('_Generated ' + opts.generatedAt + (opts.sourceRunId ? ' · run `' + opts.sourceRunId + '`' : '') + '._');
  L.push('');

  // Executive summary
  L.push('## Executive summary');
  L.push('');
  if (narrative && narrative.executive_summary) {
    L.push(narrative.executive_summary);
  } else {
    const t = report.totals || {};
    const bs = t.by_severity || {};
    L.push('_(Deterministic summary — model narrative ' + (opts.narrativeNote || 'not attached') + '.)_');
    L.push('');
    L.push(t.findings + ' findings across ' + t.sections + ' sections; '
      + (bs.critical || 0) + ' critical, ' + (bs.high || 0) + ' high, ' + (bs.medium || 0) + ' medium. '
      + t.code_error_sections + ' section(s) carry code-error fix-units.');
  }
  L.push('');

  // Per-section
  for (const s of report.sections) {
    L.push('## ' + s.title);
    L.push('');
    if (narrative && narrative.sections && narrative.sections[s.key]) {
      L.push(narrative.sections[s.key]);
      L.push('');
    } else if (s.note) {
      L.push(s.note);
      L.push('');
    }
    L.push('| Metric | Value | Δ MoM | Severity |');
    L.push('| --- | ---: | ---: | :---: |');
    for (const f of s.findings) {
      L.push('| ' + f.metric + ' | ' + f.value + ' | ' + fmtDelta(f) + ' | ' + sevBadge(f.severity) + ' ' + f.severity + ' |');
    }
    L.push('');
    if (Array.isArray(s.clusters) && s.clusters.length) {
      L.push('| Cluster | Count | Severity |');
      L.push('| --- | ---: | :---: |');
      for (const c of s.clusters) {
        L.push('| ' + c.metric + ' | ' + c.value + ' | ' + sevBadge(c.severity) + ' ' + c.severity + ' |');
      }
      L.push('');
    }
  }

  // Fix-unit stubs
  const stubs = renderFixUnitStubs(report);
  if (stubs) {
    L.push('## Candidate fix-units (ready-to-send Claude Code prompts)');
    L.push('');
    L.push(stubs);
    L.push('');
  }

  L.push('---');
  L.push('_This report feeds the W6.6 audit. It creates NO new review lane — the doc IS the consumer._');
  return L.join('\n');
}

// Code-error findings → numbered fix-unit stubs. One per distinct signature with a
// fix_unit, most-severe first, de-duplicated.
export function renderFixUnitStubs(report) {
  const seen = new Set();
  const stubs = [];
  const rank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  const all = [];
  for (const s of report.sections) {
    if (!s.code_error) continue;
    for (const f of [...(s.clusters || []), ...s.findings]) {
      if (!f.fix_unit) continue;
      all.push({ ...f, section: s.key });
    }
  }
  all.sort((a, b) => (rank[a.severity] ?? 5) - (rank[b.severity] ?? 5) || num(b.value) - num(a.value));
  let i = 1;
  for (const f of all) {
    if (seen.has(f.fix_unit)) continue;
    seen.add(f.fix_unit);
    stubs.push(i + '. **' + f.metric + '** (' + f.value + ', ' + f.severity + ') — ' + f.fix_unit);
    i += 1;
  }
  return stubs.length ? stubs.join('\n') : '';
}
