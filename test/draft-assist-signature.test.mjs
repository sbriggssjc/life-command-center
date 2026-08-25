// Prompt 126 — draft-assist appends Scott's signature block.
//
// The acceptance criteria from the prompt, enforced structurally:
//   1. the block is appended so a saved draft is send-ready
//   2. it is sourced from ONE stored config, never fabricated, and an absent
//      config appends NOTHING and says `not_configured`
//   3. it is appended exactly ONCE — never under an existing signature
//   4. it sits above the quoted thread on a reply
//   5. the dry run shows exactly what a save writes
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  appendSignature, hasSignature, loadSignatureHtml, signatureVariantFor,
  SIGNATURE_ASSETS, SIGNATURE_ENV_VARS, VARIANTS, _resetSignatureCache,
} from '../api/_shared/email-signature.js';
import { cleanEmailBody, _internals } from '../api/_shared/voice-corpus-clean.js';

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), 'utf8');
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

const PROSE = '<div>Got it — I will get you the rent roll Monday.<br>Thanks.</div>';
const PLAIN = 'Got it — I will get you the rent roll Monday.\nThanks.';

describe('P126 — the block is appended and the draft becomes send-ready', () => {
  it('appends the configured signature once, after the prose', () => {
    const r = appendSignature(PROSE, { plainBody: PLAIN });
    assert.equal(r.status, 'appended');
    assert.equal(r.source, 'asset');
    assert.ok(r.html.startsWith(PROSE), 'the prose must remain first');
    assert.ok(r.html.length > PROSE.length, 'something must have been appended');
  });

  it('the appended block carries the real contact details', () => {
    const { html } = appendSignature(PROSE, { plainBody: PLAIN, inReplyTo: '<x@y>' });
    for (const detail of ['Scott Briggs', 'Senior Vice President', 'Northmarq',
      '(918) 794-9787', 'sabriggs@northmarq.com']) {
      assert.ok(html.includes(detail), `signature must carry ${detail}`);
    }
  });

  it('appends EXACTLY ONE block — each detail appears once', () => {
    const { html } = appendSignature(PROSE, { plainBody: PLAIN, inReplyTo: '<x@y>' });
    for (const detail of ['Scott Briggs', 'Senior Vice President', '(918) 794-9787']) {
      const n = html.split(detail).length - 1;
      assert.equal(n, 1, `${detail} must appear exactly once, saw ${n}`);
    }
  });

  it('never leaks the asset provenance comment to a recipient', () => {
    const { html } = appendSignature(PROSE, { plainBody: PLAIN });
    assert.equal(html.includes('<!--'), false, 'HTML comments must be stripped');
    assert.equal(/PROVENANCE|measured/i.test(html), false);
  });
});

