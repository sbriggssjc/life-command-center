// Prompt 100 — W10 Stage 1 — voice-corpus-clean tests.
// Fixtures mirror the real shapes found live in LCC Opps (2026-08-13): a preview
// that bleeds into the quoted chain, the inline Briggs signature block, mobile
// sigs, disclaimers, and the URL/recall-notice boilerplate that must be dropped.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanEmailBody,
  stripReplyChain,
  stripSignature,
  stripTrailingSignoff,
  isMostlyBoilerplate,
  classifyDraftType,
  htmlToText,
  pickBestBody,
} from '../api/_shared/voice-corpus-clean.js';

const SIG = 'Scott Briggs\nSenior Vice President · Northmarq\nD (918) 794-9787 | E sabriggs@northmarq.com';

describe('stripReplyChain', () => {
  it('cuts at the Outlook underscore rule + quoted From header', () => {
    const raw = 'Alright, I think I did it. Let me know.\n________________________________\nFrom: Sarah Martin <smartin@northmarq.com>\nSent: Thursday';
    assert.equal(stripReplyChain(raw).trim(), 'Alright, I think I did it. Let me know.');
  });
  it('cuts at "On <date>, X wrote:"', () => {
    const raw = 'Got it, will do.\n\nOn Mon, Aug 4, 2026 at 9:14 AM, April Little <alittle@x.com> wrote:\n> prior message';
    assert.equal(stripReplyChain(raw).trim(), 'Got it, will do.');
  });
  it('drops leading > quote lines', () => {
    const raw = 'My take below.\n> your earlier point\n> second line';
    assert.equal(stripReplyChain(raw).trim(), 'My take below.');
  });
});

describe('stripSignature', () => {
  it('removes the inline Briggs sig block', () => {
    const raw = 'Perfect, thank you! Sent. ' + SIG.replace(/\n/g, ' ');
    assert.equal(stripSignature(raw).trim(), 'Perfect, thank you! Sent.');
  });
  it('removes a multiline sig + the Stan Johnson tagline', () => {
    const raw = 'Here you go.\n\nScott Briggs\nSenior Vice President\nStan Johnson Company is now Northmarq';
    assert.equal(stripSignature(raw).trim(), 'Here you go.');
  });
  it('cuts at the direct phone even without the name', () => {
    const raw = 'On it.\nD (918) 794-9787 | E sabriggs@northmarq.com';
    assert.equal(stripSignature(raw).trim(), 'On it.');
  });
});

describe('stripTrailingSignoff', () => {
  it('trims "Best regards," left before the sig', () => {
    assert.equal(stripTrailingSignoff("I'll get this tracked down ASAP. Stay tuned. Best regards,").trim(),
      "I'll get this tracked down ASAP. Stay tuned.");
  });
  it('keeps a mid-sentence Thanks!', () => {
    assert.equal(stripTrailingSignoff('Thanks! I wouldn’t have thought of it.'),
      'Thanks! I wouldn’t have thought of it.');
  });
});

describe('cleanEmailBody (end to end)', () => {
  it('keeps only the freshly-typed prose', () => {
    const raw =
      '﻿Got it. Tenant does pay for the ground rent. I\'ll call him and walk him through that section of the lease if he\'s confused.\r\n' +
      SIG + '\r\n________________________________\r\nFrom: someone <x@y.com>\r\nSent: yesterday\r\n> quoted';
    assert.equal(
      cleanEmailBody(raw),
      "Got it. Tenant does pay for the ground rent. I'll call him and walk him through that section of the lease if he's confused.",
    );
  });
  it('strips a confidentiality disclaimer', () => {
    const raw = 'Here’s that questionnaire.\n\nCONFIDENTIALITY NOTICE: This email is intended solely for…';
    assert.equal(cleanEmailBody(raw), 'Here’s that questionnaire.');
  });
});

describe('isMostlyBoilerplate', () => {
  it('flags a recall-the-message notice', () => {
    assert.equal(isMostlyBoilerplate('Team Briggs would like to recall the message, "GSA…".'), true);
  });
  it('flags a bare url / calendar link', () => {
    assert.equal(isMostlyBoilerplate('webcal://ical-cdn.teamsnap.com/team_schedule/abc.ics'), true);
  });
  it('flags an empty / punctuation-only remnant', () => {
    assert.equal(isMostlyBoilerplate('   '), true);
    assert.equal(isMostlyBoilerplate('— |'), true);
  });
  it('keeps real short prose', () => {
    assert.equal(isMostlyBoilerplate('Absolutely. Easy to do it. On it.'), false);
  });
});

