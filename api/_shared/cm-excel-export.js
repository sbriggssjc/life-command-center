// ============================================================================
// Capital Markets — Excel export module (V1)
// Life Command Center
//
// Generates a brand-styled .xlsx workbook from cm_gov_*_q (and future
// cm_dialysis_*_q / cm_natl_st_*_q) views. V1 ships data tabs only — every
// chart's underlying data is in its own tab with frozen panes, brand fonts,
// and proper number formats so marketing can paste-link or external-reference
// from the existing master Excel template.
//
// V2 (next): integrate a stripped master template that has pre-built
// brand-styled chart objects pointing to these data tabs. Server loads
// template, populates ranges, returns workbook with charts already bound
// — editing a cell auto-updates the chart.
//
// Contract:
//   buildCapitalMarketsWorkbook({ vertical, subspecialty, asOf, charts, brand })
//     → ExcelJS.Buffer
//
//   `charts` is the same array shape as /api/capital-markets?action=quarterly
//   returns: [{ chart_template_id, name, chart_type, rows: [...] }]
// ============================================================================

import ExcelJS from 'exceljs';
import { summaryColumnHeaders, buildInlineSummary } from './cm-summary-table.js';
import { NATIVE_CHART_TEMPLATES, buildInjectionSpec } from './cm-native-chart-injector.js';

// Round 3d — Inline summary blocks under selected chart tabs.
// Each entry maps a chart_template_id to a metrics array; the worksheet
// builder computes current/prior/YoY/prior-cycle/5y/10y/15y averages from
// the chart's row stream and emits a small block above the raw data dump.
// PDF parity: gov p.11/p.13/p.14/p.17/p.20/p.21, dialysis p.22/p.25/p.33.
// Round 6b — vertical-aware version. The Cap_by_Term cohort scheme
// differs between dialysis (12+/8-12/6-8/≤5 per PDF p.22) and gov
// (10+/6-10/<5/outside per PDF p.13). Mixing both into one summary
// produced 4 empty rows per export ("jumbled mess" — user feedback
// 2026-05-09). This function returns just the cohorts that actually
// populate for the active vertical.
function getInlineSummaryMetrics(chartId, vertical) {
  const COMMON = {
    cap_rate_top_bottom_quartile: [
      { label: 'Top Quartile Cap',    format: 'percent_basis_points', fieldKeys: ['top_quartile'] },
      { label: 'Median Cap',          format: 'percent_basis_points', fieldKeys: ['median'] },
      { label: 'Bottom Quartile Cap', format: 'percent_basis_points', fieldKeys: ['bottom_quartile'] },
    ],
    dom_and_pct_of_ask: [
      { label: 'Avg Days on Market (TTM)', format: 'integer_count',        fieldKeys: ['avg_dom'] },
      { label: 'Sale % of Ask Price (TTM)', format: 'percent_one_decimal', fieldKeys: ['pct_of_ask'] },
    ],
    bid_ask_spread: [
      { label: 'Avg Bid-Ask Spread (TTM)', format: 'percent_basis_points', fieldKeys: ['avg_bid_ask_spread'] },
      { label: 'Last Asking Cap (TTM)',     format: 'percent_basis_points', fieldKeys: ['avg_last_ask_cap'] },
      { label: 'Pct Listings w/ Price Change (TTM)', format: 'percent_one_decimal', fieldKeys: ['pct_price_change'] },
    ],
    cap_rate_ttm_by_quarter: [
      { label: 'Avg Cap Rate (TTM)', format: 'percent_basis_points', fieldKeys: ['ttm_weighted_cap_rate'] },
    ],
  };
  if (chartId === 'cap_rate_by_lease_term') {
    if (vertical === 'dialysis') {
      return [
        { label: '12+ Year Cap',  format: 'percent_basis_points', fieldKeys: ['cap_12plus'] },
        { label: '8-12 Year Cap', format: 'percent_basis_points', fieldKeys: ['cap_8to12'] },
        { label: '6-8 Year Cap',  format: 'percent_basis_points', fieldKeys: ['cap_6to8'] },
        { label: '≤5 Year Cap',   format: 'percent_basis_points', fieldKeys: ['cap_5orless'] },
      ];
    }
    // gov + national_st use the legacy 10+/6-10/<5/outside cohorts
    return [
      { label: '10+ Year Cap',     format: 'percent_basis_points', fieldKeys: ['cap_10plus'] },
      { label: '6-10 Year Cap',    format: 'percent_basis_points', fieldKeys: ['cap_6to10', 'cap_5to10'] },
      { label: '< 5 Year Cap',     format: 'percent_basis_points', fieldKeys: ['cap_less5'] },
      { label: 'Outside Firm Cap', format: 'percent_basis_points', fieldKeys: ['cap_outside_firm'] },
    ];
  }
  return COMMON[chartId];
}

// Excel number-format codes (matching cm_brand_tokens.axis_formats)
const FMT = {
  currency_dollars:     '"$"#,##0',
  currency_millions:    '"$"#,##0.0,,"M"',
  currency_billions:    '"$"#,##0.0,,,"B"',
  currency_per_sf:      '"$"#,##0.00',
  percent_basis_points: '0.00%',
  percent_one_decimal:  '0.0%',
  integer_count:        '#,##0',
  // Number with one decimal (used by months_of_supply, firm_term_years,
  // and R50 helper col monthly_clear_pace). Pre-existing references in
  // CHART_COLUMNS expected this key; added the format in R50 so the
  // numFmt actually applies instead of silently falling through to General.
  number_one_decimal:   '#,##0.0',
  date_short:           'mm/dd/yyyy',
  // User feedback (2026-05-07) on Avail_by_Tenant: "Let's display Avg
  // Term Remaining in 'x.x Years'."
  years_one_decimal:    '0.0" Years"',
};

// Round 1 — PDF-style footer caption strips. Italicized one-liner per
// chart that summarizes intent, displayed in a pale blue strip between
// the chart image (rows 1-22) and the title (row 24). Mirrors the
// "tagline" boxes at the bottom of each PDF page (e.g., dialysis p.17:
// "10-yr UST: 4.12% on Dec 31, 2025; year-end data confirms cap-rate
// stabilization with gradual easing contingent on financing conditions
// and asset quality").
//
// Captions are intentionally generic (no period-specific numbers) so
// they remain accurate across export rotations. If a PDF deliverable
// needs date-stamped tagline text, that's a per-rotation override that
// could be wired through brand tokens or a dedicated catalog column.
const CHART_FOOTER_CAPTIONS = {
  valuation_index:
    'Tracks the dialysis valuation index (line) over time vs YoY % change (bars). The index blends comparable cap-rate trends with changes in market rent and replacement cost to normalize values through cycles.',
  cap_rate_ttm_by_quarter:
    'Trailing-twelve-month average cap rate. Use as a baseline; pair with the volume + quartile panels for full pricing context.',
  cap_rate_top_bottom_quartile:
    'Cap-rate dispersion (upper/lower quartile + median). Wider bands indicate selectivity in the buyer pool; narrowing bands point to tighter pricing.',
  volume_ttm_by_quarter:
    'TTM transaction volume. Read alongside cap-rate trend for a fuller picture of liquidity and pricing momentum.',
  quarterly_volume_bars:
    'Per-quarter transaction volume (NOT TTM). Companion to YoY Change — bars show the quarter-by-quarter pulse; TTM line in Data_Volume_TTM smooths it.',
  buyer_pool_monthly_count:
    'Stacked monthly buyer count by classification: Private (Individual) navy, Institutional/Fund sky, REIT sage. Read alongside Data_Buyer_Pool (annual %-stacked) for the full picture.',
  on_market_snapshot:
    'Side-by-side comparison of Total Market vs 10+ Year Term active-listing metrics: count, avg price, avg/upper/lower/median cap, DOM, price-change rate. ↑/↓/→ marks year-over-year direction of change.',
  available_by_tenant_count_donut:
    'Active-listing count share by tenant (DaVita / FMC / US Renal / Other). Donut at the latest reported quarter; segments sum to total available count.',
  available_by_tenant_volume_donut:
    'Active-listing volume share by tenant (DaVita / FMC / US Renal / Other). Donut at the latest reported quarter; segments sum to total available dollar volume.',
  available_by_term_summary:
    'Active listings by lease-term cohort (Sub 5 / 5-8 / 8-12 / 12+). Sky bars: avg asking price (left axis). Diamond dots: avg cap (navy), upper quartile (purple), median (sage), lower quartile (gray) on the right axis.',
  top_buyers_table:
    'Top 25 buyers all-time, ranked by transaction count. Use to spot active capital deploying into the sector + concentration risk.',
  top_sellers_table:
    'Top 25 sellers all-time, ranked by transaction count. Reverse view of buyer ranking; helps identify dispositions and platform churn.',
  nm_notable_transactions:
    'Notable Northmarq-brokered healthcare transactions, ranked by sale price within the rotation window. Flagship comp set for marketing decks.',
  nm_buyer_distribution:
    'Northmarq buyer distribution by state for the latest TTM window. Volume + count + share-of-NM-business per state, ranked. Identifies geographic concentration of NM-brokered capital flow.',
  nm_track_record_buyer_type:
    'Northmarq track record by buyer type (REIT / Private / Institutional / Cross-Border / etc.) for the latest TTM window. Volume + count + avg cap rate + share-of-NM-business per buyer class.',
  volume_cap_quartile_combo:
    'Combined view: TTM volume area + cap-rate range bars + average cap dot. Quartile band shows pricing dispersion at each point.',
  transaction_count_ttm:
    'TTM transaction count. Helps frame the depth of the comparable set behind the cap-rate trend.',
  yoy_volume_change:
    'Year-over-year change in TTM volume. Sustained positive prints signal recovery; sharp drops match cycle inflections.',
  cap_rate_yoy_change:
    'Year-over-year change in TTM cap rate.',
  avg_deal_size:
    'TTM average deal size. Helps frame the size profile of recent comps.',
  nm_vs_market_cap:
    'Northmarq-brokered cap rates vs. broader market average. Persistent inside-the-market prints quantify the firm execution premium.',
  cap_rate_by_lease_term:
    'Cap-rate cohorts by remaining lease term (TTM). Dialysis chart uses the PDF p.22 cohorts (12+/8-12/6-8/≤5); gov uses 10+/6-10/<5/outside. Term premium (longest minus shortest) is the discount investors apply for shorter-dated assets.',
  dom_and_pct_of_ask:
    'Days on market (TTM, bars) paired with sale price as % of asking price (TTM, line). Improving % of ask + flat/falling DOM signals tightening bid/ask.',
  dom_and_pct_of_ask_monthly:
    'Days on market (TTM, bars) paired with sale price as % of asking price (TTM, line).',
  bid_ask_spread:
    'Bid-ask spread on closed sales: last asking cap rate vs. achieved cap rate. Tightening = sellers and buyers converging.',
  bid_ask_spread_monthly:
    'Bid-ask spread on closed sales.',
  seller_sentiment:
    'Share of broadly marketed deals that closed after a price adjustment, alongside the average asking cap rate at close. Lower price-change frequency + flat asking caps signals seller pricing discipline.',
  seller_sentiment_monthly:
    'Share of broadly marketed deals that closed after a price adjustment.',
  asking_cap_quartiles_active:
    'Active-listing asking cap quartiles for the Total Market and the 10+ Year Term cohort. Read alongside the closed-sale cap-rate panel to gauge seller vs. clearing pricing.',
  available_market_size_combo:
    'Active inventory count (bars) and asking cap rate (line) for Total Market vs. 10+ Year Term cohort.',
  dom_price_change_active:
    'Days on market and price-change frequency on active listings. Pair with the asking cap quartiles panel to gauge seller alignment with clearing pricing.',
  buyer_class_pct_by_year:
    'Annual breakdown of buyer pool by capital source. Private capital (individual/family/small fund) historically dominates dialysis; public REITs and institutional capital ebb and flow with the cycle.',
  buyer_pool_breakdown:
    'TTM buyer pool by capital source.',
  cost_of_capital:
    'Net-lease cost-of-capital snapshot: 10-Year Treasury (sky), TTM average cap rate (navy), and assumed loan-constant range (gray dashes between). Cap > loan constant indicates positive leverage.',
  cash_leveraged_returns:
    'Cash return index (TTM avg cap) and modeled leveraged return (50% LTV, 30-yr am, 10Y + 180–220 bps). Leveraged > cash means accretive financing is achievable.',
  rent_psf_box_quarterly:
    'Quarterly rent / SF distribution: IQR (bars), median (line), min/max (whiskers).',
  ppsf_box_quarterly:
    'Quarterly price / SF distribution: IQR (bars), median (line), min/max (whiskers).',
  cap_rate_by_credit:
    'Federal vs. State vs. Municipal TTM average cap rates. NOTE (Round 21): current gov dataset has 0 state and ~5 municipal sales with valid cap rates — state and municipal series will read empty until external state/muni lease records are imported. Federal carries credit and tenant-stability premiums; state and municipal tend to trade wider.',
  cpi_vs_renewal_cagr:
    'CPI YoY change vs. GSA renewal CAGR. Persistent gaps highlight whether GSA renewals are tracking inflation.',
  fed_funds_vs_treasury:
    'Federal Funds Rate vs. 10-Year Treasury vs. 30-Year Mortgage. Yield-curve slope is a leading indicator for cap-rate direction.',
  lease_renewal_rate:
    'GSA lease outcomes by quarter (TTM): renewed, succeeding/superseding, expired, terminated.',
  lease_termination_rate:
    'Termination rate as % of active leases (TTM).',
  lease_structures:
    'Distribution of lease structures by initial term + firm-term combination ("10, 5" = 10-year initial / 5-year firm).',
  leased_inventory_by_state:
    'Top states by total leased SF.',
  net_lease_spread:
    'Cap-rate spread over the 10-Year Treasury for Market / NM / Non-NM cohorts.',
  renewal_rent_growth:
    'TTM average GSA renewal rent / SF with quartile band.',
  rent_by_year_built:
    'Median rent / SF by build-year decade with quartile whiskers. Newer build years command rent premiums driven by interior fit-out costs and current code requirements.',
  rent_heat_map:
    'Top states by average rent / SF.',
  sources_of_capital:
    'Top buyer-state sources of capital by 15-year volume.',
  case_for_renewal:
    'Annual GSA new-lease commencements (bars) vs. average rent / SF (line).',
  pace_of_cap_rate_expansion:
    'Month-over-month change (annualized) in TTM avg cap rate (all cohort, navy) and 10+ Year Term cohort (sky). Bars above zero = expansion (cap rates rising); below zero = compression. Use to spot the rate-cycle inflection.',
};

// Default brand tokens (used as fallback if cm_brand_tokens query failed)
const DEFAULT_BRAND = {
  palette: {
    nm_navy:       '#003DA5',
    nm_sky:        '#62B5E5',
    nm_pale:       '#E0E8F4',
    nm_blue_mid:   '#265AB2',
    nm_axis:       '#6A748C',
    nm_text:       '#191919',
    nm_text_muted: '#666666',
    nm_bg:         '#FFFFFF',
    nm_bg_alt:     '#E7E6E6',
  },
  fonts: {
    title_family: 'Calibri Light',
    body_family:  'Calibri',
  },
};

const hex = (color) => (color || '').replace('#', '').toUpperCase();

// ============================================================================
// Per-chart data layout: how each chart's rows map to columns in its data tab
// ============================================================================
// Each entry returns the list of columns to write for the chart's rows.
// Format: [{ key, header, format, width }]
//   - key:    field name in the row object
//   - header: column header
//   - format: number format code (key in FMT) or undefined
//   - width:  column width in characters
//
// The first column is always 'period_end' (or year for annual data) and
// 'subspecialty' is included as a filter context column.

