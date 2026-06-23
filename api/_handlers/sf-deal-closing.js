// api/_handlers/sf-deal-closing.js
// ============================================================================
// Deal Closing Announcement email → recorded sale (Part A).
//
// A flagged Northmarq "Deal Closing Announcement" email (sender
// salesforce@northmarq.com) is parsed (api/_shared/sf-closing-email-parse.js)
// and UPSERTED into the domain's `sf_deal_staging` table as a `stage='Closed IS'`
// row — the SAME table the hourly SF Object Sync lands closed deals in. The
// EXISTING `<dia|gov>_promote_nm_comps` machinery then records the sale (price /
// cap / date / buyer / seller side), matches the property, dedups, and tags it
// Northmarq. This handler NEVER writes sales/properties itself — it only stages
// the deal + (optionally, real-time) triggers the promote.
//
// Reuse, don't fork: vertical routing = `classifyVertical` (sf-nm-classifier.js,
// the canonical classifier — US Renal → dia, GSA/agency → gov). Idempotent on
// (sf_deal_id, source_system, import_batch) — converges with the automated pull
// (both key sf_deal_staging on the Opportunity Id), so no double-recording.
//
// Plan: docs/architecture/sf_deal_closing_email_ingest_PLAN.md
// ============================================================================

import { createHash } from 'crypto';
import { classifyVertical } from '../_shared/sf-nm-classifier.js';
import { toSf18 } from '../_shared/sf-id.js';
import { domainQuery } from '../_shared/domain-db.js';
import { parseClosingAnnouncement } from '../_shared/sf-closing-email-parse.js';

// Stable channel tag → the on-conflict key includes import_batch (the
// permanent dedup-key fix was never applied live), so a CONSTANT batch makes
// a re-flag of the same deal an UPSERT (not a fresh row) within the email
// channel. Different deals still differ by sf_deal_id.
const EMAIL_IMPORT_BATCH = 'email_deal_closing';

// Whole-universe promote is heavy + idempotent + already runs daily; the
// real-time trigger is best-effort and env-disableable (fall back to the cron).
function realtimePromoteEnabled() {
  return String(process.env.DEAL_CLOSING_PROMOTE ?? 'true').toLowerCase() !== 'false';
}

/** Map a closing record to the SF managed-package `raw_row` shape the promote reads. */
function buildRawRow(parsed, sfDealId) {
  const rr = {
    Id: sfDealId,
    Name: parsed.deal_name || null,
    StageName: 'Closed IS',
    Deal_Type__c: 'IS CM',
    City_sjc__c: parsed.city || null,
    State_sjc__c: parsed.state || null,
    Tenant_Names_sjc__c: parsed.deal_name || null, // operator cue for classifyVertical / matcher
    Property_Type__c: parsed.property_type || null,
    Property_Type_Subtype__c: parsed.property_subtype || null,
    Seller_Company_sjc__c: parsed.seller_company || null,
    Buyer_Company_sjc__c: parsed.buyer_company || null,
    // PRICE GATE: the promote reads raw_row->>'Deal_Price__c' (numeric string > 0).
    Deal_Price__c: parsed.sale_price != null ? String(parsed.sale_price) : null,
    Closing_Cap_Rate_sjc__c: parsed.cap_rate != null ? String(parsed.cap_rate) : null,
    CloseDate: parsed.close_date || null,
    // NM side is NOT stated on a firm-wide announcement → leave null → the
    // promote tags it "unsided" (p_tag_unsided), which is correct.
    Direct_Co_Broke_sjc__c: null,
    // Provenance the matcher ignores but we keep for audit:
    _lcc_channel: 'deal_closing_email',
    _lcc_buyer_account_id: parsed.buyer_account_id || null,
    _lcc_seller_account_id: parsed.seller_account_id || null,
    _lcc_deal_team: parsed.deal_team || null,
  };
  return rr;
}

/**
 * Core: stage a parsed closing into the domain's sf_deal_staging + optionally
 * trigger the promote. Deps injected for unit testing.
 *
 * @param {object} parsed — output of parseClosingAnnouncement
 * @param {object} ctx — { runPromote?:boolean }
 * @param {object} deps — { classifyVertical, domainQuery, now? }
 * @returns {Promise<{ok:boolean, reason?:string, domain?:string, sf_deal_id?:string,
 *   price_missing?:boolean, staged?:boolean, promote?:object, detail?:any}>}
 */
