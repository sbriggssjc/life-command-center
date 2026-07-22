// End-to-end test of the query_comps JS layer against REAL rows returned by the
// live RPCs (2026-07-21). Run: node test_query_comps.js
const { expandTypes, dedupe } = require('./query_comps.tool.js');

let pass = 0, fail = 0;
function ok(name, cond) { cond ? (pass++, console.log('  PASS', name)) : (fail++, console.log('  FAIL', name)); }

// --- 1. synonym expansion ---
const ex = expandTypes(['medical']);
ok('medical expands to Health', ex.includes('Health'));
ok('medical expands to Medical', ex.includes('Medical'));
ok('medical expands to Dialysis', ex.includes('Dialysis'));
ok('office is passthrough', expandTypes(['office']).includes('Office'));

// --- 2. dedup: Covington GA "4179 Baker St" (SF) vs "4179 Baker Street" (canonical) ---
const covington = [
  { comp_id: 'dia_sf:a1YVs000001H8bhMAC', source: 'salesforce', source_sf_id: 'a1YVs000001H8bhMAC',
    address: '4179 Baker St', city: 'Covington', state: 'GA', sale_date: '2026-06-23', sale_price: 2410000, cap_rate: 0.0761, confidence: 0.7 },
  { comp_id: 'dia_db:14755', source: 'dialysis_db', source_sf_id: null,
    address: '4179 Baker Street', city: 'Covington', state: 'GA', sale_date: '2026-06-23', sale_price: 2410000, cap_rate: 0.0771, confidence: 0.85 },
];
const cov = dedupe(covington);
ok('Covington St/Street pair collapses to 1', cov.length === 1);
ok('Covington keeps higher-confidence canonical row', cov[0]?.source === 'dialysis_db');

// --- 3. dedup: Yukon VA — SF confidential ($0/withheld) vs priced canonical ---
const yukon = [
  { comp_id: 'gov_sf:a1YVs000002WfwXMAS', source: 'salesforce', source_sf_id: 'a1YVs000002WfwXMAS',
    address: '1808 Commons Cir', city: 'Yukon', state: 'OK', sale_date: '2026-05-20', sale_price: null, confidence: 0.7 },
  { comp_id: 'gov_db:f4460cf6', source: 'government_db', source_sf_id: null,
    address: '1808 Commons Cir', city: 'Yukon', state: 'OK', sale_date: '2026-05-20', sale_price: 1538000, confidence: 0.85 },
];
const yk = dedupe(yukon);
ok('Yukon withheld-SF + priced-canonical collapses to 1', yk.length === 1);
ok('Yukon keeps the priced record', yk[0]?.sale_price === 1538000);

// --- 4. genuinely different comps are NOT merged (different property, same city) ---
const distinct = [
  { comp_id: 'a', source: 'salesforce', address: '100 Main St', city: 'Tulsa', state: 'OK', sale_date: '2026-01-01', sale_price: 1000000, confidence: 0.8 },
  { comp_id: 'b', source: 'government_db', address: '200 Elm Ave', city: 'Tulsa', state: 'OK', sale_date: '2026-01-01', sale_price: 2000000, confidence: 0.8 },
];
ok('distinct properties are not merged', dedupe(distinct).length === 2);

// --- 5. deterministic link: canonical carrying source_sf_id drops the matching SF row ---
const linked = [
  { comp_id: 'sf1', source: 'salesforce', source_sf_id: 'X1', address: '5 A St', city: 'C', state: 'CA', sale_date: '2026-02-02', sale_price: 500000, confidence: 0.7 },
  { comp_id: 'db1', source: 'dialysis_db', source_sf_id: 'X1', address: '5 A Street', city: 'C', state: 'CA', sale_date: '2026-02-02', sale_price: 500000, confidence: 0.9 },
];
const lk = dedupe(linked);
ok('source_sf_id link collapses to 1', lk.length === 1);

// --- 6. same-property same-year price-conflict twins at EQUAL confidence:
//        surviving price is quality-chosen (master_curated) over implausible ---
const priceConflict = [
  { comp_id: 'dia_db:794', source: 'dialysis_db', address: '10 Clinic Rd', city: 'Denver', state: 'CO',
    sale_date: '2017-12-28', sale_price: 3750000, confidence: 0.85,
    raw: { cap_rate_quality: 'implausible_unverified', cap_rate_source: null } },
  { comp_id: 'dia_db:88', source: 'dialysis_db', address: '10 Clinic Road', city: 'Denver', state: 'CO',
    sale_date: '2017-12-28', sale_price: 3583644, confidence: 0.85,
    raw: { cap_rate_quality: 'stated_only', cap_rate_source: 'master_curated' } },
];
const pc = dedupe(priceConflict);
ok('price-conflict twins collapse to 1', pc.length === 1);
ok('surviving price is the quality (master_curated) one, not the implausible', pc[0]?.sale_price === 3583644);
// order-independence: even when the implausible row is seen second, quality wins
const pc2 = dedupe([priceConflict[1], priceConflict[0]]);
ok('quality survivor is order-independent', pc2[0]?.sale_price === 3583644);
// no provenance on either -> unchanged (first-seen, additive tiebreaker is inert)
const noProv = [
  { comp_id: 'x', source: 'dialysis_db', address: '9 B St', city: 'T', state: 'OK', sale_date: '2020-01-01', sale_price: 1000000, confidence: 0.85 },
  { comp_id: 'y', source: 'dialysis_db', address: '9 B Street', city: 'T', state: 'OK', sale_date: '2020-01-01', sale_price: 1200000, confidence: 0.85 },
];
ok('no-provenance tie stays first-seen (additive, no regression)', dedupe(noProv)[0]?.comp_id === 'x');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