const CHART_COLUMNS = {
  volume_ttm_by_quarter: [
    { key: 'period_end',       header: 'Quarter End',         format: 'date_short',          width: 13 },
    { key: 'subspecialty',     header: 'Subspecialty',        width: 14 },
    { key: 'volume_dollars',   header: 'TTM Volume ($)',      format: 'currency_dollars',    width: 18 },
    { key: 'yoy_change_pct',   header: 'YoY Change',          format: 'percent_one_decimal', width: 13 },
  ],
  quarterly_volume_bars: [
    { key: 'period_end',         header: 'Quarter End',         format: 'date_short',         width: 13 },
    { key: 'quarterly_volume',   header: 'Quarterly Volume ($)',format: 'currency_dollars',   width: 22 },
    { key: 'quarterly_count',    header: 'Quarterly Count',     format: 'integer_count',      width: 17 },
  ],
  buyer_pool_monthly_count: [
    { key: 'period_end',           header: 'Month End',         format: 'date_short',         width: 13 },
    { key: 'private_count',        header: 'Private (Individual)', format: 'integer_count',   width: 22 },
    { key: 'institutional_count',  header: 'Institutional / Fund', format: 'integer_count',   width: 22 },
    { key: 'reit_count',           header: 'REIT',                 format: 'integer_count',   width: 12 },
    { key: 'cross_border_count',   header: 'Cross-Border',         format: 'integer_count',   width: 16 },
  ],
  pace_of_cap_rate_expansion: [
    { key: 'period_end', header: 'Month End',                          format: 'date_short',          width: 13 },
    { key: 'pace_all',   header: 'Pace — All Cohort (annualized)',     format: 'percent_basis_points', width: 28 },
    { key: 'pace_core',  header: 'Pace — 10+ Year Cohort (annualized)',format: 'percent_basis_points', width: 32 },
    // R56 — pace_cost (YoY cost-of-capital change) was being computed
    // by the synthetic composer but dropped here. User notes 2026-05-22:
    // "We also have a YOY pace of change line in our Excel/PDF version
    // that is missing from this one."
    { key: 'pace_cost',  header: 'Pace — Cost of Capital (YoY)',       format: 'percent_basis_points', width: 28 },
  ],
  // Audit-fix: catalog rows existed but TAB_NAMES + CHART_COLUMNS were missing,
  // so these DataTables were silently dropped from every export.
  // Round 6d — user feedback 2026-05-09: "We just want an aggregate
  // list from most transactions to least over all time with no date
  // filter." Dropped the period_end column and renamed the volume/count
  // labels to "Total" (the underlying view now aggregates all-time;
  // "TTM" wording was misleading).
  top_buyers_table: [
    { key: 'rank',       header: '#',                   format: 'integer_count',    width: 5 },
    { key: 'buyer',      header: 'Buyer',                                            width: 38 },
    { key: 'ttm_count',  header: 'Total Transactions', format: 'integer_count',    width: 18 },
    { key: 'ttm_volume', header: 'Total Volume ($)',    format: 'currency_dollars', width: 20 },
  ],
  top_sellers_table: [
    { key: 'rank',       header: '#',                   format: 'integer_count',    width: 5 },
    { key: 'seller',     header: 'Seller',                                           width: 38 },
    { key: 'ttm_count',  header: 'Total Transactions', format: 'integer_count',    width: 18 },
    { key: 'ttm_volume', header: 'Total Volume ($)',    format: 'currency_dollars', width: 20 },
  ],
  nm_notable_transactions: [
    { key: 'rank',           header: '#',                  format: 'integer_count',    width: 5 },
    { key: 'sale_date',      header: 'Sale Date',          format: 'date_short',       width: 13 },
    { key: 'tenant_display', header: 'Tenant',                                          width: 22 },
    { key: 'building_name',  header: 'Property',                                        width: 32 },
    { key: 'city',           header: 'City',                                            width: 18 },
    { key: 'state',          header: 'State',                                           width: 8 },
    { key: 'sale_price',     header: 'Sale Price ($)',     format: 'currency_dollars', width: 18 },
    { key: 'cap_rate',       header: 'Cap Rate',           format: 'percent_basis_points', width: 12 },
    { key: 'buyer_type',     header: 'Buyer Type',                                      width: 16 },
  ],
  // Round 5c — gov NM tracking DataTables. Both views use cm_nm_* (no
  // vertical placeholder) and ship for gov only per the catalog.
  nm_buyer_distribution: [
    { key: 'period_end',     header: 'Quarter End',         format: 'date_short',          width: 13 },
    { key: 'rank',           header: '#',                   format: 'integer_count',       width: 5 },
    { key: 'state',          header: 'Buyer State',                                        width: 14 },
    { key: 'deal_count',     header: 'Deal Count',          format: 'integer_count',       width: 13 },
    { key: 'volume_dollars', header: 'Volume ($)',          format: 'currency_dollars',    width: 18 },
    { key: 'share_pct',      header: 'Share of NM',         format: 'percent_one_decimal', width: 14 },
  ],
  nm_track_record_buyer_type: [
    { key: 'period_end',     header: 'Quarter End',         format: 'date_short',           width: 13 },
    { key: 'buyer_type',     header: 'Buyer Type',                                          width: 18 },
    { key: 'deal_count',     header: 'Deal Count',          format: 'integer_count',        width: 13 },
    { key: 'volume_dollars', header: 'Volume ($)',          format: 'currency_dollars',     width: 18 },
    { key: 'avg_cap_rate',   header: 'Avg Cap Rate',        format: 'percent_basis_points', width: 14 },
    { key: 'share_pct',      header: 'Share of NM',         format: 'percent_one_decimal',  width: 14 },
  ],
  available_by_tenant_count_donut: [
    { key: 'tenant',         header: 'Tenant',          width: 18 },
    { key: 'count_active',   header: 'Count Available', format: 'integer_count', width: 18 },
    { key: 'period_end',     header: 'As of',           format: 'date_short',    width: 13 },
  ],
  available_by_tenant_volume_donut: [
    { key: 'tenant',           header: 'Tenant',           width: 18 },
    { key: 'volume_available', header: 'Volume Available', format: 'currency_dollars', width: 22 },
    { key: 'period_end',       header: 'As of',            format: 'date_short',       width: 13 },
  ],
  available_by_term_summary: [
    { key: 'term_bucket',         header: 'Term Bucket',     width: 18 },
    { key: 'n_listings',          header: 'Listings',        format: 'integer_count',       width: 12 },
    { key: 'avg_price',           header: 'Avg Price ($)',   format: 'currency_dollars',    width: 18 },
    { key: 'avg_cap',             header: 'Avg Cap',         format: 'percent_basis_points', width: 13 },
    { key: 'upper_quartile_cap',  header: 'Upper Q Cap',     format: 'percent_basis_points', width: 14 },
    { key: 'median_cap',          header: 'Median Cap',      format: 'percent_basis_points', width: 14 },
    { key: 'lower_quartile_cap',  header: 'Lower Q Cap',     format: 'percent_basis_points', width: 14 },
    { key: 'period_end',          header: 'As of',           format: 'date_short',          width: 13 },
  ],
  // Round 18 — 3 new charts
  core_cap_rate_dot_plot: [
    { key: 'period_end',       header: 'Sale Date',           format: 'date_short',          width: 13 },
    { key: 'cap_rate',         header: 'Cap Rate',            format: 'percent_basis_points', width: 13 },
    { key: 'firm_term_years',  header: 'Firm Term (yrs)',     format: 'number_one_decimal',  width: 16 },
    { key: 'is_northmarq',     header: 'NM-Brokered',         width: 14 },
    { key: 'sold_price',       header: 'Sold Price ($)',      format: 'currency_dollars',    width: 18 },
  ],
  available_cap_rate_dot_plot: [
    { key: 'period_end',       header: 'As of',               format: 'date_short',          width: 13 },
    { key: 'cap_rate',         header: 'Asking Cap',          format: 'percent_basis_points', width: 14 },
    { key: 'firm_term_years',  header: 'Firm Term (yrs)',     format: 'number_one_decimal',  width: 16 },
    { key: 'is_northmarq',     header: 'NM-Listed',           width: 12 },
    { key: 'last_price',       header: 'Asking Price ($)',    format: 'currency_dollars',    width: 18 },
  ],
  // Round 31 — NEW: Asking Cap Rate Ranges by Lease Term Buckets
  // (active-listings 4-line TTM cohort, dia only — gov deferred).
  asking_cap_by_term_dot_plot: [
    { key: 'period_end',  header: 'Month End',     format: 'date_short',          width: 13 },
    { key: 'subspecialty', header: 'Subspecialty', width: 14 },
    { key: 'cap_12plus',  header: '12+ Year Cap',  format: 'percent_basis_points', width: 14 },
    { key: 'cap_8to12',   header: '8-12 Year Cap', format: 'percent_basis_points', width: 15 },
    { key: 'cap_6to8',    header: '6-8 Year Cap',  format: 'percent_basis_points', width: 14 },
    { key: 'cap_5orless', header: '≤5 Year Cap',   format: 'percent_basis_points', width: 14 },
    { key: 'cap_12plus_n',  header: '12+ n',  format: 'integer_count', width: 8 },
    { key: 'cap_8to12_n',   header: '8-12 n', format: 'integer_count', width: 8 },
    { key: 'cap_6to8_n',    header: '6-8 n',  format: 'integer_count', width: 8 },
    { key: 'cap_5orless_n', header: '≤5 n',   format: 'integer_count', width: 8 },
  ],
  // Round 30 — Sold_Cap_by_Term redefined as 4-line TTM cohort series.
  // Different column shape for gov vs dia. Data-tab writer iterates the
  // cols array as-is; missing fields render as blank (cohort columns
  // not present in the other vertical's view).
  sold_cap_by_term_dot_plot: [
    { key: 'period_end',       header: 'Month End',         format: 'date_short',          width: 13 },
    { key: 'subspecialty',     header: 'Subspecialty',      width: 14 },
    // Dia cohorts
    { key: 'cap_12plus',       header: '12+ Year Cap',      format: 'percent_basis_points', width: 14 },
    { key: 'cap_8to12',        header: '8-12 Year Cap',     format: 'percent_basis_points', width: 15 },
    { key: 'cap_6to8',         header: '6-8 Year Cap',      format: 'percent_basis_points', width: 14 },
    { key: 'cap_5orless',      header: '≤5 Year Cap',       format: 'percent_basis_points', width: 14 },
    // Gov cohorts
    { key: 'cap_10plus',       header: '10+ Year Cap',      format: 'percent_basis_points', width: 14 },
    { key: 'cap_5to10',        header: '6-10 Year Cap',     format: 'percent_basis_points', width: 15 },
    { key: 'cap_less5',        header: '< 5 Year Cap',      format: 'percent_basis_points', width: 14 },
    { key: 'cap_outside_firm', header: 'Outside Firm Cap',  format: 'percent_basis_points', width: 17 },
  ],
  available_by_firm_term_summary: [
    { key: 'term_bucket',         header: 'Firm Term Bucket',  width: 18 },
    { key: 'n_listings',          header: 'Listings',          format: 'integer_count',       width: 12 },
    { key: 'avg_price',           header: 'Avg Price ($)',     format: 'currency_dollars',    width: 18 },
    { key: 'avg_cap',             header: 'Avg Cap',           format: 'percent_basis_points', width: 13 },
    { key: 'upper_quartile_cap',  header: 'Upper Q Cap',       format: 'percent_basis_points', width: 14 },
    { key: 'median_cap',          header: 'Median Cap',        format: 'percent_basis_points', width: 14 },
    { key: 'lower_quartile_cap',  header: 'Lower Q Cap',       format: 'percent_basis_points', width: 14 },
    { key: 'period_end',          header: 'As of',             format: 'date_short',          width: 13 },
  ],
  // Round 19 — Market activity
  market_turnover: [
    { key: 'period_end',         header: 'Month End',         format: 'date_short',          width: 13 },
    { key: 'subspecialty',       header: 'Subspecialty',      width: 14 },
    { key: 'ttm_sales_count',    header: 'TTM Sales',         format: 'integer_count',       width: 13 },
    { key: 'market_universe',    header: 'Market Universe',   format: 'integer_count',       width: 16 },
    { key: 'turnover_rate',      header: 'Turnover Rate',     format: 'percent_one_decimal', width: 14 },
    // R55 — new columns for the restructured chart (active inventory bar,
    // annualized sales rate bar, months-of-supply line).
    { key: 'active_count',       header: 'Active Listings',   format: 'integer_count',       width: 16 },
    { key: 'annual_sales_rate',  header: 'Annual Sales Rate', format: 'integer_count',       width: 18 },
    { key: 'months_of_supply',   header: 'Months of Supply',  format: 'number_one_decimal',  width: 17 },
  ],
  inventory_backlog: [
    { key: 'period_end',         header: 'Month End',         format: 'date_short',          width: 13 },
    { key: 'subspecialty',       header: 'Subspecialty',      width: 14 },
    { key: 'added_ttm',          header: 'No. Added (TTM)',   format: 'integer_count',       width: 17 },
    { key: 'sold_ttm',           header: 'No. Sold (TTM)',    format: 'integer_count',       width: 16 },
    { key: 'active_count',       header: 'Active Listings',   format: 'integer_count',       width: 16 },
    { key: 'months_of_supply',   header: 'Months of Supply',  format: 'number_one_decimal',  width: 17 },
  ],
  // Round 20 — PDF-parity combos
  txn_count_avg_deal_combo: [
    { key: 'period_end',         header: 'Period End',        format: 'date_short',          width: 13 },
    { key: 'ttm_count',          header: 'TTM Transactions',  format: 'integer_count',       width: 17 },
    { key: 'avg_deal_size',      header: 'Avg Deal Size ($)', format: 'currency_dollars',    width: 19 },
  ],
  rent_and_price_psf: [
    { key: 'period_end',         header: 'Quarter End',           format: 'date_short',       width: 13 },
    { key: 'subspecialty',       header: 'Subspecialty',          width: 14 },
    { key: 'rent_psf',           header: 'Avg Rent / SF (TTM)',   format: 'currency_per_sf',  width: 20 },
    { key: 'price_psf',          header: 'Avg Sale Price / SF',   format: 'currency_per_sf',  width: 22 },
    { key: 'n_with_rent_ttm',    header: 'N w/ Rent (TTM)',       format: 'integer_count',    width: 17 },
    { key: 'n_with_price_ttm',   header: 'N w/ Price (TTM)',      format: 'integer_count',    width: 17 },
  ],
  // Round 31 — Dia counterpart (per-chair unit econ).
  rent_and_price_per_chair: [
    { key: 'period_end',     header: 'Quarter End',                format: 'date_short',       width: 13 },
    { key: 'subspecialty',   header: 'Subspecialty',               width: 14 },
    { key: 'rent_per_chair', header: 'Avg Rent / Chair (TTM)',     format: 'currency_dollars', width: 22 },
    { key: 'price_per_chair', header: 'Avg Sale Price / Chair',    format: 'currency_dollars', width: 24 },
    { key: 'rent_n',         header: 'N w/ Rent (TTM)',            format: 'integer_count',    width: 17 },
    { key: 'price_n',        header: 'N w/ Price (TTM)',           format: 'integer_count',    width: 17 },
  ],
  transaction_count_ttm: [
    { key: 'period_end',       header: 'Quarter End',         format: 'date_short',          width: 13 },
    { key: 'subspecialty',     header: 'Subspecialty',        width: 14 },
    { key: 'ttm_count',        header: 'TTM Transactions',    format: 'integer_count',       width: 17 },
  ],
  cap_rate_ttm_by_quarter: [
    { key: 'period_end',       header: 'Quarter End',         format: 'date_short',          width: 13 },
    { key: 'subspecialty',     header: 'Subspecialty',        width: 14 },
    { key: 'ttm_weighted_cap_rate', header: 'Avg Cap Rate', format: 'percent_basis_points', width: 14 },
  ],
  cap_rate_top_bottom_quartile: [
    { key: 'period_end',       header: 'Quarter End',         format: 'date_short',          width: 13 },
    { key: 'subspecialty',     header: 'Subspecialty',        width: 14 },
    { key: 'top_quartile',     header: 'Top Quartile',        format: 'percent_basis_points', width: 14 },
    { key: 'median',           header: 'Median',              format: 'percent_basis_points', width: 14 },
    { key: 'bottom_quartile',  header: 'Bottom Quartile',     format: 'percent_basis_points', width: 16 },
  ],
  avg_deal_size: [
    { key: 'period_end',       header: 'Quarter End',         format: 'date_short',          width: 13 },
    { key: 'subspecialty',     header: 'Subspecialty',        width: 14 },
    { key: 'avg_deal_size',    header: 'Avg Deal Size ($)',   format: 'currency_dollars',    width: 18 },
  ],
  nm_vs_market_cap: [
    { key: 'period_end',       header: 'Quarter End',         format: 'date_short',          width: 13 },
    { key: 'subspecialty',     header: 'Subspecialty',        width: 14 },
    { key: 'nm_cap_rate',      header: 'Northmarq Cap Rate',  format: 'percent_basis_points', width: 19 },
    { key: 'market_cap_rate',  header: 'Market Cap Rate',     format: 'percent_basis_points', width: 18 },
  ],
  cap_rate_by_lease_term: [
    { key: 'period_end',       header: 'Quarter End',         format: 'date_short',          width: 13 },
    { key: 'subspecialty',     header: 'Subspecialty',        width: 14 },
    // Legacy gov-style cohorts (10+/6-10/<5/outside) — used by gov vertical
    // and kept on dialysis for backward compatibility.
    { key: 'cap_10plus',       header: '10+ Year Cap',        format: 'percent_basis_points', width: 14 },
    { key: 'cap_6to10',        header: '6–10 Year Cap',       format: 'percent_basis_points', width: 16 },
    { key: 'cap_less5',        header: '< 5 Year Cap',        format: 'percent_basis_points', width: 14 },
    { key: 'cap_outside_firm', header: 'Outside Firm Cap',    format: 'percent_basis_points', width: 18 },
    // Round 3 PDF-aligned dialysis cohorts (12+/8-12/6-8/≤5). NULL on gov
    // because gov master_m never carried these fields.
    { key: 'cap_12plus',       header: '12+ Year Cap',        format: 'percent_basis_points', width: 14 },
    { key: 'cap_8to12',        header: '8–12 Year Cap',       format: 'percent_basis_points', width: 16 },
    { key: 'cap_6to8',         header: '6–8 Year Cap',        format: 'percent_basis_points', width: 15 },
    { key: 'cap_5orless',      header: '≤5 Year Cap',         format: 'percent_basis_points', width: 14 },
  ],
  cap_rate_by_credit: [
    { key: 'period_end',       header: 'Quarter End',         format: 'date_short',          width: 13 },
    { key: 'subspecialty',     header: 'Subspecialty',        width: 14 },
    { key: 'federal_cap',      header: 'Federal Cap',         format: 'percent_basis_points', width: 14 },
    { key: 'state_cap',        header: 'State Cap',           format: 'percent_basis_points', width: 14 },
    { key: 'municipal_cap',    header: 'Municipal Cap',       format: 'percent_basis_points', width: 16 },
  ],

  // Phase 2b additions
  yoy_volume_change: [
    { key: 'period_end',       header: 'Quarter End',         format: 'date_short',          width: 13 },
    { key: 'subspecialty',     header: 'Subspecialty',        width: 14 },
    { key: 'yoy_change_pct',   header: 'YoY Change (%)',      format: 'percent_one_decimal', width: 14 },
  ],
  buyer_class_pct_by_year: [
    { key: 'year',                  header: 'Year',                width: 10 },
    { key: 'subspecialty',          header: 'Subspecialty',        width: 14 },
    { key: 'private_volume',        header: 'Private Volume',      format: 'currency_dollars',     width: 18 },
    { key: 'reit_volume',           header: 'Public REIT Volume',  format: 'currency_dollars',     width: 19 },
    { key: 'cross_border_volume',   header: 'Cross-Border Volume', format: 'currency_dollars',     width: 20 },
    { key: 'institutional_volume',  header: 'Institutional Volume',format: 'currency_dollars',     width: 21 },
    { key: 'private_pct',           header: 'Private %',           format: 'percent_zero_decimal', width: 12 },
    { key: 'reit_pct',              header: 'Public REIT %',       format: 'percent_zero_decimal', width: 14 },
    { key: 'cross_border_pct',      header: 'Cross-Border %',      format: 'percent_zero_decimal', width: 15 },
    { key: 'institutional_pct',     header: 'Institutional %',     format: 'percent_zero_decimal', width: 16 },
  ],
  dom_and_pct_of_ask: [
    { key: 'period_end',          header: 'Quarter End',           format: 'date_short',          width: 13 },
    { key: 'subspecialty',        header: 'Subspecialty',          width: 14 },
    { key: 'avg_dom',             header: 'Avg DOM (days)',        format: 'integer_count',       width: 14 },
    // Round 15 — median surfaced alongside avg as a sanity check. Long-DOM
    // stale listings (8-9yr clearings) drag avg up while median reflects
    // the typical fresh-listing experience. See dia DOM view for full
    // calc + 0-3650 day cap.
    { key: 'median_dom',          header: 'Median DOM (days)',     format: 'integer_count',       width: 17 },
    { key: 'pct_of_ask',          header: '% of Ask Price',        format: 'percent_one_decimal', width: 16 },
    { key: 'median_pct_of_ask',   header: 'Median % of Ask',       format: 'percent_one_decimal', width: 17 },
  ],
  bid_ask_spread: [
    { key: 'period_end',         header: 'Quarter End',         format: 'date_short',          width: 13 },
    { key: 'subspecialty',       header: 'Subspecialty',        width: 14 },
    { key: 'avg_bid_ask_spread', header: 'Bid-Ask Spread (bps)', format: 'percent_basis_points', width: 19 },
    { key: 'pct_price_change',   header: '% Price Changes',     format: 'percent_one_decimal', width: 16 },
  ],

  // Phase 2c additions (FRED macro)
  fed_funds_vs_treasury: [
    { key: 'period_end',         header: 'Quarter End',         format: 'date_short',          width: 13 },
    { key: 'fed_funds_rate',     header: 'Fed Funds Rate',      format: 'percent_one_decimal', width: 15 },
    { key: 'treasury_10y_yield', header: '10Y Treasury',        format: 'percent_one_decimal', width: 14 },
  ],
  cost_of_capital: [
    { key: 'period_end',         header: 'Quarter End',         format: 'date_short',          width: 13 },
    { key: 'treasury_10y_yield', header: '10Y Treasury',        format: 'percent_one_decimal', width: 14 },
    { key: 'avg_cap_rate',       header: 'Avg Cap Rate (TTM)',  format: 'percent_basis_points', width: 18 },
    { key: 'cap_10plus_year',    header: '10+ Year Cap',        format: 'percent_basis_points', width: 14 },
    { key: 'low_loan_constant',  header: 'Low Loan Constant',   format: 'percent_basis_points', width: 18 },
    { key: 'high_loan_constant', header: 'High Loan Constant',  format: 'percent_basis_points', width: 19 },
  ],
  cash_leveraged_returns: [
    { key: 'period_end',           header: 'Quarter End',           format: 'date_short',          width: 13 },
    { key: 'cash_return',          header: 'Cash Return Index',     format: 'percent_basis_points', width: 18 },
    { key: 'leveraged_return_mid', header: 'Leveraged Return (mid)',format: 'percent_basis_points', width: 22 },
    { key: 'leveraged_return_high',header: 'Leveraged High (180bps)',format: 'percent_basis_points', width: 22 },
    { key: 'leveraged_return_low', header: 'Leveraged Low (220bps)',format: 'percent_basis_points', width: 22 },
  ],
  seller_sentiment: [
    { key: 'period_end',                  header: 'Quarter End',         format: 'date_short',          width: 13 },
    { key: 'n_all',                       header: 'N (all)',             format: 'integer_count',       width: 10 },
    { key: 'pct_price_change_all',        header: 'Price Chg % (all)',   format: 'percent_one_decimal', width: 18 },
    { key: 'n_long_term',                 header: 'N (8+ yr)',           format: 'integer_count',       width: 10 },
    { key: 'pct_price_change_long_term',  header: 'Price Chg % (8+ yr)', format: 'percent_one_decimal', width: 20 },
    { key: 'last_ask_cap_all',            header: 'Last Ask Cap (all)',  format: 'percent_basis_points', width: 19 },
    { key: 'last_ask_cap_long_term',      header: 'Last Ask Cap (8+ yr)',format: 'percent_basis_points', width: 21 },
  ],
  sources_of_capital: [
    { key: 'rank_15y',          header: 'Rank',                width: 6 },
    { key: 'buyer_state',       header: 'Buyer State',         width: 14 },
    { key: 'total_volume_15y',  header: 'Total Volume 15-yr',  format: 'currency_dollars',     width: 22 },
    { key: 'pct_of_total_15y',  header: '% of Total',          format: 'percent_one_decimal', width: 12 },
    { key: 'deal_count_15y',    header: 'Deal Count',          format: 'integer_count',       width: 12 },
  ],
  valuation_index: [
    { key: 'period_end',         header: 'Quarter End',          format: 'date_short',          width: 13 },
    { key: 'avg_rent_psf',       header: 'Avg Rent PSF (TTM)',   format: 'currency_per_sf',     width: 18 },
    { key: 'avg_expenses_psf',   header: 'Expenses PSF (TTM)',   format: 'currency_per_sf',     width: 19 },
    { key: 'avg_noi_psf',        header: 'NOI PSF (TTM)',        format: 'currency_per_sf',     width: 17 },
    { key: 'avg_cap_rate',       header: 'Avg Cap Rate (TTM)',   format: 'percent_basis_points', width: 18 },
    { key: 'valuation_index',    header: 'Valuation Index ($/SF)',format: 'currency_per_sf',    width: 22 },
    // Round 22 — surface the Round 20 yoy_change column in the data tab
    // (renderer chart already uses it). gov view emits `yoy_change`,
    // dialysis view emits `yoy_change_pct`; coalesce via the spec's
    // fieldKeys.
    { key: 'yoy_change',         fieldKeys: ['yoy_change', 'yoy_change_pct'],
                                 header: 'YoY % Change',         format: 'percent_one_decimal', width: 14 },
    { key: 'n_sales',            header: 'N Sales (Q)',          format: 'integer_count',       width: 12 },
  ],

  // ===== Phase 2c.4: Section 2 Leasing Trends ==================================
  leased_inventory_by_state: [
    { key: 'rank_by_rsf', header: 'Rank', format: 'integer_count', width: 6 },
    { key: 'state', header: 'State', width: 10 },
    { key: 'lease_count', header: 'Lease Count', format: 'integer_count', width: 14 },
    { key: 'total_rsf', header: 'Total RSF', format: 'integer_count', width: 16 },
    { key: 'total_annual_rent', header: 'Total Annual Rent', format: 'currency_dollars', width: 22 },
    { key: 'avg_rent_psf', header: 'Avg Rent / SF', format: 'currency_per_sf', width: 16 },
  ],
  leasing_summary: [
    { key: 'period_label', header: 'Period', width: 18 },
    { key: 'new_lease_count', header: '# New Leases', format: 'integer_count', width: 14 },
    { key: 'monthly_avg_count', header: 'Monthly Avg Count', format: 'integer_count', width: 18 },
    { key: 'total_lsf', header: 'Total LSF', format: 'integer_count', width: 16 },
    { key: 'monthly_avg_lsf', header: 'Monthly Avg LSF', format: 'integer_count', width: 18 },
    { key: 'avg_lease_size', header: 'Avg Lease Size', format: 'integer_count', width: 16 },
    { key: 'total_rent', header: 'Total Rent', format: 'currency_dollars', width: 18 },
    { key: 'monthly_avg_rent', header: 'Monthly Avg Rent', format: 'currency_dollars', width: 19 },
    { key: 'avg_annual_rent', header: 'Avg Annual Rent', format: 'currency_dollars', width: 18 },
    { key: 'avg_rent_per_sf', header: 'Avg Rent PSF', format: 'currency_per_sf', width: 16 },
  ],
  lease_structures: [
    { key: 'period_label', header: 'Period', width: 18 },
    { key: 'term_bucket', header: 'Term Bucket', width: 14 },
    { key: 'bucket_count', header: 'Count', format: 'integer_count', width: 12 },
    { key: 'pct_of_total', header: '% of Total', format: 'percent_one_decimal', width: 14 },
  ],
  lease_renewal_rate: [
    { key: 'period_end', header: 'Quarter End', format: 'date_short', width: 13 },
    { key: 'first_generation_commencements', header: 'First Gen Commencements', format: 'integer_count', width: 24 },
    { key: 'renewed_leases', header: 'Renewed', format: 'integer_count', width: 12 },
    { key: 'succeeding_superseding_leases', header: 'Succeeding/Superseding', format: 'integer_count', width: 24 },
    { key: 'expired_leases', header: 'Expired', format: 'integer_count', width: 12 },
    { key: 'terminated_leases', header: 'Terminated', format: 'integer_count', width: 14 },
  ],
  lease_termination_rate: [
    { key: 'period_end', header: 'Quarter End', format: 'date_short', width: 13 },
    { key: 'total_leases_active', header: 'Total Active Leases', format: 'integer_count', width: 20 },
    { key: 'terminated_ttm', header: 'Terminated (TTM)', format: 'integer_count', width: 18 },
    // Round 11 — was missing; Round 9 added the column to the gov view +
    // chart renderer but the data tab didn't surface it.
    { key: 'leases_outside_firm_term', header: 'Outside Firm Term', format: 'integer_count', width: 18 },
  ],
  rent_by_year_built: [
    { key: 'year', header: 'Year Built', format: 'integer_count', width: 11 },
    { key: 'avg_rpsf', header: 'Avg RPSF', format: 'currency_per_sf', width: 14 },
    { key: 'median_rpsf', header: 'Median RPSF', format: 'currency_per_sf', width: 14 },
    { key: 'upper_quartile_rpsf', header: 'Upper Quartile', format: 'currency_per_sf', width: 16 },
    { key: 'lower_quartile_rpsf', header: 'Lower Quartile', format: 'currency_per_sf', width: 16 },
    { key: 'n_leases', header: 'N Leases', format: 'integer_count', width: 12 },
  ],
  case_for_renewal: [
    { key: 'year', header: 'Year', format: 'integer_count', width: 8 },
    { key: 'commencement_count', header: 'Lease Commencements', format: 'integer_count', width: 22 },
    { key: 'avg_rent_per_sf', header: 'Avg Rent / SF', format: 'currency_per_sf', width: 16 },
    { key: 'total_lsf', header: 'Total LSF', format: 'integer_count', width: 16 },
  ],
  renewal_rent_growth: [
    { key: 'period_end', header: 'Quarter End', format: 'date_short', width: 13 },
    { key: 'avg_renewal_rent_psf', header: 'Quarterly Avg Renewal/SF', format: 'currency_per_sf', width: 22 },
    { key: 'ttm_avg_renewal_rent_psf', header: 'TTM Avg Renewal/SF', format: 'currency_per_sf', width: 20 },
    { key: 'upper_quartile_rpsf', header: 'Upper Quartile', format: 'currency_per_sf', width: 16 },
    { key: 'lower_quartile_rpsf', header: 'Lower Quartile', format: 'currency_per_sf', width: 16 },
    { key: 'cagr_5yr', header: '5-Year CAGR', format: 'percent_one_decimal', width: 14 },
    { key: 'renewal_count', header: 'Renewal Count', format: 'integer_count', width: 16 },
  ],
  cpi_vs_renewal_cagr: [
    { key: 'period_end', header: 'Quarter End', format: 'date_short', width: 13 },
    { key: 'cpi_change', header: 'CPI YoY Change', format: 'percent_one_decimal', width: 17 },
    { key: 'gsa_renewal_cagr', header: 'GSA Renewal 5yr CAGR', format: 'percent_one_decimal', width: 22 },
  ],
  rent_heat_map: [
    { key: 'rank_by_rpsf', header: 'Rank', format: 'integer_count', width: 6 },
    { key: 'state', header: 'State', width: 10 },
    { key: 'avg_rpsf', header: 'Avg Rent / SF', format: 'currency_per_sf', width: 16 },
    { key: 'median_rpsf', header: 'Median', format: 'currency_per_sf', width: 14 },
    { key: 'upper_quartile_rpsf', header: 'Upper Quartile', format: 'currency_per_sf', width: 16 },
    { key: 'lower_quartile_rpsf', header: 'Lower Quartile', format: 'currency_per_sf', width: 16 },
    { key: 'n_leases', header: 'N Leases', format: 'integer_count', width: 12 },
  ],
  net_lease_spread: [
    { key: 'period_end',         header: 'Quarter End',         format: 'date_short',          width: 13 },
    { key: 'subspecialty',       header: 'Subspecialty',        width: 14 },
    { key: 'treasury_10y_yield', header: '10Y Treasury',        format: 'percent_one_decimal', width: 14 },
    { key: 'avg_cap_rate',       header: 'Market Avg Cap',      format: 'percent_basis_points', width: 16 },
    { key: 'nm_avg_cap',         header: 'NM Avg Cap',          format: 'percent_basis_points', width: 14 },
    { key: 'market_spread',      header: 'Market Spread (bps)', format: 'percent_basis_points', width: 19 },
    { key: 'nm_spread',          header: 'NM Spread (bps)',     format: 'percent_basis_points', width: 17 },
  ],

  // Parity-1: front-cover combo (Volume area + Cap line + Upper/Lower quartile band)
  volume_cap_quartile_combo: [
    { key: 'period_end',     header: 'Quarter End',         format: 'date_short',           width: 13 },
    { key: 'subspecialty',   header: 'Subspecialty',        width: 14 },
    { key: 'volume_dollars', header: 'TTM Volume ($)',      format: 'currency_dollars',     width: 18 },
    { key: 'cap_rate',       header: 'TTM Cap (avg)',       format: 'percent_basis_points', width: 14 },
    { key: 'upper_quartile', header: 'Upper Quartile Cap',  format: 'percent_basis_points', width: 18 },
    { key: 'lower_quartile', header: 'Lower Quartile Cap',  format: 'percent_basis_points', width: 18 },
  ],

  // Phase 5 — Inventory Analysis (dia p.29-35)
  // Note: inventory_snapshot_kpis renders via renderKpiBlockTab (kpi_block
  // contract: tile_id/tile_label/primary_value/primary_format/sort_order)
  // so it's NOT in CHART_COLUMNS — same dispatch as value_proposition_results.
  available_market_size_combo: [
    { key: 'period_end',          header: 'Quarter End',         format: 'date_short',           width: 13 },
    { key: 'subspecialty',        header: 'Subspecialty',        width: 14 },
    { key: 'count_total',         header: 'Total Market — # Available',  format: 'integer_count',        width: 22 },
    { key: 'count_core_10plus',   header: '10+ Year Term — # Available', format: 'integer_count',        width: 24 },
    { key: 'avg_cap_total',       header: 'Total Market — Avg Cap',      format: 'percent_basis_points', width: 22 },
    { key: 'avg_cap_core_10plus', header: '10+ Year Term — Avg Cap',     format: 'percent_basis_points', width: 24 },
  ],
  available_by_term_bucket: [
    { key: 'period_end',         header: 'Quarter End',         format: 'date_short',           width: 13 },
    { key: 'subspecialty',       header: 'Subspecialty',        width: 14 },
    { key: 'term_bucket',        header: 'Term Bucket',         width: 18 },
    { key: 'n_listings',         header: 'N Listings',          format: 'integer_count',        width: 12 },
    { key: 'avg_price',          header: 'Avg Price',           format: 'currency_dollars',     width: 16 },
    { key: 'lower_quartile_cap', header: 'Lower Quartile Cap',  format: 'percent_basis_points', width: 18 },
    { key: 'median_cap',         header: 'Median Cap',          format: 'percent_basis_points', width: 14 },
    { key: 'upper_quartile_cap', header: 'Upper Quartile Cap',  format: 'percent_basis_points', width: 18 },
    { key: 'avg_cap',            header: 'Avg Cap',             format: 'percent_basis_points', width: 12 },
  ],
  asking_cap_quartiles_active: [
    { key: 'period_end',     header: 'Quarter End',                            format: 'date_short',           width: 13 },
    { key: 'subspecialty',   header: 'Subspecialty',                           width: 14 },
    { key: 'upper_q_total',  header: 'Total Market — Upper Quartile',          format: 'percent_basis_points', width: 26 },
    { key: 'lower_q_total',  header: 'Total Market — Lower Quartile',          format: 'percent_basis_points', width: 26 },
    { key: 'upper_q_core',   header: '10+ Year Term — Upper Quartile',         format: 'percent_basis_points', width: 28 },
    { key: 'lower_q_core',   header: '10+ Year Term — Lower Quartile',         format: 'percent_basis_points', width: 28 },
  ],
  dom_price_change_active: [
    { key: 'period_end',              header: 'Quarter End',                         format: 'date_short',           width: 13 },
    { key: 'subspecialty',            header: 'Subspecialty',                        width: 14 },
    { key: 'avg_dom_total',           header: 'Total Market — Avg DOM',              format: 'integer_count',        width: 22 },
    { key: 'avg_dom_core',            header: '10+ Year Term — Avg DOM',             format: 'integer_count',        width: 24 },
    { key: 'pct_price_change_total',  header: 'Total Market — % Price Change',       format: 'percent_zero_decimal', width: 26 },
    { key: 'pct_price_change_core',   header: '10+ Year Term — % Price Change',      format: 'percent_zero_decimal', width: 28 },
  ],
  available_by_tenant: [
    { key: 'period_end',          header: 'Quarter End',         format: 'date_short',           width: 13 },
    { key: 'subspecialty',        header: 'Subspecialty',        width: 14 },
    { key: 'tenant',              header: 'Tenant',              width: 14 },
    { key: 'count_active',        header: 'Count Available',     format: 'integer_count',        width: 14 },
    { key: 'volume_available',    header: 'Volume Available',    format: 'currency_dollars',     width: 18 },
    { key: 'avg_deal_size',       header: 'Avg Deal Size',       format: 'currency_dollars',     width: 16 },
    { key: 'avg_firm_term_years', header: 'Avg Term Remaining',  format: 'years_one_decimal',    width: 18 },
    { key: 'avg_asking_cap',      header: 'Avg Asking Cap',      format: 'percent_basis_points', width: 16 },
    { key: 'avg_dom',             header: 'Avg DOM',             format: 'integer_count',        width: 12 },
  ],

  // Phase 6 — Monthly TTM (dia p.33-35)
  dom_and_pct_of_ask_monthly: [
    { key: 'period_end',       header: 'Month End',           format: 'date_short',           width: 13 },
    { key: 'subspecialty',     header: 'Subspecialty',        width: 14 },
    { key: 'n_sales',          header: 'N Sales (TTM)',       format: 'integer_count',        width: 14 },
    { key: 'avg_dom',          header: 'Avg DOM (days)',      format: 'integer_count',        width: 14 },
    { key: 'pct_of_ask',       header: '% of Ask Price',      format: 'percent_one_decimal',  width: 16 },
  ],
  bid_ask_spread_monthly: [
    { key: 'period_end',         header: 'Month End',           format: 'date_short',           width: 13 },
    { key: 'subspecialty',       header: 'Subspecialty',        width: 14 },
    { key: 'n_with_spread',      header: 'N Sales w/ Spread',   format: 'integer_count',        width: 18 },
    { key: 'avg_bid_ask_spread', header: 'Bid-Ask Spread (bps)',format: 'percent_basis_points', width: 19 },
    { key: 'pct_price_change',   header: '% Price Changes',     format: 'percent_one_decimal',  width: 16 },
    { key: 'avg_last_ask_cap',   header: 'Last Ask Cap',        format: 'percent_basis_points', width: 14 },
  ],
  seller_sentiment_monthly: [
    { key: 'period_end',                  header: 'Month End',           format: 'date_short',           width: 13 },
    { key: 'subspecialty',                header: 'Subspecialty',        width: 14 },
    { key: 'n_all',                       header: 'N (all)',             format: 'integer_count',        width: 10 },
    { key: 'n_long_term',                 header: 'N (8+ Yr)',           format: 'integer_count',        width: 12 },
    { key: 'pct_price_change_all',        header: 'Price Chg % (all)',   format: 'percent_one_decimal',  width: 18 },
    { key: 'pct_price_change_long_term',  header: 'Price Chg % (8+ Yr)', format: 'percent_one_decimal',  width: 20 },
    { key: 'last_ask_cap_all',            header: 'Last Ask Cap (all)',  format: 'percent_basis_points', width: 18 },
    { key: 'last_ask_cap_long_term',      header: 'Last Ask Cap (8+ Yr)',format: 'percent_basis_points', width: 20 },
  ],

  // Lease-rent 5-number summary per quarter (StockChart input)
  rent_psf_box_quarterly: [
    { key: 'period_end',          header: 'Quarter End',         format: 'date_short',       width: 13 },
    { key: 'subspecialty',        header: 'Subspecialty',        width: 14 },
    { key: 'n_leases',            header: 'N Leases',            format: 'integer_count',    width: 12 },
    { key: 'rent_min',            header: 'Min',                 format: 'currency_per_sf',  width: 10 },
    { key: 'rent_lower_quartile', header: 'Lower Quartile',      format: 'currency_per_sf',  width: 16 },
    { key: 'rent_median',         header: 'Median',              format: 'currency_per_sf',  width: 12 },
    { key: 'rent_upper_quartile', header: 'Upper Quartile',      format: 'currency_per_sf',  width: 16 },
    { key: 'rent_max',            header: 'Max',                 format: 'currency_per_sf',  width: 10 },
  ],
};

