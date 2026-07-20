import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapItemForTeams, buildOutlookDesktopLink } from '../api/intake.js';

// Task 1 (desktop Outlook deep link) + Task 2 (item-level `#/inbox/<id>` route)
// server side. Both helpers are pure; these lock the Teams-card payload shape the
// PA flow / adaptive card bind to.

describe('buildOutlookDesktopLink', () => {
  it('prefers the stable internet_message_id and strips angle brackets', () => {
    const link = buildOutlookDesktopLink({
      metadata: { internet_message_id: '<abc123@contoso.com>', graph_rest_id: 'AAMkAG...' },
    });
    assert.equal(
      link,
      'ms-outlook://emails/open?messageId=' + encodeURIComponent('abc123@contoso.com'),
    );
  });

  it('falls back to the Graph REST id when no internet_message_id', () => {
    const link = buildOutlookDesktopLink({ metadata: { graph_rest_id: 'AAMkAG_x/y' } });
    assert.equal(link, 'ms-outlook://emails/open?id=' + encodeURIComponent('AAMkAG_x/y'));
  });

  it('returns null when neither id is present', () => {
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

  it('carries the web email URL and the desktop deep link (Task 1)', () => {
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
    assert.equal(out.email_url_desktop, 'ms-outlook://emails/open?messageId=' + encodeURIComponent('m1@ex.com'));
  });

  it('desktop link is null when the row carries no message id (web-only fallback)', () => {
    const out = mapItemForTeams({ id: 'row-2', title: 'X', external_url: 'https://x', metadata: {} }, base);
    assert.equal(out.email_url_desktop, null);
    assert.equal(out.email_url, 'https://x');
  });
});
