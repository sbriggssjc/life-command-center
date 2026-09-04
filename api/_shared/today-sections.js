// UX-T1a-today — the Today recut: Significant / Important / Urgent.
//
// Canon (docs/os/canon/blocks/operator-doctrine.md 1.8.0), verbatim: "Today is the
// day's tasks only, ranked by client value, in three sections — Significant (BD
// that pays in five years: new-client research, first outreach, follow-ups),
// Important (pays within a year: BOVs, ELAs, touches that generate BOVs or
// working buyers, marketing live listings), Urgent (pays within ~90 days:
// pipeline management, deal correspondence). All three must be done; the
// surface exists to keep Urgent from crowding out Significant."
//
// Pure, injectable, no I/O — every function here takes rows already fetched by
// the handler and returns a display section. Nothing here re-derives a gate a
// SQL view already owns (the normaliser-drift rule): Significant reads
// `v_lcc_seller_prospect_queue`'s own `reach_state`/`newer_lease`/`reason_*`
// columns verbatim; Urgent reads `action_items` and `v_lcc_bd_worklist` as-is.
//
// ⚠️ RENDERED COUNT MUST EQUAL ROWS SHOWN — no re-discovery tally (P159a). Each
// section returns BOTH `items` (the capped page Today renders) and `total_open`
// (the full population, for the "See all →" link) as two distinct numbers, never
// blended.
//
// ⚠️ NAMED GAPS, NEVER A FABRICATED SIGNAL (P131's rule). Measured 2026-09-03:
// there is no DB row anywhere for "a BOV was generated" / "one is due", and no
// discrete producer for "marketing a live listing" as a task (`lcc_listing_events`
// is a SALE-event feed, not a marketing-touch queue). Important is therefore built
// from `bd_opportunities` open rows only (the one real recorded producer for
// "touches that generate BOVs or working buyers"), and the gap is reported in
// `named_gaps` rather than papered over with a heuristic.

export const TODAY_SECTION_LIMIT = 8;

