// UX-T0 defect sweep (2026-09-02) — regression guards for the five front-end
// defects from Scott's app walk-through that were root-caused to a mechanism.
//
// Each guard pins the MECHANISM, not the wording, and every source assertion
// runs against COMMENT-STRIPPED source. That is load-bearing here, not
// ceremony: the fixes' own comments quote `seller_type`, `diaAvailListings`,
// `'all'` and `renderDomainProspects(` many times while explaining what went
// wrong, so a raw-source grep would find every banned token present and pass
// happily over a full revert (the A5c / N18 trap).
//
// Source assertions anchor on stable identity tokens (constant and function
// names) or on brace-balanced function spans — never a line number and never a
// fixed-character window, which undershoots the moment a function grows and
// overshoots into its neighbour when it does not.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !/^\s*\/\//.test(line))
    .join('\n');
}

// Brace-balanced span from a stable declaration token — a function's real
// extent, so a growing body can neither fall outside the window nor drag the
// next function's code inside it.
function sliceFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, `${name} not found`);
  const brace = src.indexOf('{', src.indexOf(')', start));
  let depth = 0, end = -1;
  for (let i = brace; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.notEqual(end, -1, `could not balance-brace ${name}`);
  return src.slice(start, end);
}

const dia    = stripComments(read('dialysis.js'));
const app    = stripComments(read('app.js'));
const metric = stripComments(read('ops-metrics.js'));

// --------------------------------------------------------------------------
// UX29 — the Players > Sellers arm asked for a column that does not exist.
//
// dia public.sales_transactions carries buyer_name, buyer_type and seller_name
// but NO seller_type. Asking for it returned PostgREST 42703 on every page;
// diaQuery laundered the non-OK response into []; diaQueryAll broke out of its
// page loop on the short page; the catch never ran. The tile rendered
// "Total Sellers 0 / in dataset" over 2,142 real sellers and $13.48B of volume.
// --------------------------------------------------------------------------
describe('UX29 — sellers select names only columns dia actually has', () => {
  it('DIA_SELLER_SELECT does not request seller_type', () => {
    const m = dia.match(/const DIA_SELLER_SELECT\s*=\s*'([^']+)'/);
    assert.ok(m, 'DIA_SELLER_SELECT constant not found');
    const cols = m[1].split(',').map(c => c.trim());
    assert.ok(!cols.includes('seller_type'),
      'seller_type is NOT a column on dia sales_transactions — requesting it 42703s ' +
      'the whole query and diaQuery renders the failure as an empty seller list');
    assert.ok(cols.includes('seller_name'), 'seller_name must still be selected');
  });

  it('DIA_BUYER_SELECT keeps buyer_type (the column that does exist)', () => {
    const m = dia.match(/const DIA_BUYER_SELECT\s*=\s*'([^']+)'/);
    assert.ok(m, 'DIA_BUYER_SELECT constant not found');
    assert.ok(m[1].includes('buyer_type'),
      'buyer_type exists and is the positive control: buyers worked and sellers ' +
      'did not, and that one column was the only difference');
  });

  it('both Players loads opt into throwOnError so a failure cannot render as 0', () => {
    for (const c of ['DIA_BUYER_SELECT', 'DIA_SELLER_SELECT']) {
      const call = new RegExp("diaQueryAll\\('sales_transactions',\\s*" + c + ",\\s*\\{[^}]*throwOnError:\\s*true");
      assert.match(dia, call,
        `${c} load must pass throwOnError — without it a non-OK response is [] and ` +
        'an empty tile is indistinguishable from a real zero');
    }
  });
});