// Period-summary template — column headers are computed at render time from
// as_of (e.g. "2Q-2024", "1Q-2024"); see summaryColumnHeaders().
const PERIOD_SUMMARY_TEMPLATES = new Set([
  'volume_cap_summary_table',
]);

// Tab name per chart (kept short — Excel limits to 31 chars)
const TAB_NAMES = {
  volume_ttm_by_quarter:        'Data_Volume_TTM',
  quarterly_volume_bars:        'Data_Volume_Quarterly',
  buyer_pool_monthly_count:     'Data_Buyer_Pool_M',
  on_market_snapshot:           'Data_On_Market_Snapshot',
  pace_of_cap_rate_expansion:   'Data_Pace_Cap_Expand',
  // Audit-fix tab names (catalog rows existed; TAB_NAMES were missing):
  top_buyers_table:             'Data_Top_Buyers',
  top_sellers_table:            'Data_Top_Sellers',
  nm_notable_transactions:      'Data_NM_Notable_Txns',
  // Round 5c — gov NM tracking tabs (lifts allow-list deferrals)
  nm_buyer_distribution:        'Data_NM_Buyer_Distrib',
  nm_track_record_buyer_type:   'Data_NM_TR_BuyerType',
  available_by_tenant_count_donut:  'Data_Avail_Tenant_CountD',
  available_by_tenant_volume_donut: 'Data_Avail_Tenant_VolD',
  available_by_term_summary:        'Data_Avail_by_Term_Summary',
  transaction_count_ttm:        'Data_Txn_Count',
  cap_rate_ttm_by_quarter:      'Data_Cap_Avg',
  cap_rate_top_bottom_quartile: 'Data_Cap_Quartile',
  avg_deal_size:                'Data_Avg_Deal',
  nm_vs_market_cap:             'Data_NM_vs_Market',
  cap_rate_by_lease_term:       'Data_Cap_by_Term',
  cap_rate_by_credit:           'Data_Cap_by_Credit',
  // Phase 2b additions
  yoy_volume_change:            'Data_YoY_Change',
  buyer_class_pct_by_year:      'Data_Buyer_Pool',
  // Round 18 — 3 new charts (one applies to both verticals, one is gov-only)
  core_cap_rate_dot_plot:           'Data_Core_Cap_Dot',
  available_cap_rate_dot_plot:      'Data_Avail_Cap_Dot',
  available_by_firm_term_summary:   'Data_Avail_by_Firm_Term',
  // Round 28 — Cap Rate Comparison by Lease Term Remaining (closed sales)
  sold_cap_by_term_dot_plot:        'Data_Sold_Cap_by_Term',
  // Round 31 — Asking Cap Rate Ranges by Lease Term Buckets (active listings, dia)
  asking_cap_by_term_dot_plot:      'Data_Ask_Cap_by_Term',
  // Round 19 — market-activity charts (both verticals)
  market_turnover:                  'Data_Market_Turnover',
  inventory_backlog:                'Data_Inventory_Backlog',
  // Round 20 — PDF-parity combos
  txn_count_avg_deal_combo:         'Data_Txn_AvgDeal_Combo',
  rent_and_price_psf:               'Data_Rent_Price_PSF',
  // Round 31 — Dia counterpart (per-chair unit econ).
  rent_and_price_per_chair:         'Data_Rent_Price_Chair',
  dom_and_pct_of_ask:           'Data_DOM_Ask',
  bid_ask_spread:               'Data_Bid_Ask',
  // Phase 2c additions
  fed_funds_vs_treasury:        'Data_FF_vs_10Y',
  cost_of_capital:              'Data_Cost_Capital',
  net_lease_spread:             'Data_NL_Spread',
  // Phase 2c.2 additions
  cash_leveraged_returns:       'Data_Returns_Idx',
  seller_sentiment:             'Data_Sentiment',
  sources_of_capital:           'Data_Sources',
  // Phase 2c.3 — headline index
  valuation_index:              'Data_Val_Index',
  // Phase 2c.4 — Section 2 Leasing Trends
  leased_inventory_by_state:    'Data_Inventory_State',
  leasing_summary:              'Data_Leasing_Summary',
  lease_structures:             'Data_Lease_Terms',
  lease_renewal_rate:           'Data_Renewal_Rate',
  lease_termination_rate:       'Data_Term_Rate',
  rent_by_year_built:           'Data_Rent_Year_Built',
  case_for_renewal:             'Data_Case_Renewal',
  renewal_rent_growth:          'Data_Renewal_Growth',
  cpi_vs_renewal_cagr:          'Data_CPI_CAGR',
  rent_heat_map:                'Data_Rent_Heat_Map',
  // Parity-1 — period summary tables (replaces the manual 7-column tables
  // in the master "All Charts" tab next to each chart)
  volume_cap_summary_table:     'Summary_Vol_Cap',
  // Parity-1 — front-cover combo (Volume + Cap + Quartile band)
  volume_cap_quartile_combo:    'Data_Vol_Cap_Combo',
  // Tier 4 — KPI tile blocks
  value_proposition_results:    'KPI_Value_Prop',
  whatsnew_quarter_kpis:        'KPI_Whats_New',
  // Phase 5 — Inventory Analysis (dia p.29-35)
  inventory_snapshot_kpis:      'KPI_Inv_Snapshot',
  available_market_size_combo:  'Data_Avail_Mkt_Size',
  available_by_term_bucket:     'Data_Avail_by_Term',
  asking_cap_quartiles_active:  'Data_Active_Cap_Quart',
  dom_price_change_active:      'Data_Active_DOM_PC',
  available_by_tenant:          'Data_Avail_by_Tenant',
  // Phase 6 — Monthly TTM (dia p.33-35; dialysis-only cadence)
  dom_and_pct_of_ask_monthly:   'Data_DOM_Ask_M',
  bid_ask_spread_monthly:       'Data_Bid_Ask_M',
  seller_sentiment_monthly:     'Data_Sentiment_M',
  // Lease-rent distribution (StockChart-style 5-number summary per quarter)
  rent_psf_box_quarterly:       'Data_Rent_PSF_Box',
};

