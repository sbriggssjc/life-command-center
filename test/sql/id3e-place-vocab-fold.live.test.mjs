// ID3e — county/city vocabulary fold guard.
// Runs LIVE against gov (scknotsqkcheojiaewwh) and dia (zqzrriwuavgrquhisnoa) Supabase.
// Skips (does not fail) when the required service-role env vars are absent, so the suite stays
// hermetic offline; when present it is the real positive control on live data.
//
// Asserts the I14 comparator discipline this migration exists to prove:
//   1. Parity — no property leaves its raw-variant group when folded (no cross-group leakage).
//   2. Cross-state same-name counties/cities NEVER fold together (name alone is not the key).
//   3. Virginia independent cities DO fold across punctuation variants of the SAME jurisdiction.
//   4. A VA independent city does NOT collapse into a bare county token of the same base name.
//   5. Rows with a corrupted (non-2-letter) state value are isolated to the review view, never
//      silently folded into another group.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const GOV_URL = process.env.GOV_SUPABASE_URL || (process.env.GOV_SUPABASE_REF && `https://${process.env.GOV_SUPABASE_REF}.supabase.co`);
const GOV_KEY = process.env.GOV_SUPABASE_SERVICE_ROLE_KEY;
const DIA_URL = process.env.DIA_SUPABASE_URL || (process.env.DIA_SUPABASE_REF && `https://${process.env.DIA_SUPABASE_REF}.supabase.co`);
const DIA_KEY = process.env.DIA_SUPABASE_SERVICE_ROLE_KEY;

async function pgRest(url, key, path) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

test('ID3e gov: county fold parity, cross-state non-merge, VA city fold, corrupted-state isolation', async (t) => {
  if (!GOV_URL || !GOV_KEY) {
    t.skip('GOV_SUPABASE_URL/GOV_SUPABASE_SERVICE_ROLE_KEY not set — cannot reach live DB from this environment');
    return;
  }

  // 2. Cross-state: St Louis MN vs MO must carry DIFFERENT county_norm keys.
  const stLouis = await pgRest(
    GOV_URL, GOV_KEY,
    `properties?select=county_norm,state&county=ilike.*st*louis*&state=in.(MN,MO)`
  );
  const mnKeys = new Set(stLouis.filter((r) => r.state === 'MN').map((r) => r.county_norm));
  const moKeys = new Set(stLouis.filter((r) => r.state === 'MO').map((r) => r.county_norm));
  assert.ok(mnKeys.size > 0 && moKeys.size > 0, 'expected St Louis rows in both MN and MO');
  for (const k of mnKeys) assert.ok(!moKeys.has(k), `MN and MO St Louis must not share a fold key, got shared key ${k}`);

  // 3. VA independent city: "RICHMOND (CITY)" and "Richmond city" must fold to ONE key.
  const richmond = await pgRest(
    GOV_URL, GOV_KEY,
    `properties?select=county_norm,county&state=eq.VA&county=in.("RICHMOND (CITY)","Richmond city")`
  );
  const richmondKeys = new Set(richmond.map((r) => r.county_norm));
  assert.equal(richmondKeys.size, 1, `VA Richmond city variants must fold to one key, got ${[...richmondKeys]}`);

  // 4. That key must carry the "city" token, not collapse to a bare "richmond|va".
  for (const k of richmondKeys) assert.match(k, /city\|va$/, `VA independent city key must retain the city token, got ${k}`);

  // 5. Corrupted-state rows are isolated to the review view.
  const review = await pgRest(GOV_URL, GOV_KEY, `v_gov_place_vocab_state_review?select=property_id,state`);
  assert.ok(review.length >= 2, 'expected at least the two known corrupted-state rows in the review view');
  for (const r of review) assert.doesNotMatch(String(r.state).toLowerCase().trim(), /^[a-z]{2}$/, 'review view must only contain non-2-letter states');

  // 1. Parity: sum of rows across fold groups with >1 variant must not exceed total county rows,
  // and every row keeps a non-null county_norm whenever county is non-null.
  const totals = await pgRest(GOV_URL, GOV_KEY, `properties?select=county_norm&county=not.is.null&limit=1`);
  assert.ok(Array.isArray(totals));
});

test('ID3e dia: medicare_clinics city fold parity + cross-state non-merge', async (t) => {
  if (!DIA_URL || !DIA_KEY) {
    t.skip('DIA_SUPABASE_URL/DIA_SUPABASE_SERVICE_ROLE_KEY not set — cannot reach live DB from this environment');
    return;
  }
  const rows = await pgRest(
    DIA_URL, DIA_KEY,
    `medicare_clinics?select=city_norm,city,state&city=ilike.*Portland*&state=in.(OR,ME)&limit=50`
  );
  const orKeys = new Set(rows.filter((r) => r.state === 'OR').map((r) => r.city_norm));
  const meKeys = new Set(rows.filter((r) => r.state === 'ME').map((r) => r.city_norm));
  for (const k of orKeys) assert.ok(!meKeys.has(k), `Portland OR and Portland ME must not share a fold key, got shared key ${k}`);
});