// --------------------------------------------------------------------------
// UX28 — one buyer, two rows. The grouping key was name.trim().toUpperCase(),
// so "Sumitomo Bank Leasing And Finance Inc" (rank 1, $267.7M) and
// "Sumitomo Bank Leasing and Finance, Inc" (rank 4, $199.2M) were two parties.
// --------------------------------------------------------------------------
describe('UX28 — the party key merges punctuation variants and nothing more', () => {
  // Exercise the REAL function, not a copy of its logic.
  const keyFn = new Function(sliceFn(dia, '_diaPartyKey') + '; return _diaPartyKey;')();

  it('folds the live Sumitomo split that put one buyer at ranks 1 and 4', () => {
    assert.equal(keyFn('Sumitomo Bank Leasing And Finance Inc'),
                 keyFn('Sumitomo Bank Leasing and Finance, Inc'));
  });

  it('folds the other measured punctuation-only families', () => {
    assert.equal(keyFn('Cc Bar LLC'), keyFn('CC Bar, LLC'));
    assert.equal(keyFn('equity investment group, Inc'), keyFn('Equity Investment Group Inc'));
  });

  it('does NOT merge semantically distinct names — that is a human-confirm merge', () => {
    // These are real duplicates in the data and they are deliberately left
    // split here: collapsing them is an entity-resolution judgement, not a
    // string operation a tile may make on its own.
    assert.notEqual(keyFn('Realty Income Corp'), keyFn('Realty Income Corporation'));
    assert.notEqual(keyFn('Massmutual'), keyFn('Massmutual Life'));
    assert.notEqual(keyFn('Smbc Leasing And Finance'), keyFn('Smfg'));
  });

  it('never reduces a real company name to the empty key', () => {
    // The banned fuzzy comparator (dup-pair-planner ownerCore) strips generic
    // CRE tokens and reduces "Realty Income Corporation" to '' so it fails to
    // match itself. This key strips NO tokens.
    for (const n of ['Realty Income Corporation', 'Capital', 'Properties', 'Partners Group']) {
      assert.notEqual(keyFn(n), '', `${n} must keep a non-empty key`);
    }
  });

  it('a punctuation-only name still keys to itself rather than collapsing', () => {
    assert.equal(keyFn('--'), '--');
    assert.notEqual(keyFn('--'), keyFn('...'));
  });

  it('the key does not strip legal forms or generic tokens', () => {
    const body = sliceFn(dia, '_diaPartyKey');
    for (const banned of ['llc', 'inc\\b', 'holdings', 'partners', 'realty']) {
      assert.doesNotMatch(body, new RegExp(banned, 'i'),
        'the party key must not remove tokens — that is the fuzzy-pairing ' +
        'comparator this repo bans for identity');
    }
  });
});

// --------------------------------------------------------------------------
// UX10 — the Overview headline counted a different view than Deals > Sales >
// Availables. Measured live: v_available_listings 462 (461 after the client
// blank-filter) vs the canonical v_dia_on_market 207.
// --------------------------------------------------------------------------
describe('UX10 — the Overview on-market tile reads the canonical set', () => {
  const body = sliceFn(dia, 'renderDiaActionItemsInner');

  it('prefers diaData.onMarketRows (v_dia_on_market) for the count', () => {
    assert.match(body, /diaData\.onMarketRows/,
      'the canonical on-market rows must be the tile\'s primary source');
  });

  it('uses diaAvailListings only as a pre-canonical-load fallback', () => {
    const canonicalIdx = body.indexOf('onMarketRows');
    const fallbackIdx  = body.indexOf('diaAvailListings');
    assert.ok(canonicalIdx !== -1 && fallbackIdx !== -1);
    assert.ok(canonicalIdx < fallbackIdx,
      'diaAvailListings must be reached only after the canonical set is absent');
  });
});

// --------------------------------------------------------------------------
// UX11 — the verification feed opened on 'all', which is 100% cron timer
// advances (1,400 of 1,400 rows in 7 days), so every row read "no update".
// --------------------------------------------------------------------------
describe('UX11 — the verification drilldown opens on the evidence lane', () => {
  it('the default filter is evidence, not all', () => {
    assert.match(dia, /let diaRecentVerificationsFilter\s*=\s*'evidence'/,
      "opening on 'all' shows only the cron's own no-op timer advances");
  });
});

