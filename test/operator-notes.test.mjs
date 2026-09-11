// OC-a — operator-note funnel: payload validation, idempotency, deterministic
// triage rules, dedupe matching, and routing. All pure functions or DB calls
// injected via `deps`, so nothing here touches the network (net-guard would
// catch it otherwise).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OPERATOR_NOTE_CHANNELS,
  classifyDeterministic,
  findBestTextMatch,
  findExistingByIdempotencyKey,
  insertOperatorNote,
  routeNote,
  textSimilarity,
  validateOperatorNotePayload,
} from '../api/_shared/operator-notes.js';

// ---------------------------------------------------------------------------
// Payload validation — one shape per channel, per the contract.
// ---------------------------------------------------------------------------

test('validateOperatorNotePayload requires channel and raw_text', () => {
  const r1 = validateOperatorNotePayload({});
  assert.equal(r1.ok, false);
  assert.match(r1.error, /channel/);

  const r2 = validateOperatorNotePayload({ channel: 'in_app_note' });
  assert.equal(r2.ok, false);
  assert.match(r2.error, /raw_text/);
});

test('validateOperatorNotePayload rejects a channel outside the closed vocabulary', () => {
  const r = validateOperatorNotePayload({ channel: 'slack', raw_text: 'hello' });
  assert.equal(r.ok, false);
  assert.match(r.error, /channel must be one of/);
});

test('validateOperatorNotePayload accepts every channel in the migration CHECK constraint', () => {
  for (const channel of OPERATOR_NOTE_CHANNELS) {
    const r = validateOperatorNotePayload({ channel, raw_text: 'a note' });
    assert.equal(r.ok, true, `channel ${channel} should validate`);
    assert.equal(r.row.channel, channel);
  }
});

test('validateOperatorNotePayload normalizes context/attachments and defaults them safely', () => {
  const r = validateOperatorNotePayload({
    channel: 'in_app_note',
    raw_text: '  The Ownership tab shows two conflicting owners.  ',
    context: { route: '#/dia?d=prop:dia:1:Ownership' },
  });
  assert.equal(r.ok, true);
  assert.equal(r.row.raw_text, 'The Ownership tab shows two conflicting owners.');
  assert.deepEqual(r.row.attachments, []);
  assert.equal(r.row.context.route, '#/dia?d=prop:dia:1:Ownership');
});

test('validateOperatorNotePayload rejects a non-object context rather than crashing', () => {
  const r = validateOperatorNotePayload({ channel: 'mcp', raw_text: 'x', context: 'not an object' });
  assert.equal(r.ok, true); // context falls back to {}
  assert.deepEqual(r.row.context, {});
});

test('validateOperatorNotePayload defaults channel from defaultChannel when omitted', () => {
  const r = validateOperatorNotePayload({ raw_text: 'x' }, { defaultChannel: 'teams' });
  assert.equal(r.ok, true);
  assert.equal(r.row.channel, 'teams');
});

// ---------------------------------------------------------------------------
// Idempotency + insert (stubbed opsQuery).
// ---------------------------------------------------------------------------

test('findExistingByIdempotencyKey returns null when no key is supplied', async () => {
  const r = await findExistingByIdempotencyKey('teams', null, { opsQuery: async () => { throw new Error('should not be called'); } });
  assert.equal(r, null);
});

test('findExistingByIdempotencyKey returns the existing row when the query finds one', async () => {
  const stub = async (method, path) => {
    assert.equal(method, 'GET');
    assert.match(path, /channel=eq\.teams/);
    assert.match(path, /idempotency_key=eq\.abc123/);
    return { ok: true, data: [{ id: 'existing-id', disposition: 'routed' }] };
  };
  const r = await findExistingByIdempotencyKey('teams', 'abc123', { opsQuery: stub });
  assert.deepEqual(r, { id: 'existing-id', disposition: 'routed' });
});

test('insertOperatorNote posts disposition=open and stamps the idempotency key into context', async () => {
  let captured = null;
  const stub = async (method, path, body) => {
    captured = { method, path, body };
    return { ok: true, data: [{ id: 'new-id', disposition: 'open' }] };
  };
  const r = await insertOperatorNote(
    { channel: 'in_app_note', raw_text: 'x', context: { route: '#/x' }, attachments: [] },
    { idempotencyKey: 'msg-1' },
    { opsQuery: stub },
  );
  assert.equal(r.ok, true);
  assert.equal(r.id, 'new-id');
  assert.equal(captured.method, 'POST');
  assert.equal(captured.path, 'operator_notes');
  assert.equal(captured.body.disposition, 'open');
  assert.equal(captured.body.context.idempotency_key, 'msg-1');
  assert.equal(captured.body.context.route, '#/x'); // fill-blanks: original context preserved
});

