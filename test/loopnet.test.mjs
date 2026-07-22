// loopnet.js — LoopNet marketing-lead email parser.
//
// The lead-ingest edge function's `loopnet` action parses a real LoopNet lead
// notification email (HTML body) into buyer + property fields. Two templates,
// keyed off the subject: an INQUIRY ("LoopNet Lead for <property>") and a
// FAVORITE ("<Name> favorited <property>"). This proves the pure logic the Deno
// handler shares (no drift), including the critical rule that the buyer's
// email/phone are NOT the first contact info in the body — internal NorthMarq /
// vendor addresses appear first and must be excluded.
//
// Fixtures test/fixtures/loopnet/*.html are the actual HTML bodies extracted
// from the two real sample .eml files.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseLoopNetEmail, stripHtmlToText, pickBuyerEmail, INTERNAL_EMAIL_DOMAINS,
} from '../supabase/functions/lead-ingest/loopnet.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(HERE, 'fixtures', 'loopnet', name), 'utf-8');

describe('parseLoopNetEmail — real sample fixtures', () => {
  it('Sample 1 (inquiry): Fresenius Medical Care — Mac Dilani', () => {
    const p = parseLoopNetEmail(
      fixture('inquiry_fresenius.html'),
      fixture('inquiry_fresenius.subject.txt'),
    );
    assert.equal(p.activity_type, 'loopnet_inquiry');
    assert.equal(p.lead_name, 'Mac Dilani');
    assert.equal(p.lead_first_name, 'Mac');
    assert.equal(p.lead_last_name, 'Dilani');
    assert.equal(p.lead_phone, '949-278-2993');
    assert.equal(p.lead_email, 'dilanigroup@gmail.com');
    assert.equal(p.loopnet_listing_id, '38309608');
    assert.equal(p.property_name, 'Fresenius Medical Care');
    assert.equal(p.property_address, '20931 Burbank Blvd');
    assert.equal(p.property_city, 'Woodland Hills');
    assert.equal(p.property_state, 'CA');
    assert.equal(
      p.property,
      'Fresenius Medical Care / 20931 Burbank Blvd, Woodland Hills, CA 91367',
    );
    assert.match(p.message, /would like to learn more/i);
  });

  it('Sample 2 (favorite): 2860 S US Highway 83 — Adrian Ramirez', () => {
    const p = parseLoopNetEmail(
      fixture('favorite_zapata.html'),
      fixture('favorite_zapata.subject.txt'),
    );
    assert.equal(p.activity_type, 'loopnet_favorite');
    assert.equal(p.lead_name, 'Adrian Ramirez');
    assert.equal(p.lead_first_name, 'Adrian');
    assert.equal(p.lead_last_name, 'Ramirez');
    assert.equal(p.lead_email, 'adrian@blackrockcre.com');
    assert.equal(p.lead_phone, '832-838-7625');
    assert.equal(p.property, '2860 S US Highway 83, Zapata, TX 78076');
    assert.equal(p.property_address, '2860 S US Highway 83');
    assert.equal(p.property_city, 'Zapata');
    assert.equal(p.property_state, 'TX');
    assert.equal(p.property_name, null); // favorite: the property IS the address
    assert.equal(p.loopnet_listing_id, null); // favorite carries no listing id
  });

  it('never grabs a NorthMarq teammate as the buyer (inquiry lists them first)', () => {
    const p = parseLoopNetEmail(
      fixture('inquiry_fresenius.html'),
      fixture('inquiry_fresenius.subject.txt'),
    );
    // The "To:" line names smartin@northmarq.com etc. BEFORE the buyer's email.
    assert.doesNotMatch(p.lead_email, INTERNAL_EMAIL_DOMAINS);
    assert.equal(p.lead_email, 'dilanigroup@gmail.com');
  });
});

