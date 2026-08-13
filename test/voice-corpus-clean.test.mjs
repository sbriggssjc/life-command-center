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
