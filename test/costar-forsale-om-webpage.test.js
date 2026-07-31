import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// costar.js is a content-script IIFE that touches window/chrome/document at
// load, so it can't be imported in Node. Mirror costar-street-regex.test.js:
// slice the PURE helper declarations straight out of the source and evaluate
// them in isolation. Guards the 2026-07-31 For-Sale embedded-OM + external
// property-webpage capture (SPEC_forsale_om_and_webpage_ingest.md, Parts A/B1).
const src = readFileSync(
  fileURLToPath(new URL('../extension/content/costar.js', import.meta.url)),
  'utf8',
);

// Extract a `const NAME = <single-line>;` declaration verbatim from source.
function sliceConst(text, name) {
  const re = new RegExp(`\\n(\\s*const\\s+${name}\\s*=\\s*[^\\n]*;)`);
  const m = re.exec(text);
  assert.ok(m, `const ${name} not found in source`);
  return m[1].trim();
}

// Extract a `function NAME(...) { ... }` declaration by balanced braces. The
// target functions contain no braces inside strings/regex, so a plain depth
// counter is exact here.
function sliceFunction(text, name) {
  const start = text.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} not found in source`);
  const open = text.indexOf('{', start);
  let depth = 0;
  for (let j = open; j < text.length; j++) {
    if (text[j] === '{') depth++;
    else if (text[j] === '}') { depth--; if (depth === 0) return text.slice(start, j + 1); }
  }
  throw new Error(`unbalanced braces for ${name}`);
}

// Rebuild the pure helpers (+ their const regex deps) in an isolated scope.
const factory = new Function([
  sliceConst(src, 'EXCLUDED_URL_HOST_RE'),
  sliceConst(src, 'WEBSITE_LABEL_RE'),
  sliceFunction(src, 'classifyBrochureHref'),
  sliceFunction(src, 'isExcludedHost'),
  sliceFunction(src, 'pickExternalListingUrls'),
  'return { classifyBrochureHref, isExcludedHost, pickExternalListingUrls };',
].join('\n\n'));
const { classifyBrochureHref, isExcludedHost, pickExternalListingUrls } = factory();

describe('classifyBrochureHref — embedded Marketing Brochure / OM (Part A)', () => {
  const YES = [
    'https://ahprd1cdn.csgpimgs.com/i2/abc/marketing-brochure.pdf',
    'https://product.costar.com/docs/offering-memorandum-198.pdf',
    'https://cdn.example.com/assets/brochure/flyer.PDF',
    'https://s3.amazonaws.com/listings/offering.pdf',
    'https://d123.cloudfront.net/marketing/package.docx',
    'https://x.blob.core.windows.net/docs/om.pdf',
    'https://broker.com/documents/12345',
  ];
  const NO = [
    'javascript:void(0)',
    'mailto:jimmy@bouldergroup.com',
    'tel:+18475628500',
    'https://maps.google.com/?q=198+N+Springfield',
    'https://product.costar.com/listings/for-sale/detail/f557kbv/summary', // page itself, no doc marker
    '',
    null,
  ];
  for (const u of YES) it(`accepts ${JSON.stringify(u)}`, () => assert.equal(classifyBrochureHref(u), true));
  for (const u of NO) it(`rejects ${JSON.stringify(u)}`, () => assert.equal(classifyBrochureHref(u), false));
});

describe('isExcludedHost — external listing URL filter (Part B1)', () => {
  for (const h of ['costar.com', 'product.costar.com', 'maps.google.com', 'www.facebook.com', 'lnkd.in.linkedin.com', 'csgpimgs.com', '']) {
    it(`excludes ${JSON.stringify(h)}`, () => assert.equal(isExcludedHost(h), true));
  }
  for (const h of ['bouldergroup.com', 'www.bouldergroup.com', 'thexyzrealty.com']) {
    it(`allows ${JSON.stringify(h)}`, () => assert.equal(isExcludedHost(h), false));
  }
});

describe('pickExternalListingUrls — broker-domain + website-label selection (Part B1)', () => {
  it('keeps a link whose host matches a broker email domain', () => {
    const links = [
      { url: 'https://www.bouldergroup.com/listing/198-n-springfield', label: 'The Boulder Group', host: 'www.bouldergroup.com' },
      { url: 'https://product.costar.com/x', label: 'CoStar', host: 'product.costar.com' },
      { url: 'https://maps.google.com/q', label: 'Map', host: 'maps.google.com' },
    ];
    const out = pickExternalListingUrls(links, new Set(['bouldergroup.com']));
    assert.equal(out.length, 1);
    assert.equal(out[0].host, 'www.bouldergroup.com');
    assert.equal(out[0].matched_broker_domain, true);
  });

  it('keeps a website-ish labeled link even without an email-domain match', () => {
    const links = [{ url: 'https://acmecre.com/props/42', label: 'View Listing', host: 'acmecre.com' }];
    const out = pickExternalListingUrls(links, new Set());
    assert.equal(out.length, 1);
    assert.equal(out[0].matched_broker_domain, false);
  });

  it('drops excluded hosts and unrelated links, dedups, caps at 6, broker-matches first', () => {
    const links = [
      { url: 'https://acmecre.com/x', label: 'Property Website', host: 'acmecre.com' },
      { url: 'https://www.bouldergroup.com/l/1', label: 'The Boulder Group', host: 'www.bouldergroup.com' },
      { url: 'https://www.bouldergroup.com/l/1#frag', label: 'dup', host: 'www.bouldergroup.com' }, // dup of prior
      { url: 'https://random.com/privacy', label: 'Privacy Policy', host: 'random.com' },           // no signal → drop
      { url: 'https://twitter.com/broker', label: 'Follow us', host: 'twitter.com' },               // excluded
    ];
    const out = pickExternalListingUrls(links, new Set(['bouldergroup.com']));
    assert.equal(out.length, 2);
    assert.equal(out[0].matched_broker_domain, true, 'broker-domain match sorts first');
    assert.equal(out[0].host, 'www.bouldergroup.com');
  });
});