// ============================================================================
// Master Paste-Ready layout (gov vertical)
//
// Mirrors the column order of "All Charts" tab in Copy Government Master
// Document.xlsx. Marketing pastes this entire range into the master's All
// Charts tab at row 5; the master's existing chart objects auto-update via
// their pre-wired range references.
//
// Source columns from the gov master "All Charts" tab (row 2 headers):
//   B=Quarter | C=Date | D=Transactions(ttm) | E=Avg Deal Size |
//   F=Monthly Vol | G=Trans.Vol | H=Trans.Vol(ttm) | I=YoY Change |
//   J=Upper Quartile Cap | K=Lower Quartile Cap | L=Avg Cap(ttm) |
//   M=NM Avg Cap(ttm) | N=Non-NM Avg Cap | O=10+ Year Cap |
//   P=6-10 Year Cap | Q=<5 Year Cap | R=Outside Firm |
//   S=Private Vol | T=Public/REIT | U=Cross-Border | V=Institutional |
//   W=Federal Cap | X=State Cap | Y=Municipal Cap
//
// We pull these from cm_gov_market_quarterly directly (since it's the
// master view that has every column we need).
// ============================================================================
// ============================================================================
// Master Paste-Ready layout (dialysis vertical)
//
// Mirrors cm_dialysis_market_quarterly_master column order for the dialysis
// master XLSX's data tabs. Marketing pastes the data into the dialysis
// master (assets/cm-templates/dialysis-master-template.xlsx) to refresh the
// 37 chart objects pre-wired to these column slots.
//
// Column-order parity with gov's layout where the metric applies. Dialysis-
// specific tweaks: cross_border_* are emitted as NULL (kept for layout
// parity); avg_dom / pct_of_ask / avg_bid_ask_spread / pct_price_change are
// appended at the end (gov master doesn't have those slots — they're
// pulled from per-metric views in the gov tab).
// ============================================================================
const DIA_MASTER_PASTE_LAYOUT = [
  { key: 'fiscal_quarter',        header: 'Quarter',                  width: 10 },
  { key: 'period_end',            header: 'Date',                     format: 'date_short',           width: 12 },
  { key: 'transaction_count',     header: 'Transactions (Quarterly)', format: 'integer_count',        width: 18 },
  { key: 'avg_deal_size',         header: 'Average Deal Size',        format: 'currency_dollars',     width: 18 },
  { key: 'quarterly_volume',      header: 'Monthly Volume',           format: 'currency_dollars',     width: 18 },
  { key: 'quarterly_volume',      header: 'Transaction Volume',       format: 'currency_dollars',     width: 18 },
  { key: 'ttm_volume',            header: 'Trans. Vol. (ttm)',        format: 'currency_dollars',     width: 18 },
  { key: 'yoy_change_pct',        header: 'YoY Change (%)',           format: 'percent_one_decimal',  width: 14 },
  { key: 'upper_quartile_cap',    header: 'Upper Quartile Cap',       format: 'percent_basis_points', width: 18 },
  { key: 'lower_quartile_cap',    header: 'Lower Quartile Cap',       format: 'percent_basis_points', width: 18 },
  { key: 'avg_cap_rate',          header: 'Average Cap Rate (ttm)',   format: 'percent_basis_points', width: 18 },
  { key: 'nm_avg_cap',            header: 'NM Average Cap (ttm)',     format: 'percent_basis_points', width: 18 },
  { key: 'non_nm_avg_cap',        header: 'Non-NM Average Cap',       format: 'percent_basis_points', width: 18 },
  { key: 'cap_10plus_year',       header: '10+ Year Cap (ttm)',       format: 'percent_basis_points', width: 18 },
  { key: 'cap_6to10_year',        header: '6 to 10 Year Cap (ttm)',   format: 'percent_basis_points', width: 20 },
  { key: 'cap_less5_year',        header: 'Less than 5 Year Cap',     format: 'percent_basis_points', width: 20 },
  { key: 'cap_outside_firm',      header: 'Outside Firm Term',        format: 'percent_basis_points', width: 18 },
  { key: 'private_volume',        header: 'Private Volume (ttm)',     format: 'currency_dollars',     width: 20 },
  { key: 'reit_volume',           header: 'Public Listed/REIT',       format: 'currency_dollars',     width: 20 },
  { key: 'cross_border_volume',   header: 'Cross-Border Volume',      format: 'currency_dollars',     width: 20 },
  { key: 'institutional_volume',  header: 'Institutional Volume',     format: 'currency_dollars',     width: 20 },
  // Trade-execution metrics (dialysis-specific tail; gov master doesn't
  // have these column slots — gov reads them from per-metric views).
  { key: 'avg_dom',               header: 'Avg DOM (days)',           format: 'integer_count',        width: 14 },
  { key: 'pct_of_ask',            header: '% of Ask Price',           format: 'percent_one_decimal',  width: 16 },
  { key: 'avg_bid_ask_spread',    header: 'Bid-Ask Spread (bps)',     format: 'percent_basis_points', width: 19 },
  { key: 'pct_price_change',      header: '% Price Changes',          format: 'percent_one_decimal',  width: 18 },
];

