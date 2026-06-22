// api/_handlers/contact-writeback.js
// ============================================================================
// R52 Units 2 + 3 — Salesforce contact writeback (close the contact loop)
// ----------------------------------------------------------------------------
// The system learns contacts (CoStar/SF pull → entities, R39 dedup, R16/R20
// acquisition) but the CRM never sees them: the ONLY SF write op was
// create_opportunity. Grounded live 2026-06-20: 1,159 of 2,045 emailable LCC
// person entities (57%) carry an email but NO Salesforce Contact identity —
// stranded prospecting contacts.
//
// This worker pushes them to Salesforce, UPSERT-BY-EMAIL (so SF is never
// duplicated), VALUE-RANKED (highest-value linked owner first), and GATED (a
// deliberate action — env SF_CONTACT_WRITEBACK must be on for a real drain;
// GET dry-run is always safe). On a successful upsert it mirrors the SF Contact
// identity back onto the person (so it's not re-written) AND promotes the SF
// contact's MailingAddress/Phone to first-class (R52 Unit 1, the address
// dimension). Effect-first / outcome-truthful — a row that doesn't push or
// whose mirror fails is reported honestly, never marked written.
//
//   GET  → dry-run (no SF calls, no writes) — reports the value-ranked plan.
//   GET ?summary=1 → SF-Contact-identity coverage before/after counts.
//   POST → drain (gated on SF_CONTACT_WRITEBACK; bounded by limit + budget).
//
// Reuse, not fork: upsertSalesforceContact (the new SF flow op), ensureEntityLink
// (identity mirror + guards), the R39 email guards, toSf18 (sf-id), and the
// R52 Unit-1 promote helpers. No new api/*.js — a sub-route of operations.js.
// ============================================================================

import { authenticate } from '../_shared/auth.js';
import { opsQuery, pgFilterVal } from '../_shared/ops-db.js';
import { ensureEntityLink, normalizeEmail, isGenericInboxEmail, isJunkEntityName, looksLikePersonName } from '../_shared/entity-link.js';
import { upsertSalesforceContact, isSalesforceConfigured } from '../_shared/salesforce.js';
import { toSf18 } from '../_shared/sf-id.js';
import { planContactFieldPromotion } from '../_shared/contact-fields.js';

const WRITEBACK_BATCH_TAG = 'r52_contact_writeback';

/** Is the deliberate writeback gate on? (env SF_CONTACT_WRITEBACK = on|1|true) */
export function isWritebackEnabled() {
  const v = String(process.env.SF_CONTACT_WRITEBACK || '').trim().toLowerCase();
  return v === 'on' || v === '1' || v === 'true' || v === 'yes';
}

/**
 * PURE — decide whether/what to push for ONE candidate. Guards (never write
 * junk / a generic inbox / an implausible person): returns {ok:false, skip} or
 * {ok:true, push:{name,email,phone,company,accountId}}.
 */
export function planContactWriteback(row) {
  const email = normalizeEmail(row && row.email);
  if (!email) return { ok: false, skip: 'no_valid_email' };
  if (isGenericInboxEmail(email)) return { ok: false, skip: 'generic_inbox' };
  const name = String(row.name || '').trim();
  if (!name) return { ok: false, skip: 'no_name' };
  if (isJunkEntityName(name)) return { ok: false, skip: 'junk_name' };
  // Require a plausible HUMAN name — rejects a broker/firm mistyped as a person
  // ("Marcus & Millichap"), deal-string artifacts, and firm-suffixed names. We
  // never push a firm to SF as a Contact. (looksLikePersonName subsumes the
  // junk/implausible guards.)
  if (!looksLikePersonName(name)) return { ok: false, skip: 'not_plausible_person' };
  return {
    ok: true,
    push: {
      name,
      email,
      phone: row.phone ? String(row.phone).trim() : null,
      company: row.company ? String(row.company).trim() : null,
      accountId: row.sf_account_id || null,
    },
  };
}

