// api/_handlers/sf-contact-resolve.js
// ============================================================================
// SF-CONTACT-RECONCILE Unit 2 — the WhoId resolver worker
// ----------------------------------------------------------------------------
// The SF Activity Sync PA flow sends each Task's WhoId (Contact id) + WhatId,
// but the Salesforce connector can't return relationship fields (Who.Name is
// rejected) and per-record lookups inside the recurring flow are far too slow.
// So the recurring flow stays simple/fast (WhoId/WhatId only), the ingest queues
// the handful of WhoIds it couldn't resolve (Unit 1 → sf_contact_resolve_queue),
// and THIS worker drains that bounded queue via a dedicated, reliable
// get-by-id flow — a few new contacts per sync, not every Task.
//
// This is what makes PR #1404 (Units 1-3: mint WhoId contact + email-reconcile +
// mismatch lane) actually fire — those units are inert because the recurring
// flow no longer carries Who.Name/Who.Email. Here we fetch those names on demand.
//
//   GET  → dry-run (queue depth + a sample) — no SF calls, no writes.
//   POST → drain (bounded by `limit` + a wall-clock budget).
//
// Per queued WhoId (status='seen', oldest first):
//   1. getSalesforceContactById(who_id) via SF_CONTACT_BYID_URL.
//   2. ensureEntityLink(salesforce/Contact, externalId=who_id, seed name/email/…)
//      — routes through the R39 email tier, so the SF Eric Dowling ATTACHES to
//      the existing CoStar/RCA Dowling (one entity) instead of a duplicate; the
//      junk/implausible-person guards reject garbage (never invents a contact).
//   3. sfContactAccountMismatch({email, accountName}) → seed a
//      sf_contact_account_mismatch Decision-Center row (record-only; no SF write).
//   4. mark the queue row resolved (+ resolved_entity_id) / no_data / dead-letter
//      after SF_RESOLVE_MAX_ATTEMPTS.
//
// Feature-flagged: no-ops cleanly when SF_CONTACT_BYID_URL is unset (queue rows
// stay 'seen'). Reuses (never forks) the PR #1404 machinery:
// defaultResolveOrCreateSfContact (mint/attach), sfContactAccountMismatch
// (detector), defaultOpenSfMismatchDecision (Decision-Center producer).
// ============================================================================

import { authenticate } from '../_shared/auth.js';
import { opsQuery, pgFilterVal, resolvePrimaryWorkspaceId } from '../_shared/ops-db.js';
import { getSalesforceContactById, isSfContactByIdConfigured } from '../_shared/salesforce.js';
import {
  defaultResolveOrCreateSfContact,
  defaultOpenSfMismatchDecision,
  sfContactAccountMismatch,
} from './sf-activity-ingest.js';

// A transient by-id outage (unavailable / flow error) gets a few retries; a
// definitive no_data / guard-rejection is terminal.
const MAX_ATTEMPTS = parseInt(process.env.SF_RESOLVE_MAX_ATTEMPTS || '5', 10);

/**
 * Resolve ONE queued WhoId. Pure orchestration over injected deps so it
 * unit-tests without a live DB / SF flow.
 *
 * deps:
 *   getContactById(whoId) -> { ok, contact:{id,name,email,first,last,phone,title,
 *                              account_id,account_name} } | { ok:false, reason }
 *   mintContact({whoId, workspaceId, contact}) -> { ok, entityId, createdEntity,
 *                              resolvedByEmail } | null
 *   detectMismatch({email, accountName}) -> { mismatch, email_domain?, account_name? }
 *   openMismatch({workspaceId, entityId, detail}) -> boolean
 *   markRow(whoId, patch) -> Promise
 *   maxAttempts: number
 *   fallbackWorkspaceId: string|null — the account primary/oldest workspace,
 *     used when the queue row's workspace_id is null (the SF ingest can't always
 *     resolve one at enqueue). entities.workspace_id is NOT NULL, so minting with
 *     a null workspace 23502s — this fallback (the createResearchTask pattern) is
 *     what keeps a workspace-null row from being stranded on the mint forever.
 */
