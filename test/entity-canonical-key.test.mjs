/**
 * N15c — `entities.canonical_name` has ONE writer.
 *
 * The contract this file exists to defend: the BEFORE trigger on `entities`
 * stores `lcc_entity_canonical_key(name)`, and `ensureEntityLink` looks the row
 * up with `normalizeCanonicalName(name)`. If the SQL and the JS disagree by a
 * single character the lookup misses and mints a duplicate — which is precisely
 * the failure N15b measured (10,336 of 62,368 live entities invisible to that
 * function, ~4 new duplicates/day).
 *
 * Every `[name, expected]` pair below is a REAL live entity name paired with the
 * output SQL `lcc_entity_canonical_key` actually returned for it on LCC Opps
 * (xengecqvemvfknjvbvrq) on 2026-08-27. They are not hand-computed. 279 pairs
 * were compared live; the set kept here covers every distinct behaviour class.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  normalizeCanonicalName, entityNameTokens, legacyCanonicalName,
} from '../api/_shared/entity-link.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// 1. SQL-verified corpus pairs. name -> lcc_entity_canonical_key(name), live.
// ---------------------------------------------------------------------------
const SQL_VERIFIED = [
  // --- the adopted rule: a DST, its Trust and its LLC are ONE entity ---------
  ['Rainier Rockford DST Trust', 'rainier rockford'],
  ['Rainier Rockford Llc', 'rainier rockford'],
  ['SE VALPO LLC', 'se valpo'],
  ['Se Valpo Dst', 'se valpo'],
  ['Chiapelone Trust', 'chiapelone'],
  ['Artis Reit', 'artis'],
  ['WP Carey REIT', 'wp carey'],
  ['Cole REIT III', 'cole iii'],
  ['White Oak Healthcare MOB REIT', 'white oak healthcare mob'],
  ['GPT Properties Trust', 'gpt properties'],
  ['BPP Pacific Industrial CA REIT Owner 2 LLC', 'bpp pacific industrial ca owner 2'],

  // --- SEMANTIC tokens are KEPT. This is the whole point of the rule: the
  //     outgoing normalizer stripped group/partners/company/co and would
  //     auto-link `Carlyle` to `The Carlyle Group` with no human review.
  ['Marathon Property Group, LLC', 'marathon property group'],
  ['Fason Partners LLC', 'fason partners'],
  ['Rummani Company, Inc.', 'rummani company'],
  ['Woodworth Capital, Inc.', 'woodworth capital'],
  ['Beck Real Estate Properties LLC', 'beck real estate properties'],
  ['Fulton Realty LLC', 'fulton realty'],
  ['Infinite Equities Group', 'infinite equities group'],
  ['The CHY Co', 'chy co'],                       // `co` is NOT a stripped form
  ['The Dunham Co', 'dunham co'],

  // --- leading article only; a trailing "The" is part of the name -----------
  ['The Baker Companies', 'baker companies'],
  ['THE BARBER COMPANIES, INC.', 'barber companies'],
  ['The Molasky Group of Companies', 'molasky group of companies'],
  ['Penstar Group, The', 'penstar group the'],
  ['Edwin Mcintyre Co., Inc., The', 'edwin mcintyre co the'],
  ['The Wanlass Trust', 'wanlass'],

  // --- ampersand becomes the word "and", inline "and"/"of" survive ----------
  ['Bb&T', 'bb and t'],
  ['Ayemi Poke & Deli', 'ayemi poke and deli'],
  ['Cornerstone National Bank & Trust Company', 'cornerstone national bank and company'],
  ['Northern Bank and Trust', 'northern bank and'],
  ['UNNERSTALL LAND & CATTLE CO., L.C.', 'unnerstall land and cattle co l c'],
  ['TR Compass Pointe & McCleary & Earley, Inc.', 'tr compass pointe and mccleary and earley'],
  ['Randy Stolworthy | RRS & Company', 'randy stolworthy rrs and company'],

  // --- non-ASCII is stripped, never transliterated --------------------------
  ['Ärzteversorgung Westfalen-Lippe', 'rzteversorgung westfalen lippe'],
  ['Société Générale', 'soci t g n rale'],
  ['Guía Realty-Sperry CGA', 'gu a realty sperry cga'],
  ['Domino’s', 'domino s'],
  ['Matthews™', 'matthews'],
  ['Svn®', 'svn'],
  ['The Br—dge', 'br dge'],
  ['Unk,2–3', 'unk 2 3'],

  // --- punctuation / whitespace / dotted legal forms ------------------------
  ['PARAMUS WOODBROOK VENTURE, L.L.C.', 'paramus woodbrook venture l l c'],
  ['HPT (Shamokin), L.P.', 'hpt shamokin l p'],
  ['ACP  Management', 'acp management'],
  ['Jacob\n\n                                                        Fahner', 'jacob fahner'],
  ['Slivka Family Children\'s Trust U/A', 'slivka family children s u a'],
  ['Lion Industrial Trust d/b/a LIT Finance II', 'lion industrial d b a lit finance ii'],
  ['740 REGENT STREET ASSOCIATES, A WISCONSIN LIMITED PARTNERSHIP',
   '740 regent street associates a wisconsin partnership'],
  ['747 SPE, LLC', '747 spe'],
  ['TCN, LLC', 'tcn'],
  ['One BSD Ltd', 'one bsd'],
  ['Amigone Ventures Lp', 'amigone ventures'],
  ['Marine Terrace Investment 2 LP', 'marine terrace investment 2'],
  ['Parker’s Corporation', 'parker s'],

  // --- the 'dc:' namespaced fallback for contentless names ------------------
  // 98 live entities reduce to no tokens at all. An empty key would dedup every
  // one of them into a single entity, so they get a namespaced fallback that is
  // provably disjoint from every real key (a real key can never contain ':').
  ['--', 'dc:'],
  ['Corporation', 'dc:corporation'],
  ['LC', 'dc:lc'],
  ['Llc', 'dc:llc'],
  ['The', 'dc:the'],
  ['Trust', 'dc:trust'],
  ['The Corporation Trust Incorporated', 'dc:thecorporationtrustincorporated'],
];

test('normalizeCanonicalName matches SQL lcc_entity_canonical_key on live corpus rows', () => {
  for (const [name, expected] of SQL_VERIFIED) {
    assert.equal(normalizeCanonicalName(name), expected,
      `canonical key drifted from SQL for ${JSON.stringify(name)}`);
  }
});

// ---------------------------------------------------------------------------
// 2. ⚠️ SPACE join, never bare concatenation.
// ---------------------------------------------------------------------------
// lcc_owner_domain_core joins the SAME tokens with no separator, which is right
// for a domain comparator and wrong for a name key: measured over the 43,219
// live organizations it yields 115 FEWER distinct keys, and they are false
// collisions. This is the named row.
test('the space join keeps Gate Way and Gateway apart (no-separator collides them)', () => {
  assert.notEqual(normalizeCanonicalName('Gate Way'), normalizeCanonicalName('Gateway'));
  assert.equal(normalizeCanonicalName('Gate Way'), 'gate way');
  assert.equal(normalizeCanonicalName('Gateway'), 'gateway');
  // and the no-separator form — the thing we must NOT use for names — collides:
  assert.equal(entityNameTokens('Gate Way').join(''), entityNameTokens('Gateway').join(''));
});

test('a real key can never contain a colon, so the dc: fallback cannot collide', () => {
  for (const [name] of SQL_VERIFIED) {
    const toks = entityNameTokens(name);
    if (toks.length > 0) {
      assert.ok(!normalizeCanonicalName(name).includes(':'),
        `real key for ${JSON.stringify(name)} must not contain ':'`);
    }
  }
});

test('normalizeCanonicalName never returns null, undefined or empty', () => {
  for (const v of [null, undefined, '', '   ', '--', '&', '.', 'LLC', 'the']) {
    const k = normalizeCanonicalName(v);
    assert.equal(typeof k, 'string');
    assert.ok(k.length > 0, `empty key for ${JSON.stringify(v)}`);
  }
});

// ---------------------------------------------------------------------------
// 3. Exhaustive character inventory of the live corpus.
// ---------------------------------------------------------------------------
// The two implementations can only diverge on a character whose lower() mapping
// or [^a-z0-9] classification differs between Postgres and JS. This is every
// distinct character present in any of the 62,368 live entity names, with the
// classification Postgres gave it. Proof by exhaustion over the real alphabet
// rather than a sample. (Note `İ` U+0130 — whose JS lowercase is two codepoints
// — does NOT occur in the corpus; it is pinned below as a guard anyway.)
const CORPUS_CHARS = [
  ...'\t\n  -–—,;:!?.\'’"()[]@*/&#%`®+<|$',
  ...'0123456789',
  ...'abcdefghijklmnopqrstuvwxyz',
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  ...'Äéí™�',
];
const SURVIVES = new Set([...'0123456789abcdefghijklmnopqrstuvwxyz']);

