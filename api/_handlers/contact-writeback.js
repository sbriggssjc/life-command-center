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
import { upsertSalesforceContact, upsertSalesforceAccount, isSalesforceConfigured } from '../_shared/salesforce.js';
import { toSf18 } from '../_shared/sf-id.js';
import { planContactFieldPromotion } from '../_shared/contact-fields.js';

const WRITEBACK_BATCH_TAG = 'r52_contact_writeback';
// R52c: the SF Account-identity mirror tag (the compounding owner→account
// coverage win — distinct from the Contact-identity tag so each is reversible
// on its own).
const ACCOUNT_BATCH_TAG = 'r52c_account_establish';

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
      // accountId is NO LONGER carried here — R52c resolves the Company/Account
      // in a dedicated step (planCompanyResolution) since the org REQUIRES one.
    },
  };
}

/**
 * R52c — PURE: resolve the COMPANY (Salesforce Account) to file this contact
 * under, and the entity to mirror the resulting Account id onto. The org won't
 * accept a Contact without a Company, so every candidate gets one. Priority:
 *   (a) the contact's linked TRUE OWNER (the BD owner entity the person is
 *       associated_with) — prefer an organization; mirror the account onto that
 *       owner (the compounding owner→SF-account coverage win);
 *   (b) else the contact's existing `company` field (their employer/firm) — no
 *       owner entity to mirror onto, just file the contact under it;
 *   (c) else an individual investor → Company = the person's own name; mirror
 *       the account onto the PERSON.
 * When the chosen owner already carries an SF Account id, REUSE it (no upsert,
 * no re-mirror). `owner` is the resolved best linked owner (or null), shaped
 * `{ entity_id, name, entity_type, sf_account_id }`.
 *
 * @returns {{ok:true, companyName, accountId, mirrorEntityId, mirrorIsPerson, source}
 *          | {ok:false, skip:string}}
 */