export async function resolveWhoId(row, deps) {
  const nowIso = new Date().toISOString();
  const attempts = Number(row.attempts || 0) + 1;
  const maxAttempts = deps.maxAttempts || MAX_ATTEMPTS;
  // Row workspace when present, else the account fallback — never a null into the
  // mint (which would 23502 on entities.workspace_id).
  const workspaceId = row.workspace_id || deps.fallbackWorkspaceId || null;

  const fetched = await deps.getContactById(row.who_id);

  if (!fetched || fetched.ok !== true) {
    const reason = (fetched && fetched.reason) || 'unavailable';
    // Unconfigured is handled by the caller (it stops the whole drain) — never
    // burns an attempt on a queue row.
    if (reason === 'not_configured') return { outcome: 'not_configured' };
    // Definitive: the id isn't a resolvable Contact (Lead / blank / deleted /
    // malformed). Mark terminal so it isn't re-hammered.
    if (reason === 'no_data' || reason === 'bad_contact_id') {
      await deps.markRow(row.who_id, { status: 'no_data', attempts, last_attempt_at: nowIso, detail: reason });
      return { outcome: 'no_data' };
    }
    // Transient (unavailable / flow error): dead-letter at the cap, else retry.
    if (attempts >= maxAttempts) {
      await deps.markRow(row.who_id, { status: 'dead', attempts, last_attempt_at: nowIso, detail: String(reason).slice(0, 300) });
      return { outcome: 'dead' };
    }
    await deps.markRow(row.who_id, { status: 'seen', attempts, last_attempt_at: nowIso, detail: String(reason).slice(0, 300) });
    return { outcome: 'retry' };
  }

  const c = fetched.contact || {};
  // Mint (or attach-by-email) via ensureEntityLink. A non-entityId result carries
  // an HONEST reason (no longer a blanket 'guard_rejected'):
  //   - 'no_name'      — the by-id flow returned an id but no usable name/email
  //                      (an adapter/field-map miss). Terminal but honestly
  //                      labeled — NOT a guard rejection.
  //   - a name-guard   — junk_entity_name / implausible_person_name /
  //                      street_fragment_name (a genuine rejection). Terminal.
  //   - 'create_failed'— the entities POST / link failed (a DB/RLS/transient
  //                      error). RETRYABLE — don't terminally strand the row.
  const minted = await deps.mintContact({ whoId: row.who_id, workspaceId, contact: c });
  if (!minted || !minted.ok || !minted.entityId) {
    const reason = (minted && minted.reason) || 'no_name';
    const detail = (minted && minted.detail)
      ? String(reason + ': ' + minted.detail).slice(0, 300)
      : reason;

    // A create/link failure is transient — retry, dead-letter at the cap.
    if (reason === 'create_failed' || reason === 'link_failed') {
      if (attempts >= maxAttempts) {
        await deps.markRow(row.who_id, { status: 'dead', attempts, last_attempt_at: nowIso, detail });
        return { outcome: 'dead' };
      }
      await deps.markRow(row.who_id, { status: 'seen', attempts, last_attempt_at: nowIso, detail });
      return { outcome: 'retry' };
    }

    // 'no_name' (empty/absent name) is honestly its own outcome — never mislabel
    // it as a guard rejection. A real name-guard skip stays 'guard_rejected'.
    // The queue status stays 'no_data' (the allowed terminal value); the reason
    // rides `detail` so the true cause is observable on the next drain.
    await deps.markRow(row.who_id, { status: 'no_data', attempts, last_attempt_at: nowIso, detail: reason });
    return { outcome: reason === 'no_name' ? 'no_name' : 'guard_rejected' };
  }

  // Unit-3 mismatch detector — an email-domain firm that contradicts the SF
  // account name is a Salesforce data-quality error LCC flags (never inherits).
  let mismatchFlagged = false;
  if (c.email && c.account_name) {
    const mm = deps.detectMismatch({ email: c.email, accountName: c.account_name });
    if (mm && mm.mismatch) {
      try {
        mismatchFlagged = !!(await deps.openMismatch({
          workspaceId, entityId: minted.entityId,
          detail: {
            contact_entity_id: minted.entityId, sf_contact_id: row.who_id,
            sf_account_id: c.account_id || null,
            email_domain: mm.email_domain, account_name: mm.account_name,
            contact_name: c.name || null, via: 'sf_contact_resolve',
          },
        }));
      } catch (_e) { /* non-blocking */ }
    }
  }

  await deps.markRow(row.who_id, {
    status: 'resolved', attempts, last_attempt_at: nowIso,
    resolved_entity_id: minted.entityId,
    detail: minted.resolvedByEmail ? 'reconciled_email' : (minted.createdEntity ? 'minted' : 'attached'),
  });
  return {
    outcome: 'resolved', entity_id: minted.entityId,
    created: !!minted.createdEntity, reconciled: !!minted.resolvedByEmail,
    mismatch_flagged: mismatchFlagged,
  };
}

/** Default markRow — PATCH the queue row's mutable fields (never touches
 *  first_seen_at / workspace_id). */
async function defaultMarkRow(whoId, patch) {
  const body = {};
  for (const k of ['status', 'attempts', 'last_attempt_at', 'resolved_entity_id', 'detail']) {
    if (patch[k] !== undefined) body[k] = patch[k];
  }
  try {
    await opsQuery('PATCH', 'sf_contact_resolve_queue?who_id=eq.' + pgFilterVal(whoId), body,
      { headers: { Prefer: 'return=minimal' } });
  } catch (_e) { /* soft — a re-tick re-processes the row */ }
}

