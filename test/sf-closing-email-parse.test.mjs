// Deal Closing Announcement parser — anchored on the real Northmarq SF email
// shape (US Renal - Covington, GA, Opportunity 006Vs00000IPJGQIA5). The fixture
// is the email's text/html part in its raw QUOTED-PRINTABLE form (=3D, soft
// line breaks) so the parser's QP-decode path is exercised too.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseClosingAnnouncement,
  isClosingAnnouncement,
  CLOSING_SENDER,
} from '../api/_shared/sf-closing-email-parse.js';

// Trimmed QP-encoded fixture mirroring the real .eml table rows.
const FIXTURE_QP = [
  '<html><body>',
  '<table><tbody>',
  '<tr><td>Team Name</td><td>Team Harf</td></tr>',
  '<tr><td>Broker</td><td>Isaiah Harf</td></tr>',
  '<tr><td>Deal Name</td><td><a href=3D"https://northmarqcapital.my.salesforce.com//lightning/r/Opportunity/006Vs00000IPJGQ=',
  'IA5/view">US Renal - Covi=',
  'ngton, GA</a></td></tr>',
  '<tr><td>Deal Type</td><td>Sale Deal - Commerc=',
  'ial</td></tr>',
  '<tr><td>City, State</td><td>Covington<span>,&nbsp;</span>GA</td></tr>',
  '<tr><td>Sale Price</td><td>$2,410,000</td></tr>',
  '<tr><td>Cap Rate</td><td> 7.61%</td></tr>',
  '<tr><td>Closing Date</td><td> 06/23/2026</td></tr>',
  '<tr><td>Property Type</td><td>Healthcare</td></tr>',
  '<tr><td>Property Subtype</td><td>Dialysis</td></tr>',
  '<tr><td>Seller Company</td><td><a href=3D"https://northmarqcapital.my.salesforce.com//lightning/r/Account/0018W00002X0hiM=',
  'QAR/view">Alliance Consolidated Group of Companies LLC</a></td></tr>',
  '<tr><td>Seller 1031 Exchange</td><td>No</td></tr>',
  '<tr><td>Buyer Company</td><td><a href=3D"https://northmarqcapital.my.salesforce.com//lightning/r/Account/001Vs00000zPFVb=',
  'IAO/view">Srinivas Kothakonda and Naveen Budda</a></td></tr>',
  '<tr><td>Buyer 1031 Exchange</td><td>Unknown</td></tr>',
  '</tbody></table></body></html>',
].join('\r\n');

describe('isClosingAnnouncement', () => {
  it('matches the SF sender + subject prefix', () => {
    assert.equal(isClosingAnnouncement({ senderEmail: CLOSING_SENDER, subject: 'Deal Closing Announcement - US Renal - Covington, GA' }), true);
    assert.equal(isClosingAnnouncement({ senderEmail: 'Northmarq <salesforce@northmarq.com>', subject: 'Deal Closing Announcement - X' }), true);
  });

  // Live failure mode (2026-06-23): PA's flagged-email payload carries a NULL
  // sender, so the sender-only gate never fired. The direct SF email still
  // carries an @sfdc.net message-id; the forwarded copy embeds an SF Opportunity
  // link in the body. Either fingerprint (with the subject prefix) must pass.
  it('matches on the @sfdc.net message-id when the sender is absent', () => {
    assert.equal(isClosingAnnouncement({
      senderEmail: null,
      subject: 'Deal Closing Announcement - US Renal - Covington, GA',
      messageId: '<ECqKN0...TH3I6100Ip-ERJLCTRCFCQfukyj2Lw@sfdc.net>',
    }), true);
  });
  it('matches a forwarded copy via the SF Opportunity link in the body', () => {
    assert.equal(isClosingAnnouncement({
      senderEmail: null,
      subject: 'FW: Deal Closing Announcement - US Renal - Covington, GA',
      messageId: '<DS0PR05MB9718@DS0PR05MB9718.namprd05.prod.outlook.com>', // Outlook host
      bodyHtml: '<a href="https://northmarqcapital.my.salesforce.com//lightning/r/Opportunity/006Vs00000IPJGQIA5/view">US Renal</a>',
    }), true);
  });

  it('rejects other senders / subjects', () => {
    // Right subject but NO SF fingerprint anywhere → not a closing announcement.
    assert.equal(isClosingAnnouncement({ senderEmail: 'broker@cbre.com', subject: 'Deal Closing Announcement - X' }), false);
    assert.equal(isClosingAnnouncement({ senderEmail: 'broker@cbre.com', subject: 'Deal Closing Announcement - X', messageId: '<abc@cbre.com>', bodyHtml: '<p>see attached</p>' }), false);
    assert.equal(isClosingAnnouncement({ senderEmail: CLOSING_SENDER, subject: 'New Listing - US Renal' }), false);
    // SF fingerprint present but wrong subject → still rejected (subject is mandatory).
    assert.equal(isClosingAnnouncement({ subject: 'New Listing', messageId: '<x@sfdc.net>' }), false);
    assert.equal(isClosingAnnouncement({}), false);
  });
});