test('every character in the live corpus is classified identically to Postgres', () => {
  for (const ch of CORPUS_CHARS) {
    const lowered = ch.toLowerCase();
    const survives = [...lowered].some(c => SURVIVES.has(c));
    // A surviving character must appear in the key; a stripped one must not.
    const key = normalizeCanonicalName('zzz' + ch + 'qqq');
    if (ch === '&') {
      // '&' is the one character that is not a separator and not a survivor:
      // it is rewritten to the WORD "and" before the class strip, in both
      // implementations. SQL-verified: 'Bb&T' -> 'bb and t'.
      assert.equal(key, 'zzz and qqq');
      continue;
    }
    if (survives) {
      assert.ok(key.includes(lowered.replace(/[^a-z0-9]/g, '')),
        `char ${JSON.stringify(ch)} should survive`);
    } else {
      assert.equal(key, 'zzz qqq',
        `char ${JSON.stringify(ch)} should be a separator, got ${JSON.stringify(key)}`);
    }
  }
});

// ---------------------------------------------------------------------------
// 4. There is ONE token list. Two lists is how this broke in the first place.
// ---------------------------------------------------------------------------
test('the stoplist is defined once and both join styles read it', () => {
  const src = readFileSync(join(root, 'api/_shared/entity-link.js'), 'utf8');
  const lists = src.match(/'llc',\s*'llp'/g) || [];
  assert.equal(lists.length, 1,
    'the legal-form token list must appear exactly once in entity-link.js');
  // Every stripped form, checked through the public surface.
  for (const t of ['llc','llp','lp','inc','incorporated','corp','corporation',
                   'ltd','limited','trust','reit','dst','lllp','lc','pllc']) {
    assert.deepEqual(entityNameTokens('acme ' + t), ['acme'], `${t} must be stripped`);
  }
  // Every semantic token, kept.
  for (const t of ['group','partners','company','co','capital','holdings',
                   'properties','realty','associates','management']) {
    assert.deepEqual(entityNameTokens('acme ' + t), ['acme', t], `${t} must be KEPT`);
  }
});

