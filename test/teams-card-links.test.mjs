import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapItemForTeams, clampBody } from '../api/intake.js';

// The Teams intake card is now a SINGLE action — "View in LCC" (`lcc_item_url`).
// The Outlook web/desktop deep-link fields (email_url / email_url_desktop) were
// removed: New Outlook's deep-link verbs are a broken Microsoft feature (read-link
// → "message might have been moved or deleted"; search-link hangs), and the full
// email body now lives in the LCC inbox detail view. These tests lock the card
// payload shape the PA flow / adaptive card bind to, and the body-cap helper that
// keeps the stored full body from bloating LCC Opps.

describe('mapItemForTeams', () => {
  const base = 'https://lcc.example.app';

  it('emits an item-level #/inbox/<id> deep link (the single View-in-LCC action)', () => {
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

  it('does NOT emit the retired Outlook link fields (email_url / email_url_desktop)', () => {
    const out = mapItemForTeams(
      {
        id: 'row-1',
        title: 'Flagged deal',
        external_url: 'https://outlook.office.com/mail/deeplink/read/xyz',
        metadata: { internet_message_id: '<m1@ex.com>', sender_email: 's@ex.com' },
      },
      base,
    );
    assert.ok(!('email_url' in out), 'email_url dropped');
    assert.ok(!('email_url_desktop' in out), 'email_url_desktop dropped');
    // The card still carries sender/subject/summary for display + the LCC link.
    assert.equal(out.sender_email, 's@ex.com');
    assert.equal(out.subject, 'Flagged deal');
    assert.equal(out.lcc_item_url, base + '/#/inbox/row-1');
  });
});

describe('clampBody', () => {
  it('returns null for empty / whitespace-only bodies (so the metadata key is omitted)', () => {
    assert.equal(clampBody('', 100), null);
    assert.equal(clampBody('   \n\t ', 100), null);
    assert.equal(clampBody(null, 100), null);
    assert.equal(clampBody(undefined, 100), null);
  });

  it('passes a body through untouched when it is under the cap', () => {
    assert.equal(clampBody('<p>hello</p>', 100), '<p>hello</p>');
  });

  it('truncates a body that exceeds the cap', () => {
    const big = 'x'.repeat(500);
    const out = clampBody(big, 200);
    assert.equal(out.length, 200);
    assert.ok(big.startsWith(out));
  });
});
