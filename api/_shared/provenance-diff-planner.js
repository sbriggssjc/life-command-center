// D1 — the cross-database provenance producer-set diff (I2 / playbook Class 20).
//
// WHY THIS EXISTS. A missing feeder has NO representation anywhere: no error, no
// zero row, no queue. Every other detector in this repo examines rows that
// EXIST. This one finds rows that were never created because nobody asked a
// source for them. It is how B5 was found (gov had never consumed its own
// sales_transactions as ownership history -- 2,776 rows / 2,000 properties, 677
// with no prior history at all), and it was found BY ACCIDENT. This makes it
// standing.
//
// ⚠️ THE INTRA-TABLE FORM I2 ORIGINALLY STATED HAS A POPULATION OF ONE.
// "Group the fact store by its provenance column, split by domain" needs a table
// carrying BOTH a domain column and a provenance column. On LCC Opps exactly one
// does -- `lcc_entity_portfolio_facts`, the very table that found B5. So that
// form is kept (it is the B5 positive control, see planIntraTableDiff) but it
// cannot generalise. The form that generalises is a CROSS-DATABASE diff of
// PARALLEL tables, gov vs dia.
//
// ⚠️ ROW-COUNT DISPARITY IS NOT THE SIGNAL -- THE PRODUCER SET IS.
// property_financials is 98,510 (gov) vs 676 (dia) and is entirely legitimate:
// dia's econ truth lives in clinic_econ_reconciled. Volume rides along as
// context and is never what raises a difference.
//
// This module is PURE. All I/O lives in scripts/d1-cross-db-provenance-diff.mjs
// so the rules below are testable without a database.

// Column names that can carry a producer label. Order is PRECEDENCE: a table
// carrying more than one is resolved to the first populated one by the caller,
// which must pass `populated` counts -- resolving by name alone picked
// gov.property_financials.source, which is populated on 0 of 98,510 rows.
export const PROVENANCE_COLUMN_CANDIDATES = [
  'data_source', 'source', 'source_system', 'provenance',
  'origin', 'source_name', 'ingest_source',
];

// A provenance column whose distinct-value count exceeds this is not a producer
// label at all -- it is a data value. Measured: gov.entity_match_candidates
// .source_name holds 1,276 distinct ENTITY NAMES. Diffing it produces 1,276
// one-sided "differences", none of them a finding. Reported as excluded WITH the
// cardinality, never silently dropped.
export const MAX_PRODUCER_CARDINALITY = 60;

export const VERDICTS = ['legitimate', 'unexplained', 'unwired'];

/**
 * Strip the per-row suffix off a provenance value.
 * `county_deed:<uuid>` and `gov_master_backfill_r71|h=<hash>` are ONE producer
 * each; grouping on the raw value drowns the diff in one-row buckets.
 */
export function normalizeBucket(raw) {
  if (raw === null || raw === undefined || raw === '') return '(null)';
  return String(raw).split(':')[0].split('|')[0].trim().toLowerCase() || '(null)';
}

/**
 * Resolve which column actually carries the producer label for one table.
 * `populated` maps column -> count of non-null rows. A column present but
 * populated on zero rows is NOT the provenance column, however well it is named.
 */
export function resolveProvenanceColumn(columns, populated = {}) {
  const present = PROVENANCE_COLUMN_CANDIDATES.filter((c) => columns.includes(c));
  if (present.length === 0) return null;
  if (present.length === 1) return present[0];
  const live = present.filter((c) => (populated[c] || 0) > 0);
  if (live.length === 1) return live[0];
  // Ambiguous or all-empty: fall back to declared precedence, but the caller
  // surfaces `ambiguous` so a second populated column cannot hide.
  return (live.length ? live : present)[0];
}

/**
 * Classify one table name across the two domains.
 *
 * `table_exists_no_provenance` is a finding class in its own right and the one
 * the original I2 wording did not anticipate: you cannot diff the producer set
 * of a store that does not record its producer. Measured 2026-08-29: 12 tables
 * are in that state, including dia.ownership_history (10,037 rows) -- the very
 * store B5 was about.
 */
export function classifyTable(name, gov, dia) {
  const govHas = !!gov?.provenanceColumn;
  const diaHas = !!dia?.provenanceColumn;
  if (govHas && diaHas) return 'both_provenance';
  if (!govHas && !diaHas) return 'neither_provenance';
  const missingSideExists = govHas ? !!dia?.tableExists : !!gov?.tableExists;
  return missingSideExists ? 'table_exists_no_provenance' : 'table_absent';
}