/** Map an SF contact record's mailing fields → promotable first-class incoming. */
function promotableFromSfContact(c) {
  if (!c || typeof c !== 'object') return {};
  const out = {};
  const street = c.MailingStreet || c.mailing_street;
  const city = c.MailingCity || c.mailing_city;
  const state = c.MailingState || c.mailing_state;
  const zip = c.MailingPostalCode || c.mailing_postal_code;
  const phone = c.Phone || c.phone;
  if (street) out.address = String(street).trim();
  if (city) out.city = String(city).trim();
  if (state) out.state = String(state).trim();
  if (zip) out.zip = String(zip).trim();
  if (phone) out.phone = String(phone).trim();
  return out;
}

/**
 * Process ONE candidate: plan → upsert → mirror identity → promote address.
 * Pure orchestration over injected deps so it unit-tests without fetch:
 *   upsertContact(push)            -> { ok, contact:{Id,...}, created, reason }
 *   mirrorIdentity(row, sfId)      -> { ok }
 *   promoteFields(entityId, incoming) -> { ok, fields:[...] }
 */
export async function processContactWriteback(row, deps) {
  const plan = planContactWriteback(row);
  if (!plan.ok) return { outcome: 'skipped', reason: plan.skip, entity_id: row.entity_id };

  let res;
  try {
    res = await deps.upsertContact(plan.push);
  } catch (e) {
    return { outcome: 'unavailable', reason: String(e && e.message || e), entity_id: row.entity_id };
  }
  if (!res || res.ok !== true) {
    const reason = (res && res.reason) || 'lookup_failed';
    const outcome = reason === 'sf_not_configured' ? 'not_configured'
      : (reason === 'unsupported' || reason === 'unavailable') ? 'unsupported'
      : 'unavailable';
    // Surface the richer SF/PA flow message (R52b) so the real Salesforce
    // error reaches the tick response instead of a bare reason code.
    return { outcome, reason, detail: (res && res.detail) || null, entity_id: row.entity_id };
  }

  const sfId = res.contact && (res.contact.Id || res.contact.id);
  if (!sfId) return { outcome: 'unavailable', reason: 'no_contact_returned', entity_id: row.entity_id };

  // Effect-first / outcome-truthful: mirror the identity so it's not re-written.
  // A failed mirror keeps the row "pending" (it will re-surface next tick) rather
  // than claiming a clean write.
  const mir = await deps.mirrorIdentity(row, sfId);
  if (!mir || !mir.ok) {
    return { outcome: 'mirror_failed', reason: (mir && mir.detail) || 'mirror_failed', entity_id: row.entity_id, sf_contact_id: sfId, created: !!res.created };
  }

  // Promote the SF contact's mailing address / phone to first-class (Unit 1).
  let promoted = [];
  try {
    const pr = await deps.promoteFields(row.entity_id, promotableFromSfContact(res.contact));
    if (pr && pr.ok && pr.changed) promoted = pr.fields || [];
  } catch (_e) { /* promotion is best-effort, never fails the writeback */ }

  return { outcome: 'written', created: !!res.created, sf_contact_id: sfId, entity_id: row.entity_id, promoted_fields: promoted };
}

// ── coverage summary (Unit 3 reporting: SF-Contact coverage before/after) ────
// opsQuery parses content-range into `.count` on a GET (default count=exact);
// limit=1 keeps the body tiny while the header carries the exact total.
async function fetchCoverageSummary() {
  const exact = async (path) => {
    const r = await opsQuery('GET', path + (path.includes('?') ? '&' : '?') + 'limit=1');
    return r && Number.isFinite(r.count) ? r.count : 0;
  };
  const sfContactIdentities = await exact('external_identities?source_system=eq.salesforce&source_type=eq.Contact&select=entity_id');
  const candidatesRemaining = await exact('v_lcc_contact_writeback_candidates?select=entity_id');
  return { sf_contact_identities: sfContactIdentities, candidates_remaining: candidatesRemaining };
}

