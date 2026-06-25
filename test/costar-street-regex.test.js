import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// costar.js is a content-script IIFE that touches window/chrome/document at
// load, so it can't be imported in Node like _sale-merge.js. Instead, read the
// STREET_RE regex literals straight out of the source and exercise them — this
// guards the address-suffix coverage (notably CoStar's "Pky" abbreviation,
// which previously parsed to null and dropped the sidebar into its empty
// "unsupported site" state on records like "5155 Flynn Pky - Flynn Parkway
// Tower") without re-running the whole content script.
const src = readFileSync(
  fileURLToPath(new URL('../extension/content/costar.js', import.meta.url)),
  'utf8',
);

// Pull every `const STREET_RE = /.../i;` literal out of the source.
function extractStreetRegexes(text) {
  const out = [];
  const re = /const\s+STREET_RE\s*=\s*\/(.+?)\/([a-z]*);/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push(new RegExp(m[1], m[2]));
  }
  return out;
}

describe('costar.js STREET_RE address-suffix coverage', () => {
  const regexes = extractStreetRegexes(src);

  it('finds both STREET_RE definitions (parseAddress + findAddressInLines)', () => {
    assert.equal(regexes.length, 2, 'expected exactly two STREET_RE literals');
  });

  // The records that regressed: CoStar abbreviates Parkway as "Pky".
  const SHOULD_MATCH = [
    '5155 Flynn Pky',        // the reported failing record
    '5155 Flynn Pkwy',       // long abbreviation still works
    '5155 Flynn Parkway',
    '100 Main St',
    '2700 S Central Expy',
    '1 Garden State Pkwy',
    '4500 N Sam Houston Tpke',
    '12 Veterans Byp',
    '88 Railroad Xing',
  ];

  // Plain text / non-addresses must still be rejected by both patterns.
  const SHOULD_NOT_MATCH = [
    'Flynn Parkway Tower',   // building name, no leading number
    'Office - South Side Submarket',
    'Corpus Christi, TX 78411',
    '1 of 2,000 Records',
  ];

  // Mirror parseAddress's real gate: a segment is a street address only when
  // it ALSO starts with a number (costar.js applies `/^\d+(?:-\d+)?\s/` before
  // STREET_RE). The second regex is already `^\d+`-anchored, so the extra
  // guard is harmless there — using one predicate keeps the test faithful to
  // how both regexes are actually consumed.
  const looksLikeStreet = (rx) => (s) =>
    /^\d+(?:-\d+)?\s/.test(s) && rx.test(s);

  for (const [i, rx] of regexes.entries()) {
    const isStreet = looksLikeStreet(rx);
    for (const addr of SHOULD_MATCH) {
      it(`regex[${i}] matches "${addr}"`, () => {
        assert.ok(isStreet(addr), `${rx} should match ${addr}`);
      });
    }
    for (const bad of SHOULD_NOT_MATCH) {
      it(`regex[${i}] rejects "${bad}"`, () => {
        assert.ok(!isStreet(bad), `${rx} should NOT match ${bad}`);
      });
    }
  }
});