const GOV_MASTER_PASTE_LAYOUT = [
  { key: 'fiscal_quarter',      header: 'Quarter',                width: 10 },
  { key: 'period_end',          header: 'Date',                   format: 'date_short',          width: 12 },
  { key: 'transaction_count',   header: 'Transactions (Quarterly)', format: 'integer_count',     width: 18 },
  { key: 'avg_deal_size',       header: 'Average Deal Size',      format: 'currency_dollars',    width: 18 },
  { key: 'quarterly_volume',    header: 'Monthly Volume',         format: 'currency_dollars',    width: 18 },
  { key: 'quarterly_volume',    header: 'Transaction Volume',     format: 'currency_dollars',    width: 18 },
  { key: 'ttm_volume',          header: 'Trans. Vol. (ttm)',      format: 'currency_dollars',    width: 18 },
  { key: 'yoy_change_pct',      header: 'YoY Change (%)',         format: 'percent_one_decimal', width: 14 },
  { key: 'upper_quartile_cap',  header: 'Upper Quartile Cap',     format: 'percent_basis_points', width: 18 },
  { key: 'lower_quartile_cap',  header: 'Lower Quartile Cap',     format: 'percent_basis_points', width: 18 },
  { key: 'avg_cap_rate',        header: 'Average Cap Rate (ttm)', format: 'percent_basis_points', width: 18 },
  { key: 'nm_avg_cap',          header: 'NM Average Cap (ttm)',   format: 'percent_basis_points', width: 18 },
  { key: 'non_nm_avg_cap',      header: 'Non-NM Average Cap',     format: 'percent_basis_points', width: 18 },
  { key: 'cap_10plus_year',     header: '10+ Year Cap (ttm)',     format: 'percent_basis_points', width: 18 },
  { key: 'cap_6to10_year',      header: '6 to 10 Year Cap (ttm)', format: 'percent_basis_points', width: 20 },
  { key: 'cap_less5_year',      header: 'Less than 5 Year Cap',   format: 'percent_basis_points', width: 20 },
  { key: 'cap_outside_firm',    header: 'Outside Firm Term',      format: 'percent_basis_points', width: 18 },
  { key: 'private_volume',      header: 'Private Volume (ttm)',   format: 'currency_dollars',    width: 20 },
  { key: 'reit_volume',         header: 'Public Listed/REIT',     format: 'currency_dollars',    width: 20 },
  { key: 'cross_border_volume', header: 'Cross-Border Volume',    format: 'currency_dollars',    width: 20 },
  { key: 'institutional_volume',header: 'Institutional Volume',   format: 'currency_dollars',    width: 20 },
  { key: 'federal_cap',         header: 'Federal Cap',            format: 'percent_basis_points', width: 14 },
  { key: 'state_cap',           header: 'State Cap',              format: 'percent_basis_points', width: 14 },
  { key: 'municipal_cap',       header: 'Municipal Cap',          format: 'percent_basis_points', width: 16 },
];

// ============================================================================
// Workbook builder
// ============================================================================

// R56 — per-vertical name overrides. The catalog's `name` field is shared
// across verticals (one catalog row → multiple verticals), but a few
// charts want vertical-specific phrasing (e.g. "Firm Term" is a gov-only
// concept; dialysis says just "Lease Term"). Apply override at chart-loop
// time so it flows into tab title + index row + chart <c:title> + page
// header consistently.
const NAME_OVERRIDES_BY_VERTICAL = {
  dialysis: {
    // User notes 2026-05-22: "Firm term label in the dialysis chart title,
    // should just be lease term — firm term is for government only"
    available_cap_rate_dot_plot: 'Available Deals — Asking Cap vs Lease Term',
  },
  gov: {},
};