describe('parseClosingAnnouncement', () => {
  const p = parseClosingAnnouncement(FIXTURE_QP);

  it('extracts the core deal fields (QP-decoded)', () => {
    assert.equal(p.ok, true);
    assert.equal(p.deal_name, 'US Renal - Covington, GA');
    assert.equal(p.deal_type, 'Sale Deal - Commercial');
    assert.equal(p.city, 'Covington');
    assert.equal(p.state, 'GA');
    assert.equal(p.sale_price, 2410000);
    assert.equal(p.cap_rate, 7.61);
    assert.equal(p.close_date, '2026-06-23');
    assert.equal(p.property_type, 'Healthcare');
    assert.equal(p.property_subtype, 'Dialysis');
    assert.equal(p.deal_team, 'Team Harf');
    assert.equal(p.broker, 'Isaiah Harf');
  });

  it('extracts the SF Opportunity id + buyer/seller account ids by position', () => {
    assert.equal(p.sf_opportunity_id, '006Vs00000IPJGQIA5');
    assert.equal(p.seller_company, 'Alliance Consolidated Group of Companies LLC');
    assert.equal(p.seller_account_id, '0018W00002X0hiMQAR');
    assert.equal(p.buyer_company, 'Srinivas Kothakonda and Naveen Budda');
    assert.equal(p.buyer_account_id, '001Vs00000zPFVbIAO');
  });

  it('parses an already-decoded (non-QP) body identically', () => {
    const clean = FIXTURE_QP.replace(/=\r?\n/g, '').replace(/=3D/g, '=');
    const q = parseClosingAnnouncement(clean);
    assert.equal(q.deal_name, 'US Renal - Covington, GA');
    assert.equal(q.sale_price, 2410000);
    assert.equal(q.sf_opportunity_id, '006Vs00000IPJGQIA5');
  });

  it('tolerates missing rows (no price / no ids) and still reports ok via name', () => {
    const minimal = '<table><tr><td>Deal Name</td><td>Foo - Dallas, TX</td></tr>'
      + '<tr><td>City, State</td><td>Dallas, TX</td></tr></table>';
    const q = parseClosingAnnouncement(minimal);
    assert.equal(q.ok, true);
    assert.equal(q.deal_name, 'Foo - Dallas, TX');
    assert.equal(q.city, 'Dallas');
    assert.equal(q.state, 'TX');
    assert.equal(q.sale_price, null);
    assert.equal(q.sf_opportunity_id, null);
    assert.equal(q.cap_rate, null);
  });

  it('ok=false on an empty / non-table body', () => {
    assert.equal(parseClosingAnnouncement('').ok, false);
    assert.equal(parseClosingAnnouncement('<p>hello</p>').ok, false);
  });
});
