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

async function logMessages(dealEntityId, messages, ws) {
  let logged = 0, skipped = 0;
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
      if (r?.inserted) logged++; else skipped++;
    } catch (_e) { skipped++; }
  }
  return { logged, skipped };
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
    const limit = req.query?.limit ? Number(req.query.limit) : null;
    const deals = await opsQuery('GET',
      'bd_opportunities?select=entity_id&is_open=is.true&entity_id=not.is.null' + (limit ? ('&limit=' + limit) : ''))
      .catch(() => null);
    const ids = Array.from(new Set((deals?.data || []).map((d) => d.entity_id).filter(Boolean)));

    let dealsSearched = 0, messagesLogged = 0; const errors = [];
    for (const eid of ids) {
      const seedR = await opsQuery('POST', 'rpc/lcc_deal_correspondents', { p_deal_entity_id: eid }).catch(() => null);
      const seed = seedR?.data;
      if (!seed) continue;
      const s = await getDealThreads({
        subjects: (seed.search_subjects || []).filter(Boolean),
        emails: seed.correspondent_emails || [],
      });
      dealsSearched++;
      if (!s.ok) { errors.push({ entity_id: eid, reason: s.reason }); continue; }
      const r = await logMessages(eid, s.messages, ws);
      messagesLogged += r.logged;
    }
    return res.status(200).json({ ok: true, mode: 'worker', deals_searched: dealsSearched, messages_logged: messagesLogged, errors });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: 'deal_backfill_error', detail: String(e?.message || e).slice(0, 300) });
  }
}