export function buildCapitalMarketsWorkbook({ vertical, subspecialty, asOf, charts, brand, masterRows, chartImages }) {
  const palette = (brand?.palette) ? brand.palette : DEFAULT_BRAND.palette;
  const fonts   = (brand?.fonts)   ? brand.fonts   : DEFAULT_BRAND.fonts;
  // R56 — patch chart.name based on per-vertical overrides ONCE up front.
  // chart.name is read in many places (tab title, page header, chart
  // <c:title>, index row); patching the source avoids per-callsite plumbing.
  const verticalOverrides = NAME_OVERRIDES_BY_VERTICAL[vertical] || {};
  if (Array.isArray(charts)) {
    for (const c of charts) {
      const override = verticalOverrides[c.chart_template_id];
      if (override) c.name = override;
    }
  }

  // Lookup chartImages by chart_template_id for per-tab embedding.
  // chartImages is the array returned by renderChartsToImages(), where each
  // entry is { chart_template_id, name, png: Buffer }. When present, each
  // Data_* tab gets the matching PNG anchored at the top.
  // R34 — chart_template_ids in NATIVE_CHART_TEMPLATES are migrated to
  // native (editable) Excel charts. Skip the PNG embed for those; the
  // export endpoint post-processes the workbook buffer with
  // injectNativeCharts() using the specs we collect in nativeInjections
  // below.
  const chartImagesById = new Map();
  if (Array.isArray(chartImages)) {
    for (const ci of chartImages) {
      if (ci?.chart_template_id && ci?.png && !NATIVE_CHART_TEMPLATES.has(ci.chart_template_id)) {
        chartImagesById.set(ci.chart_template_id, ci.png);
      }
    }
  }

  // Specs returned alongside the workbook so the export endpoint can
  // inject native chart XML for migrated chart_template_ids. Each entry
  // is { tabName, spec } per the injectNativeCharts() contract.
  const nativeInjections = [];

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Northmarq Capital Markets — LCC';
  wb.lastModifiedBy = 'LCC';
  wb.created = new Date();
  wb.modified = new Date();
  wb.properties = { date1904: false };

  // ----------------------------------------------------------------
  // Cover sheet
  // ----------------------------------------------------------------
  const cover = wb.addWorksheet('Cover', {
    views: [{ showGridLines: false }],
  });
  cover.getColumn(1).width = 4;
  cover.getColumn(2).width = 80;

  const verticalLabel = vertical === 'gov' ? 'Government-Leased'
                      : vertical === 'dialysis' ? 'Dialysis'
                      : vertical === 'national_st' ? 'National Single-Tenant'
                      : vertical;

  // Title bar
  cover.getCell('B2').value = 'Capital Markets — ' + verticalLabel;
  cover.getCell('B2').font = { name: fonts.title_family, size: 24, bold: true, color: { argb: 'FF' + hex(palette.nm_navy) } };
  cover.getRow(2).height = 36;

  cover.getCell('B3').value = subspecialty && subspecialty !== 'all'
    ? `Subspecialty filter: ${subspecialty.toUpperCase()}`
    : 'All segments';
  cover.getCell('B3').font = { name: fonts.body_family, size: 11, italic: true, color: { argb: 'FF' + hex(palette.nm_axis) } };

  cover.getCell('B5').value = `As of: ${asOf || '(latest available)'}`;
  cover.getCell('B5').font = { name: fonts.body_family, size: 11, color: { argb: 'FF' + hex(palette.nm_text) } };

  cover.getCell('B6').value = `Generated: ${new Date().toISOString().slice(0, 10)} by Life Command Center`;
  cover.getCell('B6').font = { name: fonts.body_family, size: 10, color: { argb: 'FF' + hex(palette.nm_text_muted) } };

  cover.getCell('B8').value = 'Data Source';
  cover.getCell('B8').font = { name: fonts.title_family, size: 14, bold: true, color: { argb: 'FF' + hex(palette.nm_navy) } };

  cover.getCell('B9').value = 'Live-computed from public.sales_transactions on the Government Supabase, filtered to closed sales (sold_price > 0). Cap rate aggregates use N≥3 quarter guard for representative stats; NM/non-NM attribution stats use N≥1.';
  cover.getCell('B9').font = { name: fonts.body_family, size: 10, color: { argb: 'FF' + hex(palette.nm_text) } };
  cover.getCell('B9').alignment = { wrapText: true, vertical: 'top' };
  cover.getRow(9).height = 48;

  cover.getCell('B11').value = 'Northmarq Attribution Rules';
  cover.getCell('B11').font = { name: fonts.title_family, size: 14, bold: true, color: { argb: 'FF' + hex(palette.nm_navy) } };

  cover.getCell('B12').value = 'is_northmarq = listing_broker matches Northmarq, NorthMarq, SJC (any era), or Briggs/Stan Johnson (legacy era 2002–2024). Patterns editable via cm_nm_broker_patterns.';
  cover.getCell('B12').font = { name: fonts.body_family, size: 10, color: { argb: 'FF' + hex(palette.nm_text) } };
  cover.getCell('B12').alignment = { wrapText: true, vertical: 'top' };
  cover.getRow(12).height = 30;

  cover.getCell('B14').value = 'Marketing Workflow — Quarterly Refresh in 30 seconds';
  cover.getCell('B14').font = { name: fonts.title_family, size: 14, bold: true, color: { argb: 'FF' + hex(palette.nm_navy) } };

  cover.getCell('B15').value = vertical === 'dialysis'
    ? '1. Open the "MasterPasteReady" tab in this workbook.\n' +
      '2. Click cell A3, then Ctrl+Shift+End to select the entire data range.\n' +
      '3. Ctrl+C to copy.\n' +
      '4. Open your dialysis master Excel file.\n' +
      '5. Go to your master\'s charts data tab and paste at the first data row.\n' +
      '6. The 37 chart objects pre-wired to those column slots will auto-refresh.\n' +
      '7. Save the master and send to marketing.\n\n' +
      'Column shape matches gov master where the metric applies; dialysis-specific tail (DOM, % of ask, bid-ask, price-change %) is appended at the right.\n\n' +
      'Re-run this export from LCC any time to regenerate. The Data_* tabs in this workbook are also useful for sanity-checking individual chart data before pasting.'
    : '1. Open the "MasterPasteReady" tab in this workbook.\n' +
      '2. Click cell A3, then Ctrl+Shift+End to select the entire data range.\n' +
      '3. Ctrl+C to copy.\n' +
      '4. Open your master Excel file (Copy Government Master Document.xlsx).\n' +
      '5. Go to the "All Charts" tab, click cell B3, then Ctrl+V to paste.\n' +
      '6. All 18 charts on the master\'s All Charts tab + 10 charts on SSA Charts auto-update.\n' +
      '7. Save the master and send to marketing.\n\n' +
      'Re-run this export from LCC any time to regenerate. The Data_* tabs in this workbook are also useful for sanity-checking individual chart data before pasting.';
  cover.getCell('B15').font = { name: fonts.body_family, size: 10, color: { argb: 'FF' + hex(palette.nm_text) } };
  cover.getCell('B15').alignment = { wrapText: true, vertical: 'top' };
  cover.getRow(15).height = 130;

  // ----------------------------------------------------------------
  // Index sheet
  // ----------------------------------------------------------------
  const idx = wb.addWorksheet('Index', { views: [{ showGridLines: false }] });
  idx.getColumn(1).width = 4;
  idx.getColumn(2).width = 36;
  idx.getColumn(3).width = 28;
  idx.getColumn(4).width = 22;
  idx.getColumn(5).width = 12;

  idx.getCell('B2').value = 'Chart Index';
  idx.getCell('B2').font = { name: fonts.title_family, size: 18, bold: true, color: { argb: 'FF' + hex(palette.nm_navy) } };
  idx.getRow(2).height = 26;

  // Header row
  const idxHeader = idx.getRow(4);
  ['', 'Chart', 'Data Tab', 'Type', 'Rows'].forEach((h, i) => {
    idxHeader.getCell(i + 1).value = h;
  });
  idxHeader.font = { name: fonts.title_family, size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  idxHeader.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + hex(palette.nm_navy) } };
    c.alignment = { vertical: 'middle' };
  });
  idxHeader.height = 22;

  let idxRow = 5;
  for (const chart of charts) {
    const tabName = TAB_NAMES[chart.chart_template_id];
    if (!tabName) continue;
    const r = idx.getRow(idxRow);
    r.getCell(2).value = chart.name;
    r.getCell(3).value = {
      text: tabName,
      hyperlink: `#'${tabName}'!A1`,
    };
    r.getCell(3).font = { name: fonts.body_family, size: 10, color: { argb: 'FF' + hex(palette.nm_navy) }, underline: true };
    r.getCell(4).value = chart.chart_type || '';
    r.getCell(5).value = (chart.rows || []).length;
    r.getCell(5).numFmt = FMT.integer_count;
    r.getCell(2).font = { name: fonts.body_family, size: 10 };
    r.getCell(4).font = { name: fonts.body_family, size: 10, color: { argb: 'FF' + hex(palette.nm_axis) } };
    r.getCell(5).font = { name: fonts.body_family, size: 10 };
    if (idxRow % 2 === 0) {
      [2, 3, 4, 5].forEach((c) => {
        r.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + hex(palette.nm_pale) } };
      });
    }
    idxRow++;
  }

  // ----------------------------------------------------------------
  // Per-chart data tabs
  // ----------------------------------------------------------------
  for (const chart of charts) {
    const tabName = TAB_NAMES[chart.chart_template_id];

    // Period-summary tables have a different shape (rows = metrics,
    // columns = current Q + prior Q + YoY Q + prior cycle + 5/10/15-yr avg).
    // Render via dedicated helper.
    if (PERIOD_SUMMARY_TEMPLATES.has(chart.chart_template_id)) {
      if (!tabName) continue;
      renderPeriodSummaryTab({
        wb, tabName, chart, palette, fonts, asOf, subspecialty,
      });
      continue;
    }

    // Round 4a — On-Market Snapshot (PDF dialysis p.29). Two side-by-side
    // cohort tables ("Total Market" | "10+ Year Term") with arrow indicators
    // showing current vs prior-year change. No chart image; pure layout.
    if (chart.chart_template_id === 'on_market_snapshot') {
      if (!tabName) continue;
      renderOnMarketSnapshotTab({
        wb, tabName, chart, palette, fonts, asOf, subspecialty,
      });
      continue;
    }

    // Round 9 — Lease_Terms (PDF gov p.27). User: "Data_Lease_Terms
    // should be a table that shows the most recent quarter in one
    // column, the last 12 months in the next, and last five years in
    // the final column." 3-column wide-format comparison.
    if (chart.chart_template_id === 'lease_structures') {
      if (!tabName) continue;
      renderLeaseStructuresTab({
        wb, tabName, chart, palette, fonts, subspecialty,
      });
      continue;
    }

    // KPI tile blocks render as a small 1-row-per-tile table (label, primary,
    // primary_format, NM split, Non-NM split) for the latest period.
    if (chart.chart_type === 'kpi_block') {
      if (!tabName) continue;
      renderKpiBlockTab({
        wb, tabName, chart, palette, fonts, asOf, subspecialty,
      });
      continue;
    }

    const cols    = CHART_COLUMNS[chart.chart_template_id];
    if (!tabName || !cols) continue;

    // Per-tab layout when chart image is available:
    //   Rows 1-22: chart PNG (~440px tall at default row height)
    //   Row 23:    caption strip (only when chart image present)
    //   Row 24:    title block
    //   Row 25:    subtitle (metric_focus · chart_type · subspecialty)
    //   Row 26:    meta (N rows · view name)
    //   Row 27+:   inline summary block (Round 3d, only for selected charts)
    //   Row N:     header row
    //   Row N+1+:  data rows
    // When no chart image is available, the tab uses the legacy layout
    // (title at row 1, header at row 4, data at row 5).
    const png = chartImagesById.get(chart.chart_template_id);
    const titleRow  = png ? 24 : 1;
    const subRow    = titleRow + 1;
    const metaRow   = titleRow + 2;

    // Round 3d — compute the inline summary block for this chart (when
    // configured). Block is { rows: [...], height: N } where N is the
    // number of Excel rows the block consumes (1 header + 1 column-header
    // + len(metrics) metric rows + 1 spacer = len + 3).
    // Round 6b — vertical-aware so dialysis cohorts (12+/8-12/6-8/≤5) and
    // gov cohorts (10+/6-10/<5/outside) don't render side by side with
    // half the rows blank ("jumbled mess" — user feedback 2026-05-09).
    const summaryMetrics = getInlineSummaryMetrics(chart.chart_template_id, vertical);
    let summaryRows = [];
    if (summaryMetrics && Array.isArray(chart.rows) && chart.rows.length > 0) {
      try {
        summaryRows = buildInlineSummary({
          rows: chart.rows,
          metrics: summaryMetrics,
          asOf: null,  // resolve from data
        });
      } catch (e) {
        console.warn(`[cm-excel-export] inline-summary failed for ${chart.chart_template_id}: ${e?.message || e}`);
        summaryRows = [];
      }
    }
    const summaryRowCount = summaryRows.length > 0 ? (summaryRows.length + 3) : 0;

    const headerRow_n = png ? (27 + summaryRowCount) : 4;
    const dataStart = headerRow_n + 1;

    const sheet = wb.addWorksheet(tabName, {
      views: [{ showGridLines: false, state: 'frozen', ySplit: headerRow_n }],
    });
    // R42 hotfix — R41 set tabColor via addWorksheet options, which ExcelJS
    // silently drops (verified: pre-R41 MasterPasteReady was already using
    // this broken pattern; output XML had no <tabColor/> element on any of
    // the 40+ Data_* tabs). Correct API is `sheet.properties.tabColor`
    // set AFTER worksheet creation.
    if (tabName.startsWith('Data_')) {
      sheet.properties.tabColor = { argb: 'FF' + hex(palette.nm_navy) };
    }

    // Embed chart image at the top, anchored at A1, sized to span the
    // first ~22 rows. Image is 900x440 pixels which lands cleanly in a
    // standard 14-column workbook view.
    if (png) {
      try {
        const imageId = wb.addImage({ buffer: png, extension: 'png' });
        sheet.addImage(imageId, {
          tl: { col: 0, row: 0 },           // 0-indexed, anchors at A1
          ext: { width: 900, height: 440 },
        });
      } catch (e) {
        console.warn(`[cm-excel-export] addImage failed for ${chart.chart_template_id}: ${e?.message || e}`);
      }

      // Footer caption strip — pale blue full-width bar with italic
      // summary text in row 23 (between the chart image and the title).
      // Mirrors the PDF tagline boxes at the bottom of each chart page.
      const captionText = CHART_FOOTER_CAPTIONS[chart.chart_template_id];
      if (captionText) {
        const captionRow = 23;
        const lastCol = 14;  // span A:N (14 columns)
        sheet.mergeCells(captionRow, 1, captionRow, lastCol);
        const captionCell = sheet.getCell(`A${captionRow}`);
        captionCell.value = captionText;
        captionCell.font = {
          name: fonts.body_family, size: 10, italic: true,
          color: { argb: 'FF' + hex(palette.nm_navy) },
        };
        captionCell.fill = {
          type: 'pattern', pattern: 'solid',
          fgColor: { argb: 'FF' + hex(palette.nm_pale) },
        };
        captionCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
        sheet.getRow(captionRow).height = 28;
      }
    }

    // Title block (placement depends on whether chart image is present)
    sheet.getCell(`A${titleRow}`).value = chart.name;
    sheet.getCell(`A${titleRow}`).font = { name: fonts.title_family, size: 14, bold: true, color: { argb: 'FF' + hex(palette.nm_navy) } };
    sheet.getRow(titleRow).height = 22;

    sheet.getCell(`A${subRow}`).value = `${chart.metric_focus || ''} · ${chart.chart_type || ''} · subspecialty=${subspecialty}`;
    sheet.getCell(`A${subRow}`).font = { name: fonts.body_family, size: 9, italic: true, color: { argb: 'FF' + hex(palette.nm_text_muted) } };

    sheet.getCell(`A${metaRow}`).value = `${(chart.rows || []).length} rows · view=${chart.view_name || ''}`;
    sheet.getCell(`A${metaRow}`).font = { name: fonts.body_family, size: 9, color: { argb: 'FF' + hex(palette.nm_text_muted) } };

    // Round 3d — Inline summary block. Renders metric × period averages
    // between the meta row and the data header. Skipped when no summary
    // metrics are configured for this chart, or when computation returned
    // an empty array.
    if (summaryRows.length > 0 && png) {
      const summaryStart = metaRow + 1;
      // Title sub-header for the block
      sheet.getCell(`A${summaryStart}`).value = 'Period Summary';
      sheet.getCell(`A${summaryStart}`).font = {
        name: fonts.title_family, size: 11, bold: true,
        color: { argb: 'FF' + hex(palette.nm_navy) },
      };
      sheet.getRow(summaryStart).height = 18;

      // Column headers — Metric + 7 period columns. Resolve dynamic
      // headers (e.g. "2Q-2024" instead of "Current Q") via summaryColumnHeaders.
      const resolvedAsOf = summaryRows[0]?.as_of || null;
      const periodHeaders = summaryColumnHeaders(resolvedAsOf);
      const headers = ['Metric', ...periodHeaders];
      const summaryHeaderRow = summaryStart + 1;
      headers.forEach((h, i) => {
        const cell = sheet.getCell(summaryHeaderRow, i + 1);
        cell.value = h;
        cell.font = { name: fonts.title_family, size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + hex(palette.nm_navy) } };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      });
      sheet.getRow(summaryHeaderRow).height = 16;

      // Metric rows
      summaryRows.forEach((sRow, rIdx) => {
        const exRow = summaryHeaderRow + 1 + rIdx;
        const metricCell = sheet.getCell(exRow, 1);
        metricCell.value = sRow.metric;
        metricCell.font = { name: fonts.body_family, size: 9, bold: true, color: { argb: 'FF' + hex(palette.nm_navy) } };
        metricCell.alignment = { vertical: 'middle', horizontal: 'left' };

        const periodVals = [
          sRow.current_q, sRow.prior_q, sRow.yoy_q, sRow.prior_cycle_q,
          sRow.avg_5yr,   sRow.avg_10yr, sRow.avg_15yr,
        ];
        periodVals.forEach((v, i) => {
          const cell = sheet.getCell(exRow, i + 2);
          cell.value = v;
          if (sRow.format && FMT[sRow.format]) cell.numFmt = FMT[sRow.format];
          cell.font = { name: fonts.body_family, size: 9, color: { argb: 'FF' + hex(palette.nm_text || '333333') } };
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          // Alternating row banding for readability
          if (rIdx % 2 === 0) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + hex(palette.nm_pale) } };
          }
        });
      });
    }

    // Header row
    const headerRow = sheet.getRow(headerRow_n);
    cols.forEach((c, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = c.header;
      cell.font = { name: fonts.title_family, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + hex(palette.nm_navy) } };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
      cell.border = { bottom: { style: 'medium', color: { argb: 'FF' + hex(palette.nm_navy) } } };
    });
    headerRow.height = 22;

    // Set column widths + number formats
    cols.forEach((c, i) => {
      const col = sheet.getColumn(i + 1);
      col.width = c.width || 14;
      if (c.format && FMT[c.format]) col.numFmt = FMT[c.format];
    });

    // Data rows starting just below the header
    let dataRowIdx = dataStart;
    // R43 — track non-null counts per column so we can hide columns
    // that are 100% empty after writing (e.g. cross-schema cohort
    // ghosts where dia's data tab carries gov's cohort columns and
    // vice versa, all empty). Hiding (vs deleting) preserves column
    // letters so native chart XML refs like `'Data_X'!$D$5:$D$300`
    // continue to resolve correctly.
    const colHasValue = new Array(cols.length).fill(false);
    for (const row of chart.rows || []) {
      const r = sheet.getRow(dataRowIdx);
      cols.forEach((c, i) => {
        // Round 22 — support optional `fieldKeys` coalesce list on
        // CHART_COLUMNS entries (mirrors the period-summary block
        // pattern). Falls back to the primary `key` if fieldKeys
        // isn't set. Used so e.g. `valuation_index.yoy_change` can
        // read from gov's `yoy_change` OR dialysis's `yoy_change_pct`.
        let v = row[c.key];
        if (v == null && Array.isArray(c.fieldKeys)) {
          for (const fk of c.fieldKeys) {
            if (row[fk] != null) { v = row[fk]; break; }
          }
        }
        if (c.format === 'date_short' && typeof v === 'string') {
          // Convert ISO date string to Date object for proper Excel date type
          const d = new Date(v);
          if (!isNaN(d.getTime())) v = d;
        }
        const cell = r.getCell(i + 1);
        cell.value = v == null ? null : v;
        if (v != null) colHasValue[i] = true;
        cell.font = { name: fonts.body_family, size: 10, color: { argb: 'FF' + hex(palette.nm_text) } };
        if (c.format && FMT[c.format]) cell.numFmt = FMT[c.format];
      });

      // Zebra-stripe odd rows for readability
      if (dataRowIdx % 2 === 1) {
        cols.forEach((_, i) => {
          r.getCell(i + 1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF' + hex(palette.nm_pale) },
          };
        });
      }
      dataRowIdx++;
    }

    // R43 — hide columns that ended up 100% empty across all rows.
    // Skip the first two anchor columns (period_end / subspecialty)
    // and any column explicitly marked `keepIfEmpty: true` in the
    // CHART_COLUMNS entry (none currently, but the escape hatch is
    // there for future schema-stable cases). Chart XML references
    // use column letters which stay intact under `hidden=true`.
    if ((chart.rows || []).length > 0) {
      cols.forEach((c, i) => {
        if (i < 2) return;                  // never hide period_end / subspecialty
        if (c.keepIfEmpty) return;          // explicit opt-out
        if (colHasValue[i]) return;         // has data
        sheet.getColumn(i + 1).hidden = true;
      });
    }

    // R34 — Collect a native-chart injection spec for migrated templates.
    // The endpoint post-processes the workbook buffer with
    // injectNativeCharts() to swap the PNG for a real Excel chart object
    // anchored at the same location.
    let totalColsForAutoFilter = cols.length;
    if (NATIVE_CHART_TEMPLATES.has(chart.chart_template_id)) {
      const colsWithLetter = cols.map((c, i) => ({
        ...c,
        col: String.fromCharCode(65 + i),  // 0→'A', 1→'B', ...
      }));
      const spec = buildInjectionSpec({
        chart_template_id: chart.chart_template_id,
        tabName,
        cols: colsWithLetter,
        dataStart,
        dataEnd: dataRowIdx - 1,
        brand,
        // R34 P5 — pass actual data rows so cohort templates
        // (cap_rate_by_lease_term, *_cap_by_term_dot_plot) can sniff
        // dia vs gov cohorts the same way the renderer does.
        rows: chart.rows || [],
        // R38 — pass the catalog name through so each chart gets a
        // visible <c:title> matching the master Excel docs (audit
        // finding A: "no titles on any export chart").
        title: chart.name,
        // R53 — opt into the buildInjectionSpec wrapper that emits a
        // `period_label` string helper col + repoints date cat axes
        // at it. Fixes the broken "qQ-yyyy" literal labels affecting
        // 29/34 charts (R37 P1's `q"Q-"yyyy` numFmt isn't valid Excel —
        // there's no `q` token for quarter in the date-format grammar).
        // Production exports always opt in; unit tests don't (so they
        // continue to see the unwrapped pre-R53 spec shape).
        injectPeriodLabel: true,
      });
      if (spec) {
        nativeInjections.push(spec);

        // R34 P8.5 — write declarative helper columns. Templates that
        // need derived data (e.g. IQR width = upper_q − lower_q for
        // box-whisker; rolling-avg trendlines for scatter dot plots)
        // declare them via spec.helperCols and reference the helper
        // column letters in their spec. We write them here as plain
        // values (computed from row data), in additional columns to
        // the right of the regular CHART_COLUMNS entries.
        const helpers = Array.isArray(spec.helperCols) ? spec.helperCols : [];
        if (helpers.length > 0) {
          // Write helper column headers — same styling as regular headers
          helpers.forEach((h, hi) => {
            const colIdx = cols.length + hi + 1;
            const hCell = sheet.getRow(headerRow_n).getCell(colIdx);
            hCell.value = h.header || h.key;
            hCell.font = { name: fonts.title_family, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
            hCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + hex(palette.nm_navy) } };
            hCell.alignment = { vertical: 'middle', horizontal: 'left' };
            hCell.border = { bottom: { style: 'medium', color: { argb: 'FF' + hex(palette.nm_navy) } } };
            // Column width + format
            const col = sheet.getColumn(colIdx);
            col.width = h.width || 14;
            if (h.format && FMT[h.format]) col.numFmt = FMT[h.format];
          });

          // Write helper values for each data row by calling getValue(row, idx, rows)
          (chart.rows || []).forEach((row, rIdx) => {
            const xlsxRowIdx = dataStart + rIdx;
            const r = sheet.getRow(xlsxRowIdx);
            helpers.forEach((h, hi) => {
              const colIdx = cols.length + hi + 1;
              let v;
              try {
                v = h.getValue ? h.getValue(row, rIdx, chart.rows) : null;
              } catch (_e) {
                v = null;
              }
              const cell = r.getCell(colIdx);
              cell.value = (v == null || Number.isNaN(v)) ? null : v;
              cell.font = { name: fonts.body_family, size: 10, color: { argb: 'FF' + hex(palette.nm_text) } };
              if (h.format && FMT[h.format]) cell.numFmt = FMT[h.format];
              // Match zebra striping
              if (xlsxRowIdx % 2 === 1) {
                cell.fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: 'FF' + hex(palette.nm_pale) },
                };
              }
            });
          });

          totalColsForAutoFilter = cols.length + helpers.length;
        }
      }
    }

    // Auto-filter on the header row (location depends on chart-image layout)
    sheet.autoFilter = {
      from: { row: headerRow_n, column: 1 },
      to:   { row: headerRow_n, column: totalColsForAutoFilter },
    };

    // Print setup for marketing handoff
    sheet.pageSetup = {
      orientation: 'landscape',
      paperSize: 9, // A4 landscape; alternative: 1 = Letter
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
    };
    sheet.headerFooter = {
      oddHeader: `&L&"${fonts.title_family}"&12&K003DA5${chart.name}&R&"${fonts.body_family}"&10Northmarq Capital Markets`,
      oddFooter: `&L&"${fonts.body_family}"&9Generated by LCC &D&R&"${fonts.body_family}"&9Page &P of &N`,
    };
  }

  // ----------------------------------------------------------------
  // MasterPasteReady — matches the column order of master "All Charts"
  // ----------------------------------------------------------------
  // Vertical-aware MasterPasteReady dispatch. Both gov and dialysis use the
  // same render loop; only the title text + column layout differ.
  const masterPasteVertical =
    vertical === 'gov'      ? { layout: GOV_MASTER_PASTE_LAYOUT,
                                titleText: `Government Master "All Charts" — Paste-Ready (subspecialty: ${subspecialty})`,
                                noteHeader: 'PASTE INTO GOV MASTER:\n',
                                noteBody:   '1. Click A3 (first data row)\n2. Ctrl+Shift+End to select all data\n3. Ctrl+C\n4. Open Copy Government Master Document.xlsx\n5. All Charts tab → click B3\n6. Paste Special → Values\n\nColumn order matches master B-Y exactly.' }
    : vertical === 'dialysis' ? { layout: DIA_MASTER_PASTE_LAYOUT,
                                  titleText: `Dialysis Master "All Charts" — Paste-Ready (subspecialty: ${subspecialty})`,
                                  noteHeader: 'PASTE INTO DIALYSIS MASTER:\n',
                                  noteBody:   '1. Click A3 (first data row)\n2. Ctrl+Shift+End to select all data\n3. Ctrl+C\n4. Open the dialysis master XLSX (assets/cm-templates/dialysis-master-template.xlsx or your local copy)\n5. Charts data tab → click the first data row\n6. Paste Special → Values\n\nColumn parity with gov master where applicable; dialysis-specific tail (DOM, % of ask, bid-ask, price-change %) appended at the right.' }
    : null;

  if (masterPasteVertical && Array.isArray(masterRows) && masterRows.length > 0) {
    const { layout: PASTE_LAYOUT, titleText, noteHeader, noteBody } = masterPasteVertical;
    const ms = wb.addWorksheet('MasterPasteReady', {
      views: [{ showGridLines: false, state: 'frozen', ySplit: 2 }],
    });
    // R42 hotfix — addWorksheet options silently drops tabColor; must be
    // set on sheet.properties post-creation.
    ms.properties.tabColor = { argb: 'FF' + hex(palette.nm_navy) };

    // Title block
    ms.getCell('A1').value = titleText;
    ms.getCell('A1').font = { name: fonts.title_family, size: 14, bold: true, color: { argb: 'FF' + hex(palette.nm_navy) } };
    ms.mergeCells('A1:F1');
    ms.getRow(1).height = 22;

    // Header row at row 2 (matches master "All Charts" row 2 header layout)
    const msHeader = ms.getRow(2);
    PASTE_LAYOUT.forEach((c, i) => {
      const cell = msHeader.getCell(i + 1);
      cell.value = c.header;
      cell.font = { name: fonts.title_family, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + hex(palette.nm_navy) } };
      cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
      cell.border = { bottom: { style: 'medium', color: { argb: 'FF' + hex(palette.nm_navy) } } };
    });
    msHeader.height = 32;

    // Column widths + number formats
    PASTE_LAYOUT.forEach((c, i) => {
      const col = ms.getColumn(i + 1);
      col.width = c.width || 14;
      if (c.format && FMT[c.format]) col.numFmt = FMT[c.format];
    });

    // Data rows starting at row 3 (so when marketing copies A3:Xend and pastes
    // at master's All Charts data tab, the columns align with the master's
    // expected layout)
    let r = 3;
    for (const row of masterRows) {
      const dataRow = ms.getRow(r);
      PASTE_LAYOUT.forEach((c, i) => {
        let v = row[c.key];
        if (c.format === 'date_short' && typeof v === 'string') {
          const d = new Date(v);
          if (!isNaN(d.getTime())) v = d;
        }
        const cell = dataRow.getCell(i + 1);
        cell.value = v == null ? null : v;
        cell.font = { name: fonts.body_family, size: 10, color: { argb: 'FF' + hex(palette.nm_text) } };
        if (c.format && FMT[c.format]) cell.numFmt = FMT[c.format];
      });
      if (r % 2 === 1) {
        PASTE_LAYOUT.forEach((_, i) => {
          dataRow.getCell(i + 1).fill = {
            type: 'pattern', pattern: 'solid',
            fgColor: { argb: 'FF' + hex(palette.nm_pale) },
          };
        });
      }
      r++;
    }

    // Helpful instruction block above the data
    ms.getCell('A1').note = {
      texts: [
        { text: noteHeader, font: { bold: true, size: 11 } },
        { text: noteBody, font: { size: 10 } },
      ],
    };

    ms.pageSetup = {
      orientation: 'landscape',
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    };
  }

  // ----------------------------------------------------------------
  // Charts tab (PNG images, when chartImages were rendered server-side
  // via cm-chart-image-renderer). Single consolidated tab; one chart per
  // ~30 rows so a "fit to page" print yields ~3-4 charts per page.
  //
  // ExcelJS doesn't support native chart objects (limitation of the
  // library, not the file format) — embedding PNGs is the most reliable
  // way to ship visible charts in the workbook for users who don't have
  // the master XLSX paste-into workflow.
  // ----------------------------------------------------------------
  if (Array.isArray(chartImages) && chartImages.length > 0) {
    const chartsSheet = wb.addWorksheet('Charts', {
      views: [{ showGridLines: false }],
    });
    // R42 hotfix — addWorksheet options silently drops tabColor; must be
    // set on sheet.properties post-creation.
    chartsSheet.properties.tabColor = { argb: 'FF' + hex(palette.nm_navy) };
    chartsSheet.getColumn(1).width = 4;
    chartsSheet.getColumn(2).width = 130;

    chartsSheet.getCell('B2').value = `Capital Markets — ${verticalLabel} Charts`;
    chartsSheet.getCell('B2').font = { name: fonts.title_family, size: 18, bold: true, color: { argb: 'FF' + hex(palette.nm_navy) } };
    chartsSheet.getRow(2).height = 24;

    chartsSheet.getCell('B3').value =
      `Auto-rendered via QuickChart from ${chartImages.length} chart configs. ` +
      'For full chart parity, see the MasterPasteReady tab + your master XLSX.';
    chartsSheet.getCell('B3').font = { name: fonts.body_family, size: 9, italic: true, color: { argb: 'FF' + hex(palette.nm_text_muted) } };
    chartsSheet.getRow(3).height = 18;

    // Each image gets a header row + 25 data rows (≈ 480px tall)
    let cursor = 5;
    for (const img of chartImages) {
      // Header
      const titleCell = chartsSheet.getCell(`B${cursor}`);
      titleCell.value = img.name || img.chart_template_id;
      titleCell.font = { name: fonts.title_family, size: 12, bold: true, color: { argb: 'FF' + hex(palette.nm_navy) } };
      chartsSheet.getRow(cursor).height = 20;

      // Add the image. addImage requires (workbook, image opts) → returns id;
      // worksheet.addImage(id, range/extent) places it.
      const imageId = wb.addImage({
        buffer: img.png,
        extension: 'png',
      });
      chartsSheet.addImage(imageId, {
        tl: { col: 1, row: cursor },        // 0-indexed: column B (index 1), row right below header
        ext: { width: 900, height: 480 },
      });

      cursor += 27; // header + 25 image rows + 1 spacer
    }

    chartsSheet.pageSetup = {
      orientation: 'landscape',
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
    };
    chartsSheet.headerFooter = {
      oddHeader: `&L&"${fonts.title_family}"&12&K003DA5${verticalLabel} — Capital Markets Charts&R&"${fonts.body_family}"&10Northmarq`,
      oddFooter: `&L&"${fonts.body_family}"&9Generated by LCC &D&R&"${fonts.body_family}"&9Page &P of &N`,
    };
  }

  // ----------------------------------------------------------------
  // Brand reference sheet (for InDesign team)
  // ----------------------------------------------------------------
  const brandSheet = wb.addWorksheet('Brand', { views: [{ showGridLines: false }] });
  brandSheet.getColumn(1).width = 4;
  brandSheet.getColumn(2).width = 24;
  brandSheet.getColumn(3).width = 12;
  brandSheet.getColumn(4).width = 12;
  brandSheet.getColumn(5).width = 60;

  brandSheet.getCell('B2').value = 'Northmarq Brand Tokens';
  brandSheet.getCell('B2').font = { name: fonts.title_family, size: 18, bold: true, color: { argb: 'FF' + hex(palette.nm_navy) } };
  brandSheet.getRow(2).height = 26;

  const brandHdr = brandSheet.getRow(4);
  ['', 'Token', 'Hex', 'Swatch', 'Usage'].forEach((h, i) => {
    brandHdr.getCell(i + 1).value = h;
  });
  brandHdr.font = { name: fonts.title_family, size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  brandHdr.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + hex(palette.nm_navy) } };
  });
  brandHdr.height = 22;

  const brandRows = [
    ['nm_navy',       palette.nm_navy,       'Primary — series 1, axes, chart titles, KPI numbers'],
    ['nm_sky',        palette.nm_sky,        'Accent — series 2, hyperlinks, hover states'],
    ['nm_pale',       palette.nm_pale,       'Fill — area-chart fills, table zebra-stripes'],
    ['nm_blue_mid',   palette.nm_blue_mid,   'Series 3 — secondary emphasis'],
    ['nm_axis',       palette.nm_axis,       'Axis text, secondary chart text'],
    ['nm_text',       palette.nm_text,       'Body text, table headers'],
    ['nm_text_muted', palette.nm_text_muted, 'Footnote text, source attribution'],
    ['nm_bg',         palette.nm_bg,         'Page background'],
    ['nm_bg_alt',     palette.nm_bg_alt,     'Card divider, panel backgrounds'],
  ];
  brandRows.forEach((br, i) => {
    const r = brandSheet.getRow(5 + i);
    r.getCell(2).value = br[0];
    r.getCell(3).value = br[1];
    r.getCell(4).value = '';
    r.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + hex(br[1]) } };
    r.getCell(5).value = br[2];
    [2, 3, 5].forEach((c) => {
      r.getCell(c).font = { name: fonts.body_family, size: 10, color: { argb: 'FF' + hex(palette.nm_text) } };
    });
  });

  // Fonts section
  const fontsHdrRow = 5 + brandRows.length + 2;
  brandSheet.getCell(`B${fontsHdrRow}`).value = 'Fonts';
  brandSheet.getCell(`B${fontsHdrRow}`).font = { name: fonts.title_family, size: 14, bold: true, color: { argb: 'FF' + hex(palette.nm_navy) } };
  brandSheet.getCell(`B${fontsHdrRow + 1}`).value = `Titles: ${fonts.title_family} (this row)`;
  brandSheet.getCell(`B${fontsHdrRow + 1}`).font = { name: fonts.title_family, size: 12, bold: true };
  brandSheet.getCell(`B${fontsHdrRow + 2}`).value = `Body: ${fonts.body_family} (this row)`;
  brandSheet.getCell(`B${fontsHdrRow + 2}`).font = { name: fonts.body_family, size: 10 };

  // R34 — return native-chart injection specs alongside the workbook so
  // the caller can post-process the buffer with injectNativeCharts.
  // Backward-compat: legacy property access still works because the
  // returned object exposes the workbook as both `.wb` and via spread.
  wb.nativeInjections = nativeInjections;
  return wb;
}

