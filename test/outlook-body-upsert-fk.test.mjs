// Prompt 116 — the `email_bodies` "upsert 409" was a FOREIGN KEY violation, not
// a merge-duplicates conflict.
//
// Prompt 115 recorded `result.body_persist_error='upsert_409'` on 10,470 of the
// backward Sent-Items sweep's writes. On a POST carrying
// `on_conflict=workspace_id,internet_message_id` + `Prefer:
// resolution=merge-duplicates`, a 409 reads as "merge-duplicates didn't take,
// the existing row 23505'd". WRONG: PostgREST maps BOTH 23505
// (unique_violation) AND 23503 (foreign_key_violation) onto HTTP 409.
//
// Grounded live 2026-08-17 (LCC Opps `xengecqvemvfknjvbvrq`) from the Postgres
// log rather than the status code:
//   insert or update on table "email_bodies"
//     violates foreign key constraint "email_bodies_source_user_id_fkey"
//
// `email_bodies.source_user_id` FKs `public.users(id)`, and the sweep's PA flow
// was configured with the *lcc_users* id 1d3f7321-… while the working forward
// sweep used the *public.users* id b0000000-…-0001 — the SAME person. The two
// user tables have DISJOINT id spaces bridged only by EMAIL.
//
// These tests pin the contract with a faithful PostgREST simulator: FK checked
// first (as the DB does), merge-duplicates honored only when the header asks for
// it, and ON CONFLICT DO UPDATE touching only the columns the payload carries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleOutlookMessageExtract } from '../api/_shared/bridge-handlers-outlook.js';
import { resolveSourceUserId, _resetSourceUserCache } from '../api/_shared/source-user-id.js';

const WS = 'ws-0000';
const MSG = '<AS8PR05MB1234@namprd05.prod.outlook.com>';
const HTML = '<html><head><meta http-equiv="Content-Type" content="text/html"></head>'
  + '<body><div>Scott — attached is the signed LOI for the Woodland Hills close.</div></body></html>';

// The live ids, verbatim.
const PLATFORM_USER = { id: 'b0000000-0000-0000-0000-000000000001', email: 'sabriggs@northmarq.com' };
const LCC_USER = { lcc_user_id: '1d3f7321-a4ad-4f83-9c7b-489554fc1c51', email: 'sabriggs@northmarq.com' };

function qsValue(path, prefix) {
  return decodeURIComponent(path.slice(prefix.length).split('&')[0]);
}

/**
 * Minimal PostgREST stand-in for `email_bodies`, reproducing the three
 * behaviours this bug turned on:
 *   1. the FK on source_user_id is enforced, and surfaces as 23503 → HTTP 409
 *   2. `resolution=merge-duplicates` + `on_conflict` ⇒ ON CONFLICT DO UPDATE;
 *      WITHOUT it a duplicate key is 23505 → HTTP 409
 *   3. DO UPDATE sets ONLY the columns present in the payload (so an omitted
 *      body column cannot null a stored body)
 */
function makeFakePostgrest({ users = [PLATFORM_USER], lccUsers = [LCC_USER], contacts, rows = [] } = {}) {
  const table = new Map(rows.map((r) => [`${r.workspace_id}|${r.internet_message_id}`, { ...r }]));
  const calls = [];

  async function q(method, path, body, opts = {}) {
    calls.push({ method, path, body, opts });

    if (method === 'GET' && path.startsWith('unified_contacts?')) {
      return { ok: true, status: 200, data: contacts };
    }
    if (method === 'GET' && path.startsWith('users?id=eq.')) {
      const id = qsValue(path, 'users?id=eq.');
      return { ok: true, status: 200, data: users.filter((u) => u.id === id).map((u) => ({ id: u.id })) };
    }
    if (method === 'GET' && path.startsWith('users?email=ilike.')) {
      const em = qsValue(path, 'users?email=ilike.').toLowerCase();
      return { ok: true, status: 200, data: users.filter((u) => u.email.toLowerCase() === em) };
    }
    if (method === 'GET' && path.startsWith('lcc_users?lcc_user_id=eq.')) {
      const id = qsValue(path, 'lcc_users?lcc_user_id=eq.');
      return { ok: true, status: 200, data: lccUsers.filter((l) => l.lcc_user_id === id).map((l) => ({ email: l.email })) };
    }
    if (method === 'POST' && path.startsWith('email_bodies?')) {
      // (1) FK first — exactly what rejected 10,470 live writes.
      if (body.source_user_id != null && !users.some((u) => u.id === body.source_user_id)) {
        return { ok: false, status: 409, data: {
          code: '23503',
          message: 'insert or update on table "email_bodies" violates foreign key '
                 + 'constraint "email_bodies_source_user_id_fkey"'
        } };
      }
      const key = `${body.workspace_id}|${body.internet_message_id}`;
      const existing = table.get(key);
      if (!existing) { table.set(key, { ...body }); return { ok: true, status: 201, data: [{ ...body }] }; }

      // (2) merge-duplicates must be asked for, and the conflict target declared.
      const prefer = String(opts?.headers?.Prefer || opts?.Prefer || '');
      const merges = prefer.includes('resolution=merge-duplicates')
        && path.includes('on_conflict=workspace_id,internet_message_id');
      if (!merges) {
        return { ok: false, status: 409, data: {
          code: '23505',
          message: 'duplicate key value violates unique constraint "email_bodies_ws_msg_uidx"'
        } };
      }
      // (3) DO UPDATE SET only the payload's columns.
      Object.assign(existing, body);
      return { ok: true, status: 200, data: [{ ...existing }] };
    }
    return { ok: true, status: 200, data: [] };
  }
  return { q, calls, table };
}

