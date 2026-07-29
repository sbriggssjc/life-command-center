// W1.4-L3b (2026-07-29) — extension-side content gate for "Promote to DB".
//
// extension/sidepanel.js is a browser script (not an ESM module and it touches
// `document` at load), so it can't be imported. This is a FIXTURE test: it
// slices the real `hasExtractableContent` function source out of the shipped
// file and exercises it in isolation, so the gate the sidebar actually uses is
// covered and can't silently regress.
//
// The gate is what disables Promote on the repro capture — a property entity
// whose only signal is its literal name (no address, no fields, no PDF text).

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SIDEPANEL = join(__dirname, '..', 'extension', 'sidepanel.js');

let hasExtractableContent;

before(async () => {
  const src = await readFile(SIDEPANEL, 'utf8');
  const marker = 'function hasExtractableContent(';
  const start = src.indexOf(marker);
  assert.notEqual(start, -1, 'hasExtractableContent not found in sidepanel.js');
  // Balanced-brace slice from the first "{" after the signature.
  const braceStart = src.indexOf('{', start);
  let depth = 0, end = -1;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.notEqual(end, -1, 'could not balance-brace hasExtractableContent');
  const fnSource = src.slice(start, end);
  // eslint-disable-next-line no-new-func
  hasExtractableContent = new Function(`${fnSource}; return hasExtractableContent;`)();
});

describe('hasExtractableContent (W1.4-L3b Promote content gate)', () => {
  it('the repro: name-only capture (no address/fields/pdf) → gated (false)', () => {
    assert.equal(hasExtractableContent({ name: 'property 281c485a-21b9-49c6-8519-7018862aaa5b' }), false);
  });

  it('empty / non-object inputs → false', () => {
    assert.equal(hasExtractableContent(null), false);
    assert.equal(hasExtractableContent(undefined), false);
    assert.equal(hasExtractableContent({}), false);
    assert.equal(hasExtractableContent('nope'), false);
  });

  it('an address alone is extractable content', () => {
    assert.equal(hasExtractableContent({ address: '123 Main St' }), true);
  });

  it('a blank/whitespace address alone is NOT content', () => {
    assert.equal(hasExtractableContent({ address: '   ' }), false);
  });

  it('a core property/financial/lease field is content', () => {
    assert.equal(hasExtractableContent({ tenant_name: 'Social Security Administration' }), true);
    assert.equal(hasExtractableContent({ asking_price: '4,250,000' }), true);
    assert.equal(hasExtractableContent({ cap_rate: '6.75%' }), true);
    assert.equal(hasExtractableContent({ lease_expiration: '2031-05-31' }), true);
    assert.equal(hasExtractableContent({ property_subtype: 'Government' }), true);
  });

  it('PDF text or a non-empty content array is content', () => {
    assert.equal(hasExtractableContent({ pdf_extracted_texts: [{ text: 'OM body…' }] }), true);
    assert.equal(hasExtractableContent({ tenants: [{ name: 'DaVita' }] }), true);
    assert.equal(hasExtractableContent({ sales_history: [{ price: 1 }] }), true);
  });

  it('empty content arrays are NOT content', () => {
    assert.equal(hasExtractableContent({ tenants: [], contacts: [], sales_history: [] }), false);
  });
});
