// UX-T1a-queue — the seller queue's SERVER-SIDE surface rules.
//
// Pure, injectable, no I/O. The SQL view (v_lcc_seller_prospect_queue) is the single
// owner of every GATE; this module owns only how the surface FILTERS, PAGES and RANKS
// what the view already decided. A JS mirror of a SQL classifier is the normaliser drift
// this repo has paid for a dozen times, so nothing here re-derives a gate.
//
// ⚠️ CHIPS FILTER SERVER-SIDE, AND THEIR COUNTS GATE ON THE SAME PREDICATE AS THE LIST.
// A chip that filters client-side over the current page reports the whole-lane number
// while showing a page's worth of rows -- the lying badge (P139). Every chip's count is
// computed from the same `where` string its click sends.
//
// ⚠️ A PAGED LIST MUST RETURN ITS PAGINATION BLOCK. A1 measured the research page serving
// the same first 50 of 545 rows forever because the response carried no pagination and
// the renderer therefore drew no pager. `buildPagination` is what stops that here.

/** Chip vocabulary. `where` is a PostgREST filter fragment; `null` means no filter. */
export const SELLER_QUEUE_CHIPS = [
  { key: 'all',                   label: 'All',                where: null },
  { key: 'newer_lease',           label: 'Newer lease',        where: 'newer_lease=is.true' },
  { key: 'debt',                  label: 'Debt maturing',      where: 'reason_debt=is.true' },
  { key: 'developer',             label: 'Developer',          where: 'reason_value_creation_developer=is.true' },
  { key: 'no_linked_person',      label: 'No contact linked',  where: 'reach_state=eq.no_linked_person' },
  { key: 'never_touched',         label: 'Never touched',      where: 'reach_state=eq.never_touched' },
  { key: 'in_pipeline_untouched', label: 'In pipeline, untouched', where: 'reach_state=eq.in_pipeline_untouched' },
];

const CHIP_BY_KEY = new Map(SELLER_QUEUE_CHIPS.map((c) => [c.key, c]));

/** Resolve a requested chip. An unknown chip falls back to `all` — never to an empty page. */
export function resolveChip(key) {
  return CHIP_BY_KEY.get(String(key || 'all')) || CHIP_BY_KEY.get('all');
}

/**
 * The ranked order the doctrine asks for: CLIENT VALUE first, then lease recency
 * (years into the term ASC — the newest lease leads its value tier).
 *
 * ⚠️ `nullslast` on BOTH keys is load-bearing, and for two different reasons.
 * `rank_value` is NULL when the asset cannot be priced (P180 — never 0), and
 * `years_into_term` is NULL when there is no commencement to measure from. Without
 * nullslast Postgres sorts NULLs FIRST on a DESC key, so the unpriced rows would head
 * the queue — the exact inversion of "ranked by client value".
 */
export const SELLER_QUEUE_ORDER = 'rank_value.desc.nullslast,years_into_term.asc.nullslast';

/** Canonical short-form domain, or null for "no filter". Accepts both spellings. */
export function normalizeDomain(raw) {
  const d = String(raw || '').toLowerCase();
  if (d === 'gov' || d === 'government') return 'gov';
  if (d === 'dia' || d === 'dialysis') return 'dia';
  if (!d || d === 'all' || d === 'both') return null;
  return d;
}

export const SELLER_QUEUE_DEFAULT_LIMIT = 50;
export const SELLER_QUEUE_MAX_LIMIT = 200;

export function clampLimit(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return SELLER_QUEUE_DEFAULT_LIMIT;
  return Math.min(SELLER_QUEUE_MAX_LIMIT, Math.max(1, n));
}

export function clampOffset(raw) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Build the PostgREST path for a page of the queue.
 * The chip's `where` and the domain filter are applied HERE, server-side, so the page a
 * chip shows is a page of that chip's whole population rather than a filtered view of
 * page 1 (P179 class 2: a ranked-but-behind population needs a filter, not a re-rank).
 */
export function buildQueuePath({ chipKey, domain, limit, offset }) {
  const chip = resolveChip(chipKey);
  let path = 'v_lcc_seller_prospect_queue?select=*'
    + '&order=' + SELLER_QUEUE_ORDER
    + '&limit=' + clampLimit(limit)
    + '&offset=' + clampOffset(offset);
  if (chip.where) path += '&' + chip.where;
  const d = normalizeDomain(domain);
  if (d) path += '&source_domain=eq.' + encodeURIComponent(d);
  return path;
}

/**
 * Count path for ONE chip — the same predicate the list uses, minus order/paging.
 * `select=entity_id&limit=1` with count=exact reads the total off Content-Range without
 * transferring the rows.
 */
export function buildChipCountPath({ chipKey, domain }) {
  const chip = resolveChip(chipKey);
  let path = 'v_lcc_seller_prospect_queue?select=entity_id&limit=1';
  if (chip.where) path += '&' + chip.where;
  const d = normalizeDomain(domain);
  if (d) path += '&source_domain=eq.' + encodeURIComponent(d);
  return path;
}

/**
 * The pagination block the renderer needs to draw a pager at all.
 * `total` is the EXACT count for the active filter (from Content-Range), so
 * `has_more` is a fact rather than "the page came back full".
 */
export function buildPagination({ total, limit, offset }) {
  const lim = clampLimit(limit);
  const off = clampOffset(offset);
  // ⚠️ `Number(null)` is 0 and `Number.isFinite(0)` is true, so a naive coercion turns
  // "we could not count" into "there are none" -- the P180 sentinel class, in the one
  // field a pager reads. null/undefined/'' are UNKNOWN; a genuine 0 stays 0.
  const t = (total === null || total === undefined || total === '' || !Number.isFinite(Number(total)))
    ? null : Number(total);
  return {
    limit: lim,
    offset: off,
    total: t,
    page: Math.floor(off / lim) + 1,
    total_pages: t == null ? null : Math.max(1, Math.ceil(t / lim)),
    has_more: t == null ? null : off + lim < t,
  };
}