// ============================================================================
// Period-summary table renderer
// ============================================================================
//
// For chart_templates whose data_shape is 'period_summary_table' (e.g.
// volume_cap_summary_table). Output mirrors the marketing master's "Industrial
// Volume & Cap Rate" / "Office Volume & Cap Rate" / "Gov-Leased Volume & Cap"
// blocks: 4 metric rows × 7 numeric columns + a "Metric" label column.
//
// Header text is computed from the as_of period — column B becomes "2Q-2024"
// when as_of='2024-06-30', etc. Each row uses its own number format because
// the metrics span currency (Volume) and percent (Cap rates).

function renderPeriodSummaryTab({ wb, tabName, chart, palette, fonts, asOf, subspecialty }) {
  const sheet = wb.addWorksheet(tabName, { views: [{ showGridLines: false }] });
  const navy = 'FF' + hex(palette.nm_navy);
  const pale = 'FF' + hex(palette.nm_pale);
  const text = 'FF' + hex(palette.nm_text);
  const muted = 'FF' + hex(palette.nm_text_muted);

  // Title block
  sheet.getCell('A1').value = chart.name;
  sheet.getCell('A1').font = { name: fonts.title_family, size: 14, bold: true, color: { argb: navy } };
  sheet.getRow(1).height = 22;

  // Resolve as_of from the first row's as_of field if not supplied
  const resolvedAsOf = asOf || (chart.rows?.[0]?.as_of) || null;

  sheet.getCell('A2').value = `Quarterly snapshot — subspecialty=${subspecialty}${resolvedAsOf ? ' · as of ' + resolvedAsOf : ''}`;
  sheet.getCell('A2').font = { name: fonts.body_family, size: 9, italic: true, color: { argb: muted } };

  sheet.getCell('A3').value = 'Mirrors the master "All Charts" 7-column summary tables. Paste cells B4:H8 into the master\'s corresponding summary block to refresh.';
  sheet.getCell('A3').font = { name: fonts.body_family, size: 9, color: { argb: muted } };
  sheet.getCell('A3').alignment = { wrapText: true };
  sheet.getRow(3).height = 26;

  // Header row at row 4
  const dataKeys = ['current_q', 'prior_q', 'yoy_q', 'prior_cycle_q', 'avg_5yr', 'avg_10yr', 'avg_15yr'];
  const headers = ['Metric', ...summaryColumnHeaders(resolvedAsOf)];

  const headerRow = sheet.getRow(4);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { name: fonts.title_family, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: navy } };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    cell.border = { bottom: { style: 'medium', color: { argb: navy } } };
  });
  headerRow.height = 22;

  // Column widths
  sheet.getColumn(1).width = 22; // Metric label
  for (let i = 2; i <= 8; i++) sheet.getColumn(i).width = 13;

  // Data rows starting at row 5
  let rowIdx = 5;
  for (const summaryRow of chart.rows || []) {
    const r = sheet.getRow(rowIdx);
    const fmt = FMT[summaryRow.format] || '';
    // Column 1 = metric label
    const labelCell = r.getCell(1);
    labelCell.value = summaryRow.metric;
    labelCell.font = { name: fonts.body_family, size: 10, bold: true, color: { argb: text } };
    // Columns 2-8 = numeric values
    dataKeys.forEach((k, i) => {
      const cell = r.getCell(i + 2);
      cell.value = summaryRow[k] == null ? null : Number(summaryRow[k]);
      cell.font = { name: fonts.body_family, size: 10, color: { argb: text } };
      if (fmt) cell.numFmt = fmt;
    });
    if (rowIdx % 2 === 1) {
      for (let c = 1; c <= 8; c++) {
        r.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: pale } };
      }
    }
    rowIdx++;
  }

  // Light footer note explaining the column meanings
  const footRow = rowIdx + 1;
  sheet.getCell(`A${footRow}`).value =
    'Columns: as-of quarter; prior quarter; year-ago same quarter; cycle-ago (8 quarters back); trailing-mean over the trailing 5/10/15 years (20/40/60 quarters).';
  sheet.getCell(`A${footRow}`).font = { name: fonts.body_family, size: 8, italic: true, color: { argb: muted } };
  sheet.getCell(`A${footRow}`).alignment = { wrapText: true };
  sheet.mergeCells(`A${footRow}:H${footRow}`);
  sheet.getRow(footRow).height = 22;
}

// ============================================================================
// On-Market Snapshot tab renderer (Round 4a — PDF dialysis p.29)
// ============================================================================
//
// Two side-by-side cohort tables:
//   • Left:  Total Market (cohort='total')
//   • Right: 10+ Year Term (cohort='core_10plus')
//
// Each table has 4 columns: Metric | Current Q | Trend (↑↓→) | Prior Y Q.
// "Prior Y Q" = same quarter, 4 quarters back (year-over-year compare).
// Trend arrow direction depends on the metric's "good direction":
//   • count_available, avg_price → up=green (more activity / higher price)
//   • avg_cap, upper_q_cap, lower_q_cap, median_cap, avg_dom,
//     pct_price_change → up=red (rising caps + DOM + price-change rate
//     all signal weakening pricing)
// We don't bake the color semantic into the cell; we just emit the arrow
// glyph so marketing can re-color in the PDF version.

function renderOnMarketSnapshotTab({ wb, tabName, chart, palette, fonts, asOf, subspecialty }) {
  const sheet = wb.addWorksheet(tabName, { views: [{ showGridLines: false }] });
  const navy = 'FF' + hex(palette.nm_navy);
  const pale = 'FF' + hex(palette.nm_pale);
  const text = 'FF' + hex(palette.nm_text);
  const muted = 'FF' + hex(palette.nm_text_muted);

  // Title block
  sheet.getCell('A1').value = chart.name;
  sheet.getCell('A1').font = { name: fonts.title_family, size: 14, bold: true, color: { argb: navy } };
  sheet.getRow(1).height = 22;

  // Find the most recent period_end across all rows
  const rows = (chart.rows || []).filter((r) => r.period_end);
  if (rows.length === 0) {
    sheet.getCell('A3').value = 'No on-market data available.';
    sheet.getCell('A3').font = { name: fonts.body_family, size: 10, italic: true, color: { argb: muted } };
    return;
  }
  // Sort desc by period_end; pick latest
  const sorted = [...rows].sort((a, b) =>
    String(a.period_end) < String(b.period_end) ? 1 : -1
  );
  const currentPeriod = sorted[0].period_end;
  // 4 quarters back
  const yearAgo = (() => {
    const d = new Date(currentPeriod);
    d.setMonth(d.getMonth() - 12);
    // last day of that month
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
  })();

  const findRow = (period, cohort) => sorted.find((r) => r.period_end === period && r.cohort === cohort) || {};

  // Subtitle
  sheet.getCell('A2').value = `Snapshot — subspecialty=${subspecialty} · current=${currentPeriod} · prior-year=${yearAgo}`;
  sheet.getCell('A2').font = { name: fonts.body_family, size: 9, italic: true, color: { argb: muted } };

  // Metric rows: [label, fieldKey, formatKey]
  const METRICS = [
    { label: 'Number Available',     key: 'count_available',  format: 'integer_count' },
    { label: 'Average Price',        key: 'avg_price',        format: 'currency_dollars' },
    { label: 'Average Cap',          key: 'avg_cap',          format: 'percent_basis_points' },
    { label: 'Upper Quartile Cap',   key: 'upper_q_cap',      format: 'percent_basis_points' },
    { label: 'Lower Quartile Cap',   key: 'lower_q_cap',      format: 'percent_basis_points' },
    { label: 'Median Cap',           key: 'median_cap',       format: 'percent_basis_points' },
    { label: 'Days on Market (avg)', key: 'avg_dom',          format: 'integer_count' },
    { label: 'Price Change %',       key: 'pct_price_change', format: 'percent_one_decimal' },
  ];

  // Render one cohort block at the given start column. Returns the next
  // available row after the block.
  function renderCohortBlock(startCol, cohort, cohortLabel) {
    const headerRow_n = 4;
    // Column-header row: cohort label spanning the 4 columns
    const labelCell = sheet.getCell(headerRow_n, startCol);
    labelCell.value = cohortLabel;
    labelCell.font = { name: fonts.title_family, size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
    labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: navy } };
    labelCell.alignment = { vertical: 'middle', horizontal: 'center' };
    sheet.mergeCells(headerRow_n, startCol, headerRow_n, startCol + 3);
    sheet.getRow(headerRow_n).height = 22;

    // Sub-header row with column titles
    const subHdr = headerRow_n + 1;
    const subHeaders = ['Metric', formatPeriodLabel(currentPeriod), '', formatPeriodLabel(yearAgo)];
    subHeaders.forEach((h, i) => {
      const c = sheet.getCell(subHdr, startCol + i);
      c.value = h;
      c.font = { name: fonts.title_family, size: 10, bold: true, color: { argb: navy } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: pale } };
      c.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : 'center' };
      c.border = { bottom: { style: 'thin', color: { argb: navy } } };
    });
    sheet.getRow(subHdr).height = 18;

    const cur = findRow(currentPeriod, cohort);
    const prv = findRow(yearAgo, cohort);

    // Metric rows
    METRICS.forEach((m, mi) => {
      const r = subHdr + 1 + mi;
      const curVal = cur[m.key];
      const prvVal = prv[m.key];

      const labelC = sheet.getCell(r, startCol);
      labelC.value = m.label;
      labelC.font = { name: fonts.body_family, size: 10, color: { argb: text } };
      labelC.alignment = { vertical: 'middle', horizontal: 'left' };

      const curC = sheet.getCell(r, startCol + 1);
      curC.value = curVal == null ? null : Number(curVal);
      if (FMT[m.format]) curC.numFmt = FMT[m.format];
      curC.font = { name: fonts.body_family, size: 10, bold: true, color: { argb: navy } };
      curC.alignment = { vertical: 'middle', horizontal: 'right' };

      const trendC = sheet.getCell(r, startCol + 2);
      trendC.value = arrowFor(curVal, prvVal);
      trendC.font = { name: fonts.body_family, size: 12, bold: true, color: { argb: text } };
      trendC.alignment = { vertical: 'middle', horizontal: 'center' };

      const prvC = sheet.getCell(r, startCol + 3);
      prvC.value = prvVal == null ? null : Number(prvVal);
      if (FMT[m.format]) prvC.numFmt = FMT[m.format];
      prvC.font = { name: fonts.body_family, size: 10, color: { argb: muted } };
      prvC.alignment = { vertical: 'middle', horizontal: 'right' };

      // Zebra-stripe alternate rows
      if (mi % 2 === 0) {
        for (let cc = 0; cc < 4; cc++) {
          sheet.getCell(r, startCol + cc).fill = {
            type: 'pattern', pattern: 'solid',
            fgColor: { argb: 'FFF7F9FC' },
          };
        }
      }
    });

    return subHdr + METRICS.length + 1;
  }

  // Column widths: 2 blocks of [label=22, current=14, trend=6, prior=14] = 56 cols across A:H
  // Layout: cols A-D (1-4) for Total, F-I (6-9) for Core 10+, col E (5) is spacer
  sheet.getColumn(1).width = 24;
  sheet.getColumn(2).width = 14;
  sheet.getColumn(3).width = 6;
  sheet.getColumn(4).width = 14;
  sheet.getColumn(5).width = 3;  // spacer
  sheet.getColumn(6).width = 24;
  sheet.getColumn(7).width = 14;
  sheet.getColumn(8).width = 6;
  sheet.getColumn(9).width = 14;

  renderCohortBlock(1, 'total',       'Total Market');
  renderCohortBlock(6, 'core_10plus', '10+ Year Term');

  // Footer caption
  const footRow = 4 + 1 + METRICS.length + 2;
  sheet.getCell(`A${footRow}`).value =
    'On-Market Snapshot — current quarter vs prior-year-same-quarter for Dialysis (Total Market | 10+ Year Term cohort). ↑/↓/→ shows direction of change. ↑ on cap/DOM/price-change indicates softening; ↑ on count/price indicates strengthening. Source: cm_dialysis_on_market_snapshot_q.';
  sheet.getCell(`A${footRow}`).font = { name: fonts.body_family, size: 9, italic: true, color: { argb: muted } };
  sheet.getCell(`A${footRow}`).alignment = { wrapText: true };
  sheet.mergeCells(`A${footRow}:I${footRow}`);
  sheet.getRow(footRow).height = 36;
}

