// api/_handlers/correspondent-party-backfill.js
// ============================================================================
// SF-SOURCED PARTY BACKFILL — the email-keyed correspondent resolver worker
// ----------------------------------------------------------------------------
// The durable BD unit is the PARTY (a client / broker / counsel / title rep),
// not the deal. Ten-plus years of correspondence carry ~2,560 distinct external
// correspondents, but only ~334 resolve to an entity today (entities.email).
// The other ~2,226 send/receive mail with Team Briggs yet have no person in the
// graph — so a sent/inbound email from them can't stamp `party_entity_id`, and
// their relationship history is invisible to the packet layer.
//
// This worker fills that gap the CLEAN way. It does NOT fuzzy-match names out of
// email bodies. It resolves each unresolved correspondent EMAIL against
// Salesforce (the authoritative email<->name<->account source) and links a
// person entity through the SAME machinery the WhoId resolver uses
// (defaultResolveOrCreateSfContact → ensureEntityLink's R39 email tier + name
// guards). The by-id resolver (sf-contact-resolve.js) keys on a SF Task's WhoId;
// this one keys on the correspondent's email — the two are complementary drains
// over the same identity spine.
//
//   GET  → dry-run: the ranked workable head (highest-touch first). No SF calls,
//          no writes.
//   POST → drain: bounded by `limit` + a wall-clock budget. Per email:
//            1. findSalesforceContactByEmail(email)  (SF_LOOKUP_WEBHOOK_URL flow)
//            2. hit  → defaultResolveOrCreateSfContact({whoId: SF Contact Id, …})
//                      — mints, or ATTACHES-by-email to an existing CoStar/RCA/SF
//                      person (one entity, never a duplicate); junk/implausible
//                      guards reject garbage.
//               miss → record no_match (negative cache, bounded retry).
//            3. upsert correspondent_backfill_log (provenance + self-clearing).
//
// The workable set is computed by lcc_unresolved_correspondents() and is
// SELF-CLEARING: an email leaves it the instant an entity carries it
// (entities.email) or the log records a terminal outcome — no separate queue to
// keep in sync. Reversible: delete a log row to re-queue that email.
//
// Feature-flagged: no-ops cleanly when SF_LOOKUP_WEBHOOK_URL is unset (reports
// byemail_configured:false, drains nothing). Never writes back to Salesforce
// (LCC-writes-back doctrine off); the only SF interaction is the read-only
// email lookup.
// ============================================================================

import { authenticate } from '../_shared/auth.js';
import { opsQuery, resolvePrimaryWorkspaceId } from '../_shared/ops-db.js';
import { findSalesforceContactByEmail, isSalesforceConfigured } from '../_shared/salesforce.js';
import {
  defaultResolveOrCreateSfContact,
  defaultOpenSfMismatchDecision,
  sfContactAccountMismatch,
} from './sf-activity-ingest.js';

// A transient lookup outage (flow http error / unavailable) gets a few retries;
// a definitive no_match / name-guard rejection is terminal (bounded by the
// no_match cap the enumeration RPC applies).
const MAX_ATTEMPTS = parseInt(process.env.SF_RESOLVE_MAX_ATTEMPTS || '5', 10);

