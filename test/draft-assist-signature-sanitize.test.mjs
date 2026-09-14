// Prompt 127 — a dirty signature asset must never reach a draft.
//
// P126 merged assets that were NOT clean: signature-reply.html was 12.7 KB and
// carried a whole LinkedIn notification email, four tracking-pixel <img> tags and
// a broken cid: logo below the signature; signature-full.html carried three cid:
// logos plus tracking imgs. `loadSignatureHtml` stripped HTML comments and
// nothing else, so `appendSignature` would have stapled all of it onto every
// reply draft — invisible in the JSON envelope, visible only when the mail was
// opened. P126's own tests passed because they ran against trimmed working
// copies, not the bytes that merged.
//
// So the acceptance criteria here are deliberately about the LOADER, not the
// bytes: the assets are clean today, and that must stop being the only thing
// standing between a recipient and someone else's mail.
//   1. the loader sanitizes — script/img/link/style/iframe, on*= handlers,
//      javascript:/cid:/data: URLs, and everything at or after a quote boundary
//   2. it is BOUNDED, and a block that cannot be made safe degrades to
//      not_configured (append nothing) rather than leaking
//   3. removal is OBSERVABLE — a silently-cleaned asset hides that the stored
//      bytes are wrong
//   4. the committed assets are verified with a PARSER: balanced, image-free,
//      and carrying the exact contact facts
//   5. the exact bytes P126 shipped, fed back through the real call path, are
//      neutralized
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  sanitizeSignatureHtml, tokenizeHtml, MAX_SIGNATURE_BYTES, MAX_INPUT_BYTES,
} from '../api/_shared/html-sanitize.js';
import {
  appendSignature, loadSignatureHtml, VARIANTS, SIGNATURE_ENV_VARS,
  _resetSignatureCache, _resetSignatureWarnings,
} from '../api/_shared/email-signature.js';

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), 'utf8');
const asset = (v) => read(`docs/os/voice/signatures/signature-${v}.html`);

const PROSE = '<div>Got it — I will get you the rent roll Monday.<br>Thanks.</div>';
const PLAIN = 'Got it — I will get you the rent roll Monday.\nThanks.';

/**
 * The exact SHAPE of the asset P126 merged: the real signature block, then the
 * over-captured LinkedIn notification email with its tracking pixels, its cid:
 * logo, and the Outlook quote header that separated them.
 */
const P126_DIRTY = `${asset('reply')}
<img src="https://www.linkedin.com/emimp/ip_AAA.gif" height="1" width="1" alt="">
<div id="appendonsend"></div>
<div><img src="cid:image001.png@01DA.5F1" width="180" height="40"></div>
<div style="border:none;border-top:solid #E1E1E1 1.0pt;padding:3.0pt 0in 0in 0in">
<b>From:</b> LinkedIn &lt;messages-noreply@linkedin.com&gt;<br>
<b>Sent:</b> Tuesday, August 19, 2026 6:02 AM<br>
<b>To:</b> Briggs, Scott &lt;sabriggs@northmarq.com&gt;<br>
<b>Subject:</b> Scott, you have 3 new invitations
</div>
<div class="WordSection1"><p>See who viewed your profile</p>
<img src="https://www.linkedin.com/emimp/tracking2.gif" height="1" width="1">
<a href="https://www.linkedin.com/comm/psettings/email">Unsubscribe</a>
<img src="https://www.linkedin.com/emimp/tracking3.gif" height="1" width="1"></div>`;

