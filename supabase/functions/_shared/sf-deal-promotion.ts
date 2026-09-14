// ============================================================================
// sf-deal-promotion.ts — Phase 3 / Topic 3
// Single source of truth for the Closed-Won → sales_transactions promotion
// DECISION (pure, deterministic) + the state-government routing cues.
//
// Imported by:
//   - supabase/functions/sf-promotion-worker/index.ts  (Deno runtime)
//   - test/sf-deal-promotion.test.mjs                   (node --test, type-stripped)
//
// Keep this module PURE (no I/O, no Deno globals) so it is testable in both.
// ============================================================================

export type DealVertical = "dia" | "gov";

export interface DealStagingRow {
  sf_deal_id?: string | null;
  stage?: string | null;
  // sf-config maps StageName/Stage__c → `stage`; tolerate a raw Stage__c too.
  Stage__c?: string | null;
  deal_price?: number | string | null;
  listing_price?: number | string | null;
  expected_close_date?: string | null;
  buyer_company_name?: string | null;
  seller_company_name?: string | null;
  noi?: number | string | null;
  annual_rent?: number | string | null;
  deal_name?: string | null;
  property_type?: string | null;
  property_subtype?: string | null;
  tenant_names?: string | null;
  [k: string]: unknown;
}

// The minimum sale price we accept as a real transaction. Mirrors the DB
// CHECK `sold_price >= 50000` on both gov + dia sales_transactions.
export const MIN_SALE_PRICE = 50000;

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// Closed-Won detector. Case-insensitive, whitespace-insensitive. Matches
// "Closed Won" / "ClosedWon" / "07 - Closed Won" etc. Tolerates `Stage__c`.
export function isClosedWonStage(stage: unknown): boolean {
  if (stage === null || stage === undefined) return false;
  const s = String(stage).toLowerCase().replace(/[\s_-]+/g, "");
  return s.includes("closedwon");
}

export interface PlanDealSaleResult {
  promote: boolean;
  reason: string;
  saleRow?: Record<string, unknown>;
}

// ── The decision ────────────────────────────────────────────────────────────
// Promote a Closed-Won SF deal into a domain sales_transactions row ONLY when:
//   1. stage indicates Closed-Won,
//   2. a property_id resolved (NEVER insert a sale with a null property_id),
//   3. a sale price is present AND >= MIN_SALE_PRICE (prefer deal_price; we
//      require deal_price — listing_price is the ask, not a sale price; see
//      DESIGN NOTE below),
//   4. a sale date is present (expected_close_date),
//   5. no existing sales row already carries this sf_deal_id (idempotent), and
//   6. no curated/CoStar comp already exists for this property near the sale
//      date (fill-blanks / never clobber — passed in as opts.curatedSaleExists).
//
// Returns the domain-correct insert row (cap rate is NEVER set — the DB trigger
// derives it). `vertical` decides the party-column names.
//
// DESIGN NOTE (documented choice): we require `deal_price` and do NOT fall back
// to `listing_price`. On a Closed-Won opportunity the recorded sale price lives
// in deal_price; listing_price is the original ask and would corrupt the comp
// (and the cap-rate derivation). A Closed-Won deal with no deal_price is skipped
// (`no_sale_price`) rather than promoted on a guessed price.
export function planDealSalePromotion(
  row: DealStagingRow,
  resolvedPropertyId: number | null,
  vertical: DealVertical,
  opts: { existingSale?: boolean; curatedSaleExists?: boolean } = {},
): PlanDealSaleResult {
  const stage = row.stage ?? row.Stage__c;
  if (!isClosedWonStage(stage)) return { promote: false, reason: "not_closed_won" };

  if (resolvedPropertyId === null || resolvedPropertyId === undefined) {
    return { promote: false, reason: "unresolved_property" };
  }

  const sfDealId = row.sf_deal_id ? String(row.sf_deal_id) : null;
  if (!sfDealId) return { promote: false, reason: "no_sf_deal_id" };

  // Idempotency: a sales row already carries this sf_deal_id.
  if (opts.existingSale) return { promote: false, reason: "already_promoted" };

  const price = toNum(row.deal_price);
  if (price === null) return { promote: false, reason: "no_sale_price" };
  if (price < MIN_SALE_PRICE) return { promote: false, reason: "price_below_floor" };

  const saleDate = row.expected_close_date ? String(row.expected_close_date) : null;
  if (!saleDate) return { promote: false, reason: "no_sale_date" };

  // Never clobber / duplicate a curated comp (CoStar / master) near this date.
  if (opts.curatedSaleExists) return { promote: false, reason: "curated_sale_exists" };

  const noi = toNum(row.noi);
  const grossRent = toNum(row.annual_rent);
  const buyer = row.buyer_company_name ? String(row.buyer_company_name).trim() || null : null;
  const seller = row.seller_company_name ? String(row.seller_company_name).trim() || null : null;

  const saleRow: Record<string, unknown> = {
    property_id: resolvedPropertyId,
    sale_date: saleDate,
    sold_price: price,
    data_source: "salesforce_deal",
    sf_deal_id: sfDealId,
  };
  // Cap rate intentionally OMITTED — derived by the domain DB trigger.
  if (noi !== null) saleRow.noi = noi;
  if (grossRent !== null) saleRow.gross_rent = grossRent;

  // Domain-correct party columns.
  if (vertical === "gov") {
    if (buyer) saleRow.buyer = buyer;
    if (seller) saleRow.seller = seller;
  } else {
    // dia uses buyer_name / seller_name (and has no gross_rent column).
    delete saleRow.gross_rent;
    if (buyer) saleRow.buyer_name = buyer;
    if (seller) saleRow.seller_name = seller;
  }

  return { promote: true, reason: "ok", saleRow };
}