/** Default upsert for the log row — PostgREST on_conflict merge on email. */
async function defaultMarkRow(email, patch) {
  const row = { email, ...patch };
  try {
    await opsQuery('POST', 'correspondent_backfill_log?on_conflict=email', [row],
      { headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
  } catch (_e) { /* soft — a re-tick re-processes the email */ }
}

/**
 * Resolve ONE unresolved correspondent email. Pure orchestration over injected
 * deps so it unit-tests without a live DB / SF flow.
 *
 * row: { email, touches, last_seen, prior_attempts, prior_outcome }
 * deps:
 *   lookupByEmail(email) -> findSalesforceContactByEmail shape
 *   mintContact({email, contact}) -> { ok, entityId, createdEntity, resolvedByEmail } | { ok:false, reason, detail? }
 *   detectMismatch({email, accountName}) -> { mismatch, email_domain?, account_name? }
 *   openMismatch({workspaceId, entityId, detail}) -> boolean
 *   markRow(email, patch) -> Promise
 *   workspaceId: string|null
 *   maxAttempts: number
 */
export async function resolveCorrespondent(row, deps) {
  const nowIso = new Date().toISOString();
  const attempts = Number(row.prior_attempts || 0) + 1;
  const maxAttempts = deps.maxAttempts || MAX_ATTEMPTS;
  const email = row.email;

  const found = await deps.lookupByEmail(email);

  // Lookup unconfigured — caller stops the whole drain (never burns an attempt).
  if (found && found.reason === 'sf_not_configured') return { outcome: 'not_configured' };

  // A definitive "no such contact" is terminal (negative cache); the enumeration
  // RPC stops re-offering it once attempts hit the no_match cap.
  if (found && found.ok === true && !found.contact) {
    await deps.markRow(email, { outcome: 'no_match', attempts, last_attempt_at: nowIso, detail: 'sf_no_match' });
    return { outcome: 'no_match' };
  }

  // A transient lookup failure (flow http error / reported failure / timeout):
  // record as error and retry on a later tick, up to the cap.
  if (!found || found.ok !== true) {
    const reason = (found && found.reason) || 'unavailable';
    await deps.markRow(email, {
      outcome: 'error', attempts, last_attempt_at: nowIso,
      detail: String(reason).slice(0, 300),
    });
    return { outcome: attempts >= maxAttempts ? 'error_capped' : 'error' };
  }

  const c = found.contact || {};
  const sfId = c.Id || c.id || null;
  // Mint (or attach-by-email) through the shared SF-contact machinery — same
  // path, same guards, same R39 email tier as the WhoId resolver.
  const minted = await deps.mintContact({ email, contact: c });
  if (!minted || !minted.ok || !minted.entityId) {
    const reason = (minted && minted.reason) || 'no_name';
    // A create/link failure is transient — record error + retry.
    if (reason === 'create_failed' || reason === 'link_failed') {
      await deps.markRow(email, {
        outcome: 'error', attempts, last_attempt_at: nowIso, sf_contact_id: sfId,
        detail: (minted && minted.detail) ? String(reason + ': ' + minted.detail).slice(0, 300) : reason,
      });
      return { outcome: attempts >= maxAttempts ? 'error_capped' : 'error' };
    }
    // A name-guard rejection / no_name is terminal — the SF contact is junk or
    // nameless; do not re-hammer. Recorded honestly in `detail`.
    await deps.markRow(email, {
      outcome: 'no_match', attempts, last_attempt_at: nowIso, sf_contact_id: sfId,
      detail: 'sf_hit_but_' + reason,
    });
    return { outcome: 'guard_rejected' };
  }

  // Optional Unit-3 mismatch flag — a SF account name that contradicts the
  // email domain is a Salesforce data-quality issue LCC surfaces (never inherits).
  let mismatchFlagged = false;
  const accountName = c.AccountName || c.account_name || (c.Account && (c.Account.Name || c.Account.name)) || null;
  if (c.Email || email) {
    if (accountName) {
      const mm = deps.detectMismatch({ email: c.Email || email, accountName });
      if (mm && mm.mismatch) {
        try {
          mismatchFlagged = !!(await deps.openMismatch({
            workspaceId: deps.workspaceId, entityId: minted.entityId,
            detail: {
              contact_entity_id: minted.entityId, sf_contact_id: sfId,
              sf_account_id: c.AccountId || c.account_id || null,
              email_domain: mm.email_domain, account_name: mm.account_name,
              contact_name: c.Name || c.name || null, via: 'correspondent_party_backfill',
            },
          }));
        } catch (_e) { /* non-blocking */ }
      }
    }
  }

  await deps.markRow(email, {
    outcome: 'resolved', attempts, last_attempt_at: nowIso,
    entity_id: minted.entityId, sf_contact_id: sfId,
    workspace_id: deps.workspaceId || null,
    detail: minted.resolvedByEmail ? 'reconciled_email' : (minted.createdEntity ? 'minted' : 'attached'),
  });
  return {
    outcome: 'resolved', entity_id: minted.entityId,
    created: !!minted.createdEntity, reconciled: !!minted.resolvedByEmail,
    mismatch_flagged: mismatchFlagged,
  };
}

// ── HTTP entrypoint ─────────────────────────────────────────────────────────
export async function handleCorrespondentPartyBackfillTick(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET (dry-run) or POST only' });
  }
  const user = await authenticate(req, res);
  if (!user) return;

  const dryRun = req.method === 'GET';
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '25', 10)));
  const minTouches = Math.max(1, parseInt(req.query.min_touches || '2', 10));
  const configured = isSalesforceConfigured();

  const result = {
    mode: dryRun ? 'dry_run' : 'apply',
    byemail_configured: configured,
    min_touches: minTouches,
    workable_returned: 0,   // rows the enumeration RPC offered (capped by limit)
    scanned: 0,
    resolved: 0,
    minted: 0,
    attached: 0,
    reconciled: 0,
    no_match: 0,
    errored: 0,
    mismatches_flagged: 0,
    items: [],
  };

  // Pull the ranked workable head (highest-touch first).
  const rowsRes = await opsQuery('POST', 'rpc/lcc_unresolved_correspondents', {
    p_limit: limit, p_min_touches: minTouches,
  });
  if (!rowsRes.ok) {
    return res.status(rowsRes.status || 500).json({ error: 'Failed to enumerate correspondents', detail: rowsRes.data });
  }
  const rows = Array.isArray(rowsRes.data) ? rowsRes.data : [];
  result.workable_returned = rows.length;
  result.scanned = rows.length;

  if (dryRun) {
    result.note = configured ? undefined : 'SF_LOOKUP_WEBHOOK_URL unset — backfill inert (dry-run only)';
    for (const r of rows.slice(0, 50)) {
      result.items.push({ email: r.email, touches: Number(r.touches), last_seen: r.last_seen, prior_outcome: r.prior_outcome || null });
    }
    return res.status(200).json(result);
  }

  if (!configured) {
    result.note = 'SF_LOOKUP_WEBHOOK_URL unset — backfill inert (no SF lookup available)';
    return res.status(200).json(result);
  }

  // The account primary/oldest workspace — resolved ONCE per tick (mint targets
  // it; entities.workspace_id is NOT NULL).
  const workspaceId = await resolvePrimaryWorkspaceId({ opsQuery });

  const deadline = Date.now() + parseInt(process.env.SF_RESOLVE_BUDGET_MS || '20000', 10);

  for (const row of rows) {
    if (Date.now() > deadline) { result.budget_stopped = true; break; }
    const deps = {
      maxAttempts: MAX_ATTEMPTS,
      workspaceId,
      lookupByEmail: (em) => findSalesforceContactByEmail(em),
      mintContact: ({ email, contact }) => defaultResolveOrCreateSfContact({
        workspaceId, userId: user.id,
        whoId: contact.Id || contact.id,
        accountId: contact.AccountId || contact.account_id,
        accountName: contact.AccountName || contact.account_name
          || (contact.Account && (contact.Account.Name || contact.Account.name)) || null,
        name: contact.Name || contact.name,
        email: contact.Email || contact.email || email,
        first: contact.FirstName || contact.first_name || null,
        last: contact.LastName || contact.last_name || null,
        phone: contact.Phone || contact.phone || null,
        title: contact.Title || contact.title || null,
      }).then((m) => (m && m.entityId
        ? { ok: true, ...m }
        : { ok: false, reason: (m && m.reason) || 'no_name', detail: (m && m.detail) || null })),
      detectMismatch: (args) => sfContactAccountMismatch(args),
      openMismatch: (args) => defaultOpenSfMismatchDecision(args),
      markRow: defaultMarkRow,
    };

    let out;
    try {
      out = await resolveCorrespondent(row, deps);
    } catch (e) {
      out = { outcome: 'error', error: String((e && e.message) || e) };
      await defaultMarkRow(row.email, {
        outcome: 'error', attempts: Number(row.prior_attempts || 0) + 1,
        last_attempt_at: new Date().toISOString(), detail: out.error.slice(0, 300),
      });
    }

    if (out.outcome === 'not_configured') {
      result.note = 'SF_LOOKUP_WEBHOOK_URL became unavailable mid-drain';
      break;
    }
    if (out.outcome === 'resolved') {
      result.resolved++;
      if (out.created) result.minted++; else result.attached++;
      if (out.reconciled) result.reconciled++;
      if (out.mismatch_flagged) result.mismatches_flagged++;
    } else if (out.outcome === 'no_match' || out.outcome === 'guard_rejected') {
      result.no_match++;
    } else {
      result.errored++;
    }
    result.items.push({ email: row.email, outcome: out.outcome, entity_id: out.entity_id || null });
  }

  return res.status(200).json(result);
}
