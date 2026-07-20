import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapItemForTeams, buildOutlookDesktopLink } from '../api/intake.js';

// Task 1 (desktop Outlook deep link) + Task 2 (item-level `#/inbox/<id>` route)
// server side. Both helpers are pure; these lock the Teams-card payload shape the
// PA flow / adaptive card bind to.

describe('buildOutlookDesktopLink', () => {
  // "Find in Outlook" = the documented OWA SEARCH deep link, built from a distinctive
  // slice of the SUBJECT. The old `ms-outlook://open?url=<owa read-link>` wrapper was
  // dropped: New Outlook for Windows treats `ms-outlook:` as a bare app activator and
  // ignores the wrapped message target (opens to Inbox). The exact-message path is now
  // `email_url` (the raw web read-link); this link only helps FIND the message.
  const SEARCH = 'https://outlook.office.com/mail/deeplink/search?query=';

  it('builds a subject search deep link (reads item.title, not external_url)', () => {
    const link = buildOutlookDesktopLink({
      title: 'Deltona Wellness OM — asking $13.3M',
      external_url: 'https://outlook.office.com/mail/deeplink/read/xyz',
      metadata: { internet_message_id: '<abc123@contoso.com>', graph_rest_id: 'AAMkAG...' },
    });
    assert.equal(link, SEARCH + encodeURIComponent('Deltona Wellness OM — asking $13.3M'));
  });

  it('strips leading Re:/Fw:/Fwd: reply-forward prefixes (incl. repeated runs)', () => {
    const link = buildOutlookDesktopLink({ title: 'RE: FW:  Fwd: NNN dialysis comps' });
    assert.equal(link, SEARCH + encodeURIComponent('NNN dialysis comps'));
  });

  it('caps a long subject to a distinctive slice on a word boundary', () => {
    const long =
      'Offering Memorandum for a single-tenant net-leased dialysis facility located in the ' +
      'greater metropolitan area with long remaining term';
    const link = buildOutlookDesktopLink({ title: long });
    const query = decodeURIComponent(link.slice(SEARCH.length));
    assert.ok(query.length <= 80, 'query capped at 80 chars');
    assert.ok(long.startsWith(query), 'query is a leading slice of the subject');
    assert.ok(!/\s$/.test(query), 'trimmed');
    assert.ok(!query.endsWith('me'), 'no truncated mid-word token');
  });

  it('returns null when the row has no usable subject', () => {
    // No subject ⇒ nothing to search ⇒ the card omits the Find button (email_url still works).
    assert.equal(buildOutlookDesktopLink({ title: '', external_url: 'https://outlook.office.com/x' }), null);
    assert.equal(buildOutlookDesktopLink({ title: '   Re:  ' }), null);
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

  it('carries the exact-message web link (email_url) + a subject-search Find link (email_url_desktop)', () => {
    const out = mapItemForTeams(
      {
        id: 'row-1',
        title: 'Flagged deal',
        external_url: 'https://outlook.office.com/mail/deeplink/read/xyz',
        metadata: { internet_message_id: '<m1@ex.com>', sender_email: 's@ex.com' },
      },
      base,
    );
    // Exact-message path stays the raw web read-link (opens the message in OWA).
    assert.equal(out.email_url, 'https://outlook.office.com/mail/deeplink/read/xyz');
    // Desktop field is now the "Find in Outlook" subject search (same field name for the PA binding).
    assert.equal(
      out.email_url_desktop,
      'https://outlook.office.com/mail/deeplink/search?query=' + encodeURIComponent('Flagged deal'),
    );
  });

  it('the Find link is null when the row has no subject (email_url still carried when present)', () => {
    const noSubject = mapItemForTeams(
      { id: 'row-2', title: '', external_url: 'https://outlook.office.com/mail/deeplink/read/z', metadata: {} },
      base,
    );
    assert.equal(noSubject.email_url_desktop, null);
    assert.equal(noSubject.email_url, 'https://outlook.office.com/mail/deeplink/read/z');

    const empty = mapItemForTeams({ id: 'row-3', title: '', metadata: {} }, base);
    assert.equal(empty.email_url_desktop, null);
    assert.equal(empty.email_url, null);
  });
});
