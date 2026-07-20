import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapItemForTeams, buildOutlookDesktopLink } from '../api/intake.js';

// Task 1 (desktop Outlook deep link) + Task 2 (item-level `#/inbox/<id>` route)
// server side. Both helpers are pure; these lock the Teams-card payload shape the
// PA flow / adaptive card bind to.

describe('buildOutlookDesktopLink', () => {
  // Uses the `open?url=<owa-link>` verb New Outlook for Windows honors — NOT the
  // `emails/open?messageId=` verb New Outlook errors on.
  it('wraps the captured web link (external_url) in the open?url= verb', () => {
    const link = buildOutlookDesktopLink({
      external_url: 'https://outlook.office.com/mail/deeplink/read/xyz',
      metadata: { internet_message_id: '<abc123@contoso.com>', graph_rest_id: 'AAMkAG...' },
    });
    assert.equal(
      link,
      'ms-outlook://open?url=' + encodeURIComponent('https://outlook.office.com/mail/deeplink/read/xyz'),
    );
  });

  it('synthesizes an OWA read link from the Graph REST id when no external_url', () => {
    const link = buildOutlookDesktopLink({ metadata: { graph_rest_id: 'AAMkAG_x/y' } });
    const owa = 'https://outlook.office.com/mail/deeplink/read/' + encodeURIComponent('AAMkAG_x/y');
    assert.equal(link, 'ms-outlook://open?url=' + encodeURIComponent(owa));
  });

  it('falls back to an inbox/id link from the internet_message_id (brackets stripped)', () => {
    const link = buildOutlookDesktopLink({ metadata: { internet_message_id: '<m1@ex.com>' } });
    const owa = 'https://outlook.office365.com/mail/inbox/id/' + encodeURIComponent('m1@ex.com');
    assert.equal(link, 'ms-outlook://open?url=' + encodeURIComponent(owa));
  });

  it('returns null when there is no URL to wrap', () => {
    assert.equal(buildOutlookDesktopLink({ metadata: {} }), null);
    assert.equal(buildOutlookDesktopLink({}), null);
    assert.equal(buildOutlookDesktopLink(null), null);
  });
});

describe('mapItemForTeams', () => {
  const base = 'https://lcc.example.app';

  it('emits an item-level #/inbox/<id> deep link (Task 2)', () => {
    const out = mapItemForTeams(
      { id: '11111111-2222-3333-4444-555555555555', title: 'Deal', external_url: 'https://outlook.office.com/x', metadata: {} },
      base,
    );
    assert.equal(out.lcc_item_url, base + '/#/inbox/' + encodeURIComponent('11111111-2222-3333-4444-555555555555'));
    assert.equal(out.inbox_item_id, '11111111-2222-3333-4444-555555555555');
  });

  it('falls back to the bare inbox list when there is no id', () => {
    const out = mapItemForTeams({ title: 'No id', metadata: {} }, base);
    assert.equal(out.lcc_item_url, base + '/#/inbox');
  });

  it('carries the web email URL and the desktop (open?url=) deep link (Task 1)', () => {
    const out = mapItemForTeams(
      {
        id: 'row-1',
        title: 'Flagged',
        external_url: 'https://outlook.office.com/mail/deeplink/read/xyz',
        metadata: { internet_message_id: '<m1@ex.com>', sender_email: 's@ex.com' },
      },
      base,
    );
    assert.equal(out.email_url, 'https://outlook.office.com/mail/deeplink/read/xyz');
    assert.equal(
      out.email_url_desktop,
      'ms-outlook://open?url=' + encodeURIComponent('https://outlook.office.com/mail/deeplink/read/xyz'),
    );
  });

  it('desktop link is null only when the row has no URL to wrap at all', () => {
    const out = mapItemForTeams({ id: 'row-2', title: 'X', metadata: {} }, base);
    assert.equal(out.email_url_desktop, null);
    assert.equal(out.email_url, null);
  });
});