test('insertOperatorNote surfaces a DB error rather than pretending success', async () => {
  const stub = async () => ({ ok: false, data: { message: 'constraint violation' } });
  const r = await insertOperatorNote({ channel: 'mcp', raw_text: 'x' }, {}, { opsQuery: stub });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'constraint violation');
});

// ---------------------------------------------------------------------------
// Deterministic triage rules (checked BEFORE any model call).
// ---------------------------------------------------------------------------

test('classifyDeterministic recognizes an error signature as a bug', () => {
  const v = classifyDeterministic('The page threw a TypeError: cannot read property of undefined', {});
  assert.equal(v.note_type, 'bug');
});

test('classifyDeterministic reads recent_errors from context even if the note text is plain', () => {
  const v = classifyDeterministic('this seems broken', { recent_errors: ['Failed to fetch /api/foo'] });
  assert.equal(v.note_type, 'bug');
});

test('classifyDeterministic marks a 500/fatal error high severity', () => {
  const v = classifyDeterministic('Got a 500 error loading the panel', {});
  assert.equal(v.note_type, 'bug');
  assert.equal(v.severity, 'high');
});

test('classifyDeterministic recognizes a stuck-loading pattern as not-connecting', () => {
  const v = classifyDeterministic('The Overview tile is stuck loading and never resolves', {});
  assert.equal(v.note_type, 'not-connecting');
});

test('classifyDeterministic recognizes a missing-data pattern as data-gap', () => {
  const v = classifyDeterministic('The rent field shows no data for this property', {});
  assert.equal(v.note_type, 'data-gap');
});

test('classifyDeterministic recognizes an idea/feature-request pattern', () => {
  const v = classifyDeterministic('It would be great if the Note button also captured a screenshot', {});
  assert.equal(v.note_type, 'idea');
});

test('classifyDeterministic recognizes a UX complaint', () => {
  const v = classifyDeterministic('This layout is confusing, I cannot find the export button', {});
  assert.equal(v.note_type, 'ux');
});

test('classifyDeterministic falls back to question on a trailing question mark', () => {
  const v = classifyDeterministic('Why does this owner show two names?', {});
  assert.equal(v.note_type, 'question');
});

test('classifyDeterministic returns null when nothing matches — never guesses', () => {
  const v = classifyDeterministic('Scott said to check the Q3 comps deck.', {});
  assert.equal(v, null);
});

// ---------------------------------------------------------------------------
// Dedupe.
// ---------------------------------------------------------------------------

test('textSimilarity is 1.0 for identical text and 0 for disjoint text', () => {
  assert.equal(textSimilarity('the ownership tab is wrong', 'the ownership tab is wrong'), 1);
  assert.equal(textSimilarity('completely unrelated words here', 'zzz yyy xxx www'), 0);
});

test('findBestTextMatch finds a near-duplicate prior note above threshold', () => {
  const candidates = [
    { id: 'a', raw_text: 'The comps export button does nothing when clicked' },
    { id: 'b', raw_text: 'Totally different topic about Salesforce sync' },
  ];
  const match = findBestTextMatch('comps export button does nothing when I click it', candidates);
  assert.equal(match.id, 'a');
});

test('findBestTextMatch returns null when nothing clears the threshold', () => {
  const candidates = [{ id: 'a', raw_text: 'a completely unrelated note about the Tier 0 lane' }];
  const match = findBestTextMatch('the daily briefing email is empty today', candidates);
  assert.equal(match, null);
});

test('findBestTextMatch works against the backlog-index shape (title/row_id keys)', () => {
  const candidates = [{ row_id: 'P196', title: 'a park needs a reason and the two prescribed fixes were measured' }];
  const match = findBestTextMatch(
    'a park needs a reason, prescribed fixes were measured',
    candidates,
    { textKey: 'title', idKey: 'row_id' },
  );
  assert.equal(match.id, 'P196');
});

// ---------------------------------------------------------------------------
// Routing.
// ---------------------------------------------------------------------------

const TEST_ROUTING_TABLE = {
  threads: [
    { thread: 'automation', keywords: ['cron', 'tick'] },
    { thread: 'comps', keywords: ['comp', 'cap rate'] },
  ],
};

test('routeNote matches on a keyword in the raw text', () => {
  const r = routeNote({ rawText: 'The nightly cron never ran', noteType: 'bug' }, TEST_ROUTING_TABLE);
  assert.equal(r.routed_to, 'automation');
});

test('routeNote returns null routed_to and a named reason when nothing matches — never guesses', () => {
  const r = routeNote({ rawText: 'something about the weather', noteType: 'idea' }, TEST_ROUTING_TABLE);
  assert.equal(r.routed_to, null);
  assert.equal(r.reason, 'no_routing_keyword_matched');
});

test('routeNote matches case-insensitively and on the note_type/lane fields too', () => {
  const r = routeNote({ rawText: 'x', noteType: 'CRON is broken' }, TEST_ROUTING_TABLE);
  assert.equal(r.routed_to, 'automation');
});
