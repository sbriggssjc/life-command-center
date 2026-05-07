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
import { summaryColumnHeaders } from './cm-summary-table.js';

// Excel number-format codes (matching cm_brand_tokens.axis_formats)
const FMT = {
  currency_dollars:     '"$"#,##0',
  currency_millions:    '"$"#,##0.0,,"M"',
  currency_billions:    '"$"#,##0.0,,,"B"',
  currency_per_sf:      '"$"#,##0.00',
  percent_basis_points: '0.00%',
  percent_one_decimal:  '0.0%',
  integer_count:        '#,##0',
  date_short:           'mm/dd/yyyy',
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
    { key: 'cap_10plus',       header: '10+ Year Cap',        format: 'percent_basis_points', width: 14 },
    { key: 'cap_6to10',        header: '6–10 Year Cap',  format: 'percent_basis_points', width: 16 },
    { key: 'cap_less5',        header: '< 5 Year Cap',        format: 'percent_basis_points', width: 14 },
    { key: 'cap_outside_firm', header: 'Outside Firm Cap',    format: 'percent_basis_points', width: 18 },
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
    { key: 'period_end',       header: 'Quarter End',         format: 'date_short',          width: 13 },
    { key: 'subspecialty',     header: 'Subspecialty',        width: 14 },
    { key: 'avg_dom',          header: 'Avg DOM (days)',      format: 'integer_count',       width: 14 },
    { key: 'pct_of_ask',       header: '% of Ask Price',      format: 'percent_one_decimal', width: 16 },
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
    { key: 'avg_firm_term_years', header: 'Avg Term Remaining',  format: 'integer_count',        width: 18 },
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

export function buildCapitalMarketsWorkbook({ vertical, subspecialty, asOf, charts, brand, masterRows, chartImages }) {
  const palette = (brand?.palette) ? brand.palette : DEFAULT_BRAND.palette;
  const fonts   = (brand?.fonts)   ? brand.fonts   : DEFAULT_BRAND.fonts;

  // Lookup chartImages by chart_template_id for per-tab embedding.
  // chartImages is the array returned by renderChartsToImages(), where each
  // entry is { chart_template_id, name, png: Buffer }. When present, each
  // Data_* tab gets the matching PNG anchored at the top.
  const chartImagesById = new Map();
  if (Array.isArray(chartImages)) {
    for (const ci of chartImages) {
      if (ci?.chart_template_id && ci?.png) {
        chartImagesById.set(ci.chart_template_id, ci.png);
      }
    }
  }

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
    //   Row 24:    title block
    //   Row 25:    subtitle (metric_focus · chart_type · subspecialty)
    //   Row 26:    meta (N rows · view name)
    //   Row 27:    header row
    //   Row 28+:   data rows
    // When no chart image is available, the tab uses the legacy layout
    // (title at row 1, header at row 4, data at row 5).
    const png = chartImagesById.get(chart.chart_template_id);
    const titleRow  = png ? 24 : 1;
    const subRow    = titleRow + 1;
    const metaRow   = titleRow + 2;
    const headerRow_n = png ? 27 : 4;
    const dataStart = headerRow_n + 1;

    const sheet = wb.addWorksheet(tabName, {
      views: [{ showGridLines: false, state: 'frozen', ySplit: headerRow_n }],
    });

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
    }

    // Title block (placement depends on whether chart image is present)
    sheet.getCell(`A${titleRow}`).value = chart.name;
    sheet.getCell(`A${titleRow}`).font = { name: fonts.title_family, size: 14, bold: true, color: { argb: 'FF' + hex(palette.nm_navy) } };
    sheet.getRow(titleRow).height = 22;

    sheet.getCell(`A${subRow}`).value = `${chart.metric_focus || ''} · ${chart.chart_type || ''} · subspecialty=${subspecialty}`;
    sheet.getCell(`A${subRow}`).font = { name: fonts.body_family, size: 9, italic: true, color: { argb: 'FF' + hex(palette.nm_text_muted) } };

    sheet.getCell(`A${metaRow}`).value = `${(chart.rows || []).length} rows · view=${chart.view_name || ''}`;
    sheet.getCell(`A${metaRow}`).font = { name: fonts.body_family, size: 9, color: { argb: 'FF' + hex(palette.nm_text_muted) } };

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
    for (const row of chart.rows || []) {
      const r = sheet.getRow(dataRowIdx);
      cols.forEach((c, i) => {
        let v = row[c.key];
        if (c.format === 'date_short' && typeof v === 'string') {
          // Convert ISO date string to Date object for proper Excel date type
          const d = new Date(v);
          if (!isNaN(d.getTime())) v = d;
        }
        const cell = r.getCell(i + 1);
        cell.value = v == null ? null : v;
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

    // Auto-filter on the header row (location depends on chart-image layout)
    sheet.autoFilter = {
      from: { row: headerRow_n, column: 1 },
      to:   { row: headerRow_n, column: cols.length },
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
      tabColor: { argb: 'FF' + hex(palette.nm_navy) },
    });

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
      tabColor: { argb: 'FF' + hex(palette.nm_navy) },
    });
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
