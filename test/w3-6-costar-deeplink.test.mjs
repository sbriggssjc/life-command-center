// W3.6 fix 3 — metadata-backfill "Open CoStar ->" must open a property-specific
// www.costar.com search (from address+city+state, URL-encoded), NOT the generic
// product.costar.com/all-properties page the view's unencoded "#?search="
// fragment falls back to.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const opsSrc = readFileSync(join(root, 'ops.js'), 'utf8');

function sliceFn(src, marker) {
  const start = src.indexOf(marker);
  assert.notEqual(start, -1, `${marker} not found`);
  const braceStart = src.indexOf('{', src.indexOf('(', start));
  let depth = 0, end = -1;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  return src.slice(start, end);
}

describe('W3.6 fix 3 — buildCostarSearchUrl', () => {
  let build;
  before(() => {
    build = new Function(`${sliceFn(opsSrc, 'function buildCostarSearchUrl(')}; return buildCostarSearchUrl;`)();
  });

  it('builds a property-specific, URL-encoded www.costar.com search', () => {
    const u = build('70 Commercial St', 'Concord', 'NH', 'https://product.costar.com/search/all-properties#?search=x');
    assert.equal(u, 'https://www.costar.com/search?q=' + encodeURIComponent('70 Commercial St Concord NH'));
    assert.ok(u.startsWith('https://www.costar.com/search?q='));
    assert.doesNotMatch(u, /all-properties/);      // not the generic page
    assert.doesNotMatch(u, / /);                    // no raw spaces (encoded)
  });

  it('ignores the malformed view URL when we have an address to build from', () => {
    const u = build('444 W. Railroad Ave', 'West Palm Beach', 'FL',
      'https://product.costar.com/search/all-properties#?search=444 W. Railroad Ave West Palm Beach FL');
    assert.match(u, /^https:\/\/www\.costar\.com\/search\?q=/);
    assert.match(decodeURIComponent(u.split('q=')[1]), /444 W\. Railroad Ave West Palm Beach FL/);
  });

  it('falls back to the provided URL only when there is no address to build from', () => {
    assert.equal(build(null, null, null, 'https://fallback'), 'https://fallback');
    assert.equal(build('', '', '', null), null);
  });
});