export async function stageClosingDeal(parsed, ctx = {}, deps = {}) {
  const classify = deps.classifyVertical || classifyVertical;
  const dq = deps.domainQuery || domainQuery;
  const nowIso = (deps.now ? deps.now() : new Date()).toISOString
    ? (deps.now ? deps.now() : new Date()).toISOString()
    : new Date().toISOString();

  if (!parsed || !parsed.ok) return { ok: false, reason: 'unparseable' };

  const cls = classify({
    tenant: parsed.deal_name,
    deal_name: parsed.deal_name,
    property_type: parsed.property_type,
    property_use: parsed.property_type,
    specific_use: parsed.property_subtype,
    seller_company: parsed.seller_company,
  });
  const domain = cls && cls.vertical; // 'dia' | 'gov' | null
  if (domain !== 'dia' && domain !== 'gov') {
    return { ok: false, reason: 'vertical_unresolved', parsed };
  }

  // Idempotency key: the 18-char Opportunity Id, else a deterministic synthetic
  // (so a re-flag of an Id-less announcement still upserts the same row).
  const sfDealId = toSf18(parsed.sf_opportunity_id) || parsed.sf_opportunity_id
    || `EMAILCLOSE-${createHash('sha1')
      .update(`${parsed.deal_name || ''}|${parsed.close_date || ''}|${parsed.sale_price || ''}`)
      .digest('hex').slice(0, 16)}`;

  const priceMissing = !(parsed.sale_price > 0);
  const row = {
    sf_deal_id: sfDealId,
    source_system: 'salesforce',
    import_batch: EMAIL_IMPORT_BATCH,
    raw_row: buildRawRow(parsed, sfDealId),
    deal_name: parsed.deal_name || null,
    deal_type: 'IS CM',
    stage: 'Closed IS',
    expected_close_date: parsed.close_date || null,
    deal_price: parsed.sale_price ?? null,
    deal_cap_rate: parsed.cap_rate ?? null,
    seller_company_name: parsed.seller_company || null,
    buyer_company_name: parsed.buyer_company || null,
    property_type: parsed.property_type || null,
    property_subtype: parsed.property_subtype || null,
    property_city: parsed.city || null,
    property_state: parsed.state || null,
    tenant_names: parsed.deal_name || null,
    processed: false,
    process_status: 'pending',
    imported_at: nowIso,
  };

  const up = await dq(
    domain, 'POST',
    'sf_deal_staging?on_conflict=sf_deal_id,source_system,import_batch',
    row,
    { Prefer: 'resolution=merge-duplicates,return=minimal' },
  );
  if (!up || !up.ok) {
    return { ok: false, reason: 'staging_write_failed', domain, sf_deal_id: sfDealId, detail: up?.data };
  }

  // Real-time promote: the EXISTING whole-universe promote records the sale.
  // Best-effort — a failure/timeout never fails the email; the daily cron is
  // the backstop. Skipped on a price-missing deal (the promote's price gate
  // would ignore it anyway).
  let promote = { triggered: false };
  if (ctx.runPromote && realtimePromoteEnabled() && !priceMissing) {
    try {
      const pr = await dq(domain, 'POST', `rpc/${domain}_promote_nm_comps`, { p_dry_run: false });
      promote = { triggered: true, ok: !!(pr && pr.ok), status: pr?.status };
    } catch (err) {
      promote = { triggered: true, ok: false, error: err?.message || String(err) };
    }
  }

  return { ok: true, domain, sf_deal_id: sfDealId, price_missing: priceMissing, staged: true, promote };
}

/**
 * Convenience entry point for handleOutlookMessage: parse the HTML body + stage.
 * Wires production deps. Returns the stageClosingDeal result with `parsed`.
 *
 * @param {object} args — { html, runPromote?:boolean }
 * @param {object} [deps]
 */
export async function ingestClosingAnnouncementEmail({ html, runPromote = true } = {}, deps = {}) {
  const parser = deps.parseClosingAnnouncement || parseClosingAnnouncement;
  const parsed = parser(html || '');
  const res = await stageClosingDeal(parsed, { runPromote }, deps);
  return { ...res, parsed };
}