// ── HTTP entrypoint ─────────────────────────────────────────────────────────
export async function handleContactWritebackTick(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET (dry-run) or POST only' });
  }
  const user = await authenticate(req, res);
  if (!user) return;

  if (req.method === 'GET' && (req.query.summary === '1' || req.query.summary === 'true')) {
    const summary = await fetchCoverageSummary();
    return res.status(200).json({ mode: 'summary', sf_configured: isSalesforceConfigured(), writeback_enabled: isWritebackEnabled(), ...summary });
  }

  const dryRun = req.method === 'GET';
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '25', 10)));
  const configured = isSalesforceConfigured();
  const enabled = isWritebackEnabled();

  const result = {
    mode: dryRun ? 'dry_run' : 'apply',
    sf_configured: configured,
    writeback_enabled: enabled,
    candidates: 0,
    written: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    unavailable: 0,
    promoted_fields: 0,
    items: [],
  };

  // Value-ranked candidate set (Unit 3 view). Highest linked-owner value first.
  const candRes = await opsQuery('GET',
    'v_lcc_contact_writeback_candidates'
    + '?select=entity_id,workspace_id,name,email,phone,company,domain,sf_account_id,rank_value,rank_property_count'
    + '&order=rank_value.desc.nullslast&limit=' + limit);
  if (!candRes.ok) {
    return res.status(candRes.status || 500).json({ error: 'Failed to list writeback candidates', detail: candRes.data });
  }
  const rows = Array.isArray(candRes.data) ? candRes.data : [];
  result.candidates = rows.length;

  if (dryRun) {
    for (const row of rows) {
      const plan = planContactWriteback(row);
      result.items.push({
        entity_id: row.entity_id, name: row.name, email: row.email,
        rank_value: row.rank_value, sf_account_id: row.sf_account_id || null,
        plan: plan.ok ? 'push' : 'skip', reason: plan.ok ? undefined : plan.skip,
      });
    }
    return res.status(200).json(result);
  }

  // POST: the deliberate gate. Off ⇒ record-only (no SF calls, no writes) so the
  // cron stays clean (no 403 noise) until Scott sets SF_CONTACT_WRITEBACK.
  if (!enabled) {
    result.mode = 'gated';
    result.gated = true;
    result.note = 'SF_CONTACT_WRITEBACK off — no writes. Set it (deliberate) to drain.';
    result.would_process = rows.length;
    return res.status(200).json(result);
  }

  const deadline = Date.now() + parseInt(process.env.CONTACT_WRITEBACK_BUDGET_MS || '20000', 10);
  for (const row of rows) {
    if (Date.now() > deadline) { result.budget_stopped = true; break; }
    const deps = {
      upsertContact: (push) => upsertSalesforceContact({ ...push, idempotencyKey: row.entity_id }),
      mirrorIdentity: async (r, sfId) => {
        const el = await ensureEntityLink({
          workspaceId: r.workspace_id, userId: user.id,
          entityId: r.entity_id,
          sourceSystem: 'salesforce', sourceType: 'Contact', externalId: toSf18(sfId) || String(sfId),
          metadata: { via: WRITEBACK_BATCH_TAG, batch_tag: WRITEBACK_BATCH_TAG },
        });
        return { ok: !!(el && el.ok), detail: el && (el.error || el.skipped) };
      },
      promoteFields: async (entityId, incoming) => {
        if (!incoming || !Object.keys(incoming).length) return { ok: true, changed: false, fields: [] };
        const ent = await opsQuery('GET', 'entities?id=eq.' + pgFilterVal(entityId) + '&select=id,email,phone,address,city,state,zip,metadata&limit=1');
        const e = (ent.ok && Array.isArray(ent.data)) ? ent.data[0] : null;
        if (!e) return { ok: false };
        const plan = planContactFieldPromotion(e, incoming, 'salesforce');
        if (!plan.changed) return { ok: true, changed: false, fields: [] };
        const upd = await opsQuery('PATCH', 'entities?id=eq.' + pgFilterVal(entityId), plan.patch);
        return { ok: !!upd.ok, changed: !!upd.ok, fields: upd.ok ? Object.keys(plan.fieldSources) : [] };
      },
    };
    let out;
    try { out = await processContactWriteback(row, deps); }
    catch (e) { out = { outcome: 'unavailable', reason: String(e && e.message || e), entity_id: row.entity_id }; }

    if (out.outcome === 'written') {
      result.written++;
      if (out.created) result.created++; else result.updated++;
      result.promoted_fields += (out.promoted_fields || []).length;
    } else if (out.outcome === 'skipped') result.skipped++;
    else result.unavailable++;
    result.items.push(out);
  }

  return res.status(200).json(result);
}