/**
 * Fold vocabulary drift away before diffing.
 *
 * The same producer is labelled differently per domain -- `om_extraction` (gov
 * property_financials) vs `om_intake` (dia), `connectivity4_recorded_resolution`
 * vs `connectivity2_recorded_resolution`, `costar_import` vs `costar_sidebar`.
 * Without this the diff reports each as one-sided when it is one producer.
 * A synonym entry REQUIRES a reason, exactly like an acknowledgement.
 */
export function buildSynonymMap(synonyms = []) {
  const map = new Map();
  for (const s of synonyms) {
    if (!s || !s.canonical || !Array.isArray(s.aliases)) continue;
    for (const a of s.aliases) map.set(normalizeBucket(a), normalizeBucket(s.canonical));
  }
  return map;
}

export function canonicalBucket(bucket, synonymMap) {
  const n = normalizeBucket(bucket);
  return synonymMap.get(n) || n;
}

function ackKey(table, bucket, presentIn) {
  return `${table}::${normalizeBucket(bucket)}::${presentIn}`;
}

/**
 * Index the acknowledgement ledger.
 *
 * An entry is only valid with a verdict from VERDICTS and a NON-EMPTY reason.
 * "A difference is not a defect" is the whole point -- but an acknowledgement
 * with no reason is how a surface becomes a badge people click past, which is
 * the failure this detector exists to avoid reproducing.
 */
export function indexAcknowledgements(acknowledged = []) {
  const byKey = new Map();
  const invalid = [];
  for (const a of acknowledged) {
    const reason = typeof a?.reason === 'string' ? a.reason.trim() : '';
    if (!a?.table || !a?.bucket || !a?.present_in) { invalid.push({ entry: a, why: 'incomplete_key' }); continue; }
    if (!VERDICTS.includes(a?.verdict)) { invalid.push({ entry: a, why: 'bad_verdict' }); continue; }
    if (!reason) { invalid.push({ entry: a, why: 'missing_reason' }); continue; }
    byKey.set(ackKey(a.table, a.bucket, a.present_in), { ...a, reason });
  }
  return { byKey, invalid };
}

/**
 * Diff the producer sets for ONE table across the two domains.
 *
 * Returns one entry per one-sided producer bucket. Both-empty tables yield
 * nothing (no signal); a table populated on one side only is reported as
 * `counterpart_empty`, which is a different fact from "different producers"
 * and must not be triaged as one.
 */
export function diffTable(name, govBuckets, diaBuckets, opts = {}) {
  const synonymMap = opts.synonymMap || new Map();
  const maxCardinality = opts.maxCardinality ?? MAX_PRODUCER_CARDINALITY;

  const fold = (rows) => {
    const m = new Map();
    for (const r of rows || []) {
      const b = canonicalBucket(r.bucket, synonymMap);
      m.set(b, (m.get(b) || 0) + Number(r.n || 0));
    }
    return m;
  };
  const g = fold(govBuckets);
  const d = fold(diaBuckets);

  const cardinality = Math.max(g.size, d.size);
  if (cardinality > maxCardinality) {
    return { table: name, excluded: 'provenance_column_is_a_data_value', cardinality, differences: [] };
  }

  const govTotal = [...g.values()].reduce((a, b) => a + b, 0);
  const diaTotal = [...d.values()].reduce((a, b) => a + b, 0);
  if (govTotal === 0 && diaTotal === 0) {
    return { table: name, excluded: 'both_sides_empty', cardinality, differences: [] };
  }
  const counterpartEmpty = govTotal === 0 || diaTotal === 0;

  const differences = [];
  for (const [bucket, n] of g) {
    if (bucket === '(null)') continue;
    if (!d.has(bucket)) {
      differences.push({ table: name, bucket, present_in: 'gov', rows: n, counterpart_rows: 0, counterpart_empty: counterpartEmpty });
    }
  }
  for (const [bucket, n] of d) {
    if (bucket === '(null)') continue;
    if (!g.has(bucket)) {
      differences.push({ table: name, bucket, present_in: 'dia', rows: n, counterpart_rows: 0, counterpart_empty: counterpartEmpty });
    }
  }
  differences.sort((a, b) => b.rows - a.rows);
  return { table: name, excluded: null, cardinality, govTotal, diaTotal, differences };
}

/**
 * The whole plan: classify every table, diff the two-sided ones, attach the
 * acknowledgement verdict, and separate what is NEW from what is known.
 *
 * `unacknowledged` is what a run must be judged on. `known` still RENDERS --
 * acknowledging a difference as `unwired` records that we understand it and have
 * not fixed it; it must not make the row disappear.
 */