describe('P126 doctrine 1 — never fabricate a contact detail', () => {
  it('appends NOTHING and reports not_configured when no signature is stored', () => {
    const r = appendSignature(PROSE, { plainBody: PLAIN, signatureHtml: null });
    assert.equal(r.status, 'not_configured');
    assert.equal(r.html, PROSE, 'the body must be returned untouched');
    assert.match(r.note, /rather than inventing/i);
  });

  it('an empty stored signature is "not configured", not an empty append', () => {
    assert.equal(appendSignature(PROSE, { signatureHtml: '   ' }).status, 'not_configured');
  });

  it('the REPLY asset carries only what his real reply block carries', () => {
    const block = read('docs/os/voice/signatures/signature-reply.html')
      .replace(/<!--[\s\S]*?-->/g, '');
    // Measured over his 592 signature-bearing sent messages of the last 120 days,
    // the top-posted REPLY block carries the street address 0 times — the address
    // belongs to the FULL block. The offer-submission docs describe that fuller
    // block, so following them here would stamp an address on every reply.
    for (const absent of ['6120', 'Yale', 'Tulsa', 'Fund Management', 'northmarq.com/']) {
      assert.equal(block.includes(absent), false,
        `${absent} is not in his live reply block — it must not be added to it`);
    }
    assert.ok(block.includes('(918) 794-9787') && block.includes('Senior Vice President'));
  });

  it('the FULL asset carries the new-email details, verbatim', () => {
    const block = read('docs/os/voice/signatures/signature-full.html')
      .replace(/<!--[\s\S]*?-->/g, '');
    for (const detail of ['Scott Briggs', 'Senior Vice President', 'Commercial Investment Sales',
      '(918) 794-9787', 'sabriggs@northmarq.com', '6120 S. Yale Ave., Ste. 300', 'Tulsa, OK 74136',
      'Fund Management', 'northmarq.com']) {
      assert.ok(block.includes(detail), `full signature must carry ${detail}`);
    }
  });

  it('NEITHER asset ships a cid: or remote image that would render broken', () => {
    for (const v of VARIANTS) {
      const block = read(`docs/os/voice/signatures/signature-${v}.html`)
        .replace(/<!--[\s\S]*?-->/g, '');
      assert.equal(/cid:/.test(block), false,
        `${v}: a cid: reference points at an attachment a generated draft does not have`);
      assert.equal(/<img/i.test(block), false, `${v}: no image dependency`);
      assert.equal(/src\s*=\s*["']https?:/i.test(block), false, `${v}: no remote image fetch`);
    }
  });

  it('no placeholder ever ships in a signature', () => {
    for (const v of VARIANTS) {
      const block = read(`docs/os/voice/signatures/signature-${v}.html`)
        .replace(/<!--[\s\S]*?-->/g, '');
      assert.equal(/\[|\{\{|TODO|TBD/.test(block), false, `${v}: no placeholders`);
    }
  });

  it('there is no runtime path that parses a signature out of sent mail', () => {
    const code = stripComments(read('api/_shared/email-signature.js'));
    assert.equal(/email_bodies|activity_events|opsQuery/.test(code), false,
      'the signature is configuration — it must never be scraped from the corpus at runtime');
  });
});

describe('P126 doctrine 2 — never double-sign', () => {
  it('skips the append when the draft already carries a signature', () => {
    const already = 'Thanks.\n\nScott Briggs\nSenior Vice President · Northmarq';
    const r = appendSignature(`<div>${already}</div>`, { plainBody: already });
    assert.equal(r.status, 'already_present');
    assert.equal(r.html.includes('794-9787'), false, 'must not graft a second block on');
  });

  it('detects a signature by ANY of the cleaner anchors', () => {
    assert.equal(hasSignature('Call me at 918-794-9787.'), true);
    assert.equal(hasSignature('reach me at sabriggs@northmarq.com'), true);
    assert.equal(hasSignature('Thanks. Let me know.'), false);
    assert.equal(hasSignature(''), false);
  });

  it('reuses the corpus cleaner anchors rather than forking a second definition', () => {
    const code = stripComments(read('api/_shared/email-signature.js'));
    assert.match(code, /_internals\.SIGNATURE_ANCHORS/);
    // A private copy of the marker list is the normaliser drift CLAUDE.md warns
    // about — the two would diverge and the cleaner would strip what the
    // appender does not recognise.
    assert.equal(/Senior Vice President|794.?9787/.test(code), false,
      'must not restate the signature markers locally');
    assert.ok(_internals.SIGNATURE_ANCHORS.length > 0);
  });

  it('is idempotent — appending twice adds only one block', () => {
    const once = appendSignature(PROSE, { plainBody: PLAIN });
    const twice = appendSignature(once.html, { plainBody: once.html });
    assert.equal(twice.status, 'already_present');
    assert.equal(twice.html, once.html);
  });
});

describe('P126 doctrine 3 — above the quoted thread', () => {
  it('the flow composes body_html BEFORE the quote, so end-of-body is above it', () => {
    const flow = JSON.parse(read('flow-lcc-create-outlook-draft.json'));
    const json = JSON.stringify(flow);
    // The reply branch PATCHes concat(body_html, <createReply-seeded quote>).
    const m = json.match(/concat\(triggerBody\(\)\?\['body_html'\][^"]*Create_draft_reply[^"]*\)/);
    assert.ok(m, 'reply body must be concat(body_html, quote) — our html first');
    const expr = m[0];
    assert.ok(expr.indexOf("body_html") < expr.indexOf('Create_draft_reply'),
      'body_html (with the signature at its end) must precede the quoted thread');
  });

  it('the signature is the LAST thing in the body html we hand the flow', () => {
    const { html } = appendSignature(PROSE, { plainBody: PLAIN });
    assert.ok(html.trimEnd().endsWith('</table>'), 'the block must close the body');
    assert.ok(html.indexOf('Scott Briggs') > html.indexOf('rent roll'),
      'the block must sit below the prose, not above it');
  });
});

describe('P126 — the appended block cannot poison the voice corpus', () => {
  it('the corpus cleaner strips this exact block back out of a sent draft', () => {
    // A sent draft-assist draft returns through loadCorpus → cleanEmailBody. If
    // the cleaner did not cut this block, the signature would be learned back as
    // prose and start appearing INSIDE generated bodies.
    const sent = `${PLAIN}\n\nScott Briggs\nSenior Vice President · Northmarq\nD (918) 794-9787 | E sabriggs@northmarq.com`;
    const cleaned = cleanEmailBody(sent);
    assert.equal(cleaned.includes('794-9787'), false, 'cleaner must cut the phone');
    assert.equal(cleaned.includes('Senior Vice President'), false, 'cleaner must cut the title');
    assert.match(cleaned, /rent roll/, 'the real prose must survive');
  });
});

describe('P126 — reply vs new-email variant selection', () => {
  it('a reply (in_reply_to set) gets the COMPACT block', () => {
    const r = appendSignature(PROSE, { plainBody: PLAIN, inReplyTo: '<abc@northmarq.com>' });
    assert.equal(r.variant, 'reply');
    assert.equal(r.html.includes('6120 S. Yale'), false, 'the reply block carries no address');
    assert.ok(r.html.includes('(918) 794-9787'));
  });

  it('a NEW thread (in_reply_to empty) gets the FULL block', () => {
    const r = appendSignature(PROSE, { plainBody: PLAIN, inReplyTo: '' });
    assert.equal(r.variant, 'full');
    assert.ok(r.html.includes('6120 S. Yale Ave., Ste. 300'), 'the full block carries the address');
    assert.ok(r.html.includes('Commercial Investment Sales'));
    assert.ok(r.html.includes('Fund Management'), 'and the service-line tagline');
  });

  it('ambiguous input defaults to the reply block (asserts strictly less)', () => {
    assert.equal(signatureVariantFor({}), 'reply');
    assert.equal(signatureVariantFor({ inReplyTo: null }), 'reply');
    assert.equal(signatureVariantFor({ inReplyTo: '   ' }), 'full');
    assert.equal(signatureVariantFor({ isReply: true, inReplyTo: '' }), 'reply');
  });

  it('the variant rule mirrors the flow branch, not a second heuristic', () => {
    // The flow creates a draft REPLY iff in_reply_to is non-empty. If the two
    // conditions ever differed, a standalone draft could carry the reply block.
    const flow = JSON.parse(read('flow-lcc-create-outlook-draft.json'));
    const isReply = flow.definition
      ? flow.definition.actions.Check_Shared_Secret.actions.Is_Reply
      : flow.actions.Check_Shared_Secret.actions.Is_Reply;
    // Reply branch iff in_reply_to is NOT the empty string.
    const expr = JSON.stringify(isReply.expression);
    assert.match(expr, /in_reply_to/, 'the flow must branch on in_reply_to');
    assert.match(expr, /"not"/, 'reply branch = in_reply_to is NOT empty');
    assert.equal(signatureVariantFor({ inReplyTo: '<m@x>' }), 'reply');
    assert.equal(signatureVariantFor({ inReplyTo: '' }), 'full');
  });

  it('the handler feeds the SAME in_reply_to to the variant and to the flow', () => {
    const code = stripComments(read('api/draft-assist.js'));
    assert.match(code, /const inReplyTo\s*=/);
    assert.match(code, /appendSignature\([^)]*inReplyTo/s);
    assert.match(code, /in_reply_to:\s*inReplyTo/);
    assert.equal((code.match(/const inReplyTo\s*=/g) || []).length, 1);
  });
});

describe('P126 — configuration precedence and the handler wiring', () => {
  it('a variant-specific env var overrides the committed asset', () => {
    const key = SIGNATURE_ENV_VARS.reply;
    const prev = process.env[key];
    try {
      process.env[key] = '<div>Scott Briggs — override</div>';
      _resetSignatureCache();
      const r = loadSignatureHtml('reply');
      assert.equal(r.source, 'env');
      assert.match(r.html, /override/);
      // and the FULL variant is unaffected by the reply-specific override
      assert.equal(loadSignatureHtml('full').source, 'asset');
    } finally {
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
      _resetSignatureCache();
    }
  });

  it('both committed assets resolve today (the production default is configured)', () => {
    const saved = {};
    for (const k of Object.values(SIGNATURE_ENV_VARS)) { saved[k] = process.env[k]; delete process.env[k]; }
    _resetSignatureCache();
    try {
      for (const v of VARIANTS) {
        const r = loadSignatureHtml(v);
        assert.equal(r.source, 'asset', `expected the ${v} asset at ${SIGNATURE_ASSETS[v]}`);
        assert.ok(r.html && r.html.length > 100);
      }
    } finally {
      for (const [k, val] of Object.entries(saved)) if (val !== undefined) process.env[k] = val;
      _resetSignatureCache();
    }
  });

  it('the handler builds body_html ONCE, outside the save branch', () => {
    const code = stripComments(read('api/draft-assist.js'));
    assert.match(code, /appendSignature\(/);
    const n = (code.match(/const bodyHtml\s*=/g) || []).length;
    assert.equal(n, 1, 'exactly one body_html construction — two would drift');
    // It must be built before the dry-run response, or the GET describes a body
    // no code rendered and the signature is only verifiable by saving.
    assert.ok(code.indexOf('const bodyHtml') < code.indexOf('if (!isPost)'),
      'body_html must exist before the dry-run returns');
  });

  it('the dry run reports the signature status and the exact body html', () => {
    const code = stripComments(read('api/draft-assist.js'));
    assert.match(code, /body_html:\s*bodyHtml/);
    assert.match(code, /signature:\s*\{/);
    assert.match(code, /status:\s*signed\.status/);
  });

  it('the save posts the SAME body html the dry run reported', () => {
    const code = stripComments(read('api/draft-assist.js'));
    // One variable feeds both the payload and the flow call.
    assert.match(code, /body_html:\s*bodyHtml,/);
  });
});
