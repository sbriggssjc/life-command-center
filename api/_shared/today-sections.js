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

// HP1-badge (2026-09-12) — `total_open` MUST be the true population, never
// `rows.length` (the query's own LIMIT/page cap). The caller (the handler)
// separately measures the true count and passes it as `opts.trueTotalOpen`;
// a KEY that is present (even carrying `null`, meaning "the count probe
// failed this request") always wins over the capped array length. Only when
// the key is entirely ABSENT — this module's own unit tests calling a
// builder directly with an uncapped fixture array — does total_open fall
// back to `all.length`, which in that case genuinely IS the population.
// Never silently substitute a page length for an unknown count (P180: a
// failed count is "unknown", not "0" and not "however many rows the render
// path happened to fetch").
function resolveTotalOpen(opts, all) {
  if (opts && Object.prototype.hasOwnProperty.call(opts, 'trueTotalOpen')) {
    return Number.isFinite(opts.trueTotalOpen) ? opts.trueTotalOpen : null;
  }
  return all.length;
}

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
export function buildSignificantSection(rows, opts = {}) {
  const { limit = TODAY_SECTION_LIMIT, sourceError = null } = opts;
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
  return { items, count: items.length, total_open: resolveTotalOpen(opts, all), source_error: sourceError || null };
}

/**
 * IMPORTANT — BOVs, ELAs, touches that generate a BOV or a working buyer,
 * marketing live listings. Source: `bd_opportunities` open rows (the one real
 * recorded producer measured for this bucket — see the module header for the
 * two named gaps this does NOT cover).
 */
export function buildImportantSection(bdOppRows, entityById = new Map(), opts = {}) {
  const { limit = TODAY_SECTION_LIMIT, sourceError = null } = opts;
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
  return { items, count: items.length, total_open: resolveTotalOpen(opts, all), source_error: sourceError || null };
}

/**
 * URGENT — pipeline management, deal correspondence (~90 days). One named
 * producer feeds actual deal work here:
 *   1. `action_items` open/in_progress rows tied to a deal (deal_next_step,
 *      reply_overdue, review_response, seller_follow_up, send_info,
 *      schedule_call, follow_up, advance_to_contract, offer_review) — the deal
 *      CORRESPONDENCE half.
 *   2. the domain `owner_source_conflict` (auto_fixable) rows — a
 *      data-integrity block on the deal moving, so it stays in Urgent.
 *
 * ⚠️ HP1-P2f-urgent (2026-09-12): `v_lcc_bd_worklist`'s `contact_writeback`
 * rows are CRM plumbing (push an already-resolved contact to Salesforce),
 * measured at 96% of this lane's pre-fix population — not deal work an
 * operator has to judge. They are EXCLUDED from the union here and instead
 * surfaced as `pointer`: excluding is not hiding (P159a) — the pointer
 * carries the TRUE, uncapped count (never a page length) and a link to the
 * BD worklist's own `contact_writeback` chip, which already renders a
 * "Push to CRM" action for every one of them. `loan_maturity` and
 * `ownership_chain` remain excluded for the reasons already established:
 * loan_maturity's own ≤24-month window does not express the canon's ~90-day
 * Urgent boundary (no sub-slice exists to test it against), and
 * ownership_chain is now A2's automated apply lane, not a human task
 * (B1/A2 — its consumer is a cron, not an operator).
 *
 * Ranking: an OVERDUE action item (due_date in the past) always outranks a
 * value-only row — that is what "keeps Urgent from crowding out Significant"
 * means operationally: a task actually late beats a task merely valuable. Ties
 * within "overdue" and within "not overdue" break on value.
 */
export function buildUrgentSection({ actionItems, bdWorklistRows, contactWritebackCount } = {}, entityById = new Map(), opts = {}) {
  const { limit = TODAY_SECTION_LIMIT, today, actionItemsError = null, bdWorklistError = null } = opts;
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

  // HP1-P2f-urgent: contact_writeback is CRM plumbing, not deal work — it
  // never enters the ranked union. Every other bd_worklist signal type this
  // section admits (today: owner_source_conflict) still flows through.
  const bwRows = (Array.isArray(bdWorklistRows) ? bdWorklistRows : [])
    .filter((r) => r.signal_type !== 'contact_writeback')
    .map((r) => ({
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
      basis: r.signal_type === 'owner_source_conflict' ? 'reconcile owner conflict — blocks the deal moving'
        : (r.signal_type || 'pipeline hygiene'),
      deep_link: r.deep_link || null,
    }));

  const all = [...aiRows, ...bwRows];
  all.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    return (b.value || 0) - (a.value || 0);
  });

  const items = all.slice(0, limit);
  // Urgent has TWO independent producers (§ module header) — either can fail
  // on its own without the other, so the section's source_error names whichever
  // (or both) degraded rather than collapsing to one undifferentiated flag.
  const urgentSourceError = (actionItemsError && bdWorklistError)
    ? `deal correspondence: ${actionItemsError}; pipeline hygiene: ${bdWorklistError}`
    : (actionItemsError ? `deal correspondence: ${actionItemsError}`
      : (bdWorklistError ? `pipeline hygiene: ${bdWorklistError}` : null));

  // HP1-P2f-urgent — the excluded contact_writeback population's TRUE count
  // (an exact, uncapped probe the caller took off v_lcc_bd_worklist directly,
  // never the page this section itself fetched). `null` means the probe
  // failed THIS request — render "unknown", never a fabricated 0 (P180).
  const pointer = Number.isFinite(contactWritebackCount)
    ? {
      source_type: 'contact_writeback',
      count: contactWritebackCount,
      label: 'Pipeline hygiene — contacts to push to CRM',
      surface: 'bd_worklist_contact_writeback',
    }
    : null;

  return {
    items, count: items.length, total_open: resolveTotalOpen(opts, all),
    source_error: urgentSourceError, pointer,
  };
}