// ---------------------------------------------------------------------------
// 5 — the leak that shipped, tested directly
// ---------------------------------------------------------------------------
describe('P127 — the exact bytes P126 shipped are neutralized', () => {
  it('the dirty asset loses the LinkedIn email, the pixels and the cid: logo', () => {
    const { html } = sanitizeSignatureHtml(P126_DIRTY);
    assert.ok(html, 'the real signature at the top must survive');
    assert.equal(/<img/i.test(html), false, 'no tracking pixel may survive');
    assert.equal(/linkedin/i.test(html), false, 'no part of the captured email may survive');
    assert.equal(/cid:/i.test(html), false, 'no broken cid: reference may survive');
    assert.equal(/From:|Sent:|Subject:/.test(html), false, 'no quoted header may survive');
    assert.equal(/appendonsend|WordSection/i.test(html), false, 'no quote sentinel may survive');
  });

  it('and it keeps the signature it was supposed to be', () => {
    const { html } = sanitizeSignatureHtml(P126_DIRTY);
    for (const detail of ['Scott Briggs', 'Senior Vice President', 'Northmarq',
      '(918) 794-9787', 'sabriggs@northmarq.com']) {
      assert.ok(html.includes(detail), `the block must still carry ${detail}`);
    }
  });

  it('appendSignature — the real call path — appends nothing dirty', () => {
    const r = appendSignature(PROSE, { plainBody: PLAIN, signatureHtml: P126_DIRTY });
    assert.equal(r.status, 'appended');
    assert.equal(/<img|linkedin|cid:|<script/i.test(r.html), false,
      'the draft body handed to the flow must carry none of it');
    assert.ok(r.html.startsWith(PROSE), 'the prose is untouched');
    assert.ok(r.html.includes('794-9787'), 'the signature is still appended');
  });

  it('a caller-supplied block is sanitized too — there is no trusted branch', () => {
    // The `signatureHtml` override and the env overrides are as capable of
    // carrying a pasted-in pixel as a committed file is.
    const r = appendSignature(PROSE, { plainBody: PLAIN, signatureHtml: '<div>Hi<img src="https://t/px.gif"></div>' });
    assert.equal(/<img/i.test(r.html), false);
    assert.deepEqual(r.sanitized.removed, ['element:img']);
  });
});