function formatPeriodLabel(d) {
  if (!d) return '';
  const m = String(d).match(/^(\d{4})-(\d{2})/);
  if (!m) return String(d);
  const year = m[1];
  const month = parseInt(m[2], 10);
  const q = Math.ceil(month / 3);
  return `${q}Q-${year}`;
}

function arrowFor(cur, prv) {
  if (cur == null || prv == null) return '—';
  const c = Number(cur), p = Number(prv);
  if (!Number.isFinite(c) || !Number.isFinite(p)) return '—';
  if (c > p) return '↑';
  if (c < p) return '↓';
  return '→';
}

// ============================================================================
// Lease_Terms 3-column comparison renderer (Round 9 — PDF gov p.27)
// ============================================================================
//
// Wide-format pivot of cm_gov_lease_structures rows (long format:
// {period_label, term_bucket, bucket_count, pct_of_total}) into a single
// table:
//
//   Term Bucket          | Current Quarter | Last 12 Months | Last 5 Years
//                        |   Count   |  %  |   Count   |  %  |   Count   |  %
//   10, 5                |   523     | 24% |   1,538   | 26% |   ...
//   15, 10               |   ...     | ... |   ...     | ... |   ...
//
// User: "Data_Lease_Terms should be a table that shows the most recent
// quarter in one column, the last 12 months in the next, and last five
// years in the final column."

function renderLeaseStructuresTab({ wb, tabName, chart, palette, fonts, subspecialty }) {
  const sheet = wb.addWorksheet(tabName, { views: [{ showGridLines: false }] });
  const navy  = 'FF' + hex(palette.nm_navy);
  const pale  = 'FF' + hex(palette.nm_pale);
  const text  = 'FF' + hex(palette.nm_text);
  const muted = 'FF' + hex(palette.nm_text_muted);

  sheet.getCell('A1').value = chart.name;
  sheet.getCell('A1').font = { name: fonts.title_family, size: 14, bold: true, color: { argb: navy } };
  sheet.getRow(1).height = 22;

  sheet.getCell('A2').value = `Lease-structure distribution — three rolling-period windows (subspecialty=${subspecialty})`;
  sheet.getCell('A2').font = { name: fonts.body_family, size: 9, italic: true, color: { argb: muted } };

  // Build pivot: term_bucket → { current_quarter: {count, pct}, ttm: {...}, last_5_years: {...} }
  const rows = chart.rows || [];
  const buckets = new Map();
  for (const r of rows) {
    const tb = r.term_bucket || '?';
    if (!buckets.has(tb)) buckets.set(tb, {});
    buckets.get(tb)[r.period_label] = {
      count: Number(r.bucket_count) || 0,
      pct:   Number(r.pct_of_total) || 0,
    };
  }
  // Sort by ttm count desc; fallback to last_5_years count
  const allSortedBuckets = [...buckets.entries()].sort((a, b) => {
    const aN = (a[1].ttm?.count ?? 0) + (a[1].last_5_years?.count ?? 0);
    const bN = (b[1].ttm?.count ?? 0) + (b[1].last_5_years?.count ?? 0);
    return bN - aN;
  });
  // Round 17 — consolidate to top 13 by combined count + an "Other"
  // aggregate row. User: "Can we consolidate these down to maybe
  // some ranges so we show maybe the top 12-15 total lease type
  // categories?" Excludes "unknown" entirely (data-quality noise).
  const TOP_N = 13;
  const filtered = allSortedBuckets.filter(([tb]) => tb !== 'unknown' && tb !== '?');
  const topBuckets = filtered.slice(0, TOP_N);
  const tailBuckets = filtered.slice(TOP_N);
  let sortedBuckets = topBuckets;
  if (tailBuckets.length > 0) {
    // Aggregate the tail into an "Other" row, summing counts per period
    // and computing weighted pct. (pct is over total; sum the bucket_count
    // shares per period.)
    const otherRow = { current_quarter: { count: 0, pct: 0 }, ttm: { count: 0, pct: 0 }, last_5_years: { count: 0, pct: 0 } };
    for (const [, periods] of tailBuckets) {
      for (const pk of ['current_quarter', 'ttm', 'last_5_years']) {
        if (periods[pk]) {
          otherRow[pk].count += periods[pk].count || 0;
          otherRow[pk].pct   += periods[pk].pct   || 0;
        }
      }
    }
    sortedBuckets = [...topBuckets, [`Other (${tailBuckets.length} buckets)`, otherRow]];
  }

  // Column widths
  sheet.getColumn(1).width = 24;
  [2, 3, 4, 5, 6, 7].forEach((c, i) => {
    sheet.getColumn(c).width = i % 2 === 0 ? 12 : 9;
  });

  // Group header row (4)
  const groupHdr = sheet.getRow(4);
  groupHdr.getCell(1).value = 'Term Bucket';
  groupHdr.getCell(2).value = 'Current Quarter';
  groupHdr.getCell(4).value = 'Last 12 Months';
  groupHdr.getCell(6).value = 'Last 5 Years';
  sheet.mergeCells('B4:C4');
  sheet.mergeCells('D4:E4');
  sheet.mergeCells('F4:G4');
  for (let c = 1; c <= 7; c++) {
    const cell = groupHdr.getCell(c);
    cell.font = { name: fonts.title_family, size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: navy } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  }
  groupHdr.height = 20;

  // Sub-header row (5)
  const subHdr = sheet.getRow(5);
  const subHeaders = ['', 'Count', '%', 'Count', '%', 'Count', '%'];
  subHeaders.forEach((h, i) => {
    const cell = subHdr.getCell(i + 1);
    cell.value = h;
    cell.font = { name: fonts.title_family, size: 10, bold: true, color: { argb: navy } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: pale } };
    cell.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : 'center' };
    cell.border = { bottom: { style: 'thin', color: { argb: navy } } };
  });
  subHdr.height = 18;

  // Data rows
  let rowIdx = 6;
  for (const [tb, periods] of sortedBuckets) {
    if (tb === 'unknown' || tb === 'unknown'.trim()) continue;  // skip 'unknown' bucket
    const r = sheet.getRow(rowIdx);
    r.getCell(1).value = tb;
    r.getCell(1).font = { name: fonts.body_family, size: 10, color: { argb: text } };

    const periodKeys = ['current_quarter', 'ttm', 'last_5_years'];
    periodKeys.forEach((pk, pi) => {
      const data = periods[pk] || { count: null, pct: null };
      const countCell = r.getCell(2 + pi * 2);
      const pctCell   = r.getCell(3 + pi * 2);
      countCell.value = data.count;
      countCell.numFmt = FMT.integer_count;
      countCell.font = { name: fonts.body_family, size: 10, color: { argb: text } };
      countCell.alignment = { vertical: 'middle', horizontal: 'right' };
      pctCell.value = data.pct;
      pctCell.numFmt = FMT.percent_one_decimal;
      pctCell.font = { name: fonts.body_family, size: 10, color: { argb: muted } };
      pctCell.alignment = { vertical: 'middle', horizontal: 'right' };
    });

    if (rowIdx % 2 === 0) {
      for (let c = 1; c <= 7; c++) {
        r.getCell(c).fill = {
          type: 'pattern', pattern: 'solid',
          fgColor: { argb: 'FFF7F9FC' },
        };
      }
    }
    rowIdx++;
  }

  // Footer caption
  const footRow = rowIdx + 1;
  sheet.getCell(`A${footRow}`).value =
    'Lease-structure distribution by term bucket across three rolling windows (current quarter / last 12 months / last 5 years). ' +
    'Bucket label format "X, Y" = X-year total term with Y-year firm period.';
  sheet.getCell(`A${footRow}`).font = { name: fonts.body_family, size: 9, italic: true, color: { argb: muted } };
  sheet.getCell(`A${footRow}`).alignment = { wrapText: true };
  sheet.mergeCells(`A${footRow}:G${footRow}`);
  sheet.getRow(footRow).height = 30;
}

// ============================================================================
// KPI block tab renderer
// ============================================================================
//
// For chart_type='kpi_block'. View returns one row per (period_end x tile).
// We pick the latest period_end with at least one populated tile and render
// it as a compact summary table:
//
//   Tile                       Primary      NM         Non-NM
//   Avg NOI                    $1,930,088   —          —
//   Avg Cap Rate               9.00%        7.50%      9.26%
//   Avg Sales Price            $11.46M      $20.0M     $11.23M
//
// Per-row number format is taken from each tile's primary_format. Mixed
// formats across rows are fine — Excel applies them per-cell.

function renderKpiBlockTab({ wb, tabName, chart, palette, fonts, asOf, subspecialty }) {
  const sheet = wb.addWorksheet(tabName, { views: [{ showGridLines: false }] });
  const navy = 'FF' + hex(palette.nm_navy);
  const pale = 'FF' + hex(palette.nm_pale);
  const text = 'FF' + hex(palette.nm_text);
  const muted = 'FF' + hex(palette.nm_text_muted);

  // Title block
  sheet.getCell('A1').value = chart.name;
  sheet.getCell('A1').font = { name: fonts.title_family, size: 14, bold: true, color: { argb: navy } };
  sheet.getRow(1).height = 22;

  // Pick the latest period_end with populated tiles
  const allRows = chart.rows || [];
  const periods = [...new Set(allRows.map((r) => r.period_end))].sort().reverse();
  let resolvedAsOf = asOf;
  let tiles = [];
  for (const p of periods) {
    const candidates = allRows
      .filter((r) => r.period_end === p && r.primary_value != null)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    if (candidates.length > 0) {
      if (!resolvedAsOf) resolvedAsOf = p;
      tiles = candidates;
      break;
    }
  }

  sheet.getCell('A2').value = `KPI tile block — subspecialty=${subspecialty}${resolvedAsOf ? ' · as of ' + resolvedAsOf : ''}`;
  sheet.getCell('A2').font = { name: fonts.body_family, size: 9, italic: true, color: { argb: muted } };

  sheet.getCell('A3').value = 'One row per tile. Rolling 12-month TTM. Primary value uses the tile\'s format token; NM / Non-NM splits (when present) use the same format.';
  sheet.getCell('A3').font = { name: fonts.body_family, size: 9, color: { argb: muted } };
  sheet.getCell('A3').alignment = { wrapText: true };
  sheet.getRow(3).height = 26;

  // Header row at row 4
  const headers = ['Tile', 'Primary', 'NM', 'Non-NM'];
  const headerRow = sheet.getRow(4);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { name: fonts.title_family, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: navy } };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    cell.border = { bottom: { style: 'medium', color: { argb: navy } } };
  });
  headerRow.height = 22;

  // Column widths
  sheet.getColumn(1).width = 28;  // Tile label
  for (let i = 2; i <= 4; i++) sheet.getColumn(i).width = 14;

  // Data rows starting at row 5
  let rowIdx = 5;
  for (const t of tiles) {
    const r = sheet.getRow(rowIdx);
    const fmt = FMT[t.primary_format] || '';

    const labelCell = r.getCell(1);
    labelCell.value = t.tile_label;
    labelCell.font = { name: fonts.body_family, size: 10, bold: true, color: { argb: text } };

    const setNumCell = (col, value) => {
      const cell = r.getCell(col);
      cell.value = value == null ? null : Number(value);
      cell.font = { name: fonts.body_family, size: 10, color: { argb: text } };
      if (fmt) cell.numFmt = fmt;
    };
    setNumCell(2, t.primary_value);
    setNumCell(3, t.nm_value);
    setNumCell(4, t.non_nm_value);

    if (rowIdx % 2 === 1) {
      for (let c = 1; c <= 4; c++) {
        r.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: pale } };
      }
    }
    rowIdx++;
  }

  // Footer note
  const footRow = rowIdx + 1;
  sheet.getCell(`A${footRow}`).value =
    'Used to render the "Value Proposition Results" tile grid in the deliverable. NM / Non-NM splits are only populated when the tile has an NM-attribution comparison (Cap Rate, Sales Price). Avg NOI is single-value (no split).';
  sheet.getCell(`A${footRow}`).font = { name: fonts.body_family, size: 8, italic: true, color: { argb: muted } };
  sheet.getCell(`A${footRow}`).alignment = { wrapText: true };
  sheet.mergeCells(`A${footRow}:D${footRow}`);
  sheet.getRow(footRow).height = 28;
}

// ============================================================================
// Filename helper
// ============================================================================

export function exportFilename({ vertical, subspecialty, asOf }) {
  const dateStr = asOf ? String(asOf).slice(0, 10) : new Date().toISOString().slice(0, 10);
  const subStr = subspecialty && subspecialty !== 'all' ? `-${subspecialty.toUpperCase()}` : '';
  const verticalStr = vertical === 'gov' ? 'GovLeased'
                    : vertical === 'dialysis' ? 'Dialysis'
                    : vertical === 'national_st' ? 'NatSingleTenant'
                    : String(vertical || 'CapitalMarkets');
  return `NM-CapMarkets-${verticalStr}${subStr}-${dateStr}.xlsx`;
}

// ============================================================================
// Audit hook (Round 5b — silent-drop CI gate)
// ============================================================================
//
// Returns a snapshot of the per-tab dispatch tables so a CI test can verify
// that every chart_template_id in the catalog has both a tab name AND a
// column schema. The Round 5a audit caught 14 silent drops where a catalog
// row existed but TAB_NAMES / CHART_COLUMNS were missing — this hook makes
// the next one detectable on PR rather than after deploy.
//
// Returned shape (read-only — do NOT mutate from callers):
//   {
//     tabNames:                 { [chart_template_id]: 'Data_*' },
//     chartColumns:             { [chart_template_id]: ColumnSchema[] },
//     periodSummaryTemplates:   Set<chart_template_id>,
//     specialRenderers:         Set<chart_template_id>,
//   }
//
// `specialRenderers` enumerates chart_template_ids that have a dedicated
// render path (kpi_block, on_market_snapshot, period_summary_table) and
// therefore don't need a CHART_COLUMNS entry — the audit test should treat
// these as exempt from the columns check.
export function getExportBundleSchema() {
  return {
    tabNames:               TAB_NAMES,
    chartColumns:           CHART_COLUMNS,
    periodSummaryTemplates: PERIOD_SUMMARY_TEMPLATES,
    // Charts whose worksheet is built via a dedicated renderPeriodSummaryTab /
    // renderKpiBlockTab / renderOnMarketSnapshotTab path. They need a tab name
    // but NOT a CHART_COLUMNS entry — the dedicated renderer owns the layout.
    specialRenderers: new Set([
      ...PERIOD_SUMMARY_TEMPLATES,
      'on_market_snapshot',          // renderOnMarketSnapshotTab
      // KPI block charts are detected at runtime by chart.chart_type==='kpi_block',
      // not by template_id, so they're handled via runtime dispatch — list them
      // here too to keep the audit honest.
      'value_proposition_results',
      'whatsnew_quarter_kpis',
      'inventory_snapshot_kpis',
    ]),
  };
}