export function planProvenanceDiff(input) {
  const { tables = [], govBuckets = {}, diaBuckets = {}, ledger = {} } = input;
  const synonymMap = buildSynonymMap(ledger.synonyms);
  const { byKey, invalid } = indexAcknowledgements(ledger.acknowledged);
  // ⚠️ AN EXCLUSION IS A DECISION, NOT A PATTERN. A column can hold data values
  // at MODEST cardinality and slip past MAX_PRODUCER_CARDINALITY entirely:
  // gov.ingestion_tracker.source holds script names AND temp file paths
  // (`/tmp/tmpuab4ll9g.json`) across ~41 buckets. Excluding such a table by a
  // name pattern is how a detector starts returning comfortable zeros (P182),
  // so each one is named here WITH a reason and still EMITTED in `outOfScope`.
  const outOfScope = new Map();
  for (const o of ledger.out_of_scope || []) {
    const reason = typeof o?.reason === 'string' ? o.reason.trim() : '';
    if (!o?.table) continue;
    if (!reason) { invalid.push({ entry: o, why: 'out_of_scope_missing_reason' }); continue; }
    outOfScope.set(o.table, reason);
  }

  const classified = { both_provenance: [], table_exists_no_provenance: [], table_absent: [], neither_provenance: [] };
  const tableDiffs = [];
  const unacknowledged = [];
  const known = [];

  for (const t of tables) {
    const cls = classifyTable(t.name, t.gov, t.dia);
    classified[cls].push(t.name);
    if (cls !== 'both_provenance') continue;

    if (outOfScope.has(t.name)) {
      tableDiffs.push({ table: t.name, excluded: 'out_of_scope_by_decision',
                        reason: outOfScope.get(t.name), differences: [] });
      continue;
    }

    const res = diffTable(t.name, govBuckets[t.name], diaBuckets[t.name], { synonymMap });
    tableDiffs.push(res);
    for (const diff of res.differences) {
      const ack = byKey.get(ackKey(diff.table, diff.bucket, diff.present_in));
      if (ack) known.push({ ...diff, verdict: ack.verdict, reason: ack.reason, acknowledged_on: ack.acknowledged_on || null });
      else unacknowledged.push(diff);
    }
  }

  unacknowledged.sort((a, b) => b.rows - a.rows);
  return {
    classified,
    tableDiffs,
    unacknowledged,
    known,
    invalidAcknowledgements: invalid,
    counts: {
      tables_examined: tables.length,
      both_provenance: classified.both_provenance.length,
      table_exists_no_provenance: classified.table_exists_no_provenance.length,
      table_absent: classified.table_absent.length,
      out_of_scope: tableDiffs.filter((d) => d.excluded === 'out_of_scope_by_decision').length,
      differences_total: unacknowledged.length + known.length,
      unacknowledged: unacknowledged.length,
      known: known.length,
    },
  };
}

/**
 * The intra-table form, retained ONLY because it is the B5 positive control.
 *
 * ⚠️ A RUN THAT SURFACES NOTHING IS A BUG SIGNAL, NOT A CLEAN BILL OF HEALTH.
 * This asserts the detector can still see B5's signature on
 * lcc_entity_portfolio_facts: dia derives from `sales_transactions_seller_exit`
 * and gov does not. If that stops firing, the detector is broken -- not fixed.
 */
export function planIntraTableDiff(rows, opts = {}) {
  const synonymMap = opts.synonymMap || new Map();
  const byDomain = new Map();
  for (const r of rows || []) {
    const dom = r.source_domain || '(null)';
    if (!byDomain.has(dom)) byDomain.set(dom, new Map());
    const b = canonicalBucket(r.src_bucket, synonymMap);
    const m = byDomain.get(dom);
    m.set(b, (m.get(b) || 0) + Number(r.n_facts || 0));
  }
  const domains = [...byDomain.keys()].filter((d) => d !== '(null)').sort();
  const oneSided = [];
  for (const dom of domains) {
    for (const [bucket, n] of byDomain.get(dom)) {
      if (bucket === '(null)') continue;
      const absentFrom = domains.filter((o) => o !== dom && !byDomain.get(o).has(bucket));
      if (absentFrom.length) oneSided.push({ bucket, present_in: dom, absent_from: absentFrom, facts: n });
    }
  }
  oneSided.sort((a, b) => b.facts - a.facts);
  return { domains, oneSided };
}