// entity_id null keeps the (best-effort, un-injectable) activity_events branch
// out of these tests — the actor_id stamp comes from the same resolved id that
// `source_user_id` asserts below.
const TRACKED = [{ unified_id: 'uc-1', entity_id: null, email: 'buyer@example.com', full_name: 'A Buyer' }];

function jobFor({ body, msgId = MSG, sourceUserId = LCC_USER.lcc_user_id } = {}) {
  return {
    workspace_id: WS,
    payload: {
      internetMessageId: msgId,
      subject: 'Re: Woodland Hills LOI',
      bodyPreview: 'Scott — attached is the signed LOI',
      from: { emailAddress: { address: 'buyer@example.com', name: 'A Buyer' } },
      toRecipients: [{ emailAddress: { address: 'sabriggs@northmarq.com' } }],
      _source_user_id: sourceUserId,
      ...(body === undefined ? {} : { body }),
    },
  };
}

test.beforeEach(() => _resetSourceUserCache());

// ---- the acceptance contract ----------------------------------------------

test('an EXISTING (workspace_id, internet_message_id) row is UPDATED with the body, not 409', async () => {
  const fake = makeFakePostgrest({
    contacts: TRACKED,
    // the bodyless row an earlier ingestion left behind — 23,571 of these live
    rows: [{ workspace_id: WS, internet_message_id: MSG, subject: 'Re: Woodland Hills LOI',
             body_format: null, body_html: null, body_text: null,
             source_user_id: PLATFORM_USER.id }],
  });

  const r = await handleOutlookMessageExtract(
    jobFor({ body: { contentType: 'html', content: HTML } }), { opsQuery: fake.q });

  assert.equal(r.ok, true);
  assert.equal(r.result.body_persist_error, undefined, 'must not 409');
  const stored = fake.table.get(`${WS}|${MSG}`);
  assert.equal(stored.body_html, HTML);
  assert.equal(stored.body_format, 'html');
  assert.equal(fake.table.size, 1, 'updates in place — no duplicate row');
});

test('a brand-new internet_message_id still INSERTS', async () => {
  const fake = makeFakePostgrest({ contacts: TRACKED });   // empty table
  const r = await handleOutlookMessageExtract(
    jobFor({ body: { contentType: 'html', content: HTML }, msgId: '<brand-new@x.com>' }),
    { opsQuery: fake.q });

  assert.equal(r.ok, true);
  assert.equal(r.result.body_persist_error, undefined);
  assert.equal(fake.table.get(`${WS}|<brand-new@x.com>`).body_html, HTML);
});

test('a later BODYLESS touch does NOT null an already-populated body', async () => {
  const fake = makeFakePostgrest({
    contacts: TRACKED,
    rows: [{ workspace_id: WS, internet_message_id: MSG, body_format: 'html',
             body_html: HTML, body_text: null, source_user_id: PLATFORM_USER.id }],
  });

  // the 5-minute forward sweep sends no `body` key at all
  const r = await handleOutlookMessageExtract(jobFor({ body: undefined }), { opsQuery: fake.q });

  assert.equal(r.ok, true);
  const stored = fake.table.get(`${WS}|${MSG}`);
  assert.equal(stored.body_html, HTML, 'null-erasure guard: stored body survives');
  assert.equal(stored.body_format, 'html');
});

// ---- the actual root cause -------------------------------------------------

test('an lcc_users id is BRIDGED to public.users(id) before it reaches the FK', async () => {
  const fake = makeFakePostgrest({ contacts: TRACKED });
  const r = await handleOutlookMessageExtract(
    jobFor({ body: { contentType: 'html', content: HTML } }), { opsQuery: fake.q });

  assert.equal(r.ok, true);
  assert.equal(r.result.body_persist_error, undefined, 'the FK must not reject it');
  assert.equal(r.result.source_user_resolved_via, 'lcc_users_email');
  // the stamp is the PLATFORM id, never the raw lcc_users id
  assert.equal(fake.table.get(`${WS}|${MSG}`).source_user_id, PLATFORM_USER.id);
  assert.equal(fake.table.get(`${WS}|${MSG}`).body_html, HTML);
});