// ⚠️ P180: `Number(null)` is 0 and `Number.isFinite(0)` is true, so a naive
// coercion turns "unknown" into "$0" -- the exact sentinel-as-measurement trap
// this repo has paid for repeatedly. null/undefined/'' stay null; a genuine 0
// stays 0.
const money = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * SIGNIFICANT — new-client research, first outreach, follow-ups.
 * Source: v_lcc_seller_prospect_queue (UX-T1a-queue), already ranked
 * `rank_value.desc.nullslast,years_into_term.asc.nullslast`. Every row in this
 * view is, by the view's own gates, an owner not yet reached — so the WHOLE
 * queue is the Significant population; this only shapes it for the card.
 *
 * `basis` states the reason-to-sell/newer-lease signal AND the reach gate in one
 * line (C11's rule — a card naming a party needs to say why now). `value` and
 * `years_into_term` are never collapsed to 0/false when unknown (P180) — they
 * ride as `null` and the caller renders "value unknown" / "term unknown".
 */
export function buildSignificantSection(rows, { limit = TODAY_SECTION_LIMIT } = {}) {
  const all = Array.isArray(rows) ? rows : [];
  const items = all.slice(0, limit).map((r) => {
    const reasons = [];
    if (r.newer_lease) reasons.push('newer lease');
    if (r.reason_debt) reasons.push('debt maturing');
    if (r.reason_value_creation_developer) reasons.push('developer');
    const gate = r.reach_state === 'never_touched' ? 'never touched'
      : r.reach_state === 'in_pipeline_untouched' ? 'in pipeline, untouched'
      : r.reach_state === 'no_linked_person' ? 'no contact linked'
      : (r.reach_state || 'reach unknown');
    return {
      kind: 'seller_prospect',
      section: 'significant',
      entity_id: r.entity_id || null,
      domain: r.source_domain || null,
      property_id: r.property_id != null ? String(r.property_id) : null,
      who: r.owner_name || r.entity_name || null,
      value: money(r.rank_value),
      basis: (reasons.length ? reasons.join(' + ') : 'reason to sell unmeasured') + ' — ' + gate,
      reach_state: r.reach_state || null,
      years_into_term: r.years_into_term != null ? Number(r.years_into_term) : null,
      deep_link: { surface: 'entity', entity_id: r.entity_id || null },
    };
  });
  return { items, count: items.length, total_open: all.length };
}

/**
 * IMPORTANT — BOVs, ELAs, touches that generate a BOV or a working buyer,
 * marketing live listings. Source: `bd_opportunities` open rows (the one real
 * recorded producer measured for this bucket — see the module header for the
 * two named gaps this does NOT cover).
 */
export function buildImportantSection(bdOppRows, entityById = new Map(), { limit = TODAY_SECTION_LIMIT } = {}) {
  const all = Array.isArray(bdOppRows) ? bdOppRows : [];
  const items = all.slice(0, limit).map((r) => ({
    kind: 'bd_opportunity',
    section: 'important',
    entity_id: r.entity_id || null,
    who: entityById.get(r.entity_id) || r.entity_id || null,
    value: money(r.amount),
    basis: (r.type ? r.type + ' opportunity' : 'opportunity')
      + (r.stage ? ' — ' + r.stage : ' — stage unrecorded')
      + (r.expected_close_date ? ' — expected close ' + r.expected_close_date : ''),
    stage: r.stage || null,
    type: r.type || null,
    deep_link: { surface: 'entity', entity_id: r.entity_id || null },
  }));
  return { items, count: items.length, total_open: all.length };
}

/**
 * URGENT — pipeline management, deal correspondence (~90 days). Two named
 * producers, merged and ranked together:
 *   1. `action_items` open/in_progress rows tied to a deal (deal_next_step,
 *      reply_overdue, review_response, seller_follow_up, send_info,
 *      schedule_call, follow_up, advance_to_contract, offer_review) — the deal
 *      CORRESPONDENCE half.
 *   2. `v_lcc_bd_worklist`'s `contact_writeback` + the domain
 *      `owner_source_conflict` (auto_fixable) rows — the pipeline-HYGIENE half
 *      named explicitly by the prompt. `loan_maturity` and `ownership_chain`
 *      are deliberately EXCLUDED here: loan_maturity's own ≤24-month window does
 *      not express the canon's ~90-day Urgent boundary (no sub-slice exists to
 *      test it against), and ownership_chain is now A2's automated apply lane,
 *      not a human task (B1/A2 — its consumer is a cron, not an operator).
 *
 * Ranking: an OVERDUE action item (due_date in the past) always outranks a
 * value-only row — that is what "keeps Urgent from crowding out Significant"
 * means operationally: a task actually late beats a task merely valuable. Ties
 * within "overdue" and within "not overdue" break on value.
 */
export function buildUrgentSection({ actionItems, bdWorklistRows } = {}, entityById = new Map(), { limit = TODAY_SECTION_LIMIT, today } = {}) {
  const now = today instanceof Date ? today : new Date();
  const todayIso = now.toISOString().slice(0, 10);

  const aiRows = (Array.isArray(actionItems) ? actionItems : []).map((r) => {
    const overdue = !!(r.due_date && String(r.due_date).slice(0, 10) < todayIso);
    return {
      kind: 'deal_correspondence',
      section: 'urgent',
      id: r.id,
      entity_id: r.entity_id || null,
      who: entityById.get(r.entity_id) || r.entity_id || null,
      what: r.title || r.action_type || 'follow up',
      action_type: r.action_type || null,
      value: 0, // action_items carries no dollar amount; overdue is the rank signal
      due_date: r.due_date || null,
      overdue,
      basis: (overdue ? 'overdue — ' : 'due ' + (r.due_date || 'unscheduled') + ' — ')
        + (r.action_type || 'pipeline task').replace(/_/g, ' '),
      deep_link: { surface: 'entity', entity_id: r.entity_id || null },
    };
  });

  const bwRows = (Array.isArray(bdWorklistRows) ? bdWorklistRows : []).map((r) => ({
    kind: r.signal_type,
    section: 'urgent',
    id: null,
    entity_id: r.entity_id || null,
    domain: r.domain || null,
    property_id: r.property_id || null,
    who: r.who || null,
    what: r.what || r.signal_type,
    action_type: r.signal_type,
    value: money(r.rank_value) || 0,
    due_date: null,
    overdue: false,
    basis: r.signal_type === 'contact_writeback' ? 'push contact to CRM — pipeline hygiene'
      : r.signal_type === 'owner_source_conflict' ? 'reconcile owner conflict — blocks the deal moving'
      : (r.signal_type || 'pipeline hygiene'),
    deep_link: r.deep_link || null,
  }));

  const all = [...aiRows, ...bwRows];
  all.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    return (b.value || 0) - (a.value || 0);
  });

  const items = all.slice(0, limit);
  return { items, count: items.length, total_open: all.length };
}

/**
 * Assemble the whole Today recut. `named_gaps` is a list of strings describing
 * a canon-named example with no producer today — filed, never fabricated.
 */
export function assembleTodaySections({
  significantRows, bdOppRows, actionItems, bdWorklistRows, entityById,
} = {}, opts = {}) {
  const em = entityById instanceof Map ? entityById : new Map();
  return {
    significant: buildSignificantSection(significantRows, opts),
    important: buildImportantSection(bdOppRows, em, opts),
    urgent: buildUrgentSection({ actionItems, bdWorklistRows }, em, opts),
    named_gaps: [
      'Important: no DB row anywhere records "a BOV was generated" or "one is due" — bd_opportunities open rows are the closest recorded producer, not a BOV-specific one.',
      'Important: no discrete producer exists for "marketing a live listing" as a task (lcc_listing_events is a SALE-event feed, not a marketing-touch queue).',
      'Urgent: loan_maturity has no sub-slice expressible for the canon\'s ~90-day window, so it is surfaced elsewhere (Priority Queue / BD worklist), not here.',
    ],
  };
}