describe('classifyDraftType', () => {
  it('routes an internal reply to internal_coordination', () => {
    const r = classifyDraftType({ subject: 'RE: Dialysis Book Updates', toEmails: ['smartin@northmarq.com'], cleaned: 'I can fix that.' });
    assert.equal(r.bucket, 'internal_coordination');
    assert.equal(r.audience, 'internal');
  });
  it('routes a new external thread to cold_bd_outreach', () => {
    const r = classifyDraftType({ subject: 'Off-market ground lease', toEmails: ['buyer@fund.com'], cleaned: 'Wanted to flag a deal…' });
    assert.equal(r.bucket, 'cold_bd_outreach');
  });
  it('detects an LOI/offer thread by keyword regardless of audience', () => {
    const r = classifyDraftType({ subject: 'RE: LOI — 123 Main', toEmails: ['smartin@northmarq.com'], cleaned: 'Attached is the counter.' });
    assert.equal(r.bucket, 'loi_offer');
    assert.equal(r.confidence, 'high');
  });
  it('detects a listing announcement', () => {
    const r = classifyDraftType({ subject: 'Pre-Market ALDI | New Construction', toEmails: [], cleaned: 'We are quietly working on a new-construction ALDI opportunity' });
    assert.equal(r.bucket, 'listing_announcement');
  });
  it('routes an external reply to external_follow_up', () => {
    const r = classifyDraftType({ subject: 'Re: questionnaire', toEmails: ['broker@cbre.com'], cleaned: 'Here’s that questionnaire.' });
    assert.equal(r.bucket, 'external_follow_up');
  });
});

// Prompt 110 — full-body ingestion helpers.
describe('htmlToText', () => {
  it('strips tags and turns block/break tags into newlines', () => {
    const html = '<div>Hi Jane,</div><p>Thanks for the call.</p><br>Talk soon';
    const t = htmlToText(html);
    assert.match(t, /Hi Jane,/);
    assert.match(t, /Thanks for the call\./);
    assert.ok(!/[<>]/.test(t.replace(/[<>]/g, '')) || !/<[a-z]/i.test(t));
  });
  it('drops script/style and decodes entities', () => {
    const html = '<style>.x{color:red}</style>A &amp; B &lt;test&gt;<script>alert(1)</script>';
    const t = htmlToText(html);
    assert.match(t, /A & B <test>/);
    assert.ok(!/alert/.test(t));
    assert.ok(!/color:red/.test(t));
  });
  it('empty/null → empty string', () => {
    assert.equal(htmlToText(null), '');
    assert.equal(htmlToText(''), '');
  });
});

describe('pickBestBody', () => {
  it('prefers full body_text when present', () => {
    assert.equal(
      pickBestBody({ body_text: 'FULL TEXT', body_html: '<p>html</p>', body_preview: 'preview' }),
      'FULL TEXT');
  });
  it('falls to tag-stripped body_html when text is blank', () => {
    const r = pickBestBody({ body_text: '  ', body_html: '<p>Hello there</p>', body_preview: 'preview' });
    assert.match(r, /Hello there/);
    assert.ok(!/<p>/.test(r));
  });
  it('falls to body_preview when text+html are empty', () => {
    assert.equal(pickBestBody({ body_text: '', body_html: '', body_preview: 'just the preview' }), 'just the preview');
  });
  it('accepts a snippet `body` key (activity_events shape)', () => {
    assert.equal(pickBestBody({ body: 'snippet only' }), 'snippet only');
  });
  it('empty input → empty string', () => {
    assert.equal(pickBestBody({}), '');
    assert.equal(pickBestBody(), '');
  });
  it('a full body still cleans down to Scott prose (chain+sig stripped)', () => {
    const full = 'Alright, I think I did it. Let me know.\n' + SIG +
      '\n________________________________\nFrom: Sarah <smartin@northmarq.com>\nSent: Thursday';
    const raw = pickBestBody({ body_text: full });
    assert.equal(cleanEmailBody(raw).trim(), 'Alright, I think I did it. Let me know.');
  });
});