// --------------------------------------------------------------------------
// UX20 — a late loadMarketing() resolve wrote Pipeline back over whichever
// Deals sub-tab the operator had moved to.
// --------------------------------------------------------------------------
describe('UX20 — deferred prospects renders re-check their tab at resolve time', () => {
  it('no deferred render calls renderDomainProspects unguarded', () => {
    const unguarded = app.match(/loadMarketing\(\)\.then\(\(\)\s*=>\s*renderDomainProspects\(/g) || [];
    assert.equal(unguarded.length, 0,
      'every loadMarketing().then(...) prospects render must go through ' +
      'renderDomainProspectsIfCurrent, or it overwrites a tab already left');
  });

  it('the guarded form is actually used (the population is not empty)', () => {
    const guarded = app.match(/loadMarketing\(\)\.then\(\(\)\s*=>\s*renderDomainProspectsIfCurrent\(/g) || [];
    assert.ok(guarded.length >= 7,
      `expected the 7 measured deferred renders to be guarded, found ${guarded.length}`);
  });

  it('the guard compares against the CURRENT tab, not just the biz tab', () => {
    const body = sliceFn(app, 'prospectsRenderStillWanted');
    assert.match(body, /currentDiaTab/, 'must check the dia inner tab');
    assert.match(body, /currentGovTab/, 'must check the gov inner tab');
  });
});

// --------------------------------------------------------------------------
// UX48 — the Metrics roster rendered 42 rows, 38 of them mailbox aliases and
// system mailboxes, including three duplicate zero-activity Scott Briggs rows.
// --------------------------------------------------------------------------
describe('UX48 — the team roster reads the recorded person registry', () => {
  it('filters on the is_team_member flag the view supplies', () => {
    // A bare /is_team_member/ search is NOT a guard here and the mutation pass
    // proved it: the token also appears in the `_flagged` probe one line up, so
    // deleting the actual .filter() left the grep green. Anchor on the filter
    // EXPRESSION, which the mutation has to destroy.
    assert.match(metric, /\.filter\(\s*m\s*=>\s*m\.is_team_member\s*\)/,
      'the roster must gate on the recorded fact, not render every membership');
  });

  it('treats a view without the flag as unflagged rather than as all-false', () => {
    // A database that predates the UX48 migration returns no is_team_member at
    // all. `undefined` must not read as false, or the roster renders empty.
    assert.match(metric, /is_team_member !== undefined/,
      'an absent flag must fall back to showing the roster, never to hiding it');
  });

  it('discloses the suppressed count instead of hiding it silently', () => {
    // Same lesson: /_hidden/ alone stayed green when the render was mutated to
    // `if (false)`, because the const declaration still carried the name. Pin
    // the reachable branch AND that the count reaches the emitted string.
    assert.match(metric, /if\s*\(\s*_hidden\s*>\s*0\s*\)/,
      'the disclosure branch must be reachable from the suppressed count');
    assert.match(metric, /html\s*\+=[^;]*\$\{_hidden\}/,
      'suppressed rows must be counted and STATED — a silent filter is the same ' +
      'dishonesty as the padded roster it replaces');
  });

  it('does not decide team membership from the shape of a name', () => {
    const banned = /(display_name|email)[^\n]*\.(match|test|includes)\(|looksLike|isAlias/;
    assert.doesNotMatch(metric, banned,
      'membership comes from lcc_users, never from a guess about how a name looks');
  });
});

// --------------------------------------------------------------------------
// UX31 — "building size looks too large". Not a unit error (building_size IS
// square feet); a SHAPE error. Live over 8,607 dia properties with a size:
// median 8,646 sf, mean 24,044 sf, max 2,507,852 — 357 rows carry the whole
// medical-office building's RBA and dragged the mean 2.78x.
// --------------------------------------------------------------------------
describe('UX31 — the building-size tile reports a median, not a mean', () => {
  const body = sliceFn(dia, '_loadDiaPropertiesSummary');

  it('computes a median from a sorted array', () => {
    assert.match(body, /sfVals\.sort/, 'a median requires the values sorted');
    assert.match(body, /medianSF/, 'the summary must carry a median');
  });

  it('does not divide a running sum by the count', () => {
    assert.doesNotMatch(body, /sfSum\s*\/\s*withSFCount/,
      'the arithmetic mean over this distribution reads 2.78x the typical clinic');
  });

  it('the tile is labelled for what it shows', () => {
    assert.match(dia, /title:\s*'Median Building SF'/,
      'a median labelled "Avg" is the same dishonesty as showing the mean');
  });
});
