// ============================================================================
// Source-user-id resolver — bridge an inbound bridge/PA user id onto
// `public.users(id)` (Prompt 116)
// ----------------------------------------------------------------------------
// WHY THIS EXISTS
//
// The bridge ingest receiver (`api/bridges.js`) takes `_source_user_id`
// VERBATIM from the Power Automate flow's `X-LCC-Source-User-Id` header and the
// Outlook/Calendar handlers stamp it straight onto columns that FOREIGN KEY
// `public.users(id)`:
//
//   email_bodies.source_user_id → users(id)
//   meetings.source_user_id     → users(id)
//   activity_events.actor_id    → users(id)
//
// LCC carries TWO user tables with DISJOINT id spaces (the footgun already
// documented in CLAUDE.md for `touchpoint_cadence.owner_user_id` vs
// `lcc_entity_owner_override.owner_user_id`): **no `lcc_users.lcc_user_id`
// exists in `public.users`**. The BRIDGE BETWEEN THEM IS EMAIL.
//
// Grounded live 2026-08-17 (LCC Opps `xengecqvemvfknjvbvrq`): the backward
// Sent-Items sweep was configured with the *lcc_users* id
// `1d3f7321-a4ad-4f83-9c7b-489554fc1c51` (sabriggs@northmarq.com) while the
// working forward sweep used the *public.users* id
// `b0000000-0000-0000-0000-000000000001` (the SAME person). Every write the
// sweep attempted raised SQLSTATE 23503 `foreign_key_violation`, which
// PostgREST maps to **HTTP 409** — indistinguishable, from the status code
// alone, from the unique-conflict a failed `merge-duplicates` upsert would
// produce. 10,470 `email_bodies` upserts and 423+ `activity_events` inserts
// were rejected that way; the bodies were dropped on the floor.
//
// So: normalize at the boundary instead of trusting the flow's header.
//
// DISCIPLINE
//   - fail-soft: an unresolvable id yields `null`, and the caller writes NULL
//     into a NULLABLE provenance column rather than losing the whole row. A
//     missing "whose mailbox" stamp is a small, recoverable gap; a discarded
//     250 KB email body is not.
//   - never fabricates: we never mint a `users` row, and we only accept an
//     email match that is EXACT (case-insensitive).
//   - memoized per process: the mailbox sweep drives thousands of messages
//     through one process for a handful of distinct source users, so the
//     lookup runs once per id rather than once per message.
// ============================================================================

import { opsQuery as defaultOpsQuery, pgFilterVal } from './ops-db.js';

// rawId → { id, raw, via }. Transient lookup failures are deliberately NOT
// cached (see below) so a blip can't poison the whole sweep.
const _cache = new Map();

/** Test seam — clear the memo table. */
export function _resetSourceUserCache() { _cache.clear(); }

function lowerEmail(s) {
  return typeof s === 'string' && s.trim() ? s.trim().toLowerCase() : null;
}

/**
 * Resolve a raw inbound source-user id to a real `public.users.id`.
 *
 * Resolution order:
 *   1. the id already IS a `public.users.id`          → via 'users'
 *   2. the id is an `lcc_users.lcc_user_id`, and that
 *      row's email matches a `public.users.email`     → via 'lcc_users_email'
 *   3. anything else                                  → id null, via '<reason>'
 *
 * @param {string|null} rawId
 * @param {{opsQuery?: Function}} [deps] - injectable for tests
 * @returns {Promise<{id: string|null, raw: string|null, via: string}>}
 */
export async function resolveSourceUserId(rawId, deps = {}) {
  const q = deps.opsQuery || defaultOpsQuery;

  if (rawId === null || rawId === undefined || rawId === '') {
    return { id: null, raw: null, via: 'absent' };
  }
  const key = String(rawId);
  if (_cache.has(key)) return _cache.get(key);

  const rows = (r) => (r && r.ok && Array.isArray(r.data)) ? r.data : null;
  let out;

  try {
    // ---- 1. already a public.users id ------------------------------------
    const direct = await q('GET',
      `users?id=eq.${pgFilterVal(key)}&select=id&limit=1`,
      null, { countMode: 'none' });
    const directRows = rows(direct);
    if (directRows === null) {
      // A failed READ must not be mistaken for "not a user" — that would
      // silently drop the provenance stamp for the rest of the process.
      return { id: null, raw: key, via: 'lookup_error' };  // uncached
    }
    if (directRows[0]?.id) {
      out = { id: directRows[0].id, raw: key, via: 'users' };
    } else {
      // ---- 2. lcc_users id → email → public.users id --------------------
      const lcc = await q('GET',
        `lcc_users?lcc_user_id=eq.${pgFilterVal(key)}&select=email&limit=1`,
        null, { countMode: 'none' });
      const lccRows = rows(lcc);
      if (lccRows === null) return { id: null, raw: key, via: 'lookup_error' };

      const email = lowerEmail(lccRows[0]?.email);
      if (!email) {
        out = { id: null, raw: key, via: 'unknown_user_id' };
      } else {
        // `users.email` is UNIQUE. Match with ilike (PostgREST cannot call
        // lower() in a filter) then re-verify EXACT case-insensitive equality
        // in JS, so an `_`/`%` in a local-part can never widen the match.
        const u = await q('GET',
          `users?email=ilike.${pgFilterVal(email)}&select=id,email&limit=5`,
          null, { countMode: 'none' });
        const uRows = rows(u);
        if (uRows === null) return { id: null, raw: key, via: 'lookup_error' };

        const hit = uRows.find((r) => lowerEmail(r.email) === email);
        out = hit?.id
          ? { id: hit.id, raw: key, via: 'lcc_users_email' }
          : { id: null, raw: key, via: 'lcc_user_no_platform_user' };
      }
    }
  } catch (_e) {
    return { id: null, raw: key, via: 'lookup_error' };  // uncached
  }

  _cache.set(key, out);
  return out;
}