/**
 * Assemble the whole Today recut. `named_gaps` is a list of strings describing
 * a canon-named example with no producer today — filed, never fabricated.
 *
 * `sourceErrors` (HP1 Finding 1, P0) — when a source query for one lane threw
 * or 5xx'd this request (a timeout, a dead connection), the CALLER (the
 * handler) empties that lane's rows and passes the reason here instead of
 * letting the whole endpoint 500. Each section then carries `source_error`
 * (null when healthy) AND the reason is folded into `named_gaps` under the
 * SAME contract as a permanent design gap — a degraded lane this request is
 * exactly the kind of thing P131 says must be named, never silently swallowed
 * as "nothing here" (which would read as a false all-clear on an owner queue).
 * Shape: { significant, important, actionItems, bdWorklist } — each a
 * string|null describing that source's failure THIS request.
 */
export function assembleTodaySections({
  significantRows, bdOppRows, actionItems, bdWorklistRows, entityById, contactWritebackCount,
} = {}, opts = {}) {
  const em = entityById instanceof Map ? entityById : new Map();
  const se = (opts && opts.sourceErrors) || {};
  // `opts.trueTotalOpen`, when supplied, is a MAP of the three sections' true
  // counts (each a number or null — HP1-badge). Strip it off before spreading
  // `opts` into a section's own opts, or the whole map would leak down as
  // that section's scalar `trueTotalOpen`; re-attach only the ONE number (or
  // explicit null) that section owns, and only when the caller actually
  // measured it — a caller that never asked (no top-level `trueTotalOpen` at
  // all) leaves every section falling back to its own array length, exactly
  // as before this change (the pure-function unit-test contract).
  const ttMap = (opts && opts.trueTotalOpen && typeof opts.trueTotalOpen === 'object') ? opts.trueTotalOpen : null;
  const baseOpts = { ...opts };
  delete baseOpts.trueTotalOpen;
  const withTrueTotal = (sectionOpts, key) => {
    if (ttMap && Object.prototype.hasOwnProperty.call(ttMap, key)) sectionOpts.trueTotalOpen = ttMap[key];
    return sectionOpts;
  };

  const significant = buildSignificantSection(significantRows, withTrueTotal({ ...baseOpts, sourceError: se.significant || null }, 'significant'));
  const important = buildImportantSection(bdOppRows, em, withTrueTotal({ ...baseOpts, sourceError: se.important || null }, 'important'));
  const urgent = buildUrgentSection({ actionItems, bdWorklistRows, contactWritebackCount }, em, withTrueTotal({
    ...baseOpts, actionItemsError: se.actionItems || null, bdWorklistError: se.bdWorklist || null,
  }, 'urgent'));

  const named_gaps = [
    'Important: no DB row anywhere records "a BOV was generated" or "one is due" — bd_opportunities open rows are the closest recorded producer, not a BOV-specific one.',
    'Important: no discrete producer exists for "marketing a live listing" as a task (lcc_listing_events is a SALE-event feed, not a marketing-touch queue).',
    'Urgent: loan_maturity has no sub-slice expressible for the canon\'s ~90-day window, so it is surfaced elsewhere (Priority Queue / BD worklist), not here.',
  ];
  if (significant.source_error) named_gaps.push(`Significant: source degraded this request — ${significant.source_error}. Section shown empty, not exhausted.`);
  if (important.source_error) named_gaps.push(`Important: source degraded this request — ${important.source_error}. Section shown empty, not exhausted.`);
  if (urgent.source_error) named_gaps.push(`Urgent: source degraded this request — ${urgent.source_error}. Section partially or fully empty, not exhausted.`);

  return { significant, important, urgent, named_gaps };
}