// ---------------------------------------------------------------------------
// 1 — what the sanitizer removes
// ---------------------------------------------------------------------------
describe('P127 — active and remote content is removed', () => {
  const cases = [
    ['script with content', '<div>A<script>alert(1)</script>B</div>', /alert|script/i],
    ['style block', '<div>A<style>body{color:red}</style>B</div>', /color:red|<style/i],
    ['iframe', '<div>A<iframe src="https://x"></iframe>B</div>', /<iframe/i],
    ['link stylesheet', '<div>A<link rel="stylesheet" href="https://x/a.css">B</div>', /<link/i],
    ['remote image', '<div>A<img src="https://t/px.gif">B</div>', /<img/i],
    ['cid image', '<div>A<img src="cid:logo@01D">B</div>', /<img|cid:/i],
    ['data-uri image', '<div>A<img src="data:image/gif;base64,R0lGOD">B</div>', /<img|data:/i],
    ['onclick handler', '<div onclick="steal()">A</div>', /onclick|steal/i],
    ['onerror handler', '<div onerror="x()">A</div>', /onerror/i],
    ['javascript: href', '<a href="javascript:alert(1)">A</a>', /javascript/i],
    ['obfuscated javascript: href', '<a href="java\nscript:alert(1)">A</a>', /javascript|java\s*script/i],
    ['background-image url()', '<div style="background:url(https://t/px.gif)">A</div>', /url\s*\(/i],
    ['@import in style', '<div style="@import url(x)">A</div>', /@import/i],
    ['svg', '<div>A<svg><circle/></svg>B</div>', /<svg|circle/i],
    ['form', '<div>A<form action="https://evil"><input name="p"></form>B</div>', /<form|<input/i],
    ['meta refresh', '<div>A<meta http-equiv="refresh" content="0;url=https://x">B</div>', /<meta/i],
  ];
  for (const [label, input, forbidden] of cases) {
    it(`removes ${label}`, () => {
      const { html } = sanitizeSignatureHtml(input);
      assert.equal(forbidden.test(html || ''), false, `${label} leaked: ${html}`);
      assert.ok((html || '').includes('A'), 'the surrounding text must survive');
    });
  }

  it('an <img> hidden by odd casing or spacing is still an <img>', () => {
    // The class of thing a regex strip misses. The tokenizer reads the tag name,
    // not the literal `<img `.
    for (const src of ['<div>A<IMG\n  SRC="https://t/px.gif"\n>B</div>',
      '<div>A<img/src="https://t/px.gif">B</div>',
      '<div>A< img src="https://t/px.gif">B</div>']) {
      const { html } = sanitizeSignatureHtml(src);
      assert.equal(/<img/i.test(html || ''), false, `leaked: ${src} -> ${html}`);
    }
  });

  it('an unclosed <script> cannot leave live markup behind it', () => {
    const { html } = sanitizeSignatureHtml('<div>A</div><script>if (a < b) { go() }');
    assert.equal(/go\(\)|script/i.test(html || ''), false);
    assert.ok(html.includes('A'));
  });

  it('a `>` inside a quoted attribute does not end the tag early', () => {
    const { html } = sanitizeSignatureHtml('<div title="a > b">Scott</div>');
    assert.ok(html.includes('Scott'));
    assert.equal(html.includes('b&quot;&gt;') || / b">/.test(html), true);
  });

  it('rebalances the output — an unclosed or stray tag cannot escape the block', () => {
    // The block is concatenated into a live draft body, so an unclosed <div>
    // would swallow the quoted thread below it and a stray </div> would break
    // out of ours. Neither can happen: the output is rebuilt from a tag stack.
    assert.equal(sanitizeSignatureHtml('<div><div><div>Scott Briggs').html,
      '<div><div><div>Scott Briggs</div></div></div>');
    assert.equal(sanitizeSignatureHtml('<div>A</span></div></div>B').html, '<div>A</div>B');
  });

  it('drops a dropped element\'s children with it', () => {
    const { html } = sanitizeSignatureHtml('<div>A<object><img src="https://t/px.gif"><script>y()</script></object>B</div>');
    assert.equal(html, '<div>AB</div>');
  });

  it('an entity-obfuscated handler name is still not on the allowlist', () => {
    const { html } = sanitizeSignatureHtml('<div on&#99;lick="steal()">A</div>');
    assert.equal(/steal|click/i.test(html), false, 'an allowlist refuses what it does not recognise');
  });

  it('keeps the links a signature actually needs', () => {
    for (const href of ['mailto:sabriggs@northmarq.com', 'https://www.northmarq.com/', 'tel:+19187949787']) {
      const { html } = sanitizeSignatureHtml(`<a href="${href}">x</a>`);
      assert.ok(html.includes(href), `${href} must survive`);
    }
  });

  it('keeps the branded inline styles the block is built from', () => {
    const style = "font-family: 'Futura PT', Jost, Arial; color: rgb(0,61,165); font-weight: 700;";
    const { html } = sanitizeSignatureHtml(`<div style="${style}">Scott Briggs</div>`);
    assert.ok(html.includes('Futura PT') && html.includes('rgb(0,61,165)'),
      'brand fonts and colors are the whole point of a styled block');
  });
});

// ---------------------------------------------------------------------------
// 1 (cont.) — quote / forward boundaries
// ---------------------------------------------------------------------------
describe('P127 — everything at or after a quote boundary is dropped', () => {
  const boundaries = [
    ['Outlook appendonsend', '<div id="appendonsend"></div>'],
    ['Outlook reply/forward div', '<div id="divRplyFwdMsg">'],
    ['Gmail quote', '<div class="gmail_quote">'],
    ['Word section wrapper', '<div class="WordSection1">'],
  ];
  for (const [label, tag] of boundaries) {
    it(`cuts at ${label}`, () => {
      const { html } = sanitizeSignatureHtml(
        `<div>Scott Briggs</div><div>D (918) 794-9787</div>${tag}<div>SOMEONE ELSES MAIL</div>`);
      assert.ok(html.includes('Scott Briggs'), 'the block above the boundary survives');
      assert.equal(/SOMEONE ELSES MAIL/.test(html), false, `${label} did not cut`);
    });
  }

  it('cuts at a From:/Sent: header block', () => {
    const { html } = sanitizeSignatureHtml(
      '<div>Scott Briggs</div><div><b>From:</b> Someone &lt;a@b.com&gt;<br><b>Sent:</b> Tuesday</div>');
    assert.ok(html.includes('Scott Briggs'));
    assert.equal(/From:|Sent:|a@b\.com/.test(html), false);
  });

  it('cuts at an "On … wrote:" attribution', () => {
    const { html } = sanitizeSignatureHtml(
      '<div>Scott Briggs</div><div>On Tue, Aug 19, 2026, Jane Doe wrote:</div><div>quoted body</div>');
    assert.equal(/wrote:|quoted body/.test(html || ''), false);
  });

  it('an EMPTY boundary sentinel at the very top is unwrapped, not a cut', () => {
    // Outlook writes an empty <div id=appendonsend> on a freshly composed
    // message. Cutting there would delete the whole signature — the corpus
    // cleaner already learned this (MIN_LEAD_CHARS); the same rule applies here.
    const { html, removed } = sanitizeSignatureHtml(
      '<div id="appendonsend"></div><div>Scott Briggs</div><div>D (918) 794-9787</div>');
    assert.ok(html && html.includes('Scott Briggs') && html.includes('794-9787'),
      'a leading sentinel must not empty the block');
    assert.ok(removed.includes('quote-sentinel'));
  });

  it('reuses the corpus cleaner\'s boundary sets rather than forking them', () => {
    const code = read('api/_shared/html-sanitize.js')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    assert.match(code, /_internals\.QUOTE_BOUNDARY_TAGS/);
    assert.match(code, /_internals\.REPLY_MARKERS/);
    assert.match(code, /_internals\.MIN_LEAD_CHARS/);
    assert.equal(/appendonsend|divRplyFwdMsg|gmail_quote/.test(code), false,
      'a private copy of the boundary markers is exactly the normaliser drift '
      + 'CLAUDE.md warns about — the cleaner and the loader would diverge');
  });

  it('reading the boundary regex does not disturb the cleaner that shares it', () => {
    // QUOTE_BOUNDARY_TAGS is a /g regex; a stateful `.test()` would make the
    // cleaner's next call skip a boundary depending on who ran first.
    const dirty = '<div>Scott Briggs</div><div>D (918) 794-9787</div><div id="appendonsend">junk</div>';
    const a = sanitizeSignatureHtml(dirty).html;
    const b = sanitizeSignatureHtml(dirty).html;
    assert.equal(a, b, 'two identical calls must give identical results');
    assert.equal(/junk/.test(a), false);
  });
});

// ---------------------------------------------------------------------------
// 2 — bounded, and degrading toward LESS signature
// ---------------------------------------------------------------------------
describe('P127 — bounded, and it degrades rather than leaks', () => {
  it('a real signature fits well inside the ceiling', () => {
    for (const v of VARIANTS) {
      const bytes = Buffer.byteLength(asset(v), 'utf8');
      assert.ok(bytes < MAX_SIGNATURE_BYTES,
        `${v} asset is ${bytes} bytes — at or over the ${MAX_SIGNATURE_BYTES}-byte ceiling`);
    }
  });

  it('an over-size block is REJECTED, never truncated mid-tag', () => {
    const huge = `<div>${'Scott Briggs. '.repeat(MAX_SIGNATURE_BYTES)}</div>`;
    const r = sanitizeSignatureHtml(huge);
    assert.equal(r.html, null, 'a block over the ceiling must not be handed on');
    assert.match(r.reason, /over the .*ceiling/);
    assert.ok(r.removed.includes('oversize-block'));
  });

  it('an absurd input is refused before it is parsed', () => {
    const r = sanitizeSignatureHtml('x'.repeat(MAX_INPUT_BYTES + 1));
    assert.equal(r.html, null);
    assert.ok(r.removed.includes('oversize-input'));
  });

  it('a block that is ONLY removable content sanitizes to nothing, not to junk', () => {
    const r = sanitizeSignatureHtml('<script>alert(1)</script><img src="https://t/px.gif">');
    assert.equal(r.html, null);
    assert.match(r.reason, /sanitized to nothing/);
  });

  it('a rejected block reaches appendSignature as not_configured', () => {
    const r = appendSignature(PROSE, {
      plainBody: PLAIN,
      signatureHtml: '<script>alert(1)</script><img src="https://t/px.gif">',
    });
    assert.equal(r.status, 'not_configured');
    assert.equal(r.html, PROSE, 'the body must come back untouched');
    assert.match(r.note, /REJECTED/);
    assert.match(r.note, /rather than letting un-vetted content reach a recipient/);
  });

  it('an empty configuration is still "not configured", not a sanitizer failure', () => {
    const r = sanitizeSignatureHtml('   ');
    assert.equal(r.html, null);
    assert.equal(r.reason, null, 'nothing configured is not an error to report');
  });

  it('a dirty ENV override is sanitized on the same terms as the asset', () => {
    const key = SIGNATURE_ENV_VARS.reply;
    const prev = process.env[key];
    try {
      process.env[key] = '<div>Scott Briggs<img src="https://t/px.gif"></div>';
      _resetSignatureCache(); _resetSignatureWarnings();
      const r = loadSignatureHtml('reply');
      assert.equal(r.source, 'env');
      assert.equal(/<img/i.test(r.html), false, 'an ops escape hatch is not a trusted source');
      assert.deepEqual(r.removed, ['element:img']);
    } finally {
      if (prev === undefined) delete process.env[key]; else process.env[key] = prev;
      _resetSignatureCache(); _resetSignatureWarnings();
    }
  });
});

// ---------------------------------------------------------------------------
// 3 — removal is observable
// ---------------------------------------------------------------------------
describe('P127 — a dirty asset is observable, not silently cleaned', () => {
  it('the loader reports what it removed', () => {
    const key = SIGNATURE_ENV_VARS.reply;
    const prev = process.env[key];
    try {
      process.env[key] = '<div onclick="x()">Scott<img src="cid:a"></div>';
      _resetSignatureCache(); _resetSignatureWarnings();
      const r = loadSignatureHtml('reply');
      assert.ok(r.removed.includes('event-handler:onclick'));
      assert.ok(r.removed.includes('element:img'));
    } finally {
      if (prev === undefined) delete process.env[key]; else process.env[key] = prev;
      _resetSignatureCache(); _resetSignatureWarnings();
    }
  });

  it('it warns on stderr — a clean render is not evidence the bytes are clean', () => {
    const key = SIGNATURE_ENV_VARS.reply;
    const prev = process.env[key];
    const orig = console.warn;
    const lines = [];
    try {
      console.warn = (...a) => lines.push(a.join(' '));
      process.env[key] = '<div>Scott<img src="https://t/px.gif"></div>';
      _resetSignatureCache(); _resetSignatureWarnings();
      loadSignatureHtml('reply');
      loadSignatureHtml('reply');   // the warning is once per source, not per call
    } finally {
      console.warn = orig;
      if (prev === undefined) delete process.env[key]; else process.env[key] = prev;
      _resetSignatureCache(); _resetSignatureWarnings();
    }
    assert.equal(lines.length, 1, 'warn once per source, or a hot path floods the log');
    assert.match(lines[0], /\[email-signature\]/);
    assert.match(lines[0], /element:img/);
  });

  it('what sits BELOW a cut is reported too, not swallowed by the cut', () => {
    // The P126 asset's pixels sat below the quote boundary. Reporting only
    // "quoted-thread" would never mention them, and they are why anyone looked.
    const { removed } = sanitizeSignatureHtml(P126_DIRTY);
    assert.ok(removed.includes('quoted-thread'));
    assert.ok(removed.includes('below-cut:img'), `expected below-cut:img in ${JSON.stringify(removed)}`);
  });

  it('a CLEAN asset reports no removals — the signal stays meaningful', () => {
    _resetSignatureCache();
    const saved = {};
    for (const k of Object.values(SIGNATURE_ENV_VARS)) { saved[k] = process.env[k]; delete process.env[k]; }
    try {
      for (const v of VARIANTS) {
        const r = loadSignatureHtml(v);
        assert.deepEqual(r.removed, [], `${v} asset is not clean: ${JSON.stringify(r.removed)}`);
        assert.equal(r.rejected, null);
      }
    } finally {
      for (const [k, val] of Object.entries(saved)) if (val !== undefined) process.env[k] = val;
      _resetSignatureCache();
    }
  });
});

// ---------------------------------------------------------------------------
// 4 — the committed assets, verified with the parser
// ---------------------------------------------------------------------------
/** Walk the token stream and report structural faults. Not a regex spot-check. */
function parseAssetStructure(html) {
  const tokens = tokenizeHtml(html);
  const VOID = new Set(['br', 'hr', 'wbr', 'col', 'img', 'input', 'link', 'meta']);
  const stack = [];
  const faults = [];
  const elements = new Set();
  const attrs = new Set();
  const urls = [];
  for (const tok of tokens) {
    if (tok.t === 'start') {
      elements.add(tok.name);
      for (const a of tok.attrs) {
        attrs.add(a.name);
        if (a.name === 'href' || a.name === 'src') urls.push(a.value);
      }
      if (!tok.selfClosing && !VOID.has(tok.name)) stack.push(tok.name);
    } else if (tok.t === 'end') {
      if (VOID.has(tok.name)) continue;
      if (stack[stack.length - 1] !== tok.name) faults.push(`</${tok.name}> closes <${stack[stack.length - 1] || 'nothing'}>`);
      else stack.pop();
    } else if (tok.t === 'decl' && !/^<!--/.test(tok.raw)) {
      faults.push(`stray declaration ${tok.raw.slice(0, 24)}`);
    }
  }
  for (const open of stack) faults.push(`<${open}> never closed`);
  return { faults, elements, attrs, urls, tokens };
}

describe('P127 — the committed assets, verified with a parser', () => {
  for (const v of VARIANTS) {
    it(`${v}: every tag is balanced and closed`, () => {
      const { faults } = parseAssetStructure(asset(v));
      assert.deepEqual(faults, [], `${v} is not well-formed: ${faults.join('; ')}`);
    });

    it(`${v}: carries no image, script, or external resource of any kind`, () => {
      const { elements, urls } = parseAssetStructure(asset(v));
      for (const banned of ['img', 'script', 'style', 'link', 'iframe', 'object', 'svg', 'meta', 'form']) {
        assert.equal(elements.has(banned), false, `${v} carries a <${banned}>`);
      }
      for (const url of urls) {
        assert.match(url, /^(?:mailto:|tel:|https:\/\/(?:www\.)?northmarq\.com)/,
          `${v} points at ${url} — a signature reaches only Northmarq, mail, or a phone`);
      }
    });

    it(`${v}: carries no event handler and no quote residue`, () => {
      const { attrs, tokens } = parseAssetStructure(asset(v));
      for (const a of attrs) {
        assert.equal(/^on/i.test(a), false, `${v} carries an ${a} handler`);
      }
      const text = tokens.filter((t) => t.t === 'text').map((t) => t.raw).join(' ');
      for (const residue of [/linkedin/i, /From:/, /Sent:/, /Unsubscribe/i, /wrote:/]) {
        assert.equal(residue.test(text), false, `${v} carries quote residue matching ${residue}`);
      }
    });

    it(`${v}: survives its own sanitizer unchanged in substance`, () => {
      const r = sanitizeSignatureHtml(asset(v));
      assert.ok(r.html, `${v} must sanitize to something`);
      assert.deepEqual(r.removed, [], `${v} should need no cleaning: ${JSON.stringify(r.removed)}`);
      // Idempotent: sanitizing the output again is a no-op.
      assert.equal(sanitizeSignatureHtml(r.html).html, r.html);
    });
  }

  it('the REPLY asset carries exactly the reply-block facts', () => {
    const { tokens } = parseAssetStructure(asset('reply'));
    const text = tokens.filter((t) => t.t === 'text').map((t) => t.raw).join(' ')
      .replace(/&nbsp;/g, ' ');
    for (const fact of ['Scott Briggs', 'Senior Vice President', 'Northmarq',
      '(918) 794-9787', 'sabriggs@northmarq.com']) {
      assert.ok(text.includes(fact), `the reply block must carry ${fact}`);
    }
    // The address belongs to the FULL block only — see the P126 measurement.
    for (const absent of ['6120', 'Yale', 'Tulsa']) {
      assert.equal(text.includes(absent), false, `${absent} does not belong in the reply block`);
    }
  });

  it('the FULL asset carries the address and the tagline, on top of the reply facts', () => {
    const { tokens } = parseAssetStructure(asset('full'));
    const text = tokens.filter((t) => t.t === 'text').map((t) => t.raw).join(' ')
      .replace(/&nbsp;/g, ' ');
    for (const fact of ['Scott Briggs', 'Senior Vice President', 'Commercial Investment Sales',
      '(918) 794-9787', 'sabriggs@northmarq.com', '6120 S. Yale Ave., Ste. 300', 'Tulsa, OK 74136',
      'Fund Management', 'northmarq.com']) {
      assert.ok(text.includes(fact), `the full block must carry ${fact}`);
    }
  });

  it('each contact fact appears exactly ONCE per block', () => {
    for (const v of VARIANTS) {
      const html = asset(v);
      for (const fact of ['Scott Briggs', '(918) 794-9787']) {
        const n = html.split(fact).length - 1;
        assert.equal(n, 1, `${v}: ${fact} appears ${n} times — a duplicated fact is an over-capture`);
      }
    }
  });
});