export function planCompanyResolution(row, owner) {
  // (a) linked true-owner organization (or any owner) with a usable name
  if (owner && owner.name && !isJunkEntityName(String(owner.name))) {
    const acct = owner.sf_account_id ? String(owner.sf_account_id).trim() : null;
    return {
      ok: true,
      companyName: String(owner.name).trim(),
      accountId: acct || null,
      mirrorEntityId: owner.entity_id || null,
      mirrorIsPerson: owner.entity_type === 'person',
      source: 'owner',
    };
  }
  // (b) the contact's own company field (employer/firm) — no owner entity to mirror
  const company = row && row.company ? String(row.company).trim() : '';
  if (company && !isJunkEntityName(company)) {
    return { ok: true, companyName: company, accountId: null, mirrorEntityId: null, mirrorIsPerson: false, source: 'company' };
  }
  // (c) individual investor — Company = the person's own name, mirror onto the person
  const self = row && row.name ? String(row.name).trim() : '';
  if (self) {
    return { ok: true, companyName: self, accountId: null, mirrorEntityId: row.entity_id || null, mirrorIsPerson: true, source: 'self' };
  }
  return { ok: false, skip: 'no_company_resolvable' };
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

/** Map an SF/flow reason code → the tick-response outcome bucket. */
function reasonToOutcome(reason) {
  if (reason === 'sf_not_configured') return 'not_configured';
  if (reason === 'unsupported' || reason === 'unavailable') return 'unsupported';
  return 'unavailable';
}

/**
 * Process ONE candidate (R52c): plan person → ESTABLISH the Company (Account) →
 * mirror the Account id onto the owner/person (compounding coverage) → upsert
 * the Contact UNDER that Account → mirror the Contact identity → promote address.
 * Pure orchestration over injected deps so it unit-tests without fetch:
 *   resolveCompany(row)               -> { ok, companyName, accountId, mirrorEntityId, mirrorIsPerson, source } | { ok:false, skip }
 *   upsertAccount({name,idempotencyKey}) -> { ok, accountId, created, reason, detail }
 *   mirrorAccount(entityId, accountId, isPerson) -> { ok }
 *   upsertContact(push)               -> { ok, contact:{Id,...}, created, reason }
 *   mirrorIdentity(row, sfId)         -> { ok }
 *   promoteFields(entityId, incoming) -> { ok, fields:[...] }
 *
 * Effect-first / outcome-truthful: the org REQUIRES a Company on every Contact,
 * so if the Account can't be established the Contact is NEVER attempted and the
 * real reason is reported. The Account-identity mirror is the compounding win
 * but is best-effort (the Account exists in SF regardless) — recorded honestly
 * in `account_mirrored`, it never blocks the contact write.
 */
export async function processContactWriteback(row, deps) {
  const plan = planContactWriteback(row);
  if (!plan.ok) return { outcome: 'skipped', reason: plan.skip, entity_id: row.entity_id };

  // ── Establish the Company (Account) the org requires on every Contact ──────
  let comp;
  try {
    comp = await deps.resolveCompany(row);
  } catch (e) {
    return { outcome: 'unavailable', reason: String(e && e.message || e), entity_id: row.entity_id, stage: 'company' };
  }
  if (!comp || comp.ok !== true) {
    return { outcome: 'skipped', reason: (comp && comp.skip) || 'no_company_resolvable', entity_id: row.entity_id };
  }

  let accountId = comp.accountId || null;     // reuse an owner's existing SF Account
  let accountCreated = false;
  let accountMirrored = null;                 // null = not attempted (reuse), true/false = mirror result
  if (!accountId) {
    let ar;
    try {
      ar = await deps.upsertAccount({ name: comp.companyName, idempotencyKey: comp.mirrorEntityId || row.entity_id });
    } catch (e) {
      return { outcome: 'unavailable', reason: String(e && e.message || e), entity_id: row.entity_id, stage: 'account' };
    }
    if (!ar || ar.ok !== true || !ar.accountId) {
      const reason = (ar && ar.reason) || 'account_upsert_failed';
      // The org won't take a Contact without a Company → do NOT attempt the
      // contact create. Report the real Salesforce/flow detail (R52b).
      return { outcome: reasonToOutcome(reason), reason, detail: (ar && ar.detail) || null, entity_id: row.entity_id, stage: 'account', company_resolved: comp.companyName };
    }
    accountId = ar.accountId;
    accountCreated = !!ar.created;
    // The compounding win: mirror the SF Account id onto the OWNER (or the
    // person, for an individual investor) so owner→SF-account coverage grows
    // every time the writeback runs. Best-effort — never blocks the contact.
    if (comp.mirrorEntityId) {
      try {
        const m = await deps.mirrorAccount(comp.mirrorEntityId, accountId, !!comp.mirrorIsPerson);
        accountMirrored = !!(m && m.ok);
      } catch (_e) { accountMirrored = false; }
    }
  }

  // ── Upsert the Contact UNDER the resolved Account (the required Company) ────
  let res;
  try {
    res = await deps.upsertContact({ ...plan.push, accountId });
  } catch (e) {
    return { outcome: 'unavailable', reason: String(e && e.message || e), entity_id: row.entity_id, account_id: accountId };
  }
  if (!res || res.ok !== true) {
    const reason = (res && res.reason) || 'lookup_failed';
    // Surface the richer SF/PA flow message (R52b) so the real Salesforce
    // error reaches the tick response instead of a bare reason code.
    return { outcome: reasonToOutcome(reason), reason, detail: (res && res.detail) || null, entity_id: row.entity_id, account_id: accountId, account_created: accountCreated, account_mirrored: accountMirrored };
  }

  const sfId = res.contact && (res.contact.Id || res.contact.id);
  if (!sfId) return { outcome: 'unavailable', reason: 'no_contact_returned', entity_id: row.entity_id };

  // Effect-first / outcome-truthful: mirror the identity so it's not re-written.
  // A failed mirror keeps the row "pending" (it will re-surface next tick) rather
  // than claiming a clean write.
  const mir = await deps.mirrorIdentity(row, sfId);
  if (!mir || !mir.ok) {
    return { outcome: 'mirror_failed', reason: (mir && mir.detail) || 'mirror_failed', entity_id: row.entity_id, sf_contact_id: sfId, created: !!res.created, account_id: accountId, account_created: accountCreated, account_mirrored: accountMirrored };
  }

  // Promote the SF contact's mailing address / phone to first-class (Unit 1).
  let promoted = [];
  try {
    const pr = await deps.promoteFields(row.entity_id, promotableFromSfContact(res.contact));
    if (pr && pr.ok && pr.changed) promoted = pr.fields || [];
  } catch (_e) { /* promotion is best-effort, never fails the writeback */ }

  return {
    outcome: 'written',
    created: !!res.created,
    sf_contact_id: sfId,
    entity_id: row.entity_id,
    promoted_fields: promoted,
    company_resolved: comp.companyName,
    company_source: comp.source,
    account_id: accountId,
    account_created: accountCreated,
    account_mirrored: accountMirrored,
  };
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

// ── owner resolution (production resolveCompany dep) ─────────────────────────
// Find the best linked TRUE OWNER entity for a contact: the person is the `to`
// side of an `associated_with` edge, the owner is the `from` side (R52 view +
// R7-2.4 convention). Prefer an organization, then an SF-mapped owner, then the
// longest name. Reads the owner's existing SF Account id so we REUSE it instead
// of minting a duplicate. Returns the resolution plan (planCompanyResolution).
function rankOwnerRow(e, acctMap) {
  let s = 0;
  if (e.entity_type === 'organization') s += 4;
  if (acctMap.get(e.id)) s += 2;
  if (e.name && !isJunkEntityName(String(e.name))) s += 1;
  return s;
}

async function resolveCompanyForContact(row) {
  let owner = null;
  try {
    const rel = await opsQuery('GET',
      'entity_relationships?relationship_type=eq.associated_with&to_entity_id=eq.'
      + pgFilterVal(row.entity_id) + '&select=from_entity_id&limit=25');
    const ownerIds = (rel.ok && Array.isArray(rel.data))
      ? [...new Set(rel.data.map((r) => r.from_entity_id).filter(Boolean))] : [];
    if (ownerIds.length) {
      const inList = '(' + ownerIds.map(pgFilterVal).join(',') + ')';
      const [ents, acct] = await Promise.all([
        opsQuery('GET', 'entities?id=in.' + inList + '&merged_into_entity_id=is.null&select=id,name,entity_type&limit=25'),
        opsQuery('GET', 'external_identities?entity_id=in.' + inList + '&source_system=eq.salesforce&source_type=eq.Account&select=entity_id,external_id'),
      ]);
      const entRows = (ents.ok && Array.isArray(ents.data)) ? ents.data : [];
      const acctMap = new Map(((acct.ok && Array.isArray(acct.data)) ? acct.data : []).map((a) => [a.entity_id, a.external_id]));
      entRows.sort((a, b) => rankOwnerRow(b, acctMap) - rankOwnerRow(a, acctMap));
      const best = entRows.find((e) => e.name && !isJunkEntityName(String(e.name))) || entRows[0] || null;
      if (best) owner = { entity_id: best.id, name: best.name, entity_type: best.entity_type, sf_account_id: acctMap.get(best.id) || null };
    }
  } catch (_e) { /* fall through to company/self in planCompanyResolution */ }
  return planCompanyResolution(row, owner);
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
    accounts_created: 0,     // R52c: NEW SF Accounts established this drain
    accounts_mirrored: 0,    // R52c: owner→SF-account links written (coverage win)
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
      resolveCompany: (r) => resolveCompanyForContact(r),
      upsertAccount: (a) => upsertSalesforceAccount(a),
      mirrorAccount: async (entityId, accountId) => {
        const el = await ensureEntityLink({
          workspaceId: row.workspace_id, userId: user.id,
          entityId,
          sourceSystem: 'salesforce', sourceType: 'Account', externalId: toSf18(accountId) || String(accountId),
          metadata: { via: ACCOUNT_BATCH_TAG, batch_tag: ACCOUNT_BATCH_TAG },
        });
        return { ok: !!(el && el.ok), detail: el && (el.error || el.skipped) };
      },
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
    // R52c: account-establishment accounting (counts on every outcome that got
    // far enough to establish/mirror an account, incl. mirror_failed).
    if (out.account_created) result.accounts_created++;
    if (out.account_mirrored === true) result.accounts_mirrored++;
    result.items.push(out);
  }

  return res.status(200).json(result);
}
