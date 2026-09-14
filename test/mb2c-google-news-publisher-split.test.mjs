// MB2c — splitGoogleNewsTitle() dropped every hyphenated publisher name.
//
// The publisher half of the "Headline - Publisher" split regex was
// restricted to `[^-–—]+` -- no dash allowed in the PUBLISHER -- so a title
// ending in a hyphenated outlet ("... - Honolulu Star-Advertiser", "... -
// ad-hoc-news.de") failed the whole regex: `publisher: null` AND the raw
// " - Publisher" suffix stayed stuck on the headline. Widening the
// publisher half to `.+` fixes it; the headline half's `(.*)` is already
// greedy and anchors to the LAST separator, so a headline containing an
// earlier dash still splits correctly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// This file cannot be `import`ed directly under Node -- it carries a Deno
// remote import (`https://deno.land/...`) that Node's loader refuses
// (ERR_UNSUPPORTED_ESM_URL_SCHEME), the same constraint documented in this
// repo's `briefing-analyst-take.test.mjs`. So the EXACT regex literal is
// pulled out of the shipped source and re-applied here, rather than
// hand-copying a second implementation that could silently drift from it.
const SRC = readFileSync(
  fileURLToPath(new URL('../supabase/functions/briefing-intel-snapshot/index.ts', import.meta.url)), 'utf8');
const fnBody = SRC.match(
  /function splitGoogleNewsTitle\(rawTitle: string\)[\s\S]*?\n\}/,
)?.[0];
if (!fnBody) throw new Error('splitGoogleNewsTitle() not found in source -- test cannot verify the live regex');
const regexLiteral = fnBody.match(/rawTitle\.match\((\/(?:\\.|[^\/])+\/)\)/)?.[1];
if (!regexLiteral) throw new Error('splitGoogleNewsTitle() regex literal not found -- source shape changed');

function splitGoogleNewsTitle(rawTitle) {
  // eslint-disable-next-line no-new-func
  const re = new Function(`return ${regexLiteral};`)();
  const m = rawTitle.match(re);
  if (!m) return { headline: rawTitle, publisher: null };
  return { headline: m[1].trim(), publisher: m[2].trim() || null };
}

test('hyphenated publisher names now split correctly (the MB2c regression)', () => {
  assert.deepEqual(
    splitGoogleNewsTitle('DaVita to open new kidney dialysis center - Honolulu Star-Advertiser'),
    { headline: 'DaVita to open new kidney dialysis center', publisher: 'Honolulu Star-Advertiser' },
  );
  assert.deepEqual(
    splitGoogleNewsTitle('DaVita stock heads into the open after a 0.01% dip - ad-hoc-news.de'),
    { headline: 'DaVita stock heads into the open after a 0.01% dip', publisher: 'ad-hoc-news.de' },
  );
  assert.deepEqual(
    splitGoogleNewsTitle('Fresenius Medical Care stock heads into the open after a 0.13 percent dip - ad-hoc-news.de'),
    { headline: 'Fresenius Medical Care stock heads into the open after a 0.13 percent dip', publisher: 'ad-hoc-news.de' },
  );
});

test('a headline carrying its OWN dash before the separator still keeps the true publisher suffix', () => {
  // These previously-correct parses must not change under the widened regex
  // -- the greedy `(.*)` on the headline half already anchors to the LAST
  // " - "/" – " in the string.
  assert.deepEqual(
    splitGoogleNewsTitle(
      'Nature Medicine Commission on dialysis policy in low- and middle-income countries - nature.com',
    ),
    {
      headline: 'Nature Medicine Commission on dialysis policy in low- and middle-income countries',
      publisher: 'nature.com',
    },
  );
  assert.deepEqual(
    splitGoogleNewsTitle('Ready4 Ci-Ca: Innovation in clinical education - Fresenius Medical Care'),
    { headline: 'Ready4 Ci-Ca: Innovation in clinical education', publisher: 'Fresenius Medical Care' },
  );
  assert.deepEqual(
    splitGoogleNewsTitle('NYC Health + Hospitals/Gouverneur Opens Dialysis Den … - NYC Health + Hospitals'),
    { headline: 'NYC Health + Hospitals/Gouverneur Opens Dialysis Den …', publisher: 'NYC Health + Hospitals' },
  );
});

test('a title with no separator returns publisher=null and the headline untouched -- never guesses', () => {
  assert.deepEqual(
    splitGoogleNewsTitle('DaVita announces new clinic'),
    { headline: 'DaVita announces new clinic', publisher: null },
  );
});

test('em dash and en dash separators still split (not only the ASCII hyphen)', () => {
  assert.deepEqual(
    splitGoogleNewsTitle('Headline text — Some Outlet'),
    { headline: 'Headline text', publisher: 'Some Outlet' },
  );
  assert.deepEqual(
    splitGoogleNewsTitle('Headline text – Some-Outlet.com'),
    { headline: 'Headline text', publisher: 'Some-Outlet.com' },
  );
});
