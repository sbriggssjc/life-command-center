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
  net_lease_spread: [
    { key: 'period_end',         header: 'Quarter End',         format: 'date_short',          width: 13 },
    { key: 'subspecialty',       header: 'Subspecialty',        width: 14 },
    { key: 'treasury_10y_yield', header: '10Y Treasury',        format: 'percent_one_decimal', width: 14 },
    { key: 'avg_cap_rate',       header: 'Market Avg Cap',      format: 'percent_basis_points', width: 16 },
    { key: 'nm_avg_cap',         header: 'NM Avg Cap',          format: 'percent_basis_points', width: 14 },
    { key: 'market_spread',      header: 'Market Spread (bps)', format: 'percent_basis_points', width: 19 },
    { key: 'nm_spread',          header: 'NM Spread (bps)',     format: 'percent_basis_points', width: 17 },
  ],
};

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

export function buildCapitalMarketsWorkbook({ vertical, subspecialty, asOf, charts, brand, masterRows }) {
  const palette = (brand?.palette) ? brand.palette : DEFAULT_BRAND.palette;
  const fonts   = (brand?.fonts)   ? brand.fonts   : DEFAULT_BRAND.fonts;

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

  cover.getCell('B15').value =
    '1. Open the "MasterPasteReady" tab in this workbook.\n' +
    '2. Click cell A2, then Ctrl+Shift+End to select the entire data range.\n' +
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
    const cols    = CHART_COLUMNS[chart.chart_template_id];
    if (!tabName || !cols) continue;

    const sheet = wb.addWorksheet(tabName, { views: [{ showGridLines: false, state: 'frozen', ySplit: 4 }] });

    // Title block
    sheet.getCell('A1').value = chart.name;
    sheet.getCell('A1').font = { name: fonts.title_family, size: 14, bold: true, color: { argb: 'FF' + hex(palette.nm_navy) } };
    sheet.getRow(1).height = 22;

    sheet.getCell('A2').value = `${chart.metric_focus || ''} · ${chart.chart_type || ''} · subspecialty=${subspecialty}`;
    sheet.getCell('A2').font = { name: fonts.body_family, size: 9, italic: true, color: { argb: 'FF' + hex(palette.nm_text_muted) } };

    sheet.getCell('A3').value = `${(chart.rows || []).length} rows · view=${chart.view_name || ''}`;
    sheet.getCell('A3').font = { name: fonts.body_family, size: 9, color: { argb: 'FF' + hex(palette.nm_text_muted) } };

    // Header row at row 4
    const headerRow = sheet.getRow(4);
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

    // Data rows starting at row 5
    let dataRowIdx = 5;
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

    // Auto-filter on header row
    sheet.autoFilter = {
      from: { row: 4, column: 1 },
      to:   { row: 4, column: cols.length },
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
  if (vertical === 'gov' && Array.isArray(masterRows) && masterRows.length > 0) {
    const ms = wb.addWorksheet('MasterPasteReady', {
      views: [{ showGridLines: false, state: 'frozen', ySplit: 2 }],
      tabColor: { argb: 'FF' + hex(palette.nm_navy) },
    });

    // Title block
    ms.getCell('A1').value = `Government Master "All Charts" — Paste-Ready (subspecialty: ${subspecialty})`;
    ms.getCell('A1').font = { name: fonts.title_family, size: 14, bold: true, color: { argb: 'FF' + hex(palette.nm_navy) } };
    ms.mergeCells('A1:F1');
    ms.getRow(1).height = 22;

    // Header row at row 2 (matches master "All Charts" row 2 header layout)
    const msHeader = ms.getRow(2);
    GOV_MASTER_PASTE_LAYOUT.forEach((c, i) => {
      const cell = msHeader.getCell(i + 1);
      cell.value = c.header;
      cell.font = { name: fonts.title_family, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + hex(palette.nm_navy) } };
      cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
      cell.border = { bottom: { style: 'medium', color: { argb: 'FF' + hex(palette.nm_navy) } } };
    });
    msHeader.height = 32;

    // Column widths + number formats
    GOV_MASTER_PASTE_LAYOUT.forEach((c, i) => {
      const col = ms.getColumn(i + 1);
      col.width = c.width || 14;
      if (c.format && FMT[c.format]) col.numFmt = FMT[c.format];
    });

    // Data rows starting at row 3 (so when marketing copies A3:Xend and pastes
    // at master's All Charts!B3, the columns align with the master's B onward
    // — the master uses B for Quarter through Y for Municipal Cap)
    let r = 3;
    for (const row of masterRows) {
      const dataRow = ms.getRow(r);
      GOV_MASTER_PASTE_LAYOUT.forEach((c, i) => {
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
        GOV_MASTER_PASTE_LAYOUT.forEach((_, i) => {
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
        { text: 'PASTE INTO GOV MASTER:\n', font: { bold: true, size: 11 } },
        { text: '1. Click A3 (first data row)\n2. Ctrl+Shift+End to select all data\n3. Ctrl+C\n4. Open Copy Government Master Document.xlsx\n5. All Charts tab → click B3\n6. Paste Special → Values\n\nColumn order matches master B-Y exactly.', font: { size: 10 } },
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
