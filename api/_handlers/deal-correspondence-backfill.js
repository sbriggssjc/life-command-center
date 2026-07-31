// api/_handlers/deal-correspondence-backfill.js
// ============================================================================
// Deal-correspondence backfill — brings deal email threads into the activity spine,
// deal-stamped, so staleness / last-touch / content-aware next-steps work. See
// docs/architecture/correspondence-ingestion-design.md.
//
// Route: POST /api/deal-correspondence-backfill  (admin _route='deal-correspondence-backfill')
//   Receiver mode — body { deal_entity_id, messages:[{internet_message_id,subject,from,to,
//                          received_at,body_snippet,web_link}] } → logs each (testable now).
//   Worker mode   — no body: sweep open deals → lcc_deal_correspondents seed → Outlook search
//                   flow → log. Gated on OUTLOOK_SEARCH_WEBHOOK_URL (inert until the flow exists).
//   ?limit=N caps deals in worker mode.
//
// Reuses logEmailIntakeCorrespondence (dedups on internet_message_id) — no new spine logic.
// Never throws.
// ============================================================================
import { opsQuery, resolvePrimaryWorkspaceId } from '../_shared/ops-db.js';
import { logEmailIntakeCorrespondence } from '../_shared/intake-correspondence.js';
import { getDealThreads, isOutlookSearchConfigured } from '../_shared/outlook-search.js';

const SYS = 'b0000000-0000-0000-0000-000000000001';
const WS_FALLBACK = 'a0000000-0000-0000-0000-000000000001';

// Direction from the sender: our own (northmarq) address = outbound, else inbound.
// Drives lcc_reconcile_deal_todo's ball-in-court so My Day sorts "reply received —
// your move" above "awaiting them."
function inferDirection(m) {
  const from = String(m?.from || '').toLowerCase();
  return from.includes('northmarq') ? 'outbound' : 'inbound';
}

async function logMessages(dealEntityId, messages, ws) {
  let logged = 0, skipped = 0, reconciled = 0;
  for (const m of (Array.isArray(messages) ? messages : [])) {
    if (!m || !(m.internet_message_id || m.message_id)) { skipped++; continue; }
    try {
      const r = await logEmailIntakeCorrespondence({
        channel: 'email',
        emailContext: m,
        matchedEntityId: dealEntityId,   // stamps entity_id = the deal → My Day last-touch catches it
        workspaceId: ws,
        actorId: SYS,
        intakeId: null,
      });
      if (r?.inserted) {
        logged++;
        // Reconcile the deal's open deal_next_step to-dos with this correspondence
        // (evidence stamp + ball-in-court + de-stale). Non-destructive; best-effort —
        // a reconcile hiccup never un-logs the message.
        try {
          const rc = await opsQuery('POST', 'rpc/lcc_reconcile_deal_todo', {
            p_deal_entity_id: dealEntityId,
            p_direction: inferDirection(m),
            p_activity_id: r.id || null,
            p_subject: m.subject || null,
            p_occurred_at: m.received_at || null,
          });
          const packet = Array.isArray(rc?.data) ? rc.data[0] : rc?.data;
          if (packet?.todos_reconciled) reconciled += packet.todos_reconciled;
        } catch (_e) { /* best-effort */ }
      } else skipped++;
    } catch (_e) { skipped++; }
  }
  return { logged, skipped, reconciled };
}

export async function handleDealCorrespondenceBackfill(req, res) {
  try {
    const ws = (await resolvePrimaryWorkspaceId({ opsQuery }).catch(() => null)) || WS_FALLBACK;
    const body = req.body || {};

    // Receiver mode — caller supplies the messages for one deal.
    if (Array.isArray(body.messages) && body.deal_entity_id) {
      const r = await logMessages(body.deal_entity_id, body.messages, ws);
      return res.status(200).json({ ok: true, mode: 'receiver', deal_entity_id: body.deal_entity_id, ...r });
    }

    // Worker mode — sweep open deals, search Outlook, log.
    if (!isOutlookSearchConfigured()) {
      return res.status(200).json({
        ok: false, reason: 'outlook_search_not_configured',
        hint: 'Set OUTLOOK_SEARCH_WEBHOOK_URL and build the deal_thread_search flow. Receiver mode works now for testing.',
      });
    }
    // Batched sweep: a full 40-deal serial flow-sweep exceeds the platform request
    // timeout, and an un-paged worker always restarts from the top (never reaching the
    // tail). `missing_only=1` pages through deals not yet marked correspondence_swept_at,
    // so repeated small-`limit` calls converge to full coverage; each deal is stamped via
    // lcc_mark_deal_swept once searched (even on 0 messages) so it drops out next batch.
    // This is also the cadence hook (a future run re-sweeps by clearing/aging the marker).
    const limit = req.query?.limit ? Number(req.query.limit) : null;
    const missingOnly = req.query?.missing_only === '1' || req.query?.missing_only === 'true';
    const q = 'bd_opportunities?select=entity_id&is_open=is.true&entity_id=not.is.null'
      + (missingOnly ? '&metadata->>correspondence_swept_at=is.null' : '')
      + '&order=entity_id.asc'
      + (limit ? ('&limit=' + limit) : '');
    const deals = await opsQuery('GET', q).catch(() => null);
    const ids = Array.from(new Set((deals?.data || []).map((d) => d.entity_id).filter(Boolean)));

    let dealsSearched = 0, messagesLogged = 0, todosReconciled = 0, dealsSwept = 0; const errors = [];
    for (const eid of ids) {
      const seedR = await opsQuery('POST', 'rpc/lcc_deal_correspondents', { p_deal_entity_id: eid }).catch(() => null);
      const seed = seedR?.data;
      if (!seed) continue;
      const s = await getDealThreads({
        subjects: (seed.search_subjects || []).filter(Boolean),
        emails: seed.correspondent_emails || [],
      });
      dealsSearched++;
      if (!s.ok) { errors.push({ entity_id: eid, reason: s.reason, status: s.status, detail: s.detail }); continue; }
      const r = await logMessages(eid, s.messages, ws);
      messagesLogged += r.logged;
      todosReconciled += (r.reconciled || 0);
      // Mark swept even when 0 messages (true negative) so missing_only paging advances.
      try {
        await opsQuery('POST', 'rpc/lcc_mark_deal_swept',
          { p_entity_id: eid, p_count: (s.messages || []).length });
        dealsSwept++;
      } catch (_e) { /* best-effort; unswept deal simply retries next batch */ }
    }
    return res.status(200).json({ ok: true, mode: 'worker', missing_only: missingOnly,
      deals_searched: dealsSearched, messages_logged: messagesLogged,
      todos_reconciled: todosReconciled, deals_swept: dealsSwept, errors });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: 'deal_backfill_error', detail: String(e?.message || e).slice(0, 300) });
  }
}