test('an unbridgeable source user writes the BODY with a NULL stamp, never losing the row', async () => {
  const fake = makeFakePostgrest({ contacts: TRACKED, lccUsers: [] });
  const r = await handleOutlookMessageExtract(
    jobFor({ body: { contentType: 'html', content: HTML }, sourceUserId: 'ffffffff-0000-0000-0000-000000000000' }),
    { opsQuery: fake.q });

  assert.equal(r.ok, true);
  assert.equal(r.result.body_persist_error, undefined);
  assert.equal(r.result.source_user_unresolved, 'ffffffff-0000-0000-0000-000000000000');
  const stored = fake.table.get(`${WS}|${MSG}`);
  assert.equal(stored.body_html, HTML, 'the body is what matters — never drop it over a provenance stamp');
  assert.equal(stored.source_user_id, null);
});

test('a real FK rejection is reported with its 23503 code, not a bare status', async () => {
  // users list empty ⇒ nothing to bridge to ⇒ simulate the pre-fix stamp by
  // having the resolver find the id directly in a users table the WRITE rejects.
  const fake = makeFakePostgrest({ contacts: TRACKED, users: [], lccUsers: [] });
  fake.q = (function (inner) {
    return async (method, path, body, opts) => {
      if (method === 'POST' && path.startsWith('email_bodies?')) {
        return { ok: false, status: 409, data: {
          code: '23503',
          message: 'insert or update on table "email_bodies" violates foreign key '
                 + 'constraint "email_bodies_source_user_id_fkey"' } };
      }
      return inner(method, path, body, opts);
    };
  })(fake.q);

  const r = await handleOutlookMessageExtract(
    jobFor({ body: { contentType: 'html', content: HTML } }), { opsQuery: fake.q });

  assert.equal(r.result.body_persist_error, 'upsert_409');
  assert.equal(r.result.body_persist_detail.code, '23503',
    'a 409 must be self-diagnosing — 23503 (FK) reads identically to 23505 (unique) by status alone');
  assert.match(r.result.body_persist_detail.message, /foreign key/);
});

// ---- regression pin on the header itself ----------------------------------

test('the upsert declares on_conflict AND asks for merge-duplicates', async () => {
  const fake = makeFakePostgrest({
    contacts: TRACKED,
    rows: [{ workspace_id: WS, internet_message_id: MSG, body_html: null, body_text: null,
             source_user_id: PLATFORM_USER.id }],
  });
  await handleOutlookMessageExtract(
    jobFor({ body: { contentType: 'html', content: HTML } }), { opsQuery: fake.q });

  const post = fake.calls.find((c) => c.method === 'POST' && c.path.startsWith('email_bodies?'));
  assert.ok(post, 'the handler must POST to email_bodies');
  assert.match(post.path, /on_conflict=workspace_id,internet_message_id/);
  assert.match(String(post.opts?.headers?.Prefer || ''), /resolution=merge-duplicates/,
    'drop this and every existing row 23505s — the simulator would 409 above');
});

// ---- the resolver in isolation --------------------------------------------

test('resolveSourceUserId: a public.users id passes straight through', async () => {
  const fake = makeFakePostgrest({});
  const out = await resolveSourceUserId(PLATFORM_USER.id, { opsQuery: fake.q });
  assert.deepEqual({ id: out.id, via: out.via }, { id: PLATFORM_USER.id, via: 'users' });
});

test('resolveSourceUserId: an lcc_users id resolves by email', async () => {
  const fake = makeFakePostgrest({});
  const out = await resolveSourceUserId(LCC_USER.lcc_user_id, { opsQuery: fake.q });
  assert.deepEqual({ id: out.id, via: out.via }, { id: PLATFORM_USER.id, via: 'lcc_users_email' });
});

test('resolveSourceUserId: an lcc_user with no platform twin resolves to null, not a guess', async () => {
  const fake = makeFakePostgrest({ users: [], lccUsers: [LCC_USER] });
  const out = await resolveSourceUserId(LCC_USER.lcc_user_id, { opsQuery: fake.q });
  assert.equal(out.id, null);
  assert.equal(out.via, 'lcc_user_no_platform_user');
});

test('resolveSourceUserId: a READ failure is not cached as "not a user"', async () => {
  let calls = 0;
  const flaky = async (method, path) => {
    calls++;
    if (calls === 1) return { ok: false, status: 503, data: { error: 'down' } };
    if (path.startsWith('users?id=eq.')) return { ok: true, status: 200, data: [{ id: PLATFORM_USER.id }] };
    return { ok: true, status: 200, data: [] };
  };
  const first = await resolveSourceUserId(PLATFORM_USER.id, { opsQuery: flaky });
  assert.equal(first.via, 'lookup_error');
  // a transient blip must not poison the rest of a 10,000-message sweep
  const second = await resolveSourceUserId(PLATFORM_USER.id, { opsQuery: flaky });
  assert.equal(second.id, PLATFORM_USER.id);
});