// ── HTTP entrypoint ─────────────────────────────────────────────────────────
export async function handleSfContactResolveTick(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET (dry-run) or POST only' });
  }
  const user = await authenticate(req, res);
  if (!user) return;

  const dryRun = req.method === 'GET';
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '25', 10)));
  const configured = isSfContactByIdConfigured();

  const result = {
    mode: dryRun ? 'dry_run' : 'apply',
    byid_configured: configured,
    queue_depth: 0,     // status='seen' rows
    scanned: 0,
    resolved: 0,
    minted: 0,
    reconciled: 0,
    no_data: 0,
    no_name: 0,
    retried: 0,
    dead: 0,
    mismatches_flagged: 0,
    items: [],
  };

  // Honest queue depth (the workable 'seen' set).
  const cntRes = await opsQuery('GET', 'sf_contact_resolve_queue?status=eq.seen&select=who_id', null,
    { countMode: 'exact' });
  if (cntRes.ok) result.queue_depth = cntRes.count || (Array.isArray(cntRes.data) ? cntRes.data.length : 0);

  // Pull the workable batch (oldest first).
  const rowsRes = await opsQuery('GET',
    'sf_contact_resolve_queue?status=eq.seen'
    + '&select=who_id,workspace_id,attempts,first_seen_at'
    + '&order=first_seen_at.asc&limit=' + limit,
    null, { countMode: 'none' });
  if (!rowsRes.ok) {
    return res.status(rowsRes.status || 500).json({ error: 'Failed to list resolve queue', detail: rowsRes.data });
  }
  const rows = Array.isArray(rowsRes.data) ? rowsRes.data : [];
  result.scanned = rows.length;

  if (dryRun) {
    result.note = configured ? undefined : 'SF_CONTACT_BYID_URL unset — resolver inert (queue rows stay seen)';
    for (const r of rows.slice(0, 25)) {
      result.items.push({ who_id: r.who_id, attempts: r.attempts, first_seen_at: r.first_seen_at });
    }
    return res.status(200).json(result);
  }

  if (!configured) {
    result.note = 'SF_CONTACT_BYID_URL unset — resolver inert (queue rows stay seen)';
    return res.status(200).json(result);
  }

  const deadline = Date.now() + parseInt(process.env.SF_RESOLVE_BUDGET_MS || '20000', 10);

  // The account primary/oldest workspace — resolved ONCE per tick as the fallback
  // for any queue row enqueued with a null workspace_id (the SF ingest can't
  // always resolve one). Without this the mint 23502s on entities.workspace_id
  // and the row retries forever. Same pattern as createResearchTask.
  const fallbackWorkspaceId = await resolvePrimaryWorkspaceId({ opsQuery });

  for (const row of rows) {
    if (Date.now() > deadline) { result.budget_stopped = true; break; }
    const deps = {
      maxAttempts: MAX_ATTEMPTS,
      fallbackWorkspaceId,
      getContactById: (whoId) => getSalesforceContactById(whoId),
      mintContact: ({ whoId, workspaceId, contact }) => defaultResolveOrCreateSfContact({
        workspaceId, userId: user.id, whoId, accountId: contact.account_id,
        accountName: contact.account_name,
        name: contact.name, email: contact.email, first: contact.first,
        last: contact.last, phone: contact.phone, title: contact.title,
      }).then((m) => (m && m.entityId
        ? { ok: true, ...m }
        : { ok: false, reason: (m && m.reason) || 'no_name', detail: (m && m.detail) || null })),
      detectMismatch: (args) => sfContactAccountMismatch(args),
      openMismatch: (args) => defaultOpenSfMismatchDecision(args),
      markRow: defaultMarkRow,
    };

    let out;
    try {
      out = await resolveWhoId(row, deps);
    } catch (e) {
      out = { outcome: 'error', error: String((e && e.message) || e) };
      // On an unexpected throw, mark a soft retry so the row isn't stuck.
      await defaultMarkRow(row.who_id, {
        status: (Number(row.attempts || 0) + 1) >= MAX_ATTEMPTS ? 'dead' : 'seen',
        attempts: Number(row.attempts || 0) + 1, last_attempt_at: new Date().toISOString(),
        detail: out.error.slice(0, 300),
      });
    }

    if (out.outcome === 'not_configured') {
      // Should not happen (we gated above), but stop the drain if it does.
      result.note = 'SF_CONTACT_BYID_URL became unavailable mid-drain';
      break;
    }
    if (out.outcome === 'resolved') {
      result.resolved++;
      if (out.created) result.minted++;
      if (out.reconciled) result.reconciled++;
      if (out.mismatch_flagged) result.mismatches_flagged++;
    } else if (out.outcome === 'no_name') {
      result.no_name++;
    } else if (out.outcome === 'no_data' || out.outcome === 'guard_rejected') {
      result.no_data++;
    } else if (out.outcome === 'dead') {
      result.dead++;
    } else if (out.outcome === 'retry' || out.outcome === 'error') {
      result.retried++;
    }
    result.items.push({ who_id: row.who_id, outcome: out.outcome, entity_id: out.entity_id || null });
  }

  return res.status(200).json(result);
}