// ---------------------------------------------------------------------------
// 5. The inline copies are gone.
// ---------------------------------------------------------------------------
// entities-handler.js carried a COPY of this rule at two sites that had drifted
// from the original by one character, so `BALTARA ENTERPRISES, L.P.` keyed
// `baltara enterprises lp` there and `baltara enterprises l p` everywhere else.
// api/sync.js and api/domains.js carried two more the N15b census missed.
test('every canonical_name write in api/ resolves to normalizeCanonicalName', () => {
  // ⚠️ The first version of this guard matched the SHAPE `canonical_name: x.trim()`
  // and a mutation that assigned an inline copy to a local const walked straight
  // through it — the "guard checks the label, not the substance" failure. It now
  // RESOLVES the assigned expression: either a direct call, or an identifier whose
  // initializer is a direct call. Substance, not shape.
  const WRITERS = [
    'api/_handlers/entities-handler.js', 'api/sync.js', 'api/domains.js',
    'api/operations.js', 'api/intake.js', 'api/_shared/entity-link.js',
  ];
  const OK = /^\s*(normalizeCanonicalName|buildCanonicalName)\s*\(/;
  for (const f of WRITERS) {
    const src = readFileSync(join(root, f), 'utf8');
    for (const m of src.matchAll(/canonical_name(?:\s*:|\s*=)\s*([^,;\n]+)/g)) {
      const rhs = m[1].trim();
      // filters and PostgREST paths are reads, not writes
      if (/^(eq|in|ilike|is)\./.test(rhs) || rhs.startsWith('`') || rhs.startsWith('$')) continue;
      if (OK.test(rhs)) continue;
      if (/^[A-Za-z_$][\w$]*$/.test(rhs)) {
        // An identifier. If it has an initializer in this file, that initializer
        // must BE the one normalizer — this is what catches an inline copy hidden
        // behind a local const. If it has none it is loop-bound or a parameter
        // (e.g. `for (const [canonical, group] of Object.entries(...))`, which
        // shapes an API response and cannot be a rebuilt key), so it passes.
        const d = src.match(new RegExp('(?:const|let|var)\\s+' + rhs + '\\s*=\\s*([\\s\\S]{0,300}?);'));
        if (!d) continue;
        const init = d[1].trim();
        assert.ok(OK.test(init) || !/replace\(|toLowerCase\(/.test(init),
          `${f}: canonical_name is assigned from '${rhs}', which is built inline `
          + `(${init.replace(/\s+/g, ' ').slice(0, 80)})`);
        continue;
      }
      // anything else (a member expression, a ternary, an inline chain) is allowed
      // only if it is plainly not building the key itself
      assert.ok(!/replace\(/.test(rhs),
        `${f}: canonical_name is built inline from ${rhs.slice(0, 60)}`);
    }
  }
  // entity-link.js may keep exactly one legal-form regex: legacyCanonicalName,
  // the read-only dual-read key. Nothing writes it.
  const el = readFileSync(join(root, 'api/_shared/entity-link.js'), 'utf8');
  assert.equal((el.match(/\\b\(llc\|inc\|corp/g) || []).length, 1);
  assert.ok(/export function legacyCanonicalName/.test(el));
});

// ---------------------------------------------------------------------------
// 6. The dual-read is what makes deploy order safe. Do not remove it early.
// ---------------------------------------------------------------------------
test('ensureEntityLink reads BOTH the current and the legacy key', () => {
  const src = readFileSync(join(root, 'api/_shared/entity-link.js'), 'utf8');
  assert.ok(/legacyCanonicalName\(candidateName\)/.test(src),
    'ensureEntityLink must compute the legacy key');
  assert.ok(/canonical_name=in\.\(/.test(src),
    'the lookup must query both keys in one request');
  // the legacy key must still be the PRE-N15c rule, or the dual-read is a no-op
  assert.equal(legacyCanonicalName('BALTARA ENTERPRISES, L.P.'), 'baltara enterprises l p');
  assert.equal(legacyCanonicalName('The Carlyle Group'), 'the carlyle');
  assert.notEqual(legacyCanonicalName('Fason Partners LLC'), normalizeCanonicalName('Fason Partners LLC'));
});