describe('pickBuyerEmail — internal/vendor exclusion', () => {
  it('skips northmarq.com / loopnet.com / costar.com and returns the buyer', () => {
    const body = 'To: smartin@northmarq.com, sender leads@loopnet.com\ndilanigroup@gmail.com';
    assert.equal(pickBuyerEmail(body), 'dilanigroup@gmail.com');
  });

  it('returns null when every address is internal', () => {
    assert.equal(pickBuyerEmail('a@northmarq.com b@costar.com'), null);
  });

  it('INTERNAL_EMAIL_DOMAINS matches all three excluded domains', () => {
    assert.match('x@northmarq.com', INTERNAL_EMAIL_DOMAINS);
    assert.match('x@loopnet.com', INTERNAL_EMAIL_DOMAINS);
    assert.match('x@costar.com', INTERNAL_EMAIL_DOMAINS);
    assert.doesNotMatch('x@gmail.com', INTERNAL_EMAIL_DOMAINS);
  });
});

describe('template detection', () => {
  it('subject "<Name> favorited <property>" -> loopnet_favorite', () => {
    const p = parseLoopNetEmail(
      '<html><body>Your listing has been favorited by Jane Q. Broker,<br>jane@acme.com<br>+1 555-123-4567<br>10 Main St<br>Austin, TX 78701</body></html>',
      'Jane Q. Broker favorited 10 Main St',
    );
    assert.equal(p.activity_type, 'loopnet_favorite');
    assert.equal(p.lead_name, 'Jane Q. Broker');
    assert.equal(p.lead_email, 'jane@acme.com');
    assert.equal(p.lead_phone, '555-123-4567');
    assert.equal(p.property_address, '10 Main St');
    assert.equal(p.property_state, 'TX');
  });

  it('subject "LoopNet Lead for <property>" -> loopnet_inquiry', () => {
    const p = parseLoopNetEmail(
      '<html><body>From: John Doe | +1 (212) 555-9876 | john@buyer.co | (Listing ID : 12345678)<br>' +
        'To: rep@northmarq.com<br>500 Market St | San Francisco, CA 94105<br>' +
        'Hi, I found Acme Plaza on LoopNet and would like to learn more about it.</body></html>',
      'LoopNet Lead for Acme Plaza',
    );
    assert.equal(p.activity_type, 'loopnet_inquiry');
    assert.equal(p.lead_name, 'John Doe');
    assert.equal(p.lead_email, 'john@buyer.co');
    assert.equal(p.lead_phone, '(212) 555-9876');
    assert.equal(p.loopnet_listing_id, '12345678');
    assert.equal(p.property_name, 'Acme Plaza');
    assert.equal(p.property_address, '500 Market St');
    assert.equal(p.property_city, 'San Francisco');
    assert.equal(p.property_state, 'CA');
  });
});

describe('robustness — never throws / best-effort', () => {
  it('empty body returns a well-shaped inquiry object with nulls', () => {
    const p = parseLoopNetEmail('', '');
    assert.equal(p.activity_type, 'loopnet_inquiry');
    assert.equal(p.lead_name, null);
    assert.equal(p.lead_email, null);
    assert.equal(p.lead_phone, null);
    assert.equal(p.property_address, null);
    assert.equal(p.loopnet_listing_id, null);
  });

  it('plain-text (non-HTML) body still parses', () => {
    const p = parseLoopNetEmail(
      'From: Sam Lee | 949-000-1111 | sam@x.io | (Listing ID : 999)\n1 A St | Reno, NV 89501',
      'LoopNet Lead for A Plaza',
    );
    assert.equal(p.lead_email, 'sam@x.io');
    assert.equal(p.lead_phone, '949-000-1111');
    assert.equal(p.property_state, 'NV');
  });

  it('stripHtmlToText drops style/script and decodes entities', () => {
    const t = stripHtmlToText('<style>.x{color:red}</style><p>A&amp;B&nbsp;C</p><script>x()</script>');
    assert.doesNotMatch(t, /color:red/);
    assert.doesNotMatch(t, /x\(\)/);
    assert.match(t, /A&B C/);
  });
});
