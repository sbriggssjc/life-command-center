#!/usr/bin/env node
/**
 * D1 — the cross-database provenance producer-set diff. STANDING DETECTOR.
 *
 * WHAT IT ANSWERS: does a fact store have the SAME SHAPE of producers in every
 * domain? A source bucket present for one domain and absent for another IS the
 * finding (playbook Class 20, invariant I2).
 *
 * WHY IT MUST BE STANDING: a missing feeder has NO representation anywhere — no
 * error, no zero row, no queue. Every other detector in this repo examines rows
 * that EXIST. B5 (gov had never consumed its own sales_transactions as ownership
 * history: 2,776 rows / 2,000 properties, 677 with no prior history at all) was
 * found by this query BY ACCIDENT. This makes it deliberate.
 *
 * RE-RUN CADENCE: MONTHLY, and additionally whenever a new ingestion source or a
 * new domain database is added — the onboarding checklist in
 * docs/architecture/data-coherence-invariants.md points here. Monthly is chosen
 * because a producer set changes only when someone ships a feeder, which is the
 * event this is watching for; running it nightly would produce an unread report.
 *
 * ⚠️ A RUN THAT SURFACES NOTHING IS A BUG SIGNAL, NOT A CLEAN BILL OF HEALTH.
 * `--positive-control` re-runs B5's own signature on lcc_entity_portfolio_facts;
 * if that stops firing, the detector is broken rather than the system fixed.
 *
 * EXIT CODES: 0 = no unacknowledged difference. 1 = at least one NEW difference
 * (or a malformed ledger entry). 2 = could not run (missing credentials).
 *
 * Usage (repo root, reads .env.local):
 *   node scripts/d1-cross-db-provenance-diff.mjs
 *   node scripts/d1-cross-db-provenance-diff.mjs --json
 *   node scripts/d1-cross-db-provenance-diff.mjs --positive-control
 *
 * Required env: GOV_SUPABASE_URL + GOV_SUPABASE_SERVICE_KEY (or _KEY),
 *               DIA_SUPABASE_URL + DIA_SUPABASE_SERVICE_KEY (or _KEY),
 *               OPS_SUPABASE_URL + OPS_SUPABASE_KEY (positive control only).
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  PROVENANCE_COLUMN_CANDIDATES,
  planProvenanceDiff,
  planIntraTableDiff,
  buildSynonymMap,
} from '../api/_shared/provenance-diff-planner.js';

function loadEnvLocal() {
  for (const f of ['.env.local', '.env']) {
    const p = path.resolve(process.cwd(), f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      const v = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
    return f;
  }
  return null;
}
const envFile = loadEnvLocal();

const JSON_OUT = process.argv.includes('--json');
const CONTROL = process.argv.includes('--positive-control');

const DBS = {
  gov: { url: process.env.GOV_SUPABASE_URL, key: process.env.GOV_SUPABASE_SERVICE_KEY || process.env.GOV_SUPABASE_KEY },
  dia: { url: process.env.DIA_SUPABASE_URL, key: process.env.DIA_SUPABASE_SERVICE_KEY || process.env.DIA_SUPABASE_KEY },
};
const missing = Object.entries(DBS).filter(([, v]) => !v.url || !v.key).map(([k]) => k.toUpperCase());
if (missing.length) {
  console.error(`Missing credentials for: ${missing.join(', ')} (need <DOMAIN>_SUPABASE_URL + _SERVICE_KEY).`);
  console.error(envFile ? `Read ${envFile} but those keys were not in it.` : 'No .env.local found.');
  process.exit(2);
}

/** Run read-only SQL through PostgREST's rpc/exec_sql seam used elsewhere in scripts/. */
async function q(db, sql) {
  const { url, key } = DBS[db];
  const res = await fetch(`${url}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error(`${db}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

const COLS = PROVENANCE_COLUMN_CANDIDATES.map((c) => `'${c}'`).join(',');

/** The catalogue: every base table, and which provenance-shaped columns it has. */
const CATALOGUE_SQL = `
  select t.table_name,
         coalesce(array_agg(c.column_name order by c.column_name)
                  filter (where c.column_name in (${COLS})), '{}') as prov_cols
  from information_schema.tables t
  left join information_schema.columns c
    on c.table_schema = t.table_schema and c.table_name = t.table_name
  where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
  group by t.table_name`;

/**
 * Resolve the provenance column BY POPULATION, not by name.
 * gov.property_financials carries both `data_source` and `source`; `source` is
 * populated on 0 of 98,510 rows. Picking by name alone picks the dead column.
 */
async function resolveColumns(db, catalogue) {
  const multi = catalogue.filter((r) => (r.prov_cols || []).length > 1);
  const populated = {};
  for (const row of multi) {
    const parts = row.prov_cols.map((c) => `count(${c}) as ${c}`).join(', ');
    const [r] = await q(db, `select ${parts} from public.${row.table_name}`);
    populated[row.table_name] = r;
  }
  const out = {};
  for (const row of catalogue) {
    const cols = row.prov_cols || [];
    if (!cols.length) { out[row.table_name] = { tableExists: true, provenanceColumn: null }; continue; }
    let col = cols[0];
    if (cols.length > 1) {
      const live = cols.filter((c) => Number(populated[row.table_name]?.[c] || 0) > 0);
      col = (live.length ? live : cols)
        .sort((a, b) => PROVENANCE_COLUMN_CANDIDATES.indexOf(a) - PROVENANCE_COLUMN_CANDIDATES.indexOf(b))[0];
    }
    out[row.table_name] = {
      tableExists: true,
      provenanceColumn: col,
      ambiguous: cols.length > 1 ? cols : null,
    };
  }
  return out;
}

/** One grouped read per table. Buckets are split_part'd in SQL, folded in JS. */
async function bucketsFor(db, tableName, col) {
  const sql = `select split_part(split_part(coalesce(${col}::text,'(null)'),':',1),'|',1) as bucket,
                      count(*)::bigint as n
                 from public.${tableName} group by 1`;
  try {
    return (await q(db, sql)).map((r) => ({ bucket: r.bucket, n: Number(r.n) }));
  } catch (err) {
    console.error(`  ! ${db}.${tableName}: ${err.message}`);
    return [];
  }
}

async function main() {
  const ledger = JSON.parse(fs.readFileSync(
    path.resolve(path.dirname(new URL(import.meta.url).pathname), 'd1-provenance-acknowledgements.json'), 'utf8'));

  const [govCat, diaCat] = await Promise.all([q('gov', CATALOGUE_SQL), q('dia', CATALOGUE_SQL)]);
  const [govCols, diaCols] = await Promise.all([resolveColumns('gov', govCat), resolveColumns('dia', diaCat)]);

  const names = [...new Set([...Object.keys(govCols), ...Object.keys(diaCols)])].sort();
  const tables = names.map((name) => ({
    name,
    gov: govCols[name] || { tableExists: false, provenanceColumn: null },
    dia: diaCols[name] || { tableExists: false, provenanceColumn: null },
  }));

  const twoSided = tables.filter((t) => t.gov.provenanceColumn && t.dia.provenanceColumn);
  const govBuckets = {}; const diaBuckets = {};
  for (const t of twoSided) {
    govBuckets[t.name] = await bucketsFor('gov', t.name, t.gov.provenanceColumn);
    diaBuckets[t.name] = await bucketsFor('dia', t.name, t.dia.provenanceColumn);
  }

  const plan = planProvenanceDiff({ tables, govBuckets, diaBuckets, ledger });

  if (CONTROL) {
    const OPS = { url: process.env.OPS_SUPABASE_URL, key: process.env.OPS_SUPABASE_KEY };
    if (OPS.url && OPS.key) {
      DBS.ops = OPS;
      const rows = await q('ops', `select source_domain,
          split_part(coalesce(ownership_source,'(null)'),':',1) as src_bucket,
          count(*)::bigint as n_facts
        from lcc_entity_portfolio_facts group by 1,2`);
      const ctl = planIntraTableDiff(rows.map((r) => ({ ...r, n_facts: Number(r.n_facts) })),
        { synonymMap: buildSynonymMap(ledger.synonyms) });
      const b5 = ctl.oneSided.find((o) => o.bucket === 'sales_transactions_seller_exit');
      plan.positiveControl = { b5_signature_fires: !!b5, detail: b5 || null, oneSided: ctl.oneSided.length };
    } else {
      plan.positiveControl = { b5_signature_fires: null, detail: 'OPS_SUPABASE_URL/KEY not set' };
    }
  }

  if (JSON_OUT) { console.log(JSON.stringify(plan, null, 2)); }
  else {
    const c = plan.counts;
    console.log(`\nD1 cross-database provenance diff  (gov vs dia)\n`);
    console.log(`  tables examined ............... ${c.tables_examined}`);
    console.log(`  provenance on BOTH sides ...... ${c.both_provenance}`);
    console.log(`  table exists, NO provenance ... ${c.table_exists_no_provenance}   <- cannot be diffed at all`);
    console.log(`  table absent on one side ...... ${c.table_absent}`);
    console.log(`  producer differences .......... ${c.differences_total}  (known ${c.known}, NEW ${c.unacknowledged})`);
    if (plan.invalidAcknowledgements.length) {
      console.log(`\n  ledger entries REJECTED (need a verdict AND a non-empty reason):`);
      for (const i of plan.invalidAcknowledgements) console.log(`    ${i.why}: ${JSON.stringify(i.entry)}`);
    }
    const open = plan.known.filter((k) => k.verdict !== 'legitimate').sort((a, b) => b.rows - a.rows);
    if (open.length) {
      console.log(`\n  KNOWN, still open (acknowledged is not silenced):`);
      for (const k of open) console.log(`    ${k.verdict.padEnd(11)} ${k.present_in}  ${k.table}.${k.bucket}  ${k.rows} rows`);
    }
    if (plan.unacknowledged.length) {
      console.log(`\n  *** NEW, UNACKNOWLEDGED — triage these and add a ledger entry with a reason: ***`);
      for (const d of plan.unacknowledged) console.log(`    ${d.present_in}  ${d.table}.${d.bucket}  ${d.rows} rows`);
    }
    if (plan.positiveControl) {
      const pc = plan.positiveControl;
      console.log(`\n  positive control (B5 signature on lcc_entity_portfolio_facts): ` +
        (pc.b5_signature_fires === null ? `SKIPPED — ${pc.detail}`
          : pc.b5_signature_fires ? `FIRES  ${JSON.stringify(pc.detail)}`
            : `*** DID NOT FIRE — the detector is broken, not the system fixed ***`));
    }
    console.log('');
  }

  process.exit(plan.unacknowledged.length || plan.invalidAcknowledgements.length ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(2); });