// ── Government routing cues — SINGLE canonical list (DRIFT1-routing-gap) ────
// This used to be TWO lists that disagreed about a state-agency deal:
//   - intake-salesforce/sf-config.ts's own `GOV_SIGNALS` (federal-only, the
//     list that has actually been DEPLOYED — sf-2026-05-v8/v23)
//   - this module's `GOV_STATE_SIGNALS` ("Topic 1 vocabulary"), exported and
//     tested but never imported by anything that routes — a dead constant.
// Sizing the gap (2026-09-08): the population of SKIPPED rows leaves no row
// anywhere (Class 20 — a missing feeder has no representation), so it cannot
// be counted from either domain's staging tables. Confirmed empirically: a
// re-route replay of every `sf_property_staging`/`sf_comp_staging`/
// `sf_listing_staging`/`sf_deal_staging` row in BOTH the dia (zqzrriwuavgrquhisnoa)
// and gov (scknotsqkcheojiaewwh) projects (1,064 dia-side rows, all already
// dia-routed by construction) produces zero flips — not because there is no
// gap, but because a staging table can only ever contain rows that ALREADY
// resolved to that table's own vertical. Live Salesforce access (Method 2)
// was not reachable from this session (no SF connector attached) — say so
// rather than substitute the under-counting proxy silently.
//
// Absent a direct measurement, the state-agency vocabulary below is adopted
// on a DIFFERENT kind of evidence: every term (bar one, noted below) already
// has a live production precedent in api/_handlers/sidebar-pipeline.js's
// `GOV_TENANT_PATTERNS` ("Gap Memo 2026-06-23, Topic 1" — an audit against a
// real Texas Facilities Commission lease corpus, 1,179 leases, that found 54%
// of state-agency tenants fell to `no_domain` under a federal-only list).
// That list runs today, word-boundary anchored, creating gov properties from
// the CoStar sidebar with no reported false-positive incident. This routing
// widens a CREATION path too (`autoCreateProperty`, GOVDUP1-a), so the same
// caution applies — hence the exclusion below is deliberate, not an oversight.
//
// EXCLUDED: "motor vehicles" — the only GOV_STATE_SIGNALS term with NO
// sidebar-pipeline precedent (no `\bmotor vehicles\b`/`\bdmv\b` pattern
// exists there either). Unlike the phrases kept, "motor vehicles" collides
// with ordinary private business names (used-car dealers, auto auctions) and
// this module matches by plain substring, not word-boundary regex, so it
// carries more false-positive risk than the vetted list. Filed as
// DRIFT1-routing-gap-motorvehicles: measure before adding it.
//
// Every consumer of "which vertical does a SF row belong to" imports THIS
// list. Do not fork a second copy — that is the exact defect being fixed.
export const GOV_SIGNALS = [
  // Federal (matches deployed intake-salesforce sf-2026-05-v8/v23 GOV_SIGNALS)
  "gsa",
  "federal",
  "government",
  "department of",
  "veterans affairs",
  "social security",
  "united states of america",
  "u.s. government",
  "u.s. department",
  // State/local (Topic 1 vocabulary; each has a sidebar-pipeline.js
  // GOV_TENANT_PATTERNS precedent — see the header note above)
  "state of ",
  "department of ",
  "human services",
  "child protective services",
  "children's protective services",
  "adult protective services",
  "family protective services",
  "criminal justice",
  "juvenile justice",
  "parks and wildlife",
  "comptroller",
  "general land office",
  "railroad commission",
  "workforce commission",
  "public safety",
  "secretary of state",
  "attorney general",
  "health and human services",
];
