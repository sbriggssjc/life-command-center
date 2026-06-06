// ============================================================================
// Capital Markets — Native Excel chart injection
// Life Command Center
//
// Post-processes an ExcelJS-built workbook buffer to inject native Excel
// chart objects in place of PNG images on the Data_* tabs. ExcelJS v4
// doesn't support writing native charts; this module uses JSZip to inject
// the chart XML, drawing XML, rels, and content-types entries directly.
//
// Same technique cm-template-loader.js uses for the dia master template's
// Charts sheet, but applied per-tab to the data_tabs workbook layout.
//
// Usage:
//   const buf = await wb.xlsx.writeBuffer();
//   const newBuf = await injectNativeCharts(buf, [
//     { tabName: 'Data_Volume_TTM', spec: { type: 'line', ... } },
//     ...
//   ]);
//   return newBuf;
//
// Each spec describes one chart anchored on its tab's data range. The
// builder is small and intentionally limited — start with a few chart
// types, expand by type group as we migrate more chart_template_ids.
// ============================================================================

import JSZip from 'jszip';

// ----------------------------------------------------------------------------
// Excel XML namespace constants
// ----------------------------------------------------------------------------

const NS_CHART     = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const NS_DRAWINGML = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_REL       = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_SS_DRAW   = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';

const CT_CHART = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml';
const CT_DRAWING = 'application/vnd.openxmlformats-officedocument.drawing+xml';

const REL_DRAWING = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing';
const REL_CHART = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart';
const REL_SHEET = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet';

// ----------------------------------------------------------------------------
// XML helpers
// ----------------------------------------------------------------------------

function escapeXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// R37 P1 — default cat-axis date format. Renders 2026-03-31 as "1Q-2026"
// to match the PDF renderer's `Q1 '26` style (user feedback 2026-05-19:
// "we had previously displayed the labels in year and quarter terms").
// Per-template override via spec.catAxNumFmt — set to '0' for year-axis
// charts (case_for_renewal, buyer_class_pct_by_year, rent_by_year_built),
// or to '' to suppress the format on text-axis charts (term buckets,
// state rankings, donuts — those cells hold strings, format would be
// a no-op but emitting it is cleaner to skip).
const DEFAULT_CAT_AX_NUM_FMT = 'q"Q-"yyyy';

// Emit <c:numFmt> for a cat axis. Returns empty string if numFmt is
// falsy or empty.
function catAxNumFmtFrag(numFmt) {
  if (numFmt == null || numFmt === '') return '';
  return `<c:numFmt formatCode="${escapeXml(numFmt)}" sourceLinked="0"/>`;
}

// R60 — force cat-axis labels to render at the LOW end of the value
// axis (the bottom of the chart area) regardless of negative values
// in the data. User notes 2026-05-22 batch 4: "Pace_Cap_Expand: now
// we want the x-axis labels to be dropped below zero so we can see
// the data's movement" — same applies to Inventory_Backlog after the
// R54 sold-below-zero restructure (negative Sold bars would otherwise
// overlap the cat-axis labels positioned at y=0).
//
// Excel's default tickLblPos="nextTo" places labels at the point where
// the cat axis crosses the value axis. For charts with negative
// values this is the middle of the chart area. tickLblPos="low" pins
// labels at the visual bottom — identical to the default appearance
// for all-positive charts, correct for charts with negative bars.
//
// Emitted as a sibling fragment alongside the existing catFmtFrag in
// every chart builder's <c:catAx> block.
const CAT_AX_TICK_LBL_POS = '<c:tickLblPos val="low"/>';

// R66 — vertical text rotation on cat-axis labels (rot=-5400000 = -90°).
// Master Excel (Dialysis Comp Work MASTER.xlsx / Copy Government Master
// Document.xlsx) uses rot="-5400000" on every time-series catAx so the
// month/quarter labels read bottom-to-top, leaving the labels narrow
// enough to fit without overlap or auto-rotation to an awkward angle.
//
// R63 set rot="0" (horizontal) on the assumption that R62's once-per-
// quarter label thinning would leave room. User notes 2026-05-23 (batch
// 6) clarify the opposite: "review our Excel/PDF versions so the
// alignment vertically matches what's in there" — repeated for ~25
// charts. With ~100+ category positions across a typical 25-year monthly
// chart, even sparse quarter labels overflow horizontally and Excel
// auto-cuts them. Vertical rotation is the master's chosen idiom.
//
// txPr appears after spPr / before crossAx in the EG_AxShared sequence.
// Color 595959 (NM neutral gray, dark enough to print) matches R63.
const CAT_AX_VERTICAL_TXT = `<c:txPr>
          <a:bodyPr rot="-5400000" spcFirstLastPara="1" vertOverflow="ellipsis" wrap="square" anchor="ctr" anchorCtr="1"/>
          <a:lstStyle/>
          <a:p><a:pPr><a:defRPr sz="900" b="0" i="0"><a:solidFill><a:srgbClr val="595959"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p>
        </c:txPr>`;
// R66 — retained alias so call sites read naturally; R63's "horizontal"
// naming was a misnomer once the master parity was confirmed.
const CAT_AX_HORIZONTAL_TXT = CAT_AX_VERTICAL_TXT;

// ----------------------------------------------------------------------------
// R37 P2 — value-axis range pinning + number format
// ----------------------------------------------------------------------------
// User feedback 2026-05-19 item #3: "axis formatting has changed on
// most charts, adjust". The native chart XML I shipped in R34-R36 has
// no <c:scaling><c:min/><c:max/>, so Excel auto-scales — often into a
// range that buries the data signal (e.g. cap rates 6-9% on a 0-100%
// auto axis).
//
// Mirror the PNG renderer's per-template yAxisRange settings (defined
// at the top of cm-chart-image-renderer.js as CAP_RATE_RANGE, etc.).

// OOXML format-code constants — direct equivalents of the renderer's
// AXIS_FORMAT_* objects, translated to Excel custom number formats.
//
// R38 (audit finding B) — adopt the CRE-standard `[Red](N)` negative
// idiom on currency + integer formats. Master Excel uses
// `#,##0_);[Red]\(#,##0\)` for negatives in red parens; export was using
// bare formats that show negatives with a minus sign. Percent formats
// are left bare since negative percents in CRE typically read as a
// minus sign (yoy_volume_change, pace_of_cap_rate_expansion, etc.)
// rather than red parens.
const VAL_FMT_PERCENT_2DP = '0.00%';
const VAL_FMT_PERCENT_1DP = '0.0%';
const VAL_FMT_PERCENT_0DP = '0%';
// Round 70 A2 — pace_of_cap_rate_expansion data is in basis points (composer
// ×10000); value axis shows integer bps (negatives with a minus sign).
const VAL_FMT_BPS         = '0 "bps";-0 "bps"';
const VAL_FMT_CURRENCY    = '$#,##0_);[Red]($#,##0)';
const VAL_FMT_CURRENCY_M  = '$#,##0,,"M"_);[Red]($#,##0,,"M")';   // millions ($150M / red ($150M))
const VAL_FMT_CURRENCY_K  = '$#,##0,"K"_);[Red]($#,##0,"K")';     // thousands ($150K / red ($150K))
// R64 — $X.XM (1 decimal millions) for chart y-axis labels where the
// magnitude is small enough that a single decimal place adds info.
// User notes 2026-05-22 batch 5: "Let's adjust the y-axis labels so
// that they are formatted in the same $7.0M style" (Avg_Deal_Size).
const VAL_FMT_CURRENCY_M_1DP = '$#,##0.0,,"M"_);[Red]($#,##0.0,,"M")';
// R64 — $X.XXB (2 decimal billions) for Volume_TTM. User: "Let's
// adjust the y-axis label formats to show $1.80B or something similar"
const VAL_FMT_CURRENCY_B  = '$#,##0.00,,,"B"_);[Red]($#,##0.00,,,"B")';
const VAL_FMT_INTEGER     = '#,##0_);[Red](#,##0)';

// Common range constants matching the renderer's shared ranges
const CAP_RATE_RANGE          = { min: 0.05,  max: 0.10  };
const CAP_RATE_TIGHT_RANGE    = { min: 0.05,  max: 0.08  };
const CAP_RATE_BID_ASK_RANGE  = { min: 0.055, max: 0.100 };
const CAP_RATE_DOT_RANGE      = { min: 0.04,  max: 0.12  };
const CAP_RATE_COHORT_RANGE   = { min: 0.04,  max: 0.11  };
const PCT_OF_ASK_RANGE        = { min: 0.85,  max: 1.05  };

// Emit <c:scaling> block with optional min/max. If both are undefined
// returns the default orientation-only scaling. otherwise embeds the
// pinned range.
function valAxScalingFrag(range) {
  if (!range || (range.min == null && range.max == null)) {
    return '<c:scaling><c:orientation val="minMax"/></c:scaling>';
  }
  const minFrag = range.min != null ? `<c:min val="${range.min}"/>` : '';
  const maxFrag = range.max != null ? `<c:max val="${range.max}"/>` : '';
  return `<c:scaling><c:orientation val="minMax"/>${minFrag}${maxFrag}</c:scaling>`;
}

// Emit <c:numFmt> for a val axis. Returns empty string if no fmt.
function valAxNumFmtFrag(numFmt) {
  if (numFmt == null || numFmt === '') return '';
  return `<c:numFmt formatCode="${escapeXml(numFmt)}" sourceLinked="0"/>`;
}

// R41 — explicit major gridlines on val axes. Matches the master Excel
// docs (audit/cm-style-audit) which use a light-gray gridline at every
// major tick. Excel will fall back to its theme defaults if we omit
// this, but the rendering can be inconsistent across Excel versions —
// emitting the gridlines block explicitly pins the visual.
//
// Master uses tx1 schemeClr with lumMod 15000 / lumOff 85000
// (= "Black, Text 1, Lighter 85%" → ~#D9D9D9). We use the equivalent
// srgbClr so the color stays consistent regardless of the workbook's
// theme — same approach we use for series colors elsewhere.
const VAL_AX_GRIDLINE_COLOR = 'D9D9D9';  // ~85%-lightened tx1 (master parity)
const MAJOR_GRIDLINES_FRAG =
  `<c:majorGridlines>` +
    `<c:spPr><a:ln w="9525" cap="flat" cmpd="sng" algn="ctr">` +
      `<a:solidFill><a:srgbClr val="${VAL_AX_GRIDLINE_COLOR}"/></a:solidFill>` +
      `<a:round/>` +
    `</a:ln></c:spPr>` +
  `</c:majorGridlines>`;

// ----------------------------------------------------------------------------
// R37 P3 — peak/trough/most-recent data labels
// ----------------------------------------------------------------------------
// User feedback 2026-05-19, item #2: "most of the data labels are gone
// (lowest, highest and most recent)". The PNG renderer adds annotation
// labels via buildAnnotations(rows, getter, formatter) that mark the
// max/min/last data points with formatted bubbles. Native chart XML
// needs <c:dLbls> + per-point <c:dLbl idx="N"/> blocks to achieve the
// equivalent.

// Format helpers matching cm-chart-image-renderer.js fmt* functions
const fmtPct1Native        = (v) => (Number(v) * 100).toFixed(1) + '%';
const fmtPct2Native        = (v) => (Number(v) * 100).toFixed(2) + '%';
const fmtCurrencyMNative   = (v) => '$' + (Number(v) / 1_000_000).toFixed(1) + 'M';
const fmtCurrencyBNative   = (v) => '$' + (Number(v) / 1_000_000_000).toFixed(2) + 'B';  // R64 — "$1.80B"
const fmtCurrencyNative    = (v) => '$' + Math.round(Number(v)).toLocaleString('en-US');
const fmtCurrencyKNative   = (v) => '$' + Math.round(Number(v) / 1000) + 'K';
const fmtIndexNative       = (v) => Number(v).toFixed(1);
const fmtCurrencyPerSfNative = (v) => '$' + Number(v).toFixed(2);

// Map a named formatter string to its function. Used in the buildInjectionSpec
// switch cases so per-template config stays declarative.
const ANNOTATION_FORMATTERS = {
  pct1:          fmtPct1Native,
  pct2:          fmtPct2Native,
  currency:      fmtCurrencyNative,
  currency_m:    fmtCurrencyMNative,
  currency_b:    fmtCurrencyBNative,        // R64 — "$1.80B" annotation labels
  currency_k:    fmtCurrencyKNative,
  currency_psf:  fmtCurrencyPerSfNative,
  index:         fmtIndexNative,
};

/**
 * Given an array of rows + a value-extraction function, return the
 * indices and formatted labels for the max, min, and last data points.
 * Mirrors cm-chart-image-renderer.js buildAnnotations.
 *
 * @param {Array} rows
 * @param {Function} getter (row) => number|null
 * @param {Function} formatter (number) => string
 * @returns {Array<{idx: number, text: string}>} 0..3 label entries
 */
function buildAnnotationsForSpec(rows, getter, formatter) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  // Filter to (idx, val) where val is a finite number
  const points = rows
    .map((r, i) => ({ idx: i, val: getter(r) }))
    .filter(p => p.val != null && Number.isFinite(Number(p.val)));
  if (points.length < 3) return [];

  let maxP = points[0], minP = points[0];
  for (const p of points) {
    if (Number(p.val) > Number(maxP.val)) maxP = p;
    if (Number(p.val) < Number(minP.val)) minP = p;
  }
  const lastP = points[points.length - 1];

  const out = [];
  // Last (primary callout — emit first so it's deterministically present)
  out.push({ idx: lastP.idx, text: formatter(lastP.val) });
  // Max — emit only if distinct from last
  if (maxP.idx !== lastP.idx) {
    out.push({ idx: maxP.idx, text: formatter(maxP.val) });
  }
  // Min — emit only if distinct from both
  if (minP.idx !== lastP.idx && minP.idx !== maxP.idx) {
    out.push({ idx: minP.idx, text: formatter(minP.val) });
  }
  return out;
}

/**
 * Emit a single <c:dLbl> block overriding one data point with a custom
 * text label. The other points in the series get no label (via the
 * surrounding <c:dLbls> showXxx=0 defaults).
 */
function dLblXml(idx, text) {
  return `          <c:dLbl>
            <c:idx val="${idx}"/>
            <c:tx>
              <c:rich>
                <a:bodyPr wrap="none" anchor="ctr"/>
                <a:lstStyle/>
                <a:p>
                  <a:r>
                    <a:rPr lang="en-US" b="1" sz="900"/>
                    <a:t>${escapeXml(text)}</a:t>
                  </a:r>
                </a:p>
              </c:rich>
            </c:tx>
            <c:showLegendKey val="0"/>
            <c:showVal val="0"/>
            <c:showCatName val="0"/>
            <c:showSerName val="0"/>
            <c:showPercent val="0"/>
            <c:showBubbleSize val="0"/>
          </c:dLbl>`;
}

// R38 (audit finding A) — embedded <c:title> block at the top of every
// chart so the chart object itself carries its name (matches master
// Excel charts which display titles like "Average Asking Capitalization
// Rate (TTM)" above the plot area). Each builder injects this fragment
// just inside <c:chart>, before <c:autoTitleDeleted>.
//
// Style: 12pt bold, NM navy (003DA5) — matches the title cells in
// cm-excel-export.js (`titleRow` line ~1250).
function chartTitleXml(text) {
  if (!text) return '<c:autoTitleDeleted val="1"/>';
  return `<c:title>
      <c:tx>
        <c:rich>
          <a:bodyPr rot="0" spcFirstLastPara="1" vertOverflow="ellipsis" wrap="square" anchor="ctr" anchorCtr="1"/>
          <a:lstStyle/>
          <a:p>
            <a:pPr algn="ctr">
              <a:defRPr sz="1200" b="1" i="0" u="none" strike="noStrike" kern="1200" spc="0" baseline="0">
                <a:solidFill><a:srgbClr val="003DA5"/></a:solidFill>
                <a:latin typeface="+mn-lt"/>
                <a:ea typeface="+mn-ea"/>
                <a:cs typeface="+mn-cs"/>
              </a:defRPr>
            </a:pPr>
            <a:r>
              <a:rPr lang="en-US" sz="1200" b="1">
                <a:solidFill><a:srgbClr val="003DA5"/></a:solidFill>
              </a:rPr>
              <a:t>${escapeXml(text)}</a:t>
            </a:r>
          </a:p>
        </c:rich>
      </c:tx>
      <c:overlay val="0"/>
      <c:spPr>
        <a:noFill/>
        <a:ln><a:noFill/></a:ln>
      </c:spPr>
    </c:title>
    <c:autoTitleDeleted val="0"/>`;
}

// R39 — Excel built-in trendline element. Replaces the helper-column
// approach for scatter dot plots so the trendline matches the master
// Excel docs (Core Cap Chart uses polynomial order 3 with 720-day
// forward forecast; Available Comps uses linear regression).
//
// Once attached to a scatter <c:ser>, Excel computes the trendline
// natively from the series' xVal/yVal pairs — no helper column needed
// and users can right-click → Format Trendline to adjust in Excel.
//
// @param {object} t  trendline config:
//   { type: 'linear' | 'poly' | 'exp' | 'log' | 'power' | 'movingAvg',
//     order?: number (poly only, default 2),
//     period?: number (movingAvg only),
//     forward?: number (forecast units forward, default 0),
//     backward?: number (forecast units backward, default 0),
//     dashed?: boolean (sysDot for the line, default false),
//     color?: string (hex without #, default navy 003DA5) }
// Returns the <c:trendline> XML fragment, or empty string if t is null.
function trendlineXml(t) {
  if (!t || !t.type) return '';
  const color = (t.color || '003DA5').replace('#', '');
  const dashFrag = t.dashed ? '<a:prstDash val="sysDot"/>' : '';
  const orderFrag = t.type === 'poly' && t.order ? `<c:order val="${t.order}"/>` : '';
  const periodFrag = t.type === 'movingAvg' && t.period ? `<c:period val="${t.period}"/>` : '';
  const forwardFrag = t.forward != null ? `<c:forward val="${t.forward}"/>` : '';
  const backwardFrag = t.backward != null ? `<c:backward val="${t.backward}"/>` : '';
  return `          <c:trendline>
            <c:spPr>
              <a:ln w="19050" cap="rnd"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill>${dashFrag}</a:ln>
            </c:spPr>
            <c:trendlineType val="${t.type}"/>
            ${orderFrag}
            ${periodFrag}
            ${forwardFrag}
            ${backwardFrag}
            <c:dispRSqr val="0"/>
            <c:dispEq val="0"/>
          </c:trendline>`;
}

/**
 * Emit a <c:dLbls> block. Three modes:
 *
 *   1. Array of { idx, text } objects (R37 P3 peak/trough/last labels).
 *      Emits per-point overrides + suppresses the rest.
 *   2. { showVal: true } — turn on chart-level value labels (showVal=1)
 *      so EVERY data point displays its value. Used by R60 for
 *      Avail_by_Term_Summary dot callouts where each dot's cap-rate
 *      value should be visible. Optional numFmt for label format
 *      (defaults to source-linked).
 *   3. Anything else → empty (no label block emitted).
 */
function dLblsXml(spec) {
  // Mode 1 — legacy array of per-point labels (R37 P3)
  if (Array.isArray(spec) && spec.length > 0) {
    const lbls = spec.map(p => dLblXml(p.idx, p.text)).join('\n');
    return `        <c:dLbls>
${lbls}
          <c:showLegendKey val="0"/>
          <c:showVal val="0"/>
          <c:showCatName val="0"/>
          <c:showSerName val="0"/>
          <c:showPercent val="0"/>
          <c:showBubbleSize val="0"/>
        </c:dLbls>`;
  }
  // Mode 2 — R60 chart-level showVal for "label every point" mode
  if (spec && typeof spec === 'object' && spec.showVal === true) {
    const numFmtFrag = spec.numFmt
      ? `<c:numFmt formatCode="${escapeXml(spec.numFmt)}" sourceLinked="0"/>`
      : '';
    // R69 Task 5 — optional per-series label position (t/b/l/r/ctr). Lets the
    // firm-term-bucket combo (G23/D9) spread its 4 overlapping cap labels
    // around their diamonds instead of stacking them all above (default 't').
    const pos = ['t', 'b', 'l', 'r', 'ctr'].includes(spec.pos) ? spec.pos : 't';
    return `        <c:dLbls>
          ${numFmtFrag}
          <c:dLblPos val="${pos}"/>
          <c:showLegendKey val="0"/>
          <c:showVal val="1"/>
          <c:showCatName val="0"/>
          <c:showSerName val="0"/>
          <c:showPercent val="0"/>
          <c:showBubbleSize val="0"/>
        </c:dLbls>`;
  }
  return '';
}

// ----------------------------------------------------------------------------
// Chart XML builders (one per supported chart type)
// ----------------------------------------------------------------------------

/**
 * Generate a single-line chart referencing a categorical x-axis (e.g.
 * period_end labels) and a single numeric y-series.
 *
 * @param {object} spec
 * @param {string} spec.tabName        Data_* tab name (sheet name in workbook)
 * @param {string} spec.titleCell      Cell ref for series label (e.g. "B5")
 * @param {string} spec.catRange       Range for category axis values (e.g. "A6:A305")
 * @param {string} spec.valRange       Range for series numeric values (e.g. "B6:B305")
 * @param {string} [spec.color]        Series color hex without # (e.g. "003DA5")
 * @returns {string} chart XML
 */
function buildSingleLineChartXml(spec) {
  const sheet = escapeXml(spec.tabName);
  const color = spec.color || '003DA5';
  // R37 P1 — quarter-format date labels on cat axis by default.
  const catFmtFrag = catAxNumFmtFrag(
    spec.catAxNumFmt !== undefined ? spec.catAxNumFmt : DEFAULT_CAT_AX_NUM_FMT
  );
  // R37 P2 — pin val axis range + format from spec (auto-scale if absent)
  const valScalingFrag = valAxScalingFrag(spec.yAxisRange);
  const valFmtFrag     = valAxNumFmtFrag(spec.valAxNumFmt);
  // R37 P3 — peak/trough/most-recent data labels
  const dLblsFrag = dLblsXml(spec.dataLabels);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${NS_CHART}" xmlns:a="${NS_DRAWINGML}" xmlns:r="${NS_REL}">
  <c:roundedCorners val="0"/>
  <c:chart>
    ${chartTitleXml(spec.title)}
    <c:plotArea>
      <c:layout/>
      <c:lineChart>
        <c:grouping val="standard"/>
        <c:varyColors val="0"/>
        <c:ser>
          <c:idx val="0"/>
          <c:order val="0"/>
          <c:tx>
            <c:strRef><c:f>'${sheet}'!$${spec.titleCol || 'B'}$${spec.titleRow || 5}</c:f></c:strRef>
          </c:tx>
          <c:spPr>
            <a:ln w="22225" cap="rnd"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:round/></a:ln>
          </c:spPr>
          <c:marker><c:symbol val="none"/></c:marker>
${dLblsFrag}
          <c:cat>
            <c:numRef><c:f>'${sheet}'!$${spec.catCol}$${spec.dataStart}:$${spec.catCol}$${spec.dataEnd}</c:f></c:numRef>
          </c:cat>
          <c:val>
            <c:numRef><c:f>'${sheet}'!$${spec.valCol}$${spec.dataStart}:$${spec.valCol}$${spec.dataEnd}</c:f></c:numRef>
          </c:val>
          <c:smooth val="0"/>
        </c:ser>
        <c:marker val="0"/>
        <c:axId val="1"/>
        <c:axId val="2"/>
      </c:lineChart>
      <c:catAx>
        <c:axId val="1"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="b"/>
        ${catFmtFrag}
        ${CAT_AX_TICK_LBL_POS}
        ${CAT_AX_HORIZONTAL_TXT}
        <c:crossAx val="2"/>
      </c:catAx>
      <c:valAx>
        <c:axId val="2"/>
        ${valScalingFrag}
        <c:delete val="0"/>
        <c:axPos val="l"/>
        ${MAJOR_GRIDLINES_FRAG}
        ${valFmtFrag}
        <c:crossAx val="1"/>
      </c:valAx>
    </c:plotArea>
    <c:plotVisOnly val="1"/>
    <c:dispBlanksAs val="gap"/>
  </c:chart>
</c:chartSpace>`;
}

/**
 * Generate a single-bar chart referencing a categorical x-axis and a
 * single numeric y-series. Used for transaction count, avg deal size,
 * YoY change (with optional signed coloring), quarterly volume, etc.
 */
function buildSingleBarChartXml(spec) {
  const sheet = escapeXml(spec.tabName);
  const color = (spec.color || '003DA5').replace('#', '');
  // R36 P1 — `horizontal: true` produces a horizontal bar chart (top-N
  // state ranking visual). In OOXML this means:
  //   • <c:barDir val="bar"/> instead of "col"
  //   • catAx.axPos="l" (categories on the LEFT, listed top-to-bottom)
  //     For top-N rankings we want the largest at the TOP, so the cat
  //     axis also flips orientation to maxMin.
  //   • valAx.axPos="b" (values on the BOTTOM)
  const horizontal = !!spec.horizontal;
  const barDir = horizontal ? 'bar' : 'col';
  const catAxPos = horizontal ? 'l' : 'b';
  const valAxPos = horizontal ? 'b' : 'l';
  // R37 P1 — quarter labels on date cat axes. For horizontal-bar
  // state rankings (state names = text cat values), default to '' so
  // no numFmt is emitted (Excel renders strings as-is).
  const catFmtFrag = catAxNumFmtFrag(
    spec.catAxNumFmt !== undefined
      ? spec.catAxNumFmt
      : (horizontal ? '' : DEFAULT_CAT_AX_NUM_FMT)
  );
  // R37 P2 — pin val axis range + format from spec
  const valScalingFrag = valAxScalingFrag(spec.yAxisRange);
  const valFmtFrag     = valAxNumFmtFrag(spec.valAxNumFmt);
  // R37 P3 — peak/trough/most-recent data labels
  const dLblsFrag = dLblsXml(spec.dataLabels);
  // Horizontal bar: orient cat axis maxMin so largest values appear at top
  const catOrientation = horizontal ? 'maxMin' : 'minMax';
  // R68-E (G11): for horizontal state-ranking bars, the shared
  // tickLblPos="low" pinned every category label to the value-axis low end,
  // detaching the state name from its bar row ("ambiguous which bar"). Use
  // tickLblPos="nextTo" + centered lblAlgn so each label sits beside its own
  // bar. Vertical (date) axes keep the shared 'low' pin unchanged.
  const catTickLblPos = horizontal ? '<c:tickLblPos val="nextTo"/>' : CAT_AX_TICK_LBL_POS;
  const catLblAlignFrag = horizontal
    ? '<c:lblAlgn val="ctr"/><c:lblOffset val="100"/>'
    : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${NS_CHART}" xmlns:a="${NS_DRAWINGML}" xmlns:r="${NS_REL}">
  <c:roundedCorners val="0"/>
  <c:chart>
    ${chartTitleXml(spec.title)}
    <c:plotArea>
      <c:layout/>
      <c:barChart>
        <c:barDir val="${barDir}"/>
        <c:grouping val="clustered"/>
        <c:varyColors val="0"/>
        <c:ser>
          <c:idx val="0"/>
          <c:order val="0"/>
          <c:tx>
            <c:strRef><c:f>'${sheet}'!$${spec.titleCol}$${spec.titleRow}</c:f></c:strRef>
          </c:tx>
          <c:spPr>
            <a:solidFill><a:srgbClr val="${color}"/></a:solidFill>
          </c:spPr>
          <c:invertIfNegative val="0"/>
${dLblsFrag}
          <c:cat>
            <c:numRef><c:f>'${sheet}'!$${spec.catCol}$${spec.dataStart}:$${spec.catCol}$${spec.dataEnd}</c:f></c:numRef>
          </c:cat>
          <c:val>
            <c:numRef><c:f>'${sheet}'!$${spec.valCol}$${spec.dataStart}:$${spec.valCol}$${spec.dataEnd}</c:f></c:numRef>
          </c:val>
        </c:ser>
        <c:gapWidth val="60"/>
        <c:overlap val="-20"/>
        <c:axId val="1"/>
        <c:axId val="2"/>
      </c:barChart>
      <c:catAx>
        <c:axId val="1"/>
        <c:scaling><c:orientation val="${catOrientation}"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="${catAxPos}"/>
        ${catFmtFrag}
        ${catTickLblPos}
        ${CAT_AX_HORIZONTAL_TXT}
        <c:crossAx val="2"/>
        ${catLblAlignFrag}
      </c:catAx>
      <c:valAx>
        <c:axId val="2"/>
        ${valScalingFrag}
        <c:delete val="0"/>
        <c:axPos val="${valAxPos}"/>
        ${MAJOR_GRIDLINES_FRAG}
        ${valFmtFrag}
        <c:crossAx val="1"/>
      </c:valAx>
    </c:plotArea>
    <c:plotVisOnly val="1"/>
    <c:dispBlanksAs val="gap"/>
  </c:chart>
</c:chartSpace>`;
}

/**
 * Generate a stacked column chart with N series sharing one x-axis.
 * Each series stacks on top of the previous (grouping=stacked, overlap=100).
 *
 * @param {object} spec
 * @param {string} spec.tabName        Data_* tab name
 * @param {string} spec.catCol         Column letter for x-axis (categories)
 * @param {number} spec.dataStart      First data row (1-indexed)
 * @param {number} spec.dataEnd        Last data row (inclusive)
 * @param {Array}  spec.series         List of { titleCol, titleRow, valCol, color }
 * @returns {string} chart XML
 */
function buildStackedBarChartXml(spec) {
  const sheet = escapeXml(spec.tabName);
  // R37 P1 — quarter labels on date cat axes by default
  const catFmtFrag = catAxNumFmtFrag(
    spec.catAxNumFmt !== undefined ? spec.catAxNumFmt : DEFAULT_CAT_AX_NUM_FMT
  );
  // R37 P2 — pin val axis range + format
  const valScalingFrag = valAxScalingFrag(spec.yAxisRange);
  const valFmtFrag     = valAxNumFmtFrag(spec.valAxNumFmt);
  const seriesXml = spec.series.map((s, i) => {
    const color = (s.color || '003DA5').replace('#', '');
    // P8 — `noFill` flag makes a series transparent. Used to build
    // floating-bar visuals: invisible base stack + visible top stack.
    // <a:noFill/> on the fill + <a:noFill/> on the line border.
    //
    // R35 P4 — `alpha` flag (string '0'..'100000') applies a transparency
    // to the fill color. Used by cost_of_capital for the pale gray
    // mortgage-constant band (renderer's rgba(106,116,140,0.12) → 12% alpha).
    // Optional `borderColor` lets the bar have a visible border distinct
    // from its fill (matches the renderer's idiom of pale fill + solid border).
    const alphaFrag = s.alpha ? `<a:alpha val="${s.alpha}"/>` : '';
    const fillFrag = s.noFill
      ? `<a:noFill/>`
      : `<a:solidFill><a:srgbClr val="${color}">${alphaFrag}</a:srgbClr></a:solidFill>`;
    let lineFrag = '';
    if (s.noFill) {
      lineFrag = `<a:ln><a:noFill/></a:ln>`;
    } else if (s.borderColor) {
      const borderColor = s.borderColor.replace('#', '');
      lineFrag = `<a:ln w="9525"><a:solidFill><a:srgbClr val="${borderColor}"/></a:solidFill></a:ln>`;
    }
    // R46 — per-series in-bar value labels (for stacked % charts like
    // buyer_class_pct_by_year). User feedback 2026-05-21: "Data_Buyer_Pool:
    // Missing the data labels". When `s.showSegmentVal=true` is set on
    // the series, emit a <c:dLbls> block that renders each bar segment's
    // value inside the bar. Honors `s.segmentLabelFmt` (e.g. '0%') and
    // `s.segmentLabelColor` (white for dark fills, black for pale fills).
    let segLblFrag = '';
    if (s.showSegmentVal) {
      const lblFmt   = s.segmentLabelFmt   || '0%';
      const lblColor = (s.segmentLabelColor || 'FFFFFF').replace('#', '');
      segLblFrag = `          <c:dLbls>
            <c:numFmt formatCode="${escapeXml(lblFmt)}" sourceLinked="0"/>
            <c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>
            <c:txPr>
              <a:bodyPr rot="0" spcFirstLastPara="1" vertOverflow="ellipsis" wrap="square" anchor="ctr" anchorCtr="1"/>
              <a:lstStyle/>
              <a:p><a:pPr><a:defRPr sz="900" b="1"><a:solidFill><a:srgbClr val="${lblColor}"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p>
            </c:txPr>
            <c:dLblPos val="ctr"/>
            <c:showLegendKey val="0"/>
            <c:showVal val="1"/>
            <c:showCatName val="0"/>
            <c:showSerName val="0"/>
            <c:showPercent val="0"/>
            <c:showBubbleSize val="0"/>
          </c:dLbls>`;
    }
    return `        <c:ser>
          <c:idx val="${i}"/>
          <c:order val="${i}"/>
          <c:tx><c:strRef><c:f>'${sheet}'!$${s.titleCol}$${s.titleRow}</c:f></c:strRef></c:tx>
          <c:spPr>${fillFrag}${lineFrag}</c:spPr>
          <c:invertIfNegative val="0"/>
${segLblFrag}
          <c:cat><c:numRef><c:f>'${sheet}'!$${spec.catCol}$${spec.dataStart}:$${spec.catCol}$${spec.dataEnd}</c:f></c:numRef></c:cat>
          <c:val><c:numRef><c:f>'${sheet}'!$${s.valCol}$${spec.dataStart}:$${s.valCol}$${spec.dataEnd}</c:f></c:numRef></c:val>
        </c:ser>`;
  }).join('\n');

  // R35 P2 — also serves the 'clustered-bar' dispatch type.
  // grouping='stacked' (default) gives the original stacked-column visual
  // with overlap=100. grouping='clustered' gives side-by-side bars per
  // category with overlap=-20 — used for inventory_backlog and
  // pace_of_cap_rate_expansion which the renderer emits as multi-bar
  // single-axis charts.
  const grouping = spec.grouping === 'clustered' ? 'clustered' : 'stacked';
  const overlap  = grouping === 'clustered' ? -20 : 100;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${NS_CHART}" xmlns:a="${NS_DRAWINGML}" xmlns:r="${NS_REL}">
  <c:roundedCorners val="0"/>
  <c:chart>
    ${chartTitleXml(spec.title)}
    <c:plotArea>
      <c:layout/>
      <c:barChart>
        <c:barDir val="col"/>
        <c:grouping val="${grouping}"/>
        <c:varyColors val="0"/>
${seriesXml}
        <c:gapWidth val="60"/>
        <c:overlap val="${overlap}"/>
        <c:axId val="1"/>
        <c:axId val="2"/>
      </c:barChart>
      <c:catAx>
        <c:axId val="1"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="b"/>
        ${catFmtFrag}
        ${CAT_AX_TICK_LBL_POS}
        ${CAT_AX_HORIZONTAL_TXT}
        <c:crossAx val="2"/>
      </c:catAx>
      <c:valAx>
        <c:axId val="2"/>
        ${valScalingFrag}
        <c:delete val="0"/>
        <c:axPos val="l"/>
        ${MAJOR_GRIDLINES_FRAG}
        ${valFmtFrag}
        <c:crossAx val="1"/>
      </c:valAx>
    </c:plotArea>
    <c:legend>
      <c:legendPos val="b"/>
      <c:overlay val="0"/>
    </c:legend>
    <c:plotVisOnly val="1"/>
    <c:dispBlanksAs val="gap"/>
  </c:chart>
</c:chartSpace>`;
}

/**
 * Generate a multi-line chart with N series sharing one categorical x-axis.
 * Same shape as buildSingleLineChartXml but takes a series[] array so each
 * series gets its own title cell, color, and val column. Useful for cohort
 * line charts (cap_rate_by_lease_term, nm_vs_market_cap, etc.).
 *
 * @param {object} spec
 * @param {string} spec.tabName      Data_* tab name
 * @param {string} spec.catCol       Column letter for x-axis categories
 * @param {number} spec.dataStart    First data row (1-indexed)
 * @param {number} spec.dataEnd      Last data row (inclusive)
 * @param {Array}  spec.series       List of { titleCol, titleRow, valCol, color, [dashed] }
 * @param {'standard'|'stacked'} [spec.lineGrouping]  Default 'standard'.
 *        'stacked' makes Excel render each series at value=cumulative sum
 *        of all earlier series at that x — used by the Bid_Ask chart
 *        (R50): bottom line = Last Ask (ttm) at its raw cap rate; top
 *        line = Last Ask + Bid-Ask Spread. The visible distance between
 *        the two stacked lines is the spread itself, which combined with
 *        upDownBars draws the floating "drop down" bars the master uses.
 * @param {boolean} [spec.upDownBars] If true, emit <c:upDownBars/> as a
 *        chart-level sibling of the series. Excel draws gray bars between
 *        the FIRST and LAST series at each category, visually marking the
 *        gap. Pairs with lineGrouping='stacked' to produce the master's
 *        bid-ask "drop bars above the last ask" visual.
 * @returns {string} chart XML
 */
function buildMultiLineChartXml(spec) {
  const sheet = escapeXml(spec.tabName);
  // R37 P1 — quarter labels on date cat axes by default
  const catFmtFrag = catAxNumFmtFrag(
    spec.catAxNumFmt !== undefined ? spec.catAxNumFmt : DEFAULT_CAT_AX_NUM_FMT
  );
  // R37 P2 — pin val axis range + format
  const valScalingFrag = valAxScalingFrag(spec.yAxisRange);
  const valFmtFrag     = valAxNumFmtFrag(spec.valAxNumFmt);
  const seriesXml = spec.series.map((s, i) => {
    const color = (s.color || '003DA5').replace('#', '');
    // Dashed line variant (e.g. gov "Outside Firm" cohort) — Excel
    // renders <a:prstDash val="dash"/> as a regular dashed stroke.
    const dashFrag = s.dashed
      ? `<a:prstDash val="dash"/>`
      : '';
    // R37 P3 — per-series data labels
    const dLblsFrag = dLblsXml(s.dataLabels);
    return `        <c:ser>
          <c:idx val="${i}"/>
          <c:order val="${i}"/>
          <c:tx><c:strRef><c:f>'${sheet}'!$${s.titleCol}$${s.titleRow}</c:f></c:strRef></c:tx>
          <c:spPr>
            <a:ln w="22225" cap="rnd"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill>${dashFrag}<a:round/></a:ln>
          </c:spPr>
          <c:marker><c:symbol val="none"/></c:marker>
${dLblsFrag}
          <c:cat><c:numRef><c:f>'${sheet}'!$${spec.catCol}$${spec.dataStart}:$${spec.catCol}$${spec.dataEnd}</c:f></c:numRef></c:cat>
          <c:val><c:numRef><c:f>'${sheet}'!$${s.valCol}$${spec.dataStart}:$${s.valCol}$${spec.dataEnd}</c:f></c:numRef></c:val>
          <c:smooth val="0"/>
        </c:ser>`;
  }).join('\n');

  // R50 — optional stacked grouping + chart-level up-down bars.
  // upDownBars is a child of <c:lineChart> AFTER all <c:ser> blocks and
  // BEFORE <c:axId/>, per OOXML schema (CT_LineChart sequence). Excel
  // renders gray bars connecting the first-vs-last series at each x point,
  // creating the "drop bar above the last ask" visual the master uses.
  const lineGrouping = spec.lineGrouping === 'stacked' ? 'stacked' : 'standard';
  // R66o — optional thin vertical connectors between the series at each x point
  // (the deck's "drop lines" on the NM-vs-Market page). <c:hiLowLines> draws a
  // line from the min to the max series value per category. Per CT_LineChart
  // schema it precedes <c:upDownBars>. Default color = deck market-gray.
  const hiLowColor = (spec.hiLowLines && spec.hiLowLines !== true)
    ? String(spec.hiLowLines).replace('#', '') : 'C9CED6';
  const hiLowLinesFrag = spec.hiLowLines
    ? `        <c:hiLowLines><c:spPr><a:ln w="9525" cap="rnd"><a:solidFill><a:srgbClr val="${hiLowColor}"/></a:solidFill><a:round/></a:ln></c:spPr></c:hiLowLines>`
    : '';
  const upDownBarsFrag = spec.upDownBars
    ? `        <c:upDownBars>
          <c:gapWidth val="150"/>
          <c:upBars><c:spPr><a:solidFill><a:srgbClr val="D8DFDF"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="9EA9B7"/></a:solidFill></a:ln></c:spPr></c:upBars>
          <c:downBars><c:spPr><a:solidFill><a:srgbClr val="9EA9B7"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="6A748C"/></a:solidFill></a:ln></c:spPr></c:downBars>
        </c:upDownBars>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${NS_CHART}" xmlns:a="${NS_DRAWINGML}" xmlns:r="${NS_REL}">
  <c:roundedCorners val="0"/>
  <c:chart>
    ${chartTitleXml(spec.title)}
    <c:plotArea>
      <c:layout/>
      <c:lineChart>
        <c:grouping val="${lineGrouping}"/>
        <c:varyColors val="0"/>
${seriesXml}
${hiLowLinesFrag}
${upDownBarsFrag}
        <c:marker val="0"/>
        <c:axId val="1"/>
        <c:axId val="2"/>
      </c:lineChart>
      <c:catAx>
        <c:axId val="1"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="b"/>
        ${catFmtFrag}
        ${CAT_AX_TICK_LBL_POS}
        ${CAT_AX_HORIZONTAL_TXT}
        <c:crossAx val="2"/>
      </c:catAx>
      <c:valAx>
        <c:axId val="2"/>
        ${valScalingFrag}
        <c:delete val="0"/>
        <c:axPos val="l"/>
        ${MAJOR_GRIDLINES_FRAG}
        ${valFmtFrag}
        <c:crossAx val="1"/>
      </c:valAx>
    </c:plotArea>
    <c:legend>
      <c:legendPos val="b"/>
      <c:overlay val="0"/>
    </c:legend>
    <c:plotVisOnly val="1"/>
    <c:dispBlanksAs val="gap"/>
  </c:chart>
</c:chartSpace>`;
}

/**
 * Generate a combo (dual-axis) chart with a clustered-bar series group
 * on the LEFT value axis and a line series group on the RIGHT value
 * axis, both sharing the same categorical x-axis.
 *
 * Used for templates where one metric is a count/level (bars, left axis)
 * and another is a rate/percent overlay (line, right axis):
 * dom_and_pct_of_ask, case_for_renewal, available_market_size_combo, etc.
 *
 * OpenXML axis wiring:
 *   axId=1 → shared cat axis (bottom)
 *   axId=2 → primary value axis (left), used by barChart
 *   axId=3 → secondary value axis (right), used by lineChart, crosses=max
 *
 * Series idx values must be unique across both chart blocks, so line-series
 * idx continues from where the bar series leave off.
 *
 * @param {object} spec
 * @param {string} spec.tabName       Data_* tab name
 * @param {string} spec.catCol        Column letter for shared x-axis
 * @param {number} spec.dataStart     1-indexed first data row
 * @param {number} spec.dataEnd       1-indexed last data row (inclusive)
 * @param {Array}  spec.barSeries     List of { titleCol, titleRow, valCol, color, [noFill] }
 * @param {Array}  spec.lineSeries    List of { titleCol, titleRow, valCol, color,
 *                                    [showMarker], [markerShape], [markerSize] }
 *        With showMarker=true the series renders as markers only (no
 *        connecting line) — used for median/avg dot overlays on
 *        rent_by_year_built. markerShape: 'circle' (default), 'diamond',
 *        'square', 'triangle'. markerSize defaults to 5.
 * @param {'clustered'|'stacked'} [spec.barGrouping]  Default 'clustered'.
 *        'stacked' lets the combo express a floating-bar visual (invisible
 *        base + visible band) with a line series overlaid on the same axis.
 * @param {boolean} [spec.sharedAxis] If true, line series uses the SAME val
 *        axis as the bars (axId 2) instead of a secondary right axis (axId 3).
 *        Used for box-whisker visuals where the median line should be on the
 *        same scale as the IQR band.
 * @param {boolean} [spec.swapAxes] If true, bars use the RIGHT axis (axId 3)
 *        and line uses the LEFT axis (axId 2). Default puts bars on left,
 *        line on right. Used for valuation_index where the PDF puts the
 *        index line on the left and YoY bars on the right.
 *        Mutually exclusive with sharedAxis.
 * @returns {string} chart XML
 */
function buildComboChartXml(spec) {
  const sheet = escapeXml(spec.tabName);
  const barSeries = spec.barSeries || [];
  const lineSeries = spec.lineSeries || [];
  // R37 P1 — quarter labels on date cat axes by default
  const catFmtFrag = catAxNumFmtFrag(
    spec.catAxNumFmt !== undefined ? spec.catAxNumFmt : DEFAULT_CAT_AX_NUM_FMT
  );
  // R37 P2 — pin val axis range + format. Combo has 2 axes:
  //   left  (axId 2, default holds bars) — yLeftRange / yLeftNumFmt
  //   right (axId 3, default holds line) — yRightRange / yRightNumFmt
  // When sharedAxis=true the line uses axId 2 too and there's no right axis,
  // so yRightRange is ignored. Backward-compat: spec.yAxisRange also accepted
  // as an alias for yLeftRange (some old templates may have used the simpler name).
  const leftRangeFrag  = valAxScalingFrag(spec.yLeftRange || spec.yAxisRange);
  const leftFmtFrag    = valAxNumFmtFrag(spec.yLeftNumFmt || spec.valAxNumFmt);
  const rightRangeFrag = valAxScalingFrag(spec.yRightRange);
  const rightFmtFrag   = valAxNumFmtFrag(spec.yRightNumFmt);
  // P8.5 — barGrouping + sharedAxis support
  const barGrouping = spec.barGrouping === 'stacked' ? 'stacked' : 'clustered';
  // R55 — barOverlap explicit override (e.g. market_turnover wants 100
  // so the front sales bar overlays the back inventory bar at the same x).
  // Default: stacked=100, clustered=-20 (cluster side-by-side with small gap).
  const overlap = (spec.barOverlap != null)
    ? spec.barOverlap
    : (barGrouping === 'stacked' ? 100 : -20);
  // R55 — optional axis titles. Excel renders these as rotated labels
  // alongside the value axes. Pass spec.yLeftAxisTitle / yRightAxisTitle.
  const axisTitleFrag = (text) => {
    if (!text) return '';
    return `<c:title>
        <c:tx><c:rich>
          <a:bodyPr rot="-5400000" vert="horz"/>
          <a:lstStyle/>
          <a:p><a:r><a:rPr lang="en-US" sz="900" b="0">
            <a:solidFill><a:srgbClr val="6A748C"/></a:solidFill>
          </a:rPr><a:t>${escapeXml(text)}</a:t></a:r></a:p>
        </c:rich></c:tx>
        <c:overlay val="0"/>
      </c:title>`;
  };
  const leftAxTitleFrag  = axisTitleFrag(spec.yLeftAxisTitle);
  const rightAxTitleFrag = axisTitleFrag(spec.yRightAxisTitle);
  // Tier F1 — swapAxes flips which axis each chart block points at.
  // Default: bars=axId 2 (left), line=axId 3 (right).
  // swapAxes:  bars=axId 3 (right), line=axId 2 (left).
  // sharedAxis: both on axId 2 (no axId 3 emitted at all).
  const barAxId  = (spec.sharedAxis || !spec.swapAxes) ? 2 : 3;
  const lineAxId = spec.sharedAxis ? 2 : (spec.swapAxes ? 2 : 3);

  const barXml = barSeries.map((s, i) => {
    const color = (s.color || '003DA5').replace('#', '');
    // P8.5 — `noFill` flag on bar series (invisible base for floating bars)
    // R35 P4 — `alpha` (string '0'..'100000') + `borderColor` for pale-fill
    // bars with a distinct border (cost_of_capital mortgage band).
    const alphaFrag = s.alpha ? `<a:alpha val="${s.alpha}"/>` : '';
    const fillFrag = s.noFill
      ? `<a:noFill/>`
      : `<a:solidFill><a:srgbClr val="${color}">${alphaFrag}</a:srgbClr></a:solidFill>`;
    let lineFrag = '';
    if (s.noFill) {
      lineFrag = `<a:ln><a:noFill/></a:ln>`;
    } else if (s.borderColor) {
      const borderColor = s.borderColor.replace('#', '');
      lineFrag = `<a:ln w="9525"><a:solidFill><a:srgbClr val="${borderColor}"/></a:solidFill></a:ln>`;
    }
    // R37 P3 — per-series data labels (combo bar)
    const dLblsFrag = dLblsXml(s.dataLabels);
    return `        <c:ser>
          <c:idx val="${i}"/>
          <c:order val="${i}"/>
          <c:tx><c:strRef><c:f>'${sheet}'!$${s.titleCol}$${s.titleRow}</c:f></c:strRef></c:tx>
          <c:spPr>${fillFrag}${lineFrag}</c:spPr>
          <c:invertIfNegative val="0"/>
${dLblsFrag}
          <c:cat><c:numRef><c:f>'${sheet}'!$${spec.catCol}$${spec.dataStart}:$${spec.catCol}$${spec.dataEnd}</c:f></c:numRef></c:cat>
          <c:val><c:numRef><c:f>'${sheet}'!$${s.valCol}$${spec.dataStart}:$${s.valCol}$${spec.dataEnd}</c:f></c:numRef></c:val>
        </c:ser>`;
  }).join('\n');

  // Line series idx continues from where bar series ended so each
  // series in the chart has a unique index (Excel relies on this).
  //
  // P9 — per-series `showMarker: true` flag converts the series from
  // "line, no markers" to "markers only, no line" (used for median/avg
  // dot overlays on the rent_by_year_built whisker visual). Optional
  // markerShape: 'circle' | 'diamond' | 'square' | 'triangle' (default
  // 'circle') and markerSize (default 5).
  //
  // R35 P2 — per-series `dashed: true` flag emits <a:prstDash val="dash"/>
  // (matches the renderer's borderDash). Used for dom_price_change_active
  // where the core 10+yr price-change line is dashed to distinguish it
  // from the solid total-market line of the same color.
  const lineXml = lineSeries.map((s, i) => {
    const idx = barSeries.length + i;
    const color = (s.color || '003DA5').replace('#', '');
    // R37 P3 — per-series data labels (combo line)
    const dLblsFrag = dLblsXml(s.dataLabels);
    if (s.showMarker) {
      const shape = s.markerShape || 'circle';
      const size = s.markerSize || 5;
      return `        <c:ser>
          <c:idx val="${idx}"/>
          <c:order val="${idx}"/>
          <c:tx><c:strRef><c:f>'${sheet}'!$${s.titleCol}$${s.titleRow}</c:f></c:strRef></c:tx>
          <c:spPr>
            <a:ln><a:noFill/></a:ln>
          </c:spPr>
          <c:marker>
            <c:symbol val="${shape}"/>
            <c:size val="${size}"/>
            <c:spPr>
              <a:solidFill><a:srgbClr val="${color}"/></a:solidFill>
              <a:ln><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln>
            </c:spPr>
          </c:marker>
${dLblsFrag}
          <c:cat><c:numRef><c:f>'${sheet}'!$${spec.catCol}$${spec.dataStart}:$${spec.catCol}$${spec.dataEnd}</c:f></c:numRef></c:cat>
          <c:val><c:numRef><c:f>'${sheet}'!$${s.valCol}$${spec.dataStart}:$${s.valCol}$${spec.dataEnd}</c:f></c:numRef></c:val>
          <c:smooth val="0"/>
        </c:ser>`;
    }
    const dashFrag = s.dashed ? `<a:prstDash val="dash"/>` : '';
    return `        <c:ser>
          <c:idx val="${idx}"/>
          <c:order val="${idx}"/>
          <c:tx><c:strRef><c:f>'${sheet}'!$${s.titleCol}$${s.titleRow}</c:f></c:strRef></c:tx>
          <c:spPr>
            <a:ln w="22225" cap="rnd"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill>${dashFrag}<a:round/></a:ln>
          </c:spPr>
          <c:marker><c:symbol val="none"/></c:marker>
${dLblsFrag}
          <c:cat><c:numRef><c:f>'${sheet}'!$${spec.catCol}$${spec.dataStart}:$${spec.catCol}$${spec.dataEnd}</c:f></c:numRef></c:cat>
          <c:val><c:numRef><c:f>'${sheet}'!$${s.valCol}$${spec.dataStart}:$${s.valCol}$${spec.dataEnd}</c:f></c:numRef></c:val>
          <c:smooth val="0"/>
        </c:ser>`;
  }).join('\n');

  // Bar block uses primary axes (1=cat, 2=left val).
  // Line block shares the cat axis (1) but uses the secondary val axis (3).
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${NS_CHART}" xmlns:a="${NS_DRAWINGML}" xmlns:r="${NS_REL}">
  <c:roundedCorners val="0"/>
  <c:chart>
    ${chartTitleXml(spec.title)}
    <c:plotArea>
      <c:layout/>
      <c:barChart>
        <c:barDir val="col"/>
        <c:grouping val="${barGrouping}"/>
        <c:varyColors val="0"/>
${barXml}
        <c:gapWidth val="${spec.barGapWidth || 60}"/>
        <c:overlap val="${overlap}"/>
        <c:axId val="1"/>
        <c:axId val="${barAxId}"/>
      </c:barChart>
      <c:lineChart>
        <c:grouping val="standard"/>
        <c:varyColors val="0"/>
${lineXml}
        <c:marker val="${lineSeries.some(s => s.showMarker) ? 1 : 0}"/>
        <c:axId val="1"/>
        <c:axId val="${lineAxId}"/>
      </c:lineChart>
      <c:catAx>
        <c:axId val="1"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="b"/>
        ${catFmtFrag}
        ${CAT_AX_TICK_LBL_POS}
        ${CAT_AX_HORIZONTAL_TXT}
        <c:crossAx val="2"/>
      </c:catAx>
      <c:valAx>
        <c:axId val="2"/>
        ${leftRangeFrag}
        <c:delete val="0"/>
        <c:axPos val="l"/>
        ${MAJOR_GRIDLINES_FRAG}
        ${leftAxTitleFrag}
        ${leftFmtFrag}
        <c:crossAx val="1"/>
      </c:valAx>${spec.sharedAxis ? '' : `
      <c:valAx>
        <c:axId val="3"/>
        ${rightRangeFrag}
        <c:delete val="0"/>
        <c:axPos val="r"/>
        ${MAJOR_GRIDLINES_FRAG}
        ${rightAxTitleFrag}
        ${rightFmtFrag}
        <c:crossAx val="1"/>
        <c:crosses val="max"/>
      </c:valAx>`}
    </c:plotArea>
    <c:legend>
      <c:legendPos val="b"/>
      <c:overlay val="0"/>
    </c:legend>
    <c:plotVisOnly val="1"/>
    <c:dispBlanksAs val="gap"/>
  </c:chart>
</c:chartSpace>`;
}

/**
 * Generate a scatter (xy) chart with N point-cloud series. Each series
 * specifies independent x and y column letters; rows in the data range
 * are plotted as (x, y) points with no connecting line by default.
 *
 * Used for true point clouds — `core_cap_rate_dot_plot` (one dot per
 * closed sale: x=sale_date, y=cap_rate) and `available_cap_rate_dot_plot`
 * (one dot per active listing: x=firm_term_years, y=asking_cap_rate).
 *
 * OpenXML differences from the categorical charts above:
 *   • <c:scatterChart> + <c:scatterStyle val="marker"/> (no line)
 *   • Series use <c:xVal>/<c:yVal> instead of <c:cat>/<c:val>
 *   • Both axes are val axes (axId 1 + 2, both <c:valAx>) — there's
 *     no cat axis because x is continuous.
 *
 * @param {object} spec
 * @param {string} spec.tabName       Data_* tab name
 * @param {number} spec.dataStart     1-indexed first data row
 * @param {number} spec.dataEnd       1-indexed last data row (inclusive)
 * @param {Array}  spec.series        List of { titleCol, titleRow, xCol, yCol, color }
 * @returns {string} chart XML
 */
/**
 * Generate a doughnut chart — a single ring with N segments, no axes.
 * Each data row is one segment; the colors[] array maps to segments
 * positionally via per-point <c:dPt> blocks.
 *
 * OpenXML differences from every other chart type:
 *   • <c:doughnutChart> instead of barChart/lineChart/etc.
 *   • NO axes at all — donut is a special radial chart type
 *   • <c:cat> uses <c:strRef> (text labels) instead of <c:numRef>
 *   • Per-segment colors emitted as <c:dPt> blocks inside the series
 *   • <c:holeSize val="55"/> sets the donut hole percentage (matches
 *     renderer's cutout: '55%')
 *
 * @param {object} spec
 * @param {string} spec.tabName        Data_* tab name
 * @param {string} spec.titleCol       Column letter for series title cell
 * @param {number} spec.titleRow       Row index for series title cell
 * @param {string} spec.catCol         Column letter for segment labels (text)
 * @param {string} spec.valCol         Column letter for segment values
 * @param {number} spec.dataStart      1-indexed first data row
 * @param {number} spec.dataEnd        1-indexed last data row (inclusive)
 * @param {string[]} spec.colors       Hex colors, one per segment (in row order).
 *                                     Excess colors are ignored, missing ones
 *                                     fall back to navy.
 * @param {number} [spec.holeSize]     Donut hole % (default 55, range 10-90).
 * @returns {string} chart XML
 */
function buildDoughnutChartXml(spec) {
  const sheet = escapeXml(spec.tabName);
  const segmentCount = (spec.dataEnd - spec.dataStart) + 1;
  const colors = spec.colors || [];
  // Emit one <c:dPt> per segment with its hex color
  const dPtXml = Array.from({ length: segmentCount }, (_, i) => {
    const color = (colors[i] || '003DA5').replace('#', '');
    return `          <c:dPt>
            <c:idx val="${i}"/>
            <c:bubble3D val="0"/>
            <c:spPr>
              <a:solidFill><a:srgbClr val="${color}"/></a:solidFill>
              <a:ln w="19050"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln>
            </c:spPr>
          </c:dPt>`;
  }).join('\n');

  const holeSize = Math.max(10, Math.min(90, spec.holeSize || 55));

  // R46 — per-segment percent labels. User feedback 2026-05-21:
  // "Data_Avail_Tenant_Count: Missing Labels" + "Data_Avail_Tenant_Vol:
  // Missing labels". When spec.showSegmentLabels=true, emit a <c:dLbls>
  // block with showPercent=1 and a 0% format so each segment shows its
  // share of the donut total (e.g. DaVita 42%).
  const segLblsFrag = spec.showSegmentLabels
    ? `        <c:dLbls>
          <c:numFmt formatCode="0%" sourceLinked="0"/>
          <c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>
          <c:txPr>
            <a:bodyPr rot="0" spcFirstLastPara="1" vertOverflow="ellipsis" wrap="square" anchor="ctr" anchorCtr="1"/>
            <a:lstStyle/>
            <a:p><a:pPr><a:defRPr sz="900" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p>
          </c:txPr>
          <!-- R68-E (D14): dLblPos is ILLEGAL under c:doughnutChart per ECMA-376;
               its presence made Excel classify chart31/chart32 as corrupt and
               auto-repair silently stripped them on open (Available-by-Tenant
               donuts rendered as data-only tabs). showPercent=1 renders ring
               labels without a position element. Do NOT re-add dLblPos here. -->
          <c:showLegendKey val="0"/>
          <c:showVal val="0"/>
          <c:showCatName val="0"/>
          <c:showSerName val="0"/>
          <c:showPercent val="1"/>
          <c:showBubbleSize val="0"/>
        </c:dLbls>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${NS_CHART}" xmlns:a="${NS_DRAWINGML}" xmlns:r="${NS_REL}">
  <c:roundedCorners val="0"/>
  <c:chart>
    ${chartTitleXml(spec.title)}
    <c:plotArea>
      <c:layout/>
      <c:doughnutChart>
        <c:varyColors val="1"/>
        <c:ser>
          <c:idx val="0"/>
          <c:order val="0"/>
          <c:tx><c:strRef><c:f>'${sheet}'!$${spec.titleCol}$${spec.titleRow}</c:f></c:strRef></c:tx>
${dPtXml}
${segLblsFrag}
          <c:cat><c:strRef><c:f>'${sheet}'!$${spec.catCol}$${spec.dataStart}:$${spec.catCol}$${spec.dataEnd}</c:f></c:strRef></c:cat>
          <c:val><c:numRef><c:f>'${sheet}'!$${spec.valCol}$${spec.dataStart}:$${spec.valCol}$${spec.dataEnd}</c:f></c:numRef></c:val>
        </c:ser>
        <c:firstSliceAng val="0"/>
        <c:holeSize val="${holeSize}"/>
      </c:doughnutChart>
    </c:plotArea>
    <c:legend>
      <c:legendPos val="b"/>
      <c:overlay val="0"/>
    </c:legend>
    <c:plotVisOnly val="1"/>
    <c:dispBlanksAs val="gap"/>
  </c:chart>
</c:chartSpace>`;
}

function buildScatterChartXml(spec) {
  const sheet = escapeXml(spec.tabName);
  // R37 P2 — pin x + y axis ranges + formats. Scatter has both axes as
  // valAx (x axId=1, y axId=2). xRange/xNumFmt for axis 1 (x), yRange/yNumFmt
  // for axis 2 (y). yAxisRange aliases yRange for back-compat.
  const xScalingFrag = valAxScalingFrag(spec.xAxisRange);
  const xFmtFrag     = valAxNumFmtFrag(spec.xAxisNumFmt);
  const yScalingFrag = valAxScalingFrag(spec.yAxisRange);
  const yFmtFrag     = valAxNumFmtFrag(spec.valAxNumFmt);
  const seriesXml = spec.series.map((s, i) => {
    const color = (s.color || '003DA5').replace('#', '');
    // R37 P3 — per-series data labels (scatter)
    const dLblsFrag = dLblsXml(s.dataLabels);
    // P7.5 — `showLine: true` produces a connected-line series (used for
    // trendline overlays); markers are suppressed so just the line shows.
    // `dashed: true` makes the line dashed (matches the renderer's
    // borderDash for linear regression trendlines).
    if (s.showLine) {
      const dashFrag = s.dashed ? `<a:prstDash val="dash"/>` : '';
      return `        <c:ser>
          <c:idx val="${i}"/>
          <c:order val="${i}"/>
          <c:tx><c:strRef><c:f>'${sheet}'!$${s.titleCol}$${s.titleRow}</c:f></c:strRef></c:tx>
          <c:spPr>
            <a:ln w="22225" cap="rnd"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill>${dashFrag}<a:round/></a:ln>
          </c:spPr>
          <c:marker><c:symbol val="none"/></c:marker>
${dLblsFrag}
          <c:xVal><c:numRef><c:f>'${sheet}'!$${s.xCol}$${spec.dataStart}:$${s.xCol}$${spec.dataEnd}</c:f></c:numRef></c:xVal>
          <c:yVal><c:numRef><c:f>'${sheet}'!$${s.yCol}$${spec.dataStart}:$${s.yCol}$${spec.dataEnd}</c:f></c:numRef></c:yVal>
          <c:smooth val="0"/>
        </c:ser>`;
    }
    // Default dot-cloud series: visible markers, no connecting line.
    // Filled circle marker, no border emphasis (mirrors chart.js
    // pointStyle:'circle' + pointRadius:3 from the renderer).
    // <c:size val="5"/> ≈ pointRadius 3-4 in pixels.
    //
    // R39 — per-series `trendline` config attaches an Excel-native
    // <c:trendline> to this series (replaces the prior helper-column
    // approach). Matches the master Excel docs:
    //   Core_Cap_Chart:  { type: 'poly', order: 3, forward: 720, dashed: true }
    //   Available_Comps: { type: 'linear' }
    const trendlineFrag = trendlineXml(s.trendline);
    return `        <c:ser>
          <c:idx val="${i}"/>
          <c:order val="${i}"/>
          <c:tx><c:strRef><c:f>'${sheet}'!$${s.titleCol}$${s.titleRow}</c:f></c:strRef></c:tx>
          <c:spPr>
            <a:ln w="22225" cap="rnd"><a:noFill/></a:ln>
          </c:spPr>
          <c:marker>
            <c:symbol val="circle"/>
            <c:size val="5"/>
            <c:spPr>
              <a:solidFill><a:srgbClr val="${color}"><a:alpha val="55000"/></a:srgbClr></a:solidFill>
              <a:ln w="3175"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln>
            </c:spPr>
          </c:marker>
${dLblsFrag}
${trendlineFrag}
          <c:xVal><c:numRef><c:f>'${sheet}'!$${s.xCol}$${spec.dataStart}:$${s.xCol}$${spec.dataEnd}</c:f></c:numRef></c:xVal>
          <c:yVal><c:numRef><c:f>'${sheet}'!$${s.yCol}$${spec.dataStart}:$${s.yCol}$${spec.dataEnd}</c:f></c:numRef></c:yVal>
          <c:smooth val="0"/>
        </c:ser>`;
  }).join('\n');

  // Both axes are valAx (continuous). Axis IDs 1 (x, bottom) + 2 (y, left).
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${NS_CHART}" xmlns:a="${NS_DRAWINGML}" xmlns:r="${NS_REL}">
  <c:roundedCorners val="0"/>
  <c:chart>
    ${chartTitleXml(spec.title)}
    <c:plotArea>
      <c:layout/>
      <c:scatterChart>
        <c:scatterStyle val="marker"/>
        <c:varyColors val="0"/>
${seriesXml}
        <c:axId val="1"/>
        <c:axId val="2"/>
      </c:scatterChart>
      <c:valAx>
        <c:axId val="1"/>
        ${xScalingFrag}
        <c:delete val="0"/>
        <c:axPos val="b"/>
        ${MAJOR_GRIDLINES_FRAG}
        ${xFmtFrag}
        ${CAT_AX_VERTICAL_TXT}
        <c:crossAx val="2"/>
        ${spec.xMajorUnit != null ? `<c:majorUnit val="${spec.xMajorUnit}"/>` : ''}
      </c:valAx>
      <c:valAx>
        <c:axId val="2"/>
        ${yScalingFrag}
        <c:delete val="0"/>
        <c:axPos val="l"/>
        ${MAJOR_GRIDLINES_FRAG}
        ${yFmtFrag}
        <c:crossAx val="1"/>
      </c:valAx>
    </c:plotArea>
    <c:plotVisOnly val="1"/>
    <c:dispBlanksAs val="gap"/>
  </c:chart>
</c:chartSpace>`;
}

/**
 * Generate an area + bar + line combo chart — three chart blocks in one
 * plot area, sharing the cat axis but using two value axes.
 *
 * Used for volume_cap_quartile_combo (PDF p.19 dia / p.11 gov): light
 * blue shaded area (TTM Volume on left axis) BEHIND vertical range
 * bars (cap quartile spread) WITH dots (TTM avg cap) on top — all on
 * one chart with two value axes.
 *
 * OpenXML axis wiring:
 *   axId=1   shared cat axis (bottom)
 *   axId=2   left val axis  — used by areaChart (large $ values)
 *   axId=3   right val axis — used by both barChart + lineChart
 *                              (cap-rate %, crosses=max)
 *
 * Block order matters for z-order: area first (back), bars middle,
 * line last (front, dots on top).
 *
 * @param {object} spec
 * @param {string} spec.tabName
 * @param {string} spec.catCol         x-axis column
 * @param {number} spec.dataStart      first data row (1-indexed)
 * @param {number} spec.dataEnd        last data row (inclusive)
 * @param {object} spec.areaSeries     { titleCol, titleRow, valCol, fillColor, borderColor }
 *                                     One area series on the LEFT axis.
 * @param {Array}  spec.barSeries      List of { titleCol, titleRow, valCol, color, [noFill], [alpha], [borderColor] }
 *                                     Bar series on the RIGHT axis. Stacked
 *                                     grouping with overlap=100 — caller is
 *                                     responsible for emitting an invisible
 *                                     base + visible band if they want a
 *                                     floating range bar.
 * @param {Array}  spec.lineSeries     List of { titleCol, titleRow, valCol, color, [showMarker], [markerShape], [markerSize], [dashed] }
 *                                     Line series on the RIGHT axis (shared
 *                                     with bars).
 * @returns {string} chart XML
 */
function buildAreaComboChartXml(spec) {
  const sheet = escapeXml(spec.tabName);
  const area  = spec.areaSeries;
  const bars  = spec.barSeries || [];
  const lines = spec.lineSeries || [];
  // R37 P1 — quarter labels on date cat axes by default
  const catFmtFrag = catAxNumFmtFrag(
    spec.catAxNumFmt !== undefined ? spec.catAxNumFmt : DEFAULT_CAT_AX_NUM_FMT
  );
  // R37 P2 — pin val axis ranges + formats. Area-combo has 3 axes:
  //   axId 1 = cat (shared)
  //   axId 2 = LEFT val (area) — yLeftRange / yLeftNumFmt
  //   axId 3 = RIGHT val (bars + line) — yRightRange / yRightNumFmt
  const leftScalingFrag  = valAxScalingFrag(spec.yLeftRange);
  const leftFmtFrag      = valAxNumFmtFrag(spec.yLeftNumFmt);
  const rightScalingFrag = valAxScalingFrag(spec.yRightRange);
  const rightFmtFrag     = valAxNumFmtFrag(spec.yRightNumFmt);

  // Area series (always index 0)
  const areaColor   = (area?.fillColor   || 'E0E8F4').replace('#', '');
  const areaBorder  = (area?.borderColor || '003DA5').replace('#', '');
  const areaXml = area ? `        <c:ser>
          <c:idx val="0"/>
          <c:order val="0"/>
          <c:tx><c:strRef><c:f>'${sheet}'!$${area.titleCol}$${area.titleRow}</c:f></c:strRef></c:tx>
          <c:spPr>
            <a:solidFill><a:srgbClr val="${areaColor}"/></a:solidFill>
            <a:ln w="22225"><a:solidFill><a:srgbClr val="${areaBorder}"/></a:solidFill></a:ln>
          </c:spPr>
          <c:cat><c:numRef><c:f>'${sheet}'!$${spec.catCol}$${spec.dataStart}:$${spec.catCol}$${spec.dataEnd}</c:f></c:numRef></c:cat>
          <c:val><c:numRef><c:f>'${sheet}'!$${area.valCol}$${spec.dataStart}:$${area.valCol}$${spec.dataEnd}</c:f></c:numRef></c:val>
        </c:ser>` : '';

  // Bar series — indices continue from 1 (after area)
  const barXml = bars.map((s, i) => {
    const idx = 1 + i;
    const color = (s.color || '003DA5').replace('#', '');
    const alphaFrag = s.alpha ? `<a:alpha val="${s.alpha}"/>` : '';
    const fillFrag = s.noFill
      ? `<a:noFill/>`
      : `<a:solidFill><a:srgbClr val="${color}">${alphaFrag}</a:srgbClr></a:solidFill>`;
    let lineFrag = '';
    if (s.noFill) {
      lineFrag = `<a:ln><a:noFill/></a:ln>`;
    } else if (s.borderColor) {
      const bc = s.borderColor.replace('#', '');
      lineFrag = `<a:ln w="9525"><a:solidFill><a:srgbClr val="${bc}"/></a:solidFill></a:ln>`;
    }
    return `        <c:ser>
          <c:idx val="${idx}"/>
          <c:order val="${idx}"/>
          <c:tx><c:strRef><c:f>'${sheet}'!$${s.titleCol}$${s.titleRow}</c:f></c:strRef></c:tx>
          <c:spPr>${fillFrag}${lineFrag}</c:spPr>
          <c:cat><c:numRef><c:f>'${sheet}'!$${spec.catCol}$${spec.dataStart}:$${spec.catCol}$${spec.dataEnd}</c:f></c:numRef></c:cat>
          <c:val><c:numRef><c:f>'${sheet}'!$${s.valCol}$${spec.dataStart}:$${s.valCol}$${spec.dataEnd}</c:f></c:numRef></c:val>
        </c:ser>`;
  }).join('\n');

  // Line series — indices continue from (1 + bars.length)
  const lineXml = lines.map((s, i) => {
    const idx = 1 + bars.length + i;
    const color = (s.color || '003DA5').replace('#', '');
    // R37 P3 — per-series data labels (area-combo line)
    const dLblsFrag = dLblsXml(s.dataLabels);
    if (s.showMarker) {
      const shape = s.markerShape || 'circle';
      const size = s.markerSize || 5;
      return `        <c:ser>
          <c:idx val="${idx}"/>
          <c:order val="${idx}"/>
          <c:tx><c:strRef><c:f>'${sheet}'!$${s.titleCol}$${s.titleRow}</c:f></c:strRef></c:tx>
          <c:spPr><a:ln><a:noFill/></a:ln></c:spPr>
          <c:marker>
            <c:symbol val="${shape}"/>
            <c:size val="${size}"/>
            <c:spPr>
              <a:solidFill><a:srgbClr val="${color}"/></a:solidFill>
              <a:ln><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln>
            </c:spPr>
          </c:marker>
${dLblsFrag}
          <c:cat><c:numRef><c:f>'${sheet}'!$${spec.catCol}$${spec.dataStart}:$${spec.catCol}$${spec.dataEnd}</c:f></c:numRef></c:cat>
          <c:val><c:numRef><c:f>'${sheet}'!$${s.valCol}$${spec.dataStart}:$${s.valCol}$${spec.dataEnd}</c:f></c:numRef></c:val>
          <c:smooth val="0"/>
        </c:ser>`;
    }
    const dashFrag = s.dashed ? `<a:prstDash val="dash"/>` : '';
    return `        <c:ser>
          <c:idx val="${idx}"/>
          <c:order val="${idx}"/>
          <c:tx><c:strRef><c:f>'${sheet}'!$${s.titleCol}$${s.titleRow}</c:f></c:strRef></c:tx>
          <c:spPr>
            <a:ln w="22225" cap="rnd"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill>${dashFrag}<a:round/></a:ln>
          </c:spPr>
          <c:marker><c:symbol val="none"/></c:marker>
${dLblsFrag}
          <c:cat><c:numRef><c:f>'${sheet}'!$${spec.catCol}$${spec.dataStart}:$${spec.catCol}$${spec.dataEnd}</c:f></c:numRef></c:cat>
          <c:val><c:numRef><c:f>'${sheet}'!$${s.valCol}$${spec.dataStart}:$${s.valCol}$${spec.dataEnd}</c:f></c:numRef></c:val>
          <c:smooth val="0"/>
        </c:ser>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${NS_CHART}" xmlns:a="${NS_DRAWINGML}" xmlns:r="${NS_REL}">
  <c:roundedCorners val="0"/>
  <c:chart>
    ${chartTitleXml(spec.title)}
    <c:plotArea>
      <c:layout/>
      <c:areaChart>
        <c:grouping val="standard"/>
        <c:varyColors val="0"/>
${areaXml}
        <c:axId val="1"/>
        <c:axId val="2"/>
      </c:areaChart>
      <c:barChart>
        <c:barDir val="col"/>
        <c:grouping val="stacked"/>
        <c:varyColors val="0"/>
${barXml}
        <c:gapWidth val="60"/>
        <c:overlap val="100"/>
        <c:axId val="1"/>
        <c:axId val="3"/>
      </c:barChart>
      <c:lineChart>
        <c:grouping val="standard"/>
        <c:varyColors val="0"/>
${lineXml}
        <c:marker val="${lines.some(s => s.showMarker) ? 1 : 0}"/>
        <c:axId val="1"/>
        <c:axId val="3"/>
      </c:lineChart>
      <c:catAx>
        <c:axId val="1"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="b"/>
        ${catFmtFrag}
        ${CAT_AX_TICK_LBL_POS}
        ${CAT_AX_HORIZONTAL_TXT}
        <c:crossAx val="2"/>
      </c:catAx>
      <c:valAx>
        <c:axId val="2"/>
        ${leftScalingFrag}
        <c:delete val="0"/>
        <c:axPos val="l"/>
        ${MAJOR_GRIDLINES_FRAG}
        ${leftFmtFrag}
        <c:crossAx val="1"/>
      </c:valAx>
      <c:valAx>
        <c:axId val="3"/>
        ${rightScalingFrag}
        <c:delete val="0"/>
        <c:axPos val="r"/>
        ${MAJOR_GRIDLINES_FRAG}
        ${rightFmtFrag}
        <c:crossAx val="1"/>
        <c:crosses val="max"/>
      </c:valAx>
    </c:plotArea>
    <c:legend>
      <c:legendPos val="b"/>
      <c:overlay val="0"/>
    </c:legend>
    <c:plotVisOnly val="1"/>
    <c:dispBlanksAs val="gap"/>
  </c:chart>
</c:chartSpace>`;
}

/**
 * R66c — Bid-Ask DUAL-AXIS chart. Matches the master (Dialysis Comp Work
 * MASTER.xlsx chart7) "two dash-marker series, no band" idiom but fixes the
 * master's one flaw: the master plots Last-Ask cap (~5-8%) and the raw
 * Bid-Ask Spread (~0.2-0.8%) on a SINGLE cap axis, so the spread line falls
 * off the bottom and is invisible. Here the spread gets its own RIGHT axis so
 * both dash series are legible.
 *
 *   LEFT  axis (id 2): Last Ask cap — Sky dash markers, no connecting line
 *   RIGHT axis (id 3): Bid-Ask Spread — Navy dash markers, no connecting line
 *
 * spec: { tabName, catCol, dataStart, dataEnd, title,
 *         leftCol, leftColor, leftRange, leftNumFmt, leftTitleRow,
 *         rightCol, rightColor, rightRange, rightNumFmt, rightTitleRow }
 */
function buildBidAskDualAxisChartXml(spec) {
  const sheet = escapeXml(spec.tabName);
  const hdr = spec.headerRow || 4;
  const markerSer = (col, color, idx, axCat, axVal) => `      <c:lineChart>
        <c:grouping val="standard"/>
        <c:varyColors val="0"/>
        <c:ser>
          <c:idx val="${idx}"/>
          <c:order val="${idx}"/>
          <c:tx><c:strRef><c:f>'${sheet}'!$${col}$${hdr}</c:f></c:strRef></c:tx>
          <c:spPr><a:ln><a:noFill/></a:ln></c:spPr>
          <c:marker>
            <c:symbol val="dash"/>
            <c:size val="7"/>
            <c:spPr>
              <a:solidFill><a:srgbClr val="${color}"/></a:solidFill>
              <a:ln><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln>
            </c:spPr>
          </c:marker>
          <c:cat><c:numRef><c:f>'${sheet}'!$${spec.catCol}$${spec.dataStart}:$${spec.catCol}$${spec.dataEnd}</c:f></c:numRef></c:cat>
          <c:val><c:numRef><c:f>'${sheet}'!$${col}$${spec.dataStart}:$${col}$${spec.dataEnd}</c:f></c:numRef></c:val>
          <c:smooth val="0"/>
        </c:ser>
        <c:marker val="1"/>
        <c:axId val="${axCat}"/>
        <c:axId val="${axVal}"/>
      </c:lineChart>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${NS_CHART}" xmlns:a="${NS_DRAWINGML}" xmlns:r="${NS_REL}">
  <c:roundedCorners val="0"/>
  <c:chart>
    ${chartTitleXml(spec.title)}
    <c:plotArea>
      <c:layout/>
${markerSer(spec.leftCol,  (spec.leftColor  || '62B5E5').replace('#',''), 0, 1, 2)}
${markerSer(spec.rightCol, (spec.rightColor || '003DA5').replace('#',''), 1, 1, 3)}
      <c:catAx>
        <c:axId val="1"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="b"/>
        ${catAxNumFmtFrag(spec.catAxNumFmt !== undefined ? spec.catAxNumFmt : DEFAULT_CAT_AX_NUM_FMT)}
        ${CAT_AX_TICK_LBL_POS}
        ${CAT_AX_HORIZONTAL_TXT}
        <c:crossAx val="2"/>
      </c:catAx>
      <c:valAx>
        <c:axId val="2"/>
        ${valAxScalingFrag(spec.leftRange)}
        <c:delete val="0"/>
        <c:axPos val="l"/>
        ${MAJOR_GRIDLINES_FRAG}
        ${valAxNumFmtFrag(spec.leftNumFmt)}
        <c:crossAx val="1"/>
      </c:valAx>
      <c:valAx>
        <c:axId val="3"/>
        ${valAxScalingFrag(spec.rightRange)}
        <c:delete val="0"/>
        <c:axPos val="r"/>
        ${valAxNumFmtFrag(spec.rightNumFmt)}
        <c:crossAx val="1"/>
        <c:crosses val="max"/>
      </c:valAx>
    </c:plotArea>
    <c:legend>
      <c:legendPos val="b"/>
      <c:overlay val="0"/>
    </c:legend>
    <c:plotVisOnly val="1"/>
    <c:dispBlanksAs val="gap"/>
  </c:chart>
</c:chartSpace>`;
}

/**
 * R66m — Renewal Rent Growth combo (gov, deck p.32 "Renewal Rent and its
 * Growth Rate Over Time"). Three groups sharing one category axis:
 *   1. barChart  (left $ axis):  TTM avg renewal rent/SF — pale-blue bars
 *   2. lineChart (left $ axis):  upper + lower quartile as marker-only series
 *      joined by <c:hiLowLines> → the deck's dark-blue vertical quartile bars
 *      with markers at top (upper Q) and bottom (lower Q)
 *   3. lineChart (right % axis): Avg Renewal Rent CAGR — sky line
 *
 * spec: { tabName, title, catCol, dataStart, dataEnd, headerRow,
 *         rentCol, upperCol, lowerCol, cagrCol,
 *         leftRange, leftNumFmt, rightRange, rightNumFmt,
 *         rentColor, quartileColor, cagrColor }
 */
function buildRenewalRentGrowthXml(spec) {
  const sheet = escapeXml(spec.tabName);
  const hdr = spec.headerRow || 4;
  const rentColor     = (spec.rentColor     || 'BBDDF2').replace('#', '');
  const quartileColor = (spec.quartileColor || '003DA5').replace('#', '');
  const cagrColor     = (spec.cagrColor     || '62B5E5').replace('#', '');
  const catRef = `'${sheet}'!$${spec.catCol}$${spec.dataStart}:$${spec.catCol}$${spec.dataEnd}`;
  const valRef = (col) => `'${sheet}'!$${col}$${spec.dataStart}:$${col}$${spec.dataEnd}`;
  const txRef  = (col) => `'${sheet}'!$${col}$${hdr}`;

  // Bar series — TTM renewal rent/SF (pale blue), left axis (2)
  const rentBar = `        <c:ser>
          <c:idx val="0"/>
          <c:order val="0"/>
          <c:tx><c:strRef><c:f>${txRef(spec.rentCol)}</c:f></c:strRef></c:tx>
          <c:spPr><a:solidFill><a:srgbClr val="${rentColor}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>
          <c:invertIfNegative val="0"/>
          <c:cat><c:numRef><c:f>${catRef}</c:f></c:numRef></c:cat>
          <c:val><c:numRef><c:f>${valRef(spec.rentCol)}</c:f></c:numRef></c:val>
        </c:ser>`;

  // Quartile marker-only series (idx 1 = upper, idx 2 = lower), joined by
  // hiLowLines into a vertical quartile bar.
  const quartileSer = (col, idx) => `        <c:ser>
          <c:idx val="${idx}"/>
          <c:order val="${idx}"/>
          <c:tx><c:strRef><c:f>${txRef(col)}</c:f></c:strRef></c:tx>
          <c:spPr><a:ln><a:noFill/></a:ln></c:spPr>
          <c:marker>
            <c:symbol val="dash"/>
            <c:size val="7"/>
            <c:spPr><a:solidFill><a:srgbClr val="${quartileColor}"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="${quartileColor}"/></a:solidFill></a:ln></c:spPr>
          </c:marker>
          <c:cat><c:numRef><c:f>${catRef}</c:f></c:numRef></c:cat>
          <c:val><c:numRef><c:f>${valRef(col)}</c:f></c:numRef></c:val>
          <c:smooth val="0"/>
        </c:ser>`;

  // CAGR line (sky), right axis (3)
  const cagrLine = `        <c:ser>
          <c:idx val="3"/>
          <c:order val="3"/>
          <c:tx><c:strRef><c:f>${txRef(spec.cagrCol)}</c:f></c:strRef></c:tx>
          <c:spPr><a:ln w="22225" cap="rnd"><a:solidFill><a:srgbClr val="${cagrColor}"/></a:solidFill><a:round/></a:ln></c:spPr>
          <c:marker><c:symbol val="none"/></c:marker>
          <c:cat><c:numRef><c:f>${catRef}</c:f></c:numRef></c:cat>
          <c:val><c:numRef><c:f>${valRef(spec.cagrCol)}</c:f></c:numRef></c:val>
          <c:smooth val="0"/>
        </c:ser>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${NS_CHART}" xmlns:a="${NS_DRAWINGML}" xmlns:r="${NS_REL}">
  <c:roundedCorners val="0"/>
  <c:chart>
    ${chartTitleXml(spec.title)}
    <c:plotArea>
      <c:layout/>
      <c:barChart>
        <c:barDir val="col"/>
        <c:grouping val="clustered"/>
        <c:varyColors val="0"/>
${rentBar}
        <c:gapWidth val="40"/>
        <c:overlap val="-20"/>
        <c:axId val="1"/>
        <c:axId val="2"/>
      </c:barChart>
      <c:lineChart>
        <c:grouping val="standard"/>
        <c:varyColors val="0"/>
${quartileSer(spec.upperCol, 1)}
${quartileSer(spec.lowerCol, 2)}
        <c:hiLowLines><c:spPr><a:ln w="19050" cap="rnd"><a:solidFill><a:srgbClr val="${quartileColor}"/></a:solidFill><a:round/></a:ln></c:spPr></c:hiLowLines>
        <c:upDownBars>
          <c:gapWidth val="150"/>
          <c:upBars><c:spPr><a:solidFill><a:srgbClr val="${quartileColor}"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="${quartileColor}"/></a:solidFill></a:ln></c:spPr></c:upBars>
          <c:downBars><c:spPr><a:solidFill><a:srgbClr val="${quartileColor}"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="${quartileColor}"/></a:solidFill></a:ln></c:spPr></c:downBars>
        </c:upDownBars>
        <c:marker val="1"/>
        <c:axId val="1"/>
        <c:axId val="2"/>
      </c:lineChart>
      <c:lineChart>
        <c:grouping val="standard"/>
        <c:varyColors val="0"/>
${cagrLine}
        <c:marker val="0"/>
        <c:axId val="1"/>
        <c:axId val="3"/>
      </c:lineChart>
      <c:catAx>
        <c:axId val="1"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="b"/>
        ${catAxNumFmtFrag(spec.catAxNumFmt !== undefined ? spec.catAxNumFmt : DEFAULT_CAT_AX_NUM_FMT)}
        ${CAT_AX_TICK_LBL_POS}
        ${CAT_AX_HORIZONTAL_TXT}
        <c:crossAx val="2"/>
      </c:catAx>
      <c:valAx>
        <c:axId val="2"/>
        ${valAxScalingFrag(spec.leftRange)}
        <c:delete val="0"/>
        <c:axPos val="l"/>
        ${MAJOR_GRIDLINES_FRAG}
        ${valAxNumFmtFrag(spec.leftNumFmt)}
        <c:crossAx val="1"/>
      </c:valAx>
      <c:valAx>
        <c:axId val="3"/>
        ${valAxScalingFrag(spec.rightRange)}
        <c:delete val="0"/>
        <c:axPos val="r"/>
        ${valAxNumFmtFrag(spec.rightNumFmt)}
        <c:crossAx val="1"/>
        <c:crosses val="max"/>
      </c:valAx>
    </c:plotArea>
    <c:legend>
      <c:legendPos val="b"/>
      <c:overlay val="0"/>
    </c:legend>
    <c:plotVisOnly val="1"/>
    <c:dispBlanksAs val="gap"/>
  </c:chart>
</c:chartSpace>`;
}

// ----------------------------------------------------------------------------
// Drawing XML (anchors a chart to a cell range on its tab)
// ----------------------------------------------------------------------------

/**
 * Generate one `<xdr:twoCellAnchor>` block for a single chart. Returns
 * the XML fragment WITHOUT the surrounding `<xdr:wsDr>` root — caller
 * concatenates fragments to build a multi-chart drawing.
 *
 * `nvIdx` (default 2) sets the `<xdr:cNvPr>` id; must be unique within
 * the parent drawing.xml. Sequence id+1 per chart on the same sheet.
 */
function buildDrawingAnchorFrag({ chartRelId, anchor, nvIdx = 2 }) {
  const a = anchor || { col0: 0, row0: 0, col1: 13, row1: 21 };
  return `  <xdr:twoCellAnchor editAs="oneCell">
    <xdr:from>
      <xdr:col>${a.col0}</xdr:col><xdr:colOff>0</xdr:colOff>
      <xdr:row>${a.row0}</xdr:row><xdr:rowOff>0</xdr:rowOff>
    </xdr:from>
    <xdr:to>
      <xdr:col>${a.col1}</xdr:col><xdr:colOff>0</xdr:colOff>
      <xdr:row>${a.row1}</xdr:row><xdr:rowOff>0</xdr:rowOff>
    </xdr:to>
    <xdr:graphicFrame macro="">
      <xdr:nvGraphicFramePr>
        <xdr:cNvPr id="${nvIdx}" name="Chart ${nvIdx - 1}"/>
        <xdr:cNvGraphicFramePr/>
      </xdr:nvGraphicFramePr>
      <xdr:xfrm>
        <a:off x="0" y="0"/>
        <a:ext cx="0" cy="0"/>
      </xdr:xfrm>
      <a:graphic>
        <a:graphicData uri="${NS_CHART}">
          <c:chart r:id="${chartRelId}"/>
        </a:graphicData>
      </a:graphic>
    </xdr:graphicFrame>
    <xdr:clientData/>
  </xdr:twoCellAnchor>`;
}

/**
 * Generate a drawing.xml that anchors a single chart to a cell range.
 * Anchor: top-left at (col0, row0), bottom-right at (col1, row1) — both
 * zero-indexed.
 *
 * Preserved as a thin wrapper around buildDrawingAnchorFrag for the
 * single-chart path so existing tests (and callers that emit a single
 * chart per sheet) work unchanged.
 */
function buildDrawingXml({ chartRelId, anchor }) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="${NS_SS_DRAW}" xmlns:a="${NS_DRAWINGML}" xmlns:r="${NS_REL}" xmlns:c="${NS_CHART}">
${buildDrawingAnchorFrag({ chartRelId, anchor, nvIdx: 2 })}
</xdr:wsDr>`;
}

/**
 * R71 — generate a drawing.xml that anchors N charts on the same sheet.
 * Each entry in `entries` is `{ chartRelId, anchor }`. Used when a
 * single sheet (e.g. the aggregate "Charts" tab) hosts multiple native
 * chart objects at tiled anchor positions.
 *
 * Excel requires `<xdr:cNvPr id>` values to be unique within a drawing,
 * so we sequence ids starting at 2.
 */
function buildMultiChartDrawingXml(entries) {
  const frags = entries.map((e, i) =>
    buildDrawingAnchorFrag({ chartRelId: e.chartRelId, anchor: e.anchor, nvIdx: 2 + i })
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="${NS_SS_DRAW}" xmlns:a="${NS_DRAWINGML}" xmlns:r="${NS_REL}" xmlns:c="${NS_CHART}">
${frags}
</xdr:wsDr>`;
}

// ----------------------------------------------------------------------------
// Main entry: inject native charts into an ExcelJS-built workbook buffer
// ----------------------------------------------------------------------------

/**
 * @param {Buffer} buffer       ExcelJS-built workbook buffer
 * @param {Array}  injections   List of { tabName, spec } records
 * @returns {Promise<Buffer>}   New buffer with native charts injected
 */
export async function injectNativeCharts(buffer, injections) {
  if (!Array.isArray(injections) || injections.length === 0) return buffer;

  const zip = await JSZip.loadAsync(buffer);

  // Locate the workbook's sheet name → file mapping by parsing
  // xl/workbook.xml + xl/_rels/workbook.xml.rels.
  const wbXml = await zip.file('xl/workbook.xml').async('string');
  const wbRels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const ctXml = await zip.file('[Content_Types].xml').async('string');

  const sheetNameToRid = {};
  for (const m of wbXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="(rId\d+)"/g)) {
    sheetNameToRid[m[1]] = m[2];
  }
  const ridToTarget = {};
  for (const m of wbRels.matchAll(/<Relationship\s+(.*?)\s*\/>/g)) {
    const idM = m[1].match(/Id="([^"]+)"/);
    const tM  = m[1].match(/Target="([^"]+)"/);
    if (idM && tM) ridToTarget[idM[1]] = tM[1];
  }

  // Find next available numeric IDs for new chart/drawing files
  const existingCharts = Object.keys(zip.files).filter(n => /^xl\/charts\/chart\d+\.xml$/.test(n));
  const existingDrawings = Object.keys(zip.files).filter(n => /^xl\/drawings\/drawing\d+\.xml$/.test(n));
  let nextChartId = existingCharts.length + 1;
  let nextDrawingId = existingDrawings.length + 1;

  // Collect content-types overrides to append
  const newOverrides = [];

  // R71 — generate chart XML for a spec via the type→builder dispatch.
  // Extracted so the multi-chart-per-sheet path (Charts aggregate tab)
  // can reuse it.
  const renderChartXml = (spec) => {
    if (spec.type === 'stacked-bar') return buildStackedBarChartXml(spec);
    if (spec.type === 'clustered-bar') {
      // R35 P2 — shares the builder with stacked-bar but forces
      // grouping='clustered'. Used for inventory_backlog and
      // pace_of_cap_rate_expansion (multi-bar single-axis charts).
      return buildStackedBarChartXml({ ...spec, grouping: 'clustered' });
    }
    if (spec.type === 'bar') return buildSingleBarChartXml(spec);
    if (spec.type === 'multi-line') return buildMultiLineChartXml(spec);
    if (spec.type === 'combo') return buildComboChartXml(spec);
    if (spec.type === 'bidask-dual') return buildBidAskDualAxisChartXml(spec);
    if (spec.type === 'renewal-combo') return buildRenewalRentGrowthXml(spec);
    if (spec.type === 'area-combo') {
      // R35 P4 — 3-block combo (area + bar + line) for volume_cap_quartile_combo.
      return buildAreaComboChartXml(spec);
    }
    if (spec.type === 'scatter') return buildScatterChartXml(spec);
    if (spec.type === 'doughnut') {
      // R36 P2 — single-ring pie/donut chart with per-segment colors.
      return buildDoughnutChartXml(spec);
    }
    // 'line' (default) and any future shapes that don't have their own
    // builder yet fall back to the line builder.
    return buildSingleLineChartXml(spec);
  };

  // R71 — collate injections by destination tabName so each sheet gets
  // ONE drawing.xml with N <xdr:twoCellAnchor> blocks. Excel requires
  // exactly one `<drawing r:id="..."/>` per sheet, so multiple charts
  // on the same sheet MUST share a drawing. Pre-R71 the injector
  // emitted one drawing per chart and silently dropped subsequent
  // injections targeting the same sheet (see warning at L1714 in the
  // R34-era code). Multi-chart-per-sheet is needed for the aggregate
  // Charts tab — tiled native charts replacing the QuickChart PNGs.
  const bySheetTab = new Map();
  for (const inj of injections) {
    if (!bySheetTab.has(inj.tabName)) bySheetTab.set(inj.tabName, []);
    bySheetTab.get(inj.tabName).push(inj);
  }

  for (const [tabName, sheetInjections] of bySheetTab) {
    const rid = sheetNameToRid[tabName];
    if (!rid) {
      console.warn(`[cm-native-chart-injector] no rId for tab ${tabName}`);
      continue;
    }
    const sheetTarget = ridToTarget[rid];
    if (!sheetTarget) {
      console.warn(`[cm-native-chart-injector] no target for rId ${rid}`);
      continue;
    }
    // Resolve to xl/worksheets/sheetN.xml
    const sheetPath = sheetTarget.startsWith('/') ? sheetTarget.slice(1) : `xl/${sheetTarget}`;
    const cleanSheetPath = sheetPath.replace(/^xl\//, '').startsWith('worksheets/')
      ? `xl/${sheetPath.replace(/^xl\//, '')}`
      : sheetPath;

    // One drawing.xml per sheet, hosting all charts for that sheet
    const drawingFile = `xl/drawings/drawing${nextDrawingId}.xml`;
    const drawingRels = `xl/drawings/_rels/drawing${nextDrawingId}.xml.rels`;
    const sheetRels   = cleanSheetPath.replace(/^(xl\/worksheets\/)([^.]+)\.xml$/, '$1_rels/$2.xml.rels');

    // Generate each chart's XML and collect drawing-rels entries.
    // Reserve chart numeric ids and per-drawing-rels rIds in lockstep.
    const chartEntries = [];
    for (let i = 0; i < sheetInjections.length; i++) {
      const { spec } = sheetInjections[i];
      const chartId = nextChartId++;
      const chartFile = `xl/charts/chart${chartId}.xml`;
      zip.file(chartFile, renderChartXml(spec));
      newOverrides.push(`<Override PartName="/${chartFile}" ContentType="${CT_CHART}"/>`);
      chartEntries.push({
        chartId,
        chartFile,
        chartRelId: `rId${i + 1}`,  // sequenced within this sheet's drawing rels
        anchor: spec.anchor,
      });
    }

    // 2. Drawing XML — single-chart path uses the legacy builder so
    //    its byte-for-byte output is unchanged (preserving existing
    //    snapshot-style assertions); multi-chart path tiles N anchors.
    const drawingXml = chartEntries.length === 1
      ? buildDrawingXml({ chartRelId: chartEntries[0].chartRelId, anchor: chartEntries[0].anchor })
      : buildMultiChartDrawingXml(chartEntries);
    zip.file(drawingFile, drawingXml);

    // 3. Drawing rels — one Relationship per chart on this sheet
    const drawingRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${chartEntries.map(e => `  <Relationship Id="${e.chartRelId}" Type="${REL_CHART}" Target="../charts/chart${e.chartId}.xml"/>`).join('\n')}
</Relationships>`;
    zip.file(drawingRels, drawingRelsXml);

    // 4. Update sheet's rels to include the drawing reference
    let sheetRelsXml = await (zip.file(sheetRels)?.async('string')) || `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
    const usedRids = Array.from(sheetRelsXml.matchAll(/Id="rId(\d+)"/g)).map(m => Number(m[1]));
    const sheetRelNextId = usedRids.length ? Math.max(...usedRids) + 1 : 1;
    const drawingRid = `rId${sheetRelNextId}`;
    const newRel = `<Relationship Id="${drawingRid}" Type="${REL_DRAWING}" Target="../drawings/drawing${nextDrawingId}.xml"/>`;
    sheetRelsXml = sheetRelsXml.replace('</Relationships>', `${newRel}</Relationships>`);
    zip.file(sheetRels, sheetRelsXml);

    // 5. Update sheet XML to reference the drawing
    let sheetXml = await zip.file(cleanSheetPath).async('string');
    if (!/<drawing\s+r:id="[^"]+"\s*\/>/.test(sheetXml)) {
      sheetXml = sheetXml.replace('</worksheet>', `  <drawing r:id="${drawingRid}"/>\n</worksheet>`);
      zip.file(cleanSheetPath, sheetXml);
    } else {
      // Existing drawing on this sheet (e.g. PNG images embedded by
      // ExcelJS for the aggregate Charts tab pre-R71). The caller is
      // expected to suppress those PNGs when wiring native charts to
      // the same sheet. If it didn't, we leave the existing drawing
      // in place — Excel resolves only the rId already in the sheet
      // XML, so our new drawing would render but ExcelJS's PNG drawing
      // would also remain visible (double-render).
      console.warn(`[cm-native-chart-injector] ${tabName} already has a drawing element — caller should suppress PNG for migrated charts`);
    }

    newOverrides.push(`<Override PartName="/${drawingFile}" ContentType="${CT_DRAWING}"/>`);
    nextDrawingId++;
  }

  // 6. Update [Content_Types].xml with all new overrides at once
  if (newOverrides.length) {
    const updatedCt = ctXml.replace('</Types>', `${newOverrides.join('')}</Types>`);
    zip.file('[Content_Types].xml', updatedCt);
  }

  return await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

// Re-export for testing
export {
  buildSingleLineChartXml,
  buildSingleBarChartXml,
  buildStackedBarChartXml,
  buildMultiLineChartXml,
  buildComboChartXml,
  buildAreaComboChartXml,
  buildScatterChartXml,
  buildDoughnutChartXml,
  buildDrawingXml,
};

// ----------------------------------------------------------------------------
// Migration registry — which chart_template_ids are now native (editable)
// vs. still PNG-embedded
// ----------------------------------------------------------------------------

/**
 * Set of chart_template_ids that the export pipeline should:
 *   1. SKIP when embedding PNG chart images (so we don't get both)
 *   2. INCLUDE in the injectNativeCharts call after the workbook builds
 *
 * Each entry needs a corresponding `INJECTION_SPECS` builder below that
 * knows how to map a chart_template_id + the export's column layout into
 * a chart spec (which sheet, which cell ranges, what color, etc.).
 *
 * Grow this set as more chart_template_ids are migrated from PNG-embed
 * to native chart XML. See task #16 for the full migration plan.
 */
export const NATIVE_CHART_TEMPLATES = new Set([
  // P2 (R34) — first migration
  'volume_ttm_by_quarter',
  // P3 — simple single-series line + bar charts
  'cap_rate_ttm_by_quarter',
  'transaction_count_ttm',
  'avg_deal_size',
  'yoy_volume_change',
  'market_turnover',
  'quarterly_volume_bars',
  // P4 — stacked bar charts
  'lease_renewal_rate',          // 5-series stack (First Gen / Renewed / Succ-Super / Expired / Terminated)
  'buyer_pool_monthly_count',    // 3-series stack (Private / Institutional / REIT — Cross-Border excluded per renderer)
  // Deferred: lease_termination_rate (rendered "In Firm Term" series is
  //   computed total-outside, not stored — would need an extra data
  //   column or worksheet formula. Defer to P4.5.)
  // P5 — multi-line cohort charts (no secondary axis)
  'cap_rate_by_lease_term',        // 4-line cap-rate cohort (dia: 12+/8-12/6-8/≤5; gov: 10+/6-10/<5/Outside)
  'nm_vs_market_cap',              // 2-line NM vs Market cap rates
  'sold_cap_by_term_dot_plot',     // 4-line TTM cohort (same shape as cap_rate_by_lease_term)
  'asking_cap_by_term_dot_plot',   // 4-line active-listings cohort (dia only)
  // Deferred: net_lease_spread — renderer references cap_10plus_year but
  //   data tab only writes treasury_10y_yield / avg_cap_rate / nm_avg_cap /
  //   spreads. Native chart needs cells that exist; fix the data-shape
  //   mismatch first (either add cap_10plus_year column or update renderer
  //   to use nm_avg_cap as the 3rd series).
  // P6 — combo dual-axis charts (bar on left axis + line on right axis)
  'dom_and_pct_of_ask',             // bar: avg_dom (days) + line: pct_of_ask (%)
  'dom_and_pct_of_ask_monthly',     // same shape, monthly cadence
  'case_for_renewal',               // bar: commencement_count + line: avg_rent_per_sf
  'available_market_size_combo',    // bar×2 (count_total/core) + line×2 (avg_cap_total/core)
  // P7 — scatter (xy) charts — one dot per data row
  'core_cap_rate_dot_plot',         // x=sale_date, y=cap_rate (closed sales)
  'available_cap_rate_dot_plot',    // x=firm_term_years, y=asking_cap (active listings)
  // Deferred: trendlines on the cap-rate dot plots (12-mo rolling avg /
  //   linear regression). The renderer computes them in JS from the
  //   data; native chart needs the trendline values pre-computed into
  //   helper columns on the data tab. Plumbing for P7.5.
  // P8 — floating-bar / box-whisker family. Two strategies:
  //   (a) Floating bar via stacked-bar with invisible base, where the
  //       data tab naturally carries both [bottom, height] columns.
  //   (b) Render box-whisker as a multi-line quartile chart (preserves
  //       all data; drops the shaded IQR fill — user can add it manually).
  'bid_ask_spread',                 // (a) quarterly: only spread col present → simple line fallback
  'bid_ask_spread_monthly',         // (a) monthly: invisible(last_ask) + visible(spread) stacked bar
  'rent_psf_box_quarterly',         // (b) upgraded to IQR floating-bar + median line in P8.5
  // P9 — composite: IQR floating bar + median (circle) + avg (diamond)
  //      dot markers over a year x-axis. Uses helper col for IQR width.
  'rent_by_year_built',
  // R33 Tier F1 — valuation_index combo (line=index on left axis +
  //      bars=YoY% change on right axis). Renderer has been producing
  //      this shape since Round 20 but the template slipped through
  //      the R34 migration. swapAxes used because the PDF puts the
  //      line on the LEFT axis (opposite of dom_and_pct_of_ask).
  'valuation_index',
  // R35 P1 — 6 missed multi-line templates caught by post-R34 audit.
  //   All reuse buildMultiLineChartXml (no new builder needed).
  'cap_rate_top_bottom_quartile',   // 3-line: top_q dashed / median bold / bottom_q dashed
  'cap_rate_by_credit',             // 3-line: Federal navy / State sky / Municipal sage
  'cpi_vs_renewal_cagr',            // 2-line: CPI sky / GSA renewal navy
  'fed_funds_vs_treasury',          // 2-line: Fed Funds navy / 10Y Treasury sky
                                    // (renderer references mortgage_30y but it's not in
                                    // the data tab; native plots the 2 series that exist)
  'cash_leveraged_returns',         // 2-line: cash_return navy / leveraged_mid sky
  'asking_cap_quartiles_active',    // 4-line: total upper/lower + core upper/lower (dashed)
  // R35 P2 — 7 missed combo + clustered-bar templates from audit.
  //   Standard combo (bars left, line right):
  'txn_count_avg_deal_combo',       // 1 bar (count) + 1 line (avg deal $)
  'rent_and_price_per_chair',       // 1 bar (rent/chair) + 1 line (price/chair) — dia
  'rent_and_price_psf',             // 1 bar (rent/SF) + 1 line (price/SF) — gov
  'dom_price_change_active',        // 2 bars (DOM) + 2 lines (% change, 1 dashed)
  //   Swapped combo (lines left, bars right):
  'seller_sentiment',               // 2 lines (cap rate) left + 2 bars (% change) right
  'seller_sentiment_monthly',       // same shape, monthly cadence
  //   Clustered bar (no line — renderer's line series isn't in data tab):
  'inventory_backlog',              // 2 bars: No. Added (sky) + No. Sold (navy)
  'pace_of_cap_rate_expansion',     // 2 bars: pace_all (navy) + pace_core (sky)
  // R35 P3 — final 2 simple-shape missed templates from audit.
  'buyer_class_pct_by_year',        // annual stacked bar (Private / REIT / Cross-Border / Institutional)
  'renewal_rent_growth',            // single-bar Renewal Rent / SF
  // R35 P4 — final 2 complex composites.
  'cost_of_capital',                // 2 lines + floating gray range bar (sharedAxis combo)
  'volume_cap_quartile_combo',      // area + range bars + dots (area-combo)
  // R36 P1 — horizontal-bar state rankings. Audit caught these in
  // the renderer (use indexAxis: 'y') but they slipped through R35.
  // Choropleth/bubble-map upgrade is deferred (chartjs-chart-geo plugin
  // not bundled in QuickChart hosted); the horizontal-bar fallback is
  // the editable visual that ships.
  'leased_inventory_by_state',      // top-N states by lease_count (gov)
  'sources_of_capital',             // top-N buyer states by 15-yr volume (gov)
  // R36 P2 — donut charts (single ring, N segments, no axes).
  'available_by_tenant_count_donut',  // count share by tenant (DaVita/FMC/US Renal/Other)
  'available_by_tenant_volume_donut', // volume share by tenant — same shape
  // R36 P3 — bar + 4-scatter composites on categorical x-axis (term buckets).
  // Reuses the combo machinery with showMarker=true on line series for
  // the dot overlays (same pattern as rent_by_year_built from R34 P9).
  'available_by_term_summary',        // dia: Sub 5 / 5-8 / 8-12 / 12+ term cohorts
  'available_by_firm_term_summary',   // gov: same shape
  // R36 P4 — unblock 3 of 5 deferred templates with code-only changes.
  // After this PR, only ppsf_box_quarterly (dropped from catalog) and
  // lease_structures (renderer returns null — table only) remain
  // unmigrateable.
  'lease_termination_rate',         // helper col in_firm_term = total - outside
  'net_lease_spread',               // 2-line (3rd cap_10plus_year not in data tab)
  'rent_heat_map',                  // horizontal-bar fallback (same as leased_inv_by_state)
  // ppsf_box_quarterly was DELETED from the active catalog in Round 6h
  // (supabase migration 20260601_cm_catalog_drop_8_view_less_rows_round6h.sql)
  // — no view ever shipped, no exports ever produced it. The static JSON
  // catalog still lists it but the DB catalog is the runtime source of
  // truth. Nothing to migrate.
]);

/**
 * Build an injection spec for a chart_template_id given the workbook's
 * actual column layout for that tab. Returns null for unsupported types
 * (caller will fall back to PNG).
 *
 * @param {object} args
 * @param {string} args.chart_template_id
 * @param {string} args.tabName
 * @param {Array<{key:string, col:string}>} args.cols  CHART_COLUMNS entry for this template (already mapped to A/B/C... columns)
 * @param {number} args.dataStart     1-indexed row where data begins
 * @param {number} args.dataEnd       1-indexed row where data ends (inclusive)
 * @param {object} args.brand         Brand tokens (palette, fonts)
 * @param {Array<object>} [args.rows] Optional — actual data rows. Used for
 *                                    cohort detection on templates that
 *                                    keep both dia + gov column schemes
 *                                    in their data tab (e.g. cap_rate_by_lease_term).
 * @returns {object|null} injection spec or null if no builder registered
 */
// R47 — per-template chart-axis trim. User notes 2026-05-21 batch 2:
// many charts looked like they had "missing data" prior to a given year.
// Investigation (audit/cm-style-audit/R47-DATA-GAP-AUDIT.md) showed two
// shapes:
//   (1) TRUE gap — source data really starts at the cited year.
//   (2) FALSE alarm — data exists 2001-2002 + 2005+, but the sparse
//       2003-2004 window (sales_transactions only had 4-12 sales/year
//       then) causes line breaks the user reads as "missing pre-2005".
//
// User direction:
//   • TRUE gap: trim chart x-axis to where data begins.
//   • FALSE alarm: pin chart x-axis to 2005 (skip the 2003-2004 break).
//
// Implementation: shift the chart's dataStart row reference forward to
// the first row whose period_end >= cutoff year. The data tab keeps
// every row from 2001+ (so historical context is preserved); only the
// chart series references narrow. dataEnd is unchanged.
// R69 — per-vertical TTM-density cutoff helper. Returns the first year
// where 4+ consecutive months have transaction_count_ttm ≥ N. For
// cap-rate-bearing charts the dia view has n=9-14 sales/TTM through
// 2008 (so 2005 caps swing wildly on single-sample inputs) while gov
// has n=29-45 from 2005 onward (no trim needed). This lets each chart
// honestly start where the underlying sample is dense, automatically
// per-vertical, instead of requiring a vertical-aware static cutoff.
function findFirstDenseYear(rows, fieldKey, minN, consecutive = 4) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  let run = 0;
  let runStartYear = null;
  for (const r of rows) {
    const pe = r && r.period_end ? new Date(r.period_end) : null;
    if (!pe || Number.isNaN(pe.getTime())) {
      run = 0; runStartYear = null; continue;
    }
    const n = r[fieldKey];
    if (n != null && Number(n) >= minN) {
      if (run === 0) runStartYear = pe.getUTCFullYear();
      run++;
      if (run >= consecutive) return runStartYear;
    } else {
      run = 0; runStartYear = null;
    }
  }
  return null;
}

const MIN_YEAR_BY_TEMPLATE = {
  // R47 → R69. cap_rate_ttm_by_quarter and the two charts that share
  // its baseline (cash_leveraged_returns, cost_of_capital) now use a
  // data-aware cutoff. Per-vertical effective trims:
  //   dia: ~2009 (TTM transaction_count first reaches 15 consistently
  //               at Dec-2008 with n=27, then n=21-27 through 2009)
  //   gov: ~2005 (n=29-45 from the start of the time series)
  // User notes 2026-05-23 batch 6: "Same comment above about the 2005
  // cap rates not being in the 4s" — the dia 2005 sparse-sample
  // artifact disappears; gov is unaffected.
  //
  // master Excel's "Cap (TTM)" series (Dialysis Comp Work MASTER.xlsx
  // chart15, col O) begins at row 23 = Sep-2009; chart now starts
  // where the master starts. A separate ~80bps methodology gap
  // (our 7.7-8.1% vs master 8.6-9.2% in 2009) is tracked in
  // audit/cm-style-audit/R69-USER-NOTES-2026-05-24.md.
  cap_rate_ttm_by_quarter:      (rows) => findFirstDenseYear(rows, 'transaction_count_ttm', 15) ?? 2009,
  cash_leveraged_returns:       (rows) => findFirstDenseYear(rows, 'transaction_count_ttm', 15) ?? 2009,
  cost_of_capital:              (rows) => findFirstDenseYear(rows, 'transaction_count_ttm', 15) ?? 2009,
  // R54 — cap_rate_top_bottom_quartile bumped from 2005 to 2007 because
  // 2005-2006 has 0-3 cap-rate samples per TTM window (sane band). With
  // n<4 the master_m view emits degenerate Q1=Med=Q3 (single sample
  // means all three percentiles are equal). The R54 view-level
  // sample-count gate (cm_dialysis_cap_quartile_m + cm_gov_cap_quartile_m)
  // NULLs those rows so the chart correctly shows a line gap during
  // sparse periods; the MIN_YEAR bump keeps the visible chart starting
  // where data is dense, matching user expectation that the chart
  // shouldn't "move wildly around 2006".
  cap_rate_top_bottom_quartile: 2007,
  volume_cap_quartile_combo:    2005,
  // R67 — bumped from 2005 to 2015. User notes 2026-05-23 batch 6:
  // "missing quite a bit of data for before 2014 — suggesting a
  // formula or data access issue in our database; these data sets
  // should move in tandem and look closer to what we have in our
  // Excel/PDF versions." Per-cohort TTM windows go sparse below ~2014
  // for the longer-term buckets (12+ year had <5 samples per quarter
  // until ~2014). 2015 is the first year where all 4 cohorts have
  // dense, comparable coverage and the lines stop crossing erratically.
  sold_cap_by_term_dot_plot:    2015,
  asking_cap_by_term_dot_plot:  2015,
  // 2026-05-29 - the cap-by-term LINE chart was untrimmed (307 monthly
  // points from 2001): thin pre-2015 cohorts made the lines erratic AND
  // the 25-yr category count crowded out the quarterly x-axis labels.
  // Match the dot-plot term variants (2015) so cohorts are dense + labels show.
  cap_rate_by_lease_term:       2015,
  // 2026-05-29 - bumped 2006 -> 2011. NM-tagged gov sales are absent in
  // 2008-2009 and sparse in 2003/2007/2010, so the line rendered with
  // gaps + erratic jumps. From 2011 it's continuous and the 9-mo MA reads
  // smooth (matches the PDF). User: 'missing quite a bit of data ... moves
  // erratically'.
  // R66o — bumped 2011 -> 2020 to match the deck's Value Proposition Results
  // window (Sep-20 to Dec-25). The recent 5-6yr window + 4.75-7.75% axis makes
  // the NM-below-market gap legible; the 2011-19 history compressed it.
  nm_vs_market_cap:             2020,
  // R70 — sentiment: data-aware cutoff. R47's 2006 was too generous;
  // sentiment data is genuinely sparse before ~Q3 2014 (n=0-3/TTM in
  // 2006-2010, n=1-6/TTM in 2011-2013, n≥5 sustained from Q3 2014).
  // The chart visually shows "missing data before 2013" because most
  // pre-2014 cells are NULL or single-sample.
  // User notes 2026-05-23 batch 6: "Missing data for before 2013".
  // Apply findFirstDenseYear with threshold n_all >= 5 to start the
  // chart where the trailing-12-month sample becomes meaningful.
  // Falls back to 2014 if data shape doesn't expose n_all.
  // R66cc — floor at 2017: the 10+ cohort (now gated n>=3) is clean from 2017, but
  // 2015-2016 (n=3-4) carry cap inversions. Starting 2017 shows the continuous 10+
  // series without the early noise.
  seller_sentiment:             (rows) => Math.max(findFirstDenseYear(rows, 'n_all', 5) ?? 2014, 2017),
  seller_sentiment_monthly:     (rows) => Math.max(findFirstDenseYear(rows, 'n_all', 5) ?? 2014, 2017),
  // R66aa — start 2018 (was 2013). Pre-2018 TTM months are thin and volatile even
  // after the n>=10 gate; deck's DOM chart also starts 2018. With the gate+smoothing
  // the 2018+ window lands DOM 168-290 (0-300 axis) / % ask 86.9-95.8% (84-96% axis).
  dom_and_pct_of_ask:           2018,
  dom_and_pct_of_ask_monthly:   2018,
  bid_ask_spread:               2014,
  bid_ask_spread_monthly:       2014,
  // Pace recipe inherits dia/gov coverage; safe to skip 2003-2004 here too
  pace_of_cap_rate_expansion:   2005,
  // R62 — Val_Index 2010-12 swings and YOY 2002-2004 swings are both
  // small-sample TTM artifacts. User notes 2026-05-22 batch 4:
  //   "Data_Val_Index: Data swings wildly in the 2010-12 set,
  //    suggesting a lack of real data that skews the entire chart"
  //   "Data_YOY_Change: Big changes in 2002 and 2004 time frame"
  // Trim each to where the volatility stabilizes. valuation_index
  // gets 2005 (avoids 2003-2004 thin data); yoy_volume_change goes
  // to 2003 so YoY is computed against 2002 (which exists per R47
  // 12 sales/yr in 2001-2002).
  // R68-D (2026-06-05) — was static 2013, which cropped the index + its YoY%
  // overlay to ~2014 even though the inputs (rent_at_sale + cap) support ~2011.
  // The valuation_index view now self-gates per row at ttm_n>=12 (migration
  // 20260713), so track the data start data-aware on ttm_n rather than a static
  // floor. Lands at 2011 (Sep-2011 is the first run of 4 consecutive n>=12
  // months); the embedded YoY% bars (lag-12 of the index) follow automatically.
  valuation_index:              (rows) => findFirstDenseYear(rows, 'ttm_n', 12) ?? 2011,
  // 2026-05-29 - start the credit-tier chart ~2000 (pre-2000 gov cap data
  // is sparse/noisy). User: "stop the x-axis around 2000".
  cap_rate_by_credit:           2000,
  yoy_volume_change:            2005,
  // R51 — active-listings family (user notes 2026-05-21 sparseness items
  // that R47 didn't sweep up). Each is a TRUE-gap: the active_listings
  // table itself only carries data from the cited year onward (broker
  // active-inventory tracking began at different times for different
  // metrics). Verified per-year row counts in
  // audit/cm-style-audit/R51-ACTIVE-LISTING-GAPS.md.
  //
  // dia-only templates (gov doesn't carry these views); the trim is a
  // no-op for verticals where the catalog doesn't include the template.
  asking_cap_quartiles_active:  2015,  // 2 rows in 2014 → trim to first full year
  // R66t — bumped 2016 -> 2017. The chart is now on a trailing-12-month "marketed"
  // basis (cm_dialysis_available_market_size_q); listing capture is sparse pre-2017
  // (1-55 listings/yr) so 2015-2016 TTM counts are thin. Deck starts Q3-17.
  available_market_size_combo:  2017,
  dom_price_change_active:      2018,  // R66b: pre-2018 had <12 active listings/mo,
                                       // so the DOM average stair-stepped on 2-5 listings.
                                       // View now gates n>=8 + 3-mo smooths; trim display to 2018.
};

export function buildInjectionSpec(args) {
  // R38 — thin wrapper that lets `args.title` flow into the returned
  // spec without touching the ~50 switch cases in buildInjectionSpecInner.
  // Each case constructs `spec: { type, tabName, ... }` and returns it
  // wrapped in `{ tabName, spec, helperCols? }`. We splice title here
  // so every builder gets it via `spec.title` regardless of case.
  //
  // R47 — also compute an effective dataStart row offset based on the
  // per-template MIN_YEAR_BY_TEMPLATE cutoff. The first row whose
  // period_end is >= cutoff year becomes the chart's dataStart; the
  // data tab is unchanged so all historical rows from 2001+ remain
  // visible in the worksheet.
  //
  // R69 — MIN_YEAR_BY_TEMPLATE entry can be either a number (static cutoff,
  // same for all verticals — R47's original behavior) or a function
  // `(rows) => number | null`. The function form lets per-vertical
  // sparseness drive the cutoff: e.g. for cap_rate_ttm_by_quarter, dia
  // has n=9-14 sales per TTM through 2008 (master Excel doesn't show
  // pre-2009 data at all) while gov has n=29-45 from 2005 onward, so a
  // single static cutoff would either trim valid gov data or leave dia
  // showing single-sample outlier-driven cap rates. The function reads
  // each row's transaction_count_ttm to find the first chronological
  // year where the underlying sample is dense enough to be honest.
  const minYearEntry = MIN_YEAR_BY_TEMPLATE[args.chart_template_id];
  const minYear = typeof minYearEntry === 'function'
    ? minYearEntry(args.rows)
    : minYearEntry;
  let effectiveStart = args.dataStart;
  if (minYear && Array.isArray(args.rows) && args.rows.length > 0) {
    // Find first row at or after the cutoff year. Rows arrive in
    // chronological order from the view; first match is the offset.
    const cutoff = new Date(`${minYear}-01-01T00:00:00Z`).getTime();
    let offset = 0;
    for (const r of args.rows) {
      const pe = r.period_end ? new Date(r.period_end).getTime() : NaN;
      if (Number.isFinite(pe) && pe >= cutoff) break;
      offset++;
    }
    // Don't shift past the end (safety — keep at least 1 row visible)
    if (offset < args.rows.length) {
      effectiveStart = args.dataStart + offset;
    }
  }
  // R57 — preserve the ORIGINAL header row even when R47's axis trim
  // shifted dataStart forward. The header row in the worksheet is at a
  // fixed location set by cm-excel-export.js (row 4 by default; or 27
  // + summary when a PNG image is anchored on top). headerRowOverride
  // pins the legend / series-title references at that original spot
  // so they continue showing column header text ("Top Quartile") and
  // not numeric cell values from the trimmed first data row.
  const innerArgs = effectiveStart !== args.dataStart
    ? { ...args, dataStart: effectiveStart, headerRowOverride: args.dataStart - 1 }
    : args;
  const result = buildInjectionSpecInner(innerArgs);
  if (result && result.spec && args.title) {
    result.spec.title = args.title;
  }

  // R53 — universal fix for the broken "qQ-yyyy" cat-axis labels.
  // R37 P1 set DEFAULT_CAT_AX_NUM_FMT = 'q"Q-"yyyy' on every date-axis
  // chart so users would see quarter labels like "1Q-2024". Excel's
  // number-format token set DOES NOT support `q` for quarter — Excel
  // renders the format string LITERALLY as "qQ-2024", breaking all 29
  // date-axis charts in the export (verified in
  // audit/cm-style-audit/R53-peek-export.mjs).
  //
  // The fix: emit a `period_label` STRING helper column at the data
  // tab (values like "Q1 '24" for quarterly cadence, "Jan '24" for
  // monthly) and repoint the chart's cat axis at that string column.
  // The format on the axis becomes General — the string values pass
  // through unchanged.
  //
  // Applied universally to any spec whose catCol points at the
  // period_end column (col A in every quarterly/monthly view). Specs
  // with categorical/text x-axes (term_bucket, year, state) are
  // untouched because their catCol points somewhere other than the
  // period_end col.
  //
  // Opt-in via args.injectPeriodLabel = true. cm-excel-export.js
  // ALWAYS passes true (so the production export benefits). Existing
  // unit tests that target the inner spec shape don't pass the flag
  // and continue to see the unwrapped pre-R53 spec (so their hard-coded
  // catCol = 'A' assertions don't need rewriting); new R53 tests opt
  // in explicitly to verify the period_label wiring.
  const cols = args.cols;
  if (args.injectPeriodLabel && result && result.spec && Array.isArray(cols) && cols.length > 0) {
    const firstCol = cols[0];
    const periodEndCol = (firstCol && firstCol.key === 'period_end') ? firstCol.col : null;
    if (periodEndCol && result.spec.catCol === periodEndCol) {
      // Detect cadence from the row spacing. Robust against the
      // template-id naming convention drift (some monthly templates
      // don't end with `_monthly`).
      // R58 — detect cadence from template id, not row spacing.
      // Most underlying views are monthly (_m) but most exports show
      // quarter labels on the x-axis. Only the explicitly-monthly
      // templates (chart_template_id ending in _monthly or
      // monthly_count) keep "Mar '24" style labels.
      const isMonthly = detectMonthlyCadence(args.chart_template_id);
      const labelFormatter = isMonthly ? formatMonthLabel : formatQuarterLabel;
      const existingHelpers = Array.isArray(result.helperCols) ? result.helperCols : [];
      // period_label lands one column past the regular CHART_COLUMNS
      // entries. Existing helper cols (e.g. R50 net_ttm at cols.length+1)
      // shift right by one — wrapper rewrites their column letter
      // references in the spec body too.
      const labelColIdx = cols.length;                            // 0-based
      const labelColLetter = String.fromCharCode(65 + labelColIdx);
      // Shift any existing helper col references in the spec body by 1.
      // Helper cols are typically computed in the inner builder as
      // `String.fromCharCode(65 + cols.length)` → that needs to become
      // 65 + cols.length + 1 now that period_label is in front of them.
      if (existingHelpers.length > 0) {
        const oldFirstHelperLetter = String.fromCharCode(65 + cols.length);
        const newFirstHelperLetter = String.fromCharCode(65 + cols.length + 1);
        shiftHelperColRefs(result.spec, oldFirstHelperLetter, newFirstHelperLetter, existingHelpers.length);
      }
      // Prepend period_label so it sits BEFORE the other helper cols.
      result.helperCols = [
        {
          key: 'period_label',
          header: isMonthly ? 'Month' : 'Quarter',
          // No FMT entry — string values render as-is. width set for legibility.
          width: 10,
          getValue: (row) => row && row.period_end ? labelFormatter(row.period_end) : null,
        },
        ...existingHelpers,
      ];
      // Repoint the chart's cat axis at the new string column. Drop
      // the broken catAxNumFmt so the General format renders the
      // strings as-is. Persist the original numFmt as catAxOriginalFmt
      // for any downstream debugging.
      if (result.spec.catAxNumFmt !== undefined) {
        result.spec.catAxOriginalFmt = result.spec.catAxNumFmt;
      }
      result.spec.catAxNumFmt = '';      // explicit empty → numFmt suppressed
      result.spec.catCol = labelColLetter;
    }
  }

  return result;
}

// R58 — cadence detection from chart_template_id. The R53 row-spacing
// heuristic was wrong: most underlying views are MONTHLY cadence (the
// _m views), but the user's chart conventions show QUARTER labels on
// the x-axis even when the line connects monthly dots. R58 inverts
// the default: every date-axis chart shows quarter labels ("Q1 '24")
// UNLESS the template name explicitly marks it as a monthly variant
// (chart_template_id ends with _monthly OR includes _m_).
//
// Why this matters: user notes 2026-05-22 batch 4 repeatedly called
// out "Date x-axis and not quarters" / "labeled in months now and we
// want quarters" across nearly every chart in the export. R53 was
// producing "Jan '07" / "Feb '07" labels because the row-spacing
// detection saw the underlying _m views as monthly.
//
// Explicitly-monthly templates (keep "Jan '24" labels):
//   • bid_ask_spread_monthly
//   • dom_and_pct_of_ask_monthly
//   • seller_sentiment_monthly
//   • buyer_pool_monthly_count
// All others default to quarter labels.
function detectMonthlyCadence(chartTemplateId /* legacy: rows[] also accepted */) {
  if (typeof chartTemplateId === 'string') {
    // R62 — _monthly suffix only. Removed monthly_count special case so
    // buyer_pool_monthly_count gets quarter labels too (user notes
    // 2026-05-22 batch 4: "Data_Buyer_Pool_M: X-axis quarter labeling
    // issue showing in months"). Quarter labels are emitted on
    // end-of-quarter rows only (see formatQuarterLabel below), so the
    // 3-bars-per-quarter visual doesn't get duplicated labels.
    if (/_monthly$/.test(chartTemplateId)) return true;
    return false;
  }
  // Back-compat for any callers still passing rows array.
  return false;
}

// R62 — emit quarter labels ONLY on end-of-quarter rows so monthly-
// cadence charts (buyer_pool_monthly_count, etc.) get one quarter
// label per 3 monthly bars instead of "Q1 '24, Q1 '24, Q1 '24, Q2 '24
// ..." duplicated across consecutive bars.
function formatQuarterLabel(periodEnd) {
  const d = new Date(periodEnd);
  if (Number.isNaN(d.getTime())) return null;
  const m = d.getUTCMonth();              // 0..11
  // Only label end-of-quarter rows: Mar (2), Jun (5), Sep (8), Dec (11)
  if (m % 3 !== 2) return '';
  const q = Math.floor(m / 3) + 1;
  const y2 = String(d.getUTCFullYear()).slice(-2);
  return `Q${q} '${y2}`;
}

// R53 — "Jan '24" formatter for monthly cadence.
const MONTH_ABBREV_R53 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function formatMonthLabel(periodEnd) {
  const d = new Date(periodEnd);
  if (Number.isNaN(d.getTime())) return null;
  const y2 = String(d.getUTCFullYear()).slice(-2);
  return `${MONTH_ABBREV_R53[d.getUTCMonth()]} '${y2}`;
}

// R53 — when a spec body refers to a helper col by a hard-coded
// column letter (e.g. R50 Inventory_Backlog sets netCol = 'G' at
// cols.length=6), we need to shift that reference forward by 1
// because period_label now sits at that position.
//
// `oldFirst` is what existing helper col letters START at (computed
// before adding period_label); `newFirst` is what they SHOULD start
// at now. We walk through the spec's series/bar/line lists looking
// for valCol / titleCol values within the helper-col letter range
// and shift them.
function shiftHelperColRefs(spec, oldFirst, newFirst, helperCount) {
  if (!spec || helperCount <= 0) return;
  const oldStart = oldFirst.charCodeAt(0);
  const newStart = newFirst.charCodeAt(0);
  const inRange = (letter) => {
    if (typeof letter !== 'string' || letter.length !== 1) return false;
    const code = letter.charCodeAt(0);
    return code >= oldStart && code < oldStart + helperCount;
  };
  const shift = (letter) => String.fromCharCode(letter.charCodeAt(0) + (newStart - oldStart));
  const visit = (s) => {
    if (!s || typeof s !== 'object') return;
    for (const key of ['valCol', 'titleCol', 'catCol', 'xCol', 'yCol']) {
      if (inRange(s[key])) s[key] = shift(s[key]);
    }
  };
  visit(spec);
  for (const arr of [spec.series, spec.barSeries, spec.lineSeries]) {
    if (Array.isArray(arr)) for (const s of arr) visit(s);
  }
}

function buildInjectionSpecInner({ chart_template_id, tabName, cols, dataStart, dataEnd, brand, rows, title, headerRowOverride, vertical }) {
  const palette = brand?.palette || {};
  const navy   = (palette.nm_navy   || '#003DA5').replace('#', '');
  const sky    = (palette.nm_sky    || '#62B5E5').replace('#', '');
  // R57 — accept a headerRow override from the outer wrapper. The R47
  // axis-trim wrapper shifts dataStart forward to skip sparse early
  // years, but the header row is at a FIXED location in the worksheet
  // (row 4 or wherever cm-excel-export writes it) — it doesn't move
  // when the chart's plotted data range narrows. Without this override,
  // titleRow = dataStart - 1 would point at the TRIMMED first data
  // row's cells, making the legend show numeric values like "4.73%"
  // instead of the column headers like "Top Quartile".
  const headerRow = (typeof headerRowOverride === 'number' && headerRowOverride > 0)
    ? headerRowOverride
    : dataStart - 1;
  const standardAnchor = { col0: 0, row0: 0, col1: 13, row1: 21 };

  // Helper: find the column letter for a CHART_COLUMNS key (or first
  // match from a list of candidate keys).
  const findCol = (...keys) => {
    for (const k of keys) {
      const c = cols.find(c => c.key === k);
      if (c) return c.col;
    }
    return null;
  };

  // Helper: build a simple single-series chart spec given a chart type,
  // a value-column key (or list of candidates), and a color. period_end
  // is always the x-axis.
  //
  // R37 P2 — optional `opts` for per-template axis pinning + format:
  //   opts.yAxisRange:  { min, max } passed straight through to valAx
  //   opts.valAxNumFmt: Excel format string for the y axis (e.g. '0.00%')
  //
  // R37 P3 — optional `opts.annotateKey` + `opts.annotateFmt` builds
  // peak/trough/most-recent labels from `rows` against the named row key,
  // formatted by one of the keys in ANNOTATION_FORMATTERS.
  const singleSeries = (type, valKeys, color, opts = {}) => {
    const periodCol = findCol('period_end');
    const valCol = findCol(...(Array.isArray(valKeys) ? valKeys : [valKeys]));
    if (!periodCol || !valCol) return null;
    // R37 P3 — compute data labels from rows if requested
    let dataLabels;
    if (opts.annotateKey && opts.annotateFmt && Array.isArray(rows)) {
      const fmt = ANNOTATION_FORMATTERS[opts.annotateFmt];
      if (fmt) {
        dataLabels = buildAnnotationsForSpec(rows, r => r[opts.annotateKey], fmt);
      }
    }
    return {
      tabName,
      spec: {
        type, tabName,
        titleCol: valCol, titleRow: headerRow,
        catCol: periodCol, valCol,
        dataStart, dataEnd,
        color,
        yAxisRange:  opts.yAxisRange,
        valAxNumFmt: opts.valAxNumFmt,
        dataLabels,
        anchor: standardAnchor,
      },
    };
  };

  switch (chart_template_id) {
    // P2 — first migration
    case 'volume_ttm_by_quarter':
      // master_m mapper renames ttm_volume → volume_dollars in some places.
      // R64 — user feedback 2026-05-22 batch 5: "$1.80B y-axis format" +
      // peak/trough/last annotations missing (R37 P3 wasn't wired here).
      return singleSeries('line', ['volume_dollars', 'ttm_volume'], navy, {
        valAxNumFmt:  VAL_FMT_CURRENCY_B,
        annotateKey:  'volume_dollars',
        annotateFmt:  'currency_b',
      });

    // P3 — simple single-series line + bar charts
    case 'cap_rate_ttm_by_quarter':
      // R66b — dia retuned to displayed data 6.48-8.57% -> 6.25-8.75% (R66's
      // 5.75-8.5% clipped the 8.57% peak and left ~0.7% empty below); gov stays
      // on shared CAP_RATE_RANGE (5-10%).
      return singleSeries('line', 'ttm_weighted_cap_rate', navy, {
        yAxisRange: (vertical === 'dialysis' ? { min: 0.0625, max: 0.0875 } : CAP_RATE_RANGE),
        valAxNumFmt: VAL_FMT_PERCENT_2DP,
      });
    case 'transaction_count_ttm':
      return singleSeries('bar', ['ttm_count', 'count'], navy, {
        valAxNumFmt: VAL_FMT_INTEGER,
      });
    case 'avg_deal_size':
      // R37 P3 + R64 — y-axis labels use "$X.XM" format per user batch 5
      // ("formatted in the same $7.0M style"). The R37 P3 peak/trough/last
      // annotation already used currency_m formatter; only the y-axis
      // numFmt changes to match.
      return singleSeries('bar', 'avg_deal_size', navy, {
        valAxNumFmt: VAL_FMT_CURRENCY_M_1DP,
        annotateKey: 'avg_deal_size',
        annotateFmt: 'currency_m',
      });
    case 'yoy_volume_change':
      // Renderer uses signed colors (navy positive, lighter negative).
      // Native chart XML doesn't easily express per-point conditional
      // colors — accept navy across the board for now (mirrors most-recent
      // values; negative bars still render correctly, just without the
      // red highlight). Could add point-level dPt color overrides later.
      return singleSeries('bar', 'yoy_change_pct', navy, {
        valAxNumFmt: VAL_FMT_PERCENT_0DP,
      });
    case 'market_turnover': {
      // R55 — restructured per user direction 2026-05-22:
      // "I think we show a total number of listings on the market on a
      //  bar, the annualized rate at which sales are occurring monthly
      //  on another bar in front of the inventory bar, and then the
      //  line is the number of months that it would take to sell all
      //  of the inventory available during that month at the current
      //  rate we are seeing transactions occur."
      //
      // 3 series, dual axis:
      //   • Bar (back, pale sky):  Active Listings (current inventory)
      //   • Bar (front, navy):     Annual Sales Rate (TTM sales count)
      //   • Line (gray, right):    Months of Supply (= active / monthly_sales)
      //
      // Bars share the LEFT axis (integer count). Line on RIGHT axis
      // (months, ~30-50 mo range). Both axes labeled.
      const periodCol = findCol('period_end');
      const activeCol = findCol('active_count');
      const salesRateCol = findCol('annual_sales_rate');
      const mosCol    = findCol('months_of_supply');
      // Backward-compat fallback: if the new R55 columns haven't propagated
      // to a vertical's view yet, degrade to the R50 single-bar+line shape.
      if (!periodCol) return null;
      if (!activeCol || !salesRateCol || !mosCol) {
        // Pre-R55 view shape — keep R50 behavior so the chart still renders.
        const salesCol  = findCol('ttm_sales_count');
        const rateCol   = findCol('turnover_rate');
        if (!salesCol || !rateCol) return null;
        const paceCol = String.fromCharCode(65 + cols.length);
        return {
          tabName,
          spec: {
            type: 'combo', tabName, catCol: periodCol, dataStart, dataEnd,
            barGrouping:  'clustered',
            yLeftNumFmt:  VAL_FMT_INTEGER,
            yLeftAxisTitle:  'Sales per month',
            yRightNumFmt: VAL_FMT_PERCENT_1DP,
            yRightAxisTitle: 'Turnover rate',
            barSeries:  [{ titleCol: paceCol, titleRow: headerRow, valCol: paceCol, color: sky }],
            lineSeries: [{ titleCol: rateCol, titleRow: headerRow, valCol: rateCol, color: navy }],
            anchor: standardAnchor,
          },
          helperCols: [{
            key: 'monthly_clear_pace',
            header: 'Monthly Clear Pace',
            format: 'number_one_decimal',
            width: 18,
            getValue: (row) => row.ttm_sales_count == null ? null : Number(row.ttm_sales_count) / 12,
          }],
        };
      }
      // R62 — switch the front bar from annual_sales_rate to monthly
      // clear pace (= ttm_sales_count / 12) per user clarification
      // 2026-05-22 batch 4: "the monthly figures for sales should be
      // the TTM sales count/12 so we show the rate at which the
      // current outstanding inventory clears the market monthly
      // (total listings available for sale during that month against
      // the average monthly sold rate for the prior 12 months)."
      //
      // R55 used annual_sales_rate (TTM raw count, ~150 dia); user
      // wants monthly clear pace (~12.5 dia). Added as a helper col
      // computed at chart-build time so the data tab keeps both
      // figures available. Front bar reads from the helper col.
      const pale = '#E0E8F4';
      const monthlyPaceCol = String.fromCharCode(65 + cols.length);
      // R66s STRIPPED the gov active-universe / months-of-supply ("~11% listing
      // coverage"). R69 (G25) RE-ENABLES them: Scott's 2026-06-05 note — "we are
      // missing total available and monthly clearance rate." Live receipts
      // (2026-06-06) show gov active_count is stable from 2012 on (20-98 active,
      // 4-8 months of supply), and cm_gov_market_turnover_m now NULLs the
      // pre-2012 head (no listing history) so the universe series start cleanly
      // where the data is real. Gov now gets the full 3-series combo at parity
      // with dia and the master deck: Total Available bar + Monthly Sales Rate
      // bar + Months-to-clear line. (The gov universe is ~80% synthetic_from_sale
      // — a relative inventory-vs-pace indicator, not an organic on-market count;
      // it self-heals as organic page-marker capture accrues.)
      const stripUniverse = false;
      return {
        tabName,
        spec: {
          type: 'combo',
          tabName,
          catCol: periodCol,
          dataStart, dataEnd,
          barGrouping:     'clustered',
          barOverlap:      stripUniverse ? -20 : 100,  // front bar overlays back inventory bar at same x
          sharedAxis:      stripUniverse,               // gov: single axis, no empty months-of-supply axis
          yLeftNumFmt:     VAL_FMT_INTEGER,
          yLeftAxisTitle:  stripUniverse ? 'Monthly sales rate' : 'Listings / monthly sales rate',
          yRightNumFmt:    '#,##0.0" mo"',
          yRightAxisTitle: stripUniverse ? undefined : 'Months of supply',
          barSeries: stripUniverse ? [
            { titleCol: monthlyPaceCol,   titleRow: headerRow, valCol: monthlyPaceCol,   color: navy },
          ] : [
            // Back bar — total active inventory (pale sky)
            { titleCol: activeCol,        titleRow: headerRow, valCol: activeCol,        color: pale, borderColor: sky },
            // Front bar (R62) — monthly clear pace helper col, NOT annual rate
            { titleCol: monthlyPaceCol,   titleRow: headerRow, valCol: monthlyPaceCol,   color: navy },
          ],
          lineSeries: stripUniverse ? [] : [
            { titleCol: mosCol, titleRow: headerRow, valCol: mosCol, color: '6A748C' },
          ],
          anchor: standardAnchor,
        },
        // R62 — monthly clear pace helper col (TTM sales / 12).
        helperCols: [{
          key: 'monthly_clear_pace',
          header: 'Monthly Sales Rate',
          format: 'number_one_decimal',
          width: 18,
          getValue: (row) => {
            const c = row.annual_sales_rate ?? row.ttm_sales_count;
            return c == null ? null : Number(c) / 12;
          },
        }],
      };
    }
    case 'quarterly_volume_bars':
      // R68-E (D13): abbreviate the currency y-axis ($300M, $1.2B) instead of
      // raw $300,000,000. Quarterly volume spans ~$100M-$1.2B; the $X.XM form
      // matches the avg_deal_size convention and keeps tick labels legible.
      // (volume_ttm_by_quarter already abbreviates in billions.)
      return singleSeries('bar', 'quarterly_volume', sky, {
        valAxNumFmt: VAL_FMT_CURRENCY_M_1DP,
      });

    // P4 — stacked bar charts
    case 'lease_renewal_rate': {
      // R68-E G5 — DIVERGING stacked bars + net line. Mirrors the renderer
      // (cm-chart-image-renderer.js lease_renewal_rate). Additive outcomes
      // (sign +1) plot above zero; subtractive (sign -1) below. The data
      // tab keeps every count POSITIVE (auditable); chart-support helper
      // cols carry the negated values + the per-period net (signed sum).
      // Series→sign is CONFIG so a PDF-reconciliation mismatch is a
      // one-line flip. Stacked combo on a shared count axis (same machinery
      // as inventory_backlog's negative-bar + net-line visual). pdf_reconcile.
      const periodCol = findCol('period_end');
      // R70 G25 — all five categories stack POSITIVE (total height = total TTM
      // actions, category-shaded), per Scott's deck design; supersedes R68-E's
      // diverging for this chart. Sign map stays CONFIG. With all signs +1 the
      // negSeries set is empty (no negated helper cols) and the helper "total"
      // col equals the stack height -> rendered as a "Total Actions" line.
      const RENEWAL_SERIES = [
        { key: 'first_generation_commencements', color: 'E0E8F4', sign: +1 },  // pale
        { key: 'renewed_leases',                 color: '003DA5', sign: +1 },  // navy
        { key: 'succeeding_superseding_leases',  color: '265AB2', sign: +1 },  // mid blue
        { key: 'expired_leases',                 color: '62B5E5', sign: +1 },  // sky
        { key: 'terminated_leases',              color: 'D97706', sign: +1 },  // amber
      ];
      const resolved = RENEWAL_SERIES
        .map(s => ({ ...s, col: findCol(s.key) }))
        .filter(s => s.col);
      if (!periodCol || resolved.length === 0) return null;

      // Helper cols land one past the regular CHART_COLUMNS entries.
      // Negated cols for every subtractive series, then the net col.
      const negSeries = resolved.filter(s => s.sign < 0);
      const helperLetters = {};
      negSeries.forEach((s, i) => {
        helperLetters[s.key] = String.fromCharCode(65 + cols.length + i);
      });
      const netColLetter = String.fromCharCode(65 + cols.length + negSeries.length);

      const barSeries = resolved.map(s => ({
        // Series TITLE always references the original (positive) header cell
        // so the legend reads the plain outcome name; VAL points at the
        // negated helper col for subtractive series.
        titleCol: s.col, titleRow: headerRow,
        valCol: s.sign < 0 ? helperLetters[s.key] : s.col,
        color: s.color,
      }));

      const helperCols = negSeries.map(s => ({
        key: `${s.key}_neg`,
        header: `${s.key} (chart, neg)`,
        format: 'integer_count',
        width: 18,
        getValue: (row) => row[s.key] == null ? null : -Number(row[s.key]),
      }));
      helperCols.push({
        key: 'net_movement',
        header: 'Total Actions',
        format: 'integer_count',
        width: 16,
        getValue: (row) => {
          let net = 0; let seen = false;
          for (const s of RENEWAL_SERIES) {
            const v = row[s.key];
            if (v != null) { net += s.sign * Number(v); seen = true; }
          }
          return seen ? net : null;
        },
      });

      return {
        tabName,
        spec: {
          type: 'combo',
          tabName,
          catCol: periodCol,
          dataStart, dataEnd,
          barGrouping: 'stacked',
          sharedAxis:  true,            // net line on the same count axis
          valAxNumFmt: VAL_FMT_INTEGER,
          yLeftNumFmt: VAL_FMT_INTEGER,
          barSeries,
          lineSeries: [
            { titleCol: netColLetter, titleRow: headerRow, valCol: netColLetter, color: '191919' },
          ],
          anchor: standardAnchor,
        },
        helperCols,
      };
    }

    case 'buyer_pool_monthly_count': {
      // 3-series stack per the renderer (PDF dialysis p.27):
      //   Private (navy) / Institutional+Fund (sky) / REIT (sage green)
      // Cross-Border column exists in the data tab but the renderer
      // doesn't chart it — match that here so the editable chart
      // matches the PDF visual.
      const periodCol = findCol('period_end');
      const seriesDefs = [
        { key: 'private_count',       color: '003DA5' },  // navy — Private
        { key: 'institutional_count', color: '62B5E5' },  // sky — Institutional/Fund
        { key: 'reit_count',          color: '4CB582' },  // sage — REIT
      ];
      const series = seriesDefs
        .map(s => ({ ...s, col: findCol(s.key) }))
        .filter(s => s.col);
      if (!periodCol || series.length === 0) return null;
      return {
        tabName,
        spec: {
          type: 'stacked-bar',
          tabName,
          catCol: periodCol,
          dataStart, dataEnd,
          series: series.map(s => ({
            titleCol: s.col, titleRow: headerRow,
            valCol: s.col,
            color: s.color,
          })),
          anchor: standardAnchor,
        },
      };
    }

    // P5 — multi-line cohort charts (no secondary axis)
    case 'cap_rate_by_lease_term':
    case 'sold_cap_by_term_dot_plot':
    case 'asking_cap_by_term_dot_plot': {
      // Renderer detects dialysis vs gov cohorts by sniffing the actual
      // data rows. Mirror that here so the native chart's series count
      // matches the PDF visual exactly.
      //
      // Cohort palette per cm-chart-image-renderer.js PDF_COLORS:
      //   cap_long_term     #7E6BAD  (purple)   — longest-term
      //   cap_mid_long      #4CB582  (sage)     — middle-long
      //   cap_mid           #62B5E5  (sky)      — middle (dia only)
      //   cap_short         #003DA5  (navy)     — shortest
      //   cap_outside_firm  #6A748C  (gray)     — gov only, dashed
      //
      // Cohort detection: look for cap_12plus / cap_8to12 / cap_6to8 /
      // cap_5orless in the actual data. Falls back to checking which
      // cols are present if rows aren't supplied (helps tests).
      const periodCol = findCol('period_end');
      if (!periodCol) return null;

      let hasDialysisCohorts = false;
      if (Array.isArray(rows) && rows.length) {
        hasDialysisCohorts = rows.some(r =>
          r.cap_12plus != null || r.cap_8to12 != null ||
          r.cap_6to8   != null || r.cap_5orless != null
        );
      } else {
        // No rows supplied (e.g. unit tests) — fall back to schema sniff.
        // sold_cap_by_term_dot_plot's CHART_COLUMNS includes BOTH cohort
        // schemes side-by-side, so this falls through to gov-cohorts by
        // default for those templates. Tests can pass `rows: [{ cap_12plus: x }]`
        // to force the dia branch explicitly.
        hasDialysisCohorts = !!findCol('cap_12plus');
      }

      // Pick the cohort key for the asking-cap variant (dia only — gov
      // active-listing data doesn't exist per the renderer comment).
      // sold_cap_by_term and cap_rate_by_lease_term map gov 6-10 to
      // different column names: sold_cap uses cap_5to10, cap_rate_by_lease_term
      // uses cap_6to10. Wire each one up specifically.
      const govSixToTenKey = chart_template_id === 'sold_cap_by_term_dot_plot'
        ? 'cap_5to10'
        : 'cap_6to10';

      const seriesDefs = hasDialysisCohorts ? [
        { key: 'cap_12plus',  color: '7E6BAD' },                       // 12+ purple
        { key: 'cap_8to12',   color: '4CB582' },                       // 8-12 sage
        { key: 'cap_6to8',    color: '62B5E5' },                       // 6-8 sky
        { key: 'cap_5orless', color: '003DA5' },                       // ≤5 navy
      ] : [
        { key: 'cap_10plus',       color: '7E6BAD' },                  // 10+ purple
        { key: govSixToTenKey,     color: '4CB582' },                  // 6-10 sage
        { key: 'cap_less5',        color: '003DA5' },                  // <5 navy
        { key: 'cap_outside_firm', color: '6A748C', dashed: true },    // Outside dashed gray
      ];

      const series = seriesDefs
        .map(s => ({ ...s, col: findCol(s.key) }))
        .filter(s => s.col);
      if (series.length === 0) return null;
      // R66b — re-tuned to the DISPLAYED (cropped) data window, measured from
      // the live export (2026-06-01). R66's ranges came from full-view p5/p95
      // and left the cohort lines compressed (sold dia filled only ~46%) or
      // clipping (asking dia low 4.94%, gov sold high 11.81%). New ranges hug
      // the plotted data with ~0.25% pad, no clipping:
      //   sold_cap  dia 5.67-7.87% -> 5.5-8.0% ; gov 6.40-11.81% -> 6.0-12.0%
      //   asking    dia 4.94-7.80% -> 4.75-8.0%
      //   cap_term  gov 5.38-7.79% -> 5.25-8.0%
      let cohortRange = CAP_RATE_COHORT_RANGE;
      if (chart_template_id === 'sold_cap_by_term_dot_plot') {
        cohortRange = (vertical === 'dialysis')
          ? { min: 0.0525, max: 0.08 }    // R66x — unified cap_rate_final + no-gap cohorts span 5.40-7.96% (2015+)
          : { min: 0.0575, max: 0.08 };   // R66q — gov ladder cohorts span 6.07-7.72% (was 6-12%, top half empty)
      } else if (chart_template_id === 'asking_cap_by_term_dot_plot') {
        cohortRange = { min: 0.0475, max: 0.085 };  // R66y — cohorts span 4.94-8.33%
      } else if (chart_template_id === 'cap_rate_by_lease_term') {
        // R66x — dia line chart now reads the SAME unified canonical (master_m
        //   cohort cols == cm_dialysis_sold_cap_by_term_dot): span 5.40-7.96%.
        // R66k — gov view on the unified term ladder (cm_gov_cap_by_term_q):
        //   tight 5.91-7.56% band.
        cohortRange = (vertical === 'dialysis')
          ? { min: 0.0525, max: 0.08 }   // dia
          : { min: 0.055, max: 0.0775 }; // gov
      }
      return {
        tabName,
        spec: {
          type: 'multi-line',
          tabName,
          catCol: periodCol,
          dataStart, dataEnd,
          // R37 P2 — 4-line cohort caps: 4-11% pin (renderer line ~874)
          yAxisRange: cohortRange,
          valAxNumFmt: VAL_FMT_PERCENT_2DP,
          series: series.map(s => ({
            titleCol: s.col, titleRow: headerRow,
            valCol: s.col,
            color: s.color,
            dashed: !!s.dashed,
          })),
          anchor: standardAnchor,
        },
      };
    }

    case 'nm_vs_market_cap': {
      // R66o — match the deck's Value Proposition Results page (Dialysis Market
      // Filter p.38): NM line is the hero in SKY blue and sits BELOW the Non-NM
      // market line in GRAY. (Prior build used navy NM / sky market, which both
      // inverted the visual hierarchy and — on a stale pre-R66 build — showed NM
      // tangled above market. Live data now has NM below market throughout.)
      const NM_GRAY   = '8A8F98'; // deck market-line gray
      const periodCol = findCol('period_end');
      const nmCol     = findCol('nm_cap_rate');
      const marketCol = findCol('market_cap_rate');
      if (!periodCol || !nmCol || !marketCol) return null;
      // R66o — deck labels both lines (peak / trough / most-recent per our
      // convention) so the current NM-vs-market gap is callout-legible.
      // R66bb — compute the peak/trough/last over the DISPLAYED window only
      // (>= MIN_YEAR 2020). The chart trims to 2020+, but buildAnnotationsForSpec
      // ran over the full 2001+ rows, so the data-label INDICES referenced points
      // outside the plotted range — e.g. a 4.73% trough from ~2004 got stamped
      // onto a 2024 point. Filtering to the window aligns idx with the plotted
      // series so labels land on the right points.
      const nmWindowRows = Array.isArray(rows)
        ? rows.filter(r => r && r.period_end && new Date(r.period_end).getFullYear() >= 2020)
        : [];
      const nmLabels  = buildAnnotationsForSpec(nmWindowRows, r => r.nm_cap_rate, fmtPct2Native);
      const mktLabels = buildAnnotationsForSpec(nmWindowRows, r => r.market_cap_rate, fmtPct2Native);
      return {
        tabName,
        spec: {
          type: 'multi-line',
          tabName,
          catCol: periodCol,
          dataStart, dataEnd,
          // R66bb — tighten to the 2020+ data. dia: NM 6.09-6.78%, market to 7.05%
          // -> 5.75-7.25%. R66l — gov data sits higher (NM 6.32-7.42%, market
          // 6.40-7.27% over 2020+), so the dia range clipped the gov peaks; gov
          // gets its own 6.0-7.75% frame. (The 4.75-7.75% original left ~1.3% of
          // dead space below the lines on both.)
          yAxisRange: (vertical === 'dialysis')
            ? { min: 0.0575, max: 0.0725 }
            : { min: 0.06, max: 0.0775 },
          valAxNumFmt: VAL_FMT_PERCENT_2DP,
          // R66o — thin gray vertical connectors between the two lines (deck style).
          hiLowLines: '#C9CED6',
          series: [
            { titleCol: marketCol, titleRow: headerRow, valCol: marketCol, color: NM_GRAY, dataLabels: mktLabels },
            { titleCol: nmCol,     titleRow: headerRow, valCol: nmCol,     color: sky, dataLabels: nmLabels },
          ],
          anchor: standardAnchor,
        },
      };
    }

    // P6 — combo dual-axis charts (bar series on left axis + line series
    //      on right axis). Single shared cat axis.
    case 'dom_and_pct_of_ask':
    case 'dom_and_pct_of_ask_monthly': {
      // Bar: avg_dom (sky), Line: pct_of_ask (navy) — matches the
      // renderer at cm-chart-image-renderer.js line 879.
      const periodCol = findCol('period_end');
      const domCol    = findCol('avg_dom');
      const pctCol    = findCol('pct_of_ask');
      if (!periodCol || !domCol || !pctCol) return null;
      // R37 P3 — peak/trough/most-recent labels.
      // R67 — added labels on avg_dom (bar) IN ADDITION to pct_of_ask (line).
      // The chart title is "Days on Market & % of Ask Price"; users
      // read the bar as the headline metric. Previously only the line
      // carried labels which left the DOM peaks/troughs unannotated.
      // User feedback 2026-05-23 batch 6: "data labels for high, low
      // and most recent are off" → on the most-logical series per chart.
      const pctLabels = Array.isArray(rows)
        ? buildAnnotationsForSpec(rows, r => r.pct_of_ask, fmtPct1Native)
        : undefined;
      const domLabels = Array.isArray(rows)
        ? buildAnnotationsForSpec(rows, r => r.avg_dom, (v) => `${Math.round(v)}d`)
        : undefined;
      return {
        tabName,
        spec: {
          type: 'combo',
          tabName,
          catCol: periodCol,
          dataStart, dataEnd,
          // R37 P2 — left integer days, right percent 85-105% (renderer ~905)
          // R66n — % of ask view trims sold/initial_ask to a strict <1.0 window
          // (cm_dialysis_dom_pct_ask_m) so the line is a realistic 87-95% band.
          // R66t — DOM left axis widened 300 -> 450. The view is gated at n>=10
          // and smoothed, so the recent climb (297 -> 345 in-export, 411 live and
          // still rising) is REAL deal-slowdown, not a thin-sample artifact; the
          // 300 ceiling was clipping it. % of ask max is 95.85%, fits 84-96%.
          yLeftNumFmt:  VAL_FMT_INTEGER,
          yLeftRange:   (vertical === 'dialysis' ? { min: 0, max: 450 } : undefined),
          yRightRange:  (vertical === 'dialysis' ? { min: 0.84, max: 0.96 } : PCT_OF_ASK_RANGE),
          yRightNumFmt: VAL_FMT_PERCENT_1DP,
          barSeries: [
            { titleCol: domCol, titleRow: headerRow, valCol: domCol, color: sky,
              dataLabels: domLabels },
          ],
          lineSeries: [
            { titleCol: pctCol, titleRow: headerRow, valCol: pctCol, color: navy,
              dataLabels: pctLabels },
          ],
          anchor: standardAnchor,
        },
      };
    }

    case 'case_for_renewal': {
      // X-axis is `year` (integer), not period_end.
      // Bar: commencement_count (sky), Line: avg_rent_per_sf (navy).
      const yearCol = findCol('year');
      const cntCol  = findCol('commencement_count');
      const rentCol = findCol('avg_rent_per_sf');
      if (!yearCol || !cntCol || !rentCol) return null;
      // R37 P3 — peak/trough/most-recent labels on rent line
      // (renderer line 1923: buildAnnotations(rows, r => r.avg_rent_per_sf, fmtCurrencyPerSf, 'year'))
      const rentLabels = Array.isArray(rows)
        ? buildAnnotationsForSpec(rows, r => r.avg_rent_per_sf, fmtCurrencyPerSfNative)
        : undefined;
      return {
        tabName,
        spec: {
          type: 'combo',
          tabName,
          catCol: yearCol,
          dataStart, dataEnd,
          // R37 P1 — year x-axis (integer 2020), not quarter date.
          catAxNumFmt: '0',
          // R37 P2 — left = lease count integers, right = rent currency.
          // Renderer auto-pins right around the rent data ±10% — auto-scale
          // is acceptable here since the rent range varies per dataset.
          yLeftNumFmt:  VAL_FMT_INTEGER,
          yRightNumFmt: VAL_FMT_CURRENCY,
          barSeries: [
            { titleCol: cntCol, titleRow: headerRow, valCol: cntCol, color: sky },
          ],
          lineSeries: [
            { titleCol: rentCol, titleRow: headerRow, valCol: rentCol, color: navy,
              dataLabels: rentLabels },
          ],
          anchor: standardAnchor,
        },
      };
    }

    case 'available_market_size_combo': {
      // 4-series combo: 2 bars (count_total / count_core_10plus) on left
      // axis + 2 lines (avg_cap_total / avg_cap_core_10plus) on right axis.
      //
      // R65 — colors realigned to Northmarq brand tokens (per user notes
      // 2026-05-22 batch 5: "Color scheme doesn't match the brand
      // standards"). Pre-R65 used off-brand sage (#4CB582) for the core
      // 10+ bar and amber (#D97706) for the core 10+ line. R65 swaps to:
      //   count_total         nm_sky  #62B5E5  (was sky — keep)
      //   count_core_10plus   nm_pale #E0E8F4  (pale fill + sky border)
      //   avg_cap_total       nm_navy #003DA5  solid line (was navy — keep)
      //   avg_cap_core_10plus nm_navy #003DA5  DASHED line (same color, style differentiates)
      // All four series now from the brand palette in
      // public/reports/cm_brand_tokens.json. Same color + line style
      // for the 2 cap lines is a brand-compliant convention also used
      // for cohort overlays elsewhere (R35 P2 dom_price_change_active).
      const periodCol  = findCol('period_end');
      const cntTotCol  = findCol('count_total');
      const cntCoreCol = findCol('count_core_10plus');
      const capTotCol  = findCol('avg_cap_total');
      const capCoreCol = findCol('avg_cap_core_10plus');
      if (!periodCol || !cntTotCol || !cntCoreCol || !capTotCol || !capCoreCol) return null;
      return {
        tabName,
        spec: {
          type: 'combo',
          tabName,
          catCol: periodCol,
          dataStart, dataEnd,
          yLeftNumFmt:  VAL_FMT_INTEGER,
          // R66t — TTM-basis core cap dips to ~5.4% and total reaches ~7.0%; widen
          // from 5.5-7.5% so neither cap line clips (deck right axis is 4.5-7.0%).
          yRightRange:  { min: 0.05, max: 0.0725 },
          yRightNumFmt: VAL_FMT_PERCENT_2DP,
          barSeries: [
            { titleCol: cntTotCol,  titleRow: headerRow, valCol: cntTotCol,  color: sky },
            // R67 — was pale-sky (#E0E8F4) which was too faint against the
            // gridlines and the user couldn't see the core-10+ bar at all.
            // Sage (#4CB582) is the next NM brand-palette color over from
            // sky and creates clear visual separation in the clustered
            // grouping. Keep sky border as a tint cue ("close cousin of
            // total market"). User feedback 2026-05-23 batch 6.
            { titleCol: cntCoreCol, titleRow: headerRow, valCol: cntCoreCol, color: '4CB582', borderColor: sky },
          ],
          lineSeries: [
            { titleCol: capTotCol,  titleRow: headerRow, valCol: capTotCol,  color: navy },
            // R65 — core 10+ line uses navy (same color) with dashed style — brand-compliant cohort overlay
            { titleCol: capCoreCol, titleRow: headerRow, valCol: capCoreCol, color: navy, dashed: true },
          ],
          anchor: standardAnchor,
        },
      };
    }

    // P7 — scatter (xy) charts — one point per data row, no connecting line
    case 'core_cap_rate_dot_plot': {
      // Closed-sale scatter: x = period_end (sale date), y = cap_rate.
      //
      // R39 — Switch from helper-column rolling-average to Excel's
      // built-in <c:trendline> with polynomial order 3 + 720-day forward
      // forecast (matches master Dialysis Comp Work MASTER.xlsx > Core Cap
      // Chart). Excel computes the trendline natively from the series'
      // xVal/yVal pairs — no helper column needed and users can right-click
      // the line in Excel to adjust the order / forecast / R² display.
      const xCol = findCol('period_end');
      const yCol = findCol('cap_rate');
      if (!xCol || !yCol) return null;
      // R67 — pin scatter x-axis to data range so it doesn't extend
      // before the first sale or compress everything to the right. User
      // feedback 2026-05-23: "X-axis is messed up and goes back before
      // we have data and scrunches up the data we do have. Quarter
      // labels are wrong." Auto-scaling pulled the lower bound back to
      // ~1900 (Excel's date-serial origin) on some workbooks. Walk the
      // rows to find min/max sale dates and convert to Excel serials
      // (days since 1900-01-01, with the 1900-leap-year offset).
      // majorUnit=365 forces year-interval ticks (master uses year
      // labels on its Core Cap Chart trendline plot).
      let xAxisRange;
      let xMajorUnit;
      if (Array.isArray(rows) && rows.length > 0) {
        const dates = rows
          .map(r => r && r.period_end ? new Date(r.period_end) : null)
          .filter(d => d && !Number.isNaN(d.getTime()));
        if (dates.length > 0) {
          const minMs = Math.min(...dates.map(d => d.getTime()));
          const maxMs = Math.max(...dates.map(d => d.getTime()));
          // Excel 1900-system serial: days since 1899-12-30 (accounts for
          // the legacy 1900-leap-year bug). 86400000 ms per day.
          const EPOCH = Date.UTC(1899, 11, 30);
          const minSerial = Math.floor((minMs - EPOCH) / 86400000);
          // Extend the upper bound by the trendline's 720-day forecast
          // so the dashed forecast tail isn't clipped.
          const maxSerial = Math.ceil((maxMs - EPOCH) / 86400000) + 720;
          xAxisRange = { min: minSerial, max: maxSerial };
          xMajorUnit = 365;  // ~year intervals
        }
      }
      return {
        tabName,
        spec: {
          type: 'scatter',
          tabName,
          dataStart, dataEnd,
          // R37 P2 — y axis cap rate 4-12% (renderer line ~2071).
          yAxisRange: CAP_RATE_DOT_RANGE,
          valAxNumFmt: VAL_FMT_PERCENT_2DP,
          // R67 — pin x-axis to data range (was auto-scaled).
          xAxisRange,
          xMajorUnit,
          // R46 — quarter format. R67 — even with year-interval major
          // ticks, the per-tick label format stays mmm-yy so users see
          // the date span, not just the year number. Switch from
          // q"Q-"yyyy → [$-409]mmm-yy;@ for master parity (master Core
          // Cap Chart uses mmm-yy labels).
          xAxisNumFmt: '[$-409]mmm-yy;@',
          series: [{
            titleCol: yCol, titleRow: headerRow, xCol, yCol, color: sky,
            // Polynomial order 3, dotted, navy, 720-day forecast forward.
            // Matches the master exactly (see
            // audit/cm-style-audit/PUNCH-LIST.md + Core Cap Chart trendline).
            trendline: { type: 'poly', order: 3, forward: 720, dashed: true, color: navy },
          }],
          anchor: standardAnchor,
        },
      };
    }

    case 'available_cap_rate_dot_plot': {
      // R39 — Switch from helper-column linear regression to Excel's
      // built-in <c:trendline type="linear"/> (matches master
      // Dialysis Comp Work MASTER.xlsx > Available Comps which uses 2
      // linear trendlines). Excel computes the regression natively from
      // the series' xVal/yVal pairs.
      const xCol = findCol('firm_term_years');
      const yCol = findCol('cap_rate');
      if (!xCol || !yCol) return null;
      return {
        tabName,
        spec: {
          type: 'scatter',
          tabName,
          dataStart, dataEnd,
          // R37 P2 — y axis cap rate 4-12% (renderer line ~2142).
          // X axis is firm_term_years — leave auto-scaled (term distribution
          // varies per data set; renderer pads ±10% dynamically).
          yAxisRange: CAP_RATE_DOT_RANGE,
          valAxNumFmt: VAL_FMT_PERCENT_2DP,
          series: [{
            titleCol: yCol, titleRow: headerRow, xCol, yCol, color: sky,
            // Linear regression, dashed, navy. Matches master exactly.
            trendline: { type: 'linear', dashed: true, color: navy },
          }],
          anchor: standardAnchor,
        },
      };
    }

    // R50 — Bid_Ask restructured to match master chart7 (Charts tab).
    // Master is a STACKED line chart with chart-level up-down bars:
    //   • Bottom series (sky line):  Last Ask Cap (TTM)
    //   • Top series (navy line):    Last Ask + Bid-Ask Spread (stacked)
    //   • <c:upDownBars/> draws gray bars BETWEEN the two stacked lines
    //     at each x point — visually marks the spread distance above
    //     the last asking cap, which is exactly what the user described:
    //     "spread in bars/lines with drop down lines above the last
    //      asking cap TTM" (R50 user notes 2026-05-22).
    //
    // Both cadences (quarterly + monthly) need both avg_last_ask_cap AND
    // avg_bid_ask_spread. Quarterly views (cm_*_bid_ask_spread_q) were
    // extended in R50 to add avg_last_ask_cap — monthly views already
    // carried both. If avg_last_ask_cap is missing for any reason we
    // gracefully degrade to a single-line spread chart so the chart
    // still renders (preserves the R47/R48 behavior).
    case 'bid_ask_spread':
    case 'bid_ask_spread_monthly': {
      const periodCol  = findCol('period_end');
      const lastAskCol = findCol('avg_last_ask_cap');
      const spreadCol  = findCol('avg_bid_ask_spread');
      if (!periodCol || !spreadCol) return null;

      // R66l — match the deliverable PDF (Dialysis Market Filter p.34 / gov p.21)
      // STRUCTURE exactly: a single cap-rate axis where each month is a solid
      // light-gray FLOATING BAR from Last Ask (bottom) up to Achieved cap (top =
      // last_ask + spread), with a SKY dash marker at the bottom (Last Ask) and a
      // NAVY dash marker at the top (Achieved). The bar height = the bid-ask spread.
      // R66z — the spread data is now real (~30-284 bps; Achieved reaches ~9.8%), so:
      //   (a) the Achieved (top) marker series must reference the helper col's actual
      //       letter (String.fromCharCode(65 + cols.length)), NOT the literal
      //       '__achieved__' which is not a column and never rendered; the R53 wrapper
      //       then shifts it +1 when period_label is prepended; and
      //   (b) the dia axis is widened to 5.5-10% so the Achieved tops + markers fit
      //       (was 5.25-8%, which clipped everything above 8%).
      const achievedCol = String.fromCharCode(65 + cols.length);
      if (lastAskCol) {
        return {
          tabName,
          spec: {
            type: 'combo',
            tabName,
            catCol: periodCol,
            dataStart, dataEnd,
            barGrouping: 'stacked',
            sharedAxis:  true,
            barGapWidth: 60,
            yLeftRange: ((vertical === 'gov' || vertical === 'government_leased')
              ? { min: 0.055, max: 0.10 }
              : { min: 0.055, max: 0.10 }),
            yLeftNumFmt: VAL_FMT_PERCENT_2DP,
            barSeries: [
              // invisible base lifts the visible bar to the Last Ask level
              { titleCol: lastAskCol, titleRow: headerRow, valCol: lastAskCol, color: '003DA5', noFill: true },
              // visible light-gray bar = the spread (Last Ask -> Achieved)
              { titleCol: spreadCol,  titleRow: headerRow, valCol: spreadCol,  color: 'D8DFDF', borderColor: '9EA9B7' },
            ],
            lineSeries: [
              { titleCol: lastAskCol, titleRow: headerRow, valCol: lastAskCol, color: sky,
                showMarker: true, markerShape: 'dash', markerSize: 7 },
              { titleCol: achievedCol, titleRow: headerRow, valCol: achievedCol, color: navy,
                showMarker: true, markerShape: 'dash', markerSize: 7 },
            ],
            anchor: standardAnchor,
          },
          helperCols: [
            {
              key: 'achieved_cap',
              header: 'Achieved Cap (TTM)',
              format: 'percent_basis_points',
              width: 18,
              getValue: (row) => {
                const la = row.avg_last_ask_cap, sp = row.avg_bid_ask_spread;
                return (la != null && sp != null) ? Number(la) + Number(sp) : null;
              },
            },
          ],
        };
      }

      // Fallback: only the spread column present -> single line.
      return singleSeries('line', 'avg_bid_ask_spread', sky, {
        valAxNumFmt: VAL_FMT_PERCENT_2DP,
      });
    }

    case 'rent_psf_box_quarterly': {
      // R34 P8.5 upgrade — proper box-whisker visual now that we have
      // helper-column infrastructure.
      //
      // PDF visual: shaded IQR box (lower_q → upper_q) with median line
      // overlay. Native decomposition:
      //   • Stacked bar series 0 (invisible, noFill=true):
      //       val = rent_lower_quartile (lifts the bar off 0)
      //   • Stacked bar series 1 (visible sky band):
      //       val = iqr_width helper column = upper_q − lower_q
      //   • Line series 0 (navy bold):
      //       val = rent_median (overlay on same val axis)
      //
      // The line uses sharedAxis: true so the median plots on the same
      // scale as the IQR band, NOT on a separate right axis.
      const periodCol = findCol('period_end');
      const lowerCol  = findCol('rent_lower_quartile');
      const medianCol = findCol('rent_median');
      const upperCol  = findCol('rent_upper_quartile');
      if (!periodCol || !lowerCol || !medianCol || !upperCol) return null;

      // IQR width helper column letter — sits one column past the regular
      // CHART_COLUMNS entries. cm-excel-export.js writes the values.
      const iqrCol = String.fromCharCode(65 + cols.length);

      return {
        tabName,
        spec: {
          type: 'combo',
          tabName,
          catCol: periodCol,
          dataStart, dataEnd,
          barGrouping: 'stacked',
          sharedAxis: true,
          // R37 P2 — rent PSF $5-$50 (renderer line ~1161)
          yLeftRange:   { min: 5, max: 50 },
          yLeftNumFmt:  VAL_FMT_CURRENCY,
          barSeries: [
            // Invisible base — lifts the visible bar off the 0 line
            { titleCol: lowerCol, titleRow: headerRow, valCol: lowerCol,
              color: '003DA5', noFill: true },
            // Visible IQR band (sky)
            { titleCol: iqrCol,   titleRow: headerRow, valCol: iqrCol,
              color: sky },
          ],
          lineSeries: [
            // Median line over the band
            { titleCol: medianCol, titleRow: headerRow, valCol: medianCol,
              color: navy },
          ],
          anchor: standardAnchor,
        },
        helperCols: [
          {
            key: 'iqr_width',
            header: 'IQR Width',
            format: 'currency_per_sf',
            width: 14,
            getValue: (row) => {
              const lo = row.rent_lower_quartile;
              const hi = row.rent_upper_quartile;
              return (lo != null && hi != null) ? Number(hi) - Number(lo) : null;
            },
          },
        ],
      };
    }

    // P9 — composite: IQR floating bar + median dot + avg diamond over
    //      a year x-axis. Final PNG-only template to migrate.
    case 'rent_by_year_built': {
      // Renderer at cm-chart-image-renderer.js ~line 1774:
      //   • Whisker bar: floating [lower_quartile_rpsf, upper_quartile_rpsf]
      //     (pale sky 25% fill with sky border, narrow barPercentage 0.18)
      //   • Median dot: scatter (sky circle, radius 5)
      //   • Avg dot:    scatter (navy diamond, radius 6)
      //
      // Native decomposition (combo chart, stacked bar + markers-only line):
      //   • barSeries[0] invisible base:  rent_lower_quartile_rpsf
      //   • barSeries[1] visible sky band: iqr_width helper col
      //                                     = upper_q − lower_q
      //   • lineSeries[0] sky circle marker, no line: median_rpsf
      //   • lineSeries[1] navy diamond marker, no line: avg_rpsf
      //
      // Year x-axis is categorical. barGrouping='stacked' + sharedAxis=true
      // so all series live on the same currency value axis.
      const yearCol  = findCol('year');
      const avgCol   = findCol('avg_rpsf');
      const medCol   = findCol('median_rpsf');
      const upperCol = findCol('upper_quartile_rpsf');
      const lowerCol = findCol('lower_quartile_rpsf');
      if (!yearCol || !avgCol || !medCol || !upperCol || !lowerCol) return null;

      // Helper col lands at cols.length + 1 (col G after the 6 regular cols).
      const iqrCol = String.fromCharCode(65 + cols.length);

      return {
        tabName,
        spec: {
          type: 'combo',
          tabName,
          catCol: yearCol,
          dataStart, dataEnd,
          // R37 P1 — year x-axis (integer 1990, 1995, etc.), not quarter date.
          catAxNumFmt: '0',
          // R68-E (G9): tightened 0-70 -> 0-50. After the cohort-coherent view
          // rebuild, max upper-quartile rent/SF is ~$46; 70 wasted the top third
          // of the plot. 0-50 gives headroom without crushing the IQR band.
          yLeftRange:  { min: 0, max: 50 },
          yLeftNumFmt: VAL_FMT_CURRENCY,
          barGrouping: 'stacked',
          sharedAxis: true,
          barSeries: [
            // Invisible base — lifts the floating IQR bar off 0
            { titleCol: lowerCol, titleRow: headerRow, valCol: lowerCol,
              color: '003DA5', noFill: true },
            // Visible IQR band (sky)
            { titleCol: iqrCol, titleRow: headerRow, valCol: iqrCol,
              color: sky },
          ],
          lineSeries: [
            // Median dot — sky circle marker, no connecting line
            { titleCol: medCol, titleRow: headerRow, valCol: medCol,
              color: sky, showMarker: true, markerShape: 'circle', markerSize: 5 },
            // Avg dot — navy diamond marker, no connecting line
            { titleCol: avgCol, titleRow: headerRow, valCol: avgCol,
              color: navy, showMarker: true, markerShape: 'diamond', markerSize: 7 },
          ],
          anchor: standardAnchor,
        },
        helperCols: [
          {
            key: 'iqr_width',
            header: 'IQR Width',
            format: 'currency_per_sf',
            width: 14,
            getValue: (row) => {
              const lo = row.lower_quartile_rpsf;
              const hi = row.upper_quartile_rpsf;
              return (lo != null && hi != null) ? Number(hi) - Number(lo) : null;
            },
          },
        ],
      };
    }

    // R33 Tier F1 — valuation_index combo: navy line (index) on LEFT
    // axis + sky YoY% bars on RIGHT axis. Matches the renderer at
    // cm-chart-image-renderer.js line ~1084 (Round 20+).
    //
    // swapAxes=true is the key — by default our combo puts bars on
    // the left axis, but this chart wants line on left, bars on right
    // (PDF deck p.17).
    //
    // The signed-color treatment of YoY bars (sky for gains, amber
    // for declines) the renderer applies is per-data-point and isn't
    // easily expressible in native chart XML without per-point <c:dPt>
    // overrides — same limitation as yoy_volume_change (P3). Native
    // chart uses all-sky bars; negative values still render correctly,
    // just without the color highlight.
    case 'valuation_index': {
      const periodCol = findCol('period_end');
      const indexCol  = findCol('valuation_index');
      // yoy_change column uses fieldKeys coalesce (yoy_change OR
      // yoy_change_pct). cm-excel-export.js writes whichever the view
      // emits into the canonical 'yoy_change' column slot — so the
      // column letter we get back from findCol('yoy_change') is the
      // right cell range to reference.
      const yoyCol    = findCol('yoy_change');
      if (!periodCol || !indexCol || !yoyCol) return null;
      // R37 P3 — peak/trough/most-recent labels on valuation_index navy line
      // (renderer line 1105: buildAnnotations(rows, r => r.valuation_index, fmtIndex))
      const indexLabels = Array.isArray(rows)
        ? buildAnnotationsForSpec(rows, r => r.valuation_index, fmtIndexNative)
        : undefined;
      return {
        tabName,
        spec: {
          type: 'combo',
          tabName,
          catCol: periodCol,
          dataStart, dataEnd,
          swapAxes: true,  // line on LEFT, bars on RIGHT (matches PDF)
          // 2026-05-29 - pin the index (left) axis to its data band so the
          // line's movement is visible (auto-scale from 0 flattened it).
          // gov ~198-310, dia ~76-215.
          // R66dd — dia index now sits 98-157 (post-R66r gate+smooth), so the prior
          // 75-250 axis showed it in the lower third (~30% fill). Tighten to 90-165 so
          // the index movement fills the frame. gov 210-350 unchanged.
          yLeftRange: (vertical === 'gov' ? { min: 210, max: 350 } : { min: 90, max: 165 }),
          // R37 P2 — formats: LEFT integer (valuation index 200-400),
          // RIGHT percent (YoY %). Renderer auto-pins right to ±yoyMax
          // dynamically per dataset; native leaves auto-scale so the
          // value adapts. Format settings make ticks legible.
          yLeftNumFmt:  VAL_FMT_INTEGER,
          yRightNumFmt: VAL_FMT_PERCENT_1DP,
          barSeries: [
            // YoY % Change — sky color, no per-point amber treatment
            // (can be added later via <c:dPt> color overrides if needed)
            { titleCol: yoyCol, titleRow: headerRow, valCol: yoyCol,
              color: sky },
          ],
          lineSeries: [
            // Valuation Index — navy line, no markers
            { titleCol: indexCol, titleRow: headerRow, valCol: indexCol,
              color: navy, dataLabels: indexLabels },
          ],
          anchor: standardAnchor,
        },
      };
    }

    // ────────────────────────────────────────────────────────────────
    // R35 P1 — 6 missed multi-line templates (post-R34 audit). All
    // reuse the existing buildMultiLineChartXml; just need spec wiring.
    // ────────────────────────────────────────────────────────────────

    case 'cap_rate_top_bottom_quartile': {
      // 3-line: top_q dashed purple, median solid navy bold, bottom_q
      // dashed sage. Colors per cm-chart-image-renderer.js line ~780.
      const periodCol = findCol('period_end');
      const topCol    = findCol('top_quartile');
      const medCol    = findCol('median');
      const botCol    = findCol('bottom_quartile');
      if (!periodCol || !topCol || !medCol || !botCol) return null;
      return {
        tabName,
        spec: {
          type: 'multi-line',
          tabName, catCol: periodCol, dataStart, dataEnd,
          // R60 → R63 — IQR-visibility. R63 set 5-9% (batch 6 2026-05-23).
          // NOTE: Data_Cap_Quartile was NOT in the 2026-05-31 export feedback,
          // so R66 leaves it at the R63 5-9% band (no scope creep).
          yAxisRange: { min: 0.05, max: 0.09 },
          valAxNumFmt: VAL_FMT_PERCENT_2DP,
          series: [
            { titleCol: topCol, titleRow: headerRow, valCol: topCol,
              color: '7E6BAD', dashed: true },  // purple
            { titleCol: medCol, titleRow: headerRow, valCol: medCol,
              color: '003DA5' },                // navy
            { titleCol: botCol, titleRow: headerRow, valCol: botCol,
              color: '4CB582', dashed: true },  // sage
          ],
          anchor: standardAnchor,
        },
      };
    }

    case 'cap_rate_by_credit': {
      // 3-line: Federal navy bold / State sky / Municipal sage.
      // Note: state + municipal series will be empty for gov data per
      // the 2026-05-06 audit (0 state and ~5 municipal sales with caps),
      // but the chart shape is correct — series will fill in once the
      // data feed exists.
      const periodCol = findCol('period_end');
      const fedCol    = findCol('federal_cap');
      const stateCol  = findCol('state_cap');
      const muniCol   = findCol('municipal_cap');
      if (!periodCol || !fedCol || !stateCol || !muniCol) return null;
      return {
        tabName,
        spec: {
          type: 'multi-line',
          tabName, catCol: periodCol, dataStart, dataEnd,
          // R37 P2 — cap by credit uses CAP_RATE_RANGE 5-10% (renderer ~1538)
          yAxisRange: CAP_RATE_RANGE,
          valAxNumFmt: VAL_FMT_PERCENT_2DP,
          series: [
            { titleCol: fedCol,   titleRow: headerRow, valCol: fedCol,   color: navy   },
            { titleCol: stateCol, titleRow: headerRow, valCol: stateCol, color: sky    },
            { titleCol: muniCol,  titleRow: headerRow, valCol: muniCol,  color: '4CB582' },  // sage
          ],
          anchor: standardAnchor,
        },
      };
    }

    case 'cpi_vs_renewal_cagr': {
      // 2-line: CPI sky / GSA Renewal navy bold.
      const periodCol = findCol('period_end');
      const cpiCol    = findCol('cpi_change');
      const cagrCol   = findCol('gsa_renewal_cagr');
      if (!periodCol || !cpiCol || !cagrCol) return null;
      // R37 P3 — peak/trough/most-recent labels on the navy GSA renewal CAGR line
      // (renderer line 1561: buildAnnotations(rows, r => r.gsa_renewal_cagr, fmtPct1))
      const cagrLabels = Array.isArray(rows)
        ? buildAnnotationsForSpec(rows, r => r.gsa_renewal_cagr, fmtPct1Native)
        : undefined;
      return {
        tabName,
        spec: {
          type: 'multi-line',
          tabName, catCol: periodCol, dataStart, dataEnd,
          // R37 P2 — percent 1dp matches renderer
          valAxNumFmt: VAL_FMT_PERCENT_1DP,
          series: [
            { titleCol: cpiCol,  titleRow: headerRow, valCol: cpiCol,  color: sky  },
            { titleCol: cagrCol, titleRow: headerRow, valCol: cagrCol, color: navy,
              dataLabels: cagrLabels },
          ],
          anchor: standardAnchor,
        },
      };
    }

    case 'fed_funds_vs_treasury': {
      // 2-line in native (renderer adds a 3rd mortgage_30y line that
      // isn't in the data tab — see net_lease_spread for the same
      // data-shape mismatch pattern).
      const periodCol = findCol('period_end');
      const ffCol     = findCol('fed_funds_rate');
      const t10Col    = findCol('treasury_10y_yield');
      if (!periodCol || !ffCol || !t10Col) return null;
      return {
        tabName,
        spec: {
          type: 'multi-line',
          tabName, catCol: periodCol, dataStart, dataEnd,
          // R37 P2 — percent 1dp (renderer line ~1586)
          valAxNumFmt: VAL_FMT_PERCENT_1DP,
          series: [
            { titleCol: ffCol,  titleRow: headerRow, valCol: ffCol,  color: navy },
            { titleCol: t10Col, titleRow: headerRow, valCol: t10Col, color: sky  },
          ],
          anchor: standardAnchor,
        },
      };
    }

    case 'cash_leveraged_returns': {
      // 2-line: Cash Return navy bold / Leveraged Return (mid) sky.
      // Renderer plots only these 2 of the 4 columns in the data tab
      // (leveraged_return_high/low columns exist but aren't rendered).
      const periodCol  = findCol('period_end');
      const cashCol    = findCol('cash_return');
      const lvgMidCol  = findCol('leveraged_return_mid');
      if (!periodCol || !cashCol || !lvgMidCol) return null;
      return {
        tabName,
        spec: {
          type: 'multi-line',
          tabName, catCol: periodCol, dataStart, dataEnd,
          // R37 P2 — percent 1dp (renderer line ~1240)
          // R66m — match the published deck's axis. The PDF (Dialysis Market
          // Filter p.18) uses a wide 4-13% scale; our prior tight 5.75-11.5%
          // axis visually exaggerated month-to-month movement. Combined with
          // the view-side +/-3-mo smoothing (cm_*_returns_indexes_m), this makes
          // the lines read like the deck instead of a noisy staircase.
          yAxisRange: (vertical === 'gov' ? { min: 0.04, max: 0.13 } : { min: 0.04, max: 0.13 }),
          valAxNumFmt: VAL_FMT_PERCENT_1DP,
          series: [
            { titleCol: cashCol,   titleRow: headerRow, valCol: cashCol,   color: navy },
            { titleCol: lvgMidCol, titleRow: headerRow, valCol: lvgMidCol, color: sky  },
          ],
          anchor: standardAnchor,
        },
      };
    }

    case 'asking_cap_quartiles_active': {
      // R66s — match the deck (Dialysis Market Filter p.31, top chart): FOUR solid
      // lines in four distinct colors (no dashes), tightly clustered. Prior build
      // used solid-total / dashed-core in just two colors, which the deck does not.
      //   upper_q_total = mauve/amethyst, lower_q_total = sky,
      //   upper_q_core  = teal/aquamarine, lower_q_core  = NM navy.
      const C_MAUVE = '9B7EBD';
      const C_SKY   = '62B5E5';
      const C_TEAL  = '3FA39B';
      const C_NAVY  = '003DA5';
      const periodCol = findCol('period_end');
      const upTotCol  = findCol('upper_q_total');
      const loTotCol  = findCol('lower_q_total');
      const upCorCol  = findCol('upper_q_core');
      const loCorCol  = findCol('lower_q_core');
      if (!periodCol || !upTotCol || !loTotCol || !upCorCol || !loCorCol) return null;
      return {
        tabName,
        spec: {
          type: 'multi-line',
          tabName, catCol: periodCol, dataStart, dataEnd,
          // R66s — the core-10+ quartile spikes (to 8.86% on 1-2 listings) are now
          // gated out at the view (n_core>=5) and all four series are smoothed, so
          // the data sits in the deck's tight 4.94-7.3% band. Tighten the axis to
          // the deck's 4.5-7.75% (was 4.75-9.0% to accommodate the now-removed spikes).
          yAxisRange: { min: 0.045, max: 0.0775 },
          valAxNumFmt: VAL_FMT_PERCENT_2DP,
          series: [
            { titleCol: upTotCol, titleRow: headerRow, valCol: upTotCol, color: C_MAUVE }, // total upper
            { titleCol: loTotCol, titleRow: headerRow, valCol: loTotCol, color: C_SKY   }, // total lower
            { titleCol: upCorCol, titleRow: headerRow, valCol: upCorCol, color: C_TEAL  }, // core upper
            { titleCol: loCorCol, titleRow: headerRow, valCol: loCorCol, color: C_NAVY  }, // core lower
          ],
          anchor: standardAnchor,
        },
      };
    }

    // ────────────────────────────────────────────────────────────────
    // R35 P2 — 7 missed combo + clustered-bar templates (post-R34 audit).
    // ────────────────────────────────────────────────────────────────

    // Standard combo: bars LEFT axis, line RIGHT axis (default).
    case 'txn_count_avg_deal_combo': {
      // Master deck p.8 (dia) / p.17 (gov):
      //   Bar: TTM transaction count (left integer axis)
      //   Line: Avg deal size $ (right currency axis)
      const periodCol = findCol('period_end');
      const cntCol    = findCol('ttm_count');
      const avgCol    = findCol('avg_deal_size');
      if (!periodCol || !cntCol || !avgCol) return null;
      // R37 P3 — peak/trough/most-recent labels on avg deal line
      // (renderer line 2348: buildAnnotations(rows, r => r.avg_deal_size, fmtCurrencyM))
      const avgLabels = Array.isArray(rows)
        ? buildAnnotationsForSpec(rows, r => r.avg_deal_size, fmtCurrencyMNative)
        : undefined;
      return {
        tabName,
        spec: {
          type: 'combo',
          tabName,
          catCol: periodCol,
          dataStart, dataEnd,
          // R37 P2 — left integer count, right compact currency for avg deal
          yLeftNumFmt:  VAL_FMT_INTEGER,
          yRightNumFmt: VAL_FMT_CURRENCY_M,
          barSeries:  [{ titleCol: cntCol, titleRow: headerRow, valCol: cntCol, color: sky }],
          lineSeries: [{ titleCol: avgCol, titleRow: headerRow, valCol: avgCol, color: navy,
                         dataLabels: avgLabels }],
          anchor: standardAnchor,
        },
      };
    }

    case 'rent_and_price_per_chair': {
      // Dialysis counterpart to gov rent_and_price_psf — bars=rent/chair
      // (left $), line=price/chair (right $). Both TTM rolling.
      const periodCol = findCol('period_end');
      const rentCol   = findCol('rent_per_chair');
      const priceCol  = findCol('price_per_chair');
      if (!periodCol || !rentCol || !priceCol) return null;
      // R37 P3 — peak/trough/most-recent labels on the price/chair line
      // (renderer line 2393: buildAnnotations(rows, r => r.price_per_chair, fmtCurrencyK))
      const priceLabels = Array.isArray(rows)
        ? buildAnnotationsForSpec(rows, r => r.price_per_chair, fmtCurrencyKNative)
        : undefined;
      return {
        tabName,
        spec: {
          type: 'combo',
          tabName,
          catCol: periodCol,
          dataStart, dataEnd,
          // R37 P2 — rent/chair $0-16K, price/chair $0-250K (renderer ~2390)
          yLeftRange:   { min: 0, max: 16000 },
          yLeftNumFmt:  VAL_FMT_CURRENCY,
          yRightRange:  { min: 0, max: 250000 },
          yRightNumFmt: VAL_FMT_CURRENCY,
          barSeries:  [{ titleCol: rentCol,  titleRow: headerRow, valCol: rentCol,  color: sky  }],
          lineSeries: [{ titleCol: priceCol, titleRow: headerRow, valCol: priceCol, color: navy,
                         dataLabels: priceLabels }],
          anchor: standardAnchor,
        },
      };
    }

    case 'rent_and_price_psf': {
      // Master deck p.9 (gov): bars=rent/SF (left $), line=price/SF (right $).
      const periodCol = findCol('period_end');
      const rentCol   = findCol('rent_psf');
      const priceCol  = findCol('price_psf');
      if (!periodCol || !rentCol || !priceCol) return null;
      // R37 P3 — peak/trough/most-recent labels on price/SF line
      // (renderer line 2433: buildAnnotations(rows, r => r.price_psf, $rounded))
      const priceLabels = Array.isArray(rows)
        ? buildAnnotationsForSpec(rows, r => r.price_psf, fmtCurrencyNative)
        : undefined;
      return {
        tabName,
        spec: {
          type: 'combo',
          tabName,
          catCol: periodCol,
          dataStart, dataEnd,
          // R37 P2 — rent/SF $0-50 (renderer ~2431); price/SF auto-scale
          yLeftRange:   { min: 0, max: 50 },
          yLeftNumFmt:  VAL_FMT_CURRENCY,
          yRightNumFmt: VAL_FMT_CURRENCY,
          barSeries:  [{ titleCol: rentCol,  titleRow: headerRow, valCol: rentCol,  color: sky  }],
          lineSeries: [{ titleCol: priceCol, titleRow: headerRow, valCol: priceCol, color: navy,
                         dataLabels: priceLabels }],
          anchor: standardAnchor,
        },
      };
    }

    case 'dom_price_change_active': {
      // 4 series — 2 DOM bars (left) + 2 price-change % lines (right).
      // Both lines share the same color (#1F4E79 dark blue) with the
      // core variant DASHED per renderer line ~1393. Bar colors per
      // renderer: avg_dom_total=palette[3] (pale/sky), avg_dom_core=palette[1] (sky).
      const periodCol = findCol('period_end');
      const domTotCol = findCol('avg_dom_total');
      const domCorCol = findCol('avg_dom_core');
      const pctTotCol = findCol('pct_price_change_total');
      const pctCorCol = findCol('pct_price_change_core');
      if (!periodCol || !domTotCol || !domCorCol || !pctTotCol || !pctCorCol) return null;
      const DARK_BLUE = '1F4E79';
      return {
        tabName,
        spec: {
          type: 'combo',
          tabName,
          catCol: periodCol,
          dataStart, dataEnd,
          // R37 P2 — left DOM days integer, right % change 0dp
          yLeftNumFmt:  VAL_FMT_INTEGER,
          yRightNumFmt: VAL_FMT_PERCENT_0DP,
          barSeries: [
            // Total Market DOM — pale/sky fill
            { titleCol: domTotCol, titleRow: headerRow, valCol: domTotCol, color: '9DC3E6' },
            // 10+ Year Core DOM — sky fill
            { titleCol: domCorCol, titleRow: headerRow, valCol: domCorCol, color: sky },
          ],
          lineSeries: [
            // Total Market % change — dark blue solid
            { titleCol: pctTotCol, titleRow: headerRow, valCol: pctTotCol, color: DARK_BLUE },
            // 10+ Year Core % change — dark blue dashed (matches asking_cap_quartiles_active idiom)
            { titleCol: pctCorCol, titleRow: headerRow, valCol: pctCorCol, color: DARK_BLUE, dashed: true },
          ],
          anchor: standardAnchor,
        },
      };
    }

    // Swapped combo: lines LEFT axis, bars RIGHT axis (PDF p.35/p.22).
    case 'seller_sentiment':
    case 'seller_sentiment_monthly': {
      // 4 series — 2 cap-rate lines (LEFT) + 2 price-change % bars (RIGHT).
      // Renderer colors per line ~1057:
      //   Bars: PDF_COLORS.sentiment_bar_all (sage), sentiment_bar_long (light purple)
      //   Lines: palette[0] navy (all), palette[1] sky (8+yr)
      const periodCol = findCol('period_end');
      const barAllCol = findCol('pct_price_change_all');
      const barLongCol = findCol('pct_price_change_long_term');
      const lineAllCol = findCol('last_ask_cap_all');
      const lineLongCol = findCol('last_ask_cap_long_term');
      if (!periodCol || !barAllCol || !barLongCol || !lineAllCol || !lineLongCol) return null;
      // R37 P3 — peak/trough/most-recent labels on the all-cap navy line.
      // R66cc — compute over the DISPLAYED window (>= 2017) only; the chart trims to
      // 2017+ but the full-history peak (e.g. an ~8.2% pre-2017 value) was being
      // stamped onto a windowed point (same idx-vs-trim bug fixed on NM-vs-Market).
      const sentWindowRows = Array.isArray(rows)
        ? rows.filter(r => r && r.period_end && new Date(r.period_end).getFullYear() >= 2017)
        : [];
      const capLabels = buildAnnotationsForSpec(sentWindowRows, r => r.last_ask_cap_all, fmtPct2Native);
      return {
        tabName,
        spec: {
          type: 'combo',
          tabName,
          catCol: periodCol,
          dataStart, dataEnd,
          swapAxes: true,  // lines LEFT, bars RIGHT (PDF p.35/p.22)
          // 2026-05-29 - pin the cap-rate (left) axis per vertical so the
          // asking-cap line movement is legible (matches the PNG renderer's
          // pins: dia 4.75-9.25%, gov 5.5-9.5%).
          // R66b — dia retuned to displayed last-ask-cap data 5.51-7.84% -> 5.25-8.0%.
          // R66cc — dia floor lowered to 4.5% so the recovered 10+ cohort's 2023 dip
          // (~4.7%, long-WALT assets asking low caps in the low-rate window) shows
          // instead of clipping below 5.25%. gov unchanged.
          yLeftRange: (vertical === 'gov' ? { min: 0.06, max: 0.09 } : { min: 0.045, max: 0.08 }),
          // R37 P2 — left = cap rate (% 2dp), right = price change % (% 0dp).
          // Renderer pins per-vertical (dia 4.75-9.25% left, 0-70% right;
          // gov 5.5-9.5% left, 0-8% right). The spec builder doesn't have
          // vertical signal — leave range auto-scale, just set formats.
          yLeftNumFmt:  VAL_FMT_PERCENT_2DP,
          yRightNumFmt: VAL_FMT_PERCENT_0DP,
          barSeries: [
            { titleCol: barAllCol,  titleRow: headerRow, valCol: barAllCol,  color: '4CB582' },  // sage
            { titleCol: barLongCol, titleRow: headerRow, valCol: barLongCol, color: '7E6BAD' },  // light purple
          ],
          lineSeries: [
            { titleCol: lineAllCol,  titleRow: headerRow, valCol: lineAllCol,  color: navy,
              dataLabels: capLabels },
            { titleCol: lineLongCol, titleRow: headerRow, valCol: lineLongCol, color: sky  },
          ],
          anchor: standardAnchor,
        },
      };
    }

    // R50 — Inventory_Backlog restructured to match master chart8 (Charts tab).
    // Master is a combo: 2 bars (Added, Sold) + 1 LINE (Net to Market).
    // The line tells the story of whether inventory is growing or shrinking:
    //   net_ttm = added_ttm − sold_ttm
    // Negative ⇒ inventory shrinking (more sold than added).
    // Positive ⇒ inventory growing (more listings hitting market).
    //
    // The net column doesn't exist in the view — compute it as a helper
    // column at chart-build time via the R34 P8.5 helperCols infra.
    // The helper col lands one past the regular CHART_COLUMNS entries
    // (col G for inventory_backlog which has cols A-F).
    case 'inventory_backlog': {
      // R54 — Sold now renders as NEGATIVE bars (below 0). User notes
      // 2026-05-22: "The No Sold category should be counting as a number
      // removed from the market and go below the 0 on the same plane as
      // the count for those added so that we can visualize the movement
      // in the market better." The data tab keeps sold_ttm POSITIVE
      // (it's a real count); we add a `sold_neg` helper col that's
      // -sold_ttm, and chart that column instead.
      //
      // Net to Market line (R50) stays positive when added > sold,
      // negative when sold > added. Visual flow:
      //   Sky bar at +50 (Added) ──────────┐
      //   Net line at +20 (gray, can be ±)  │
      //   Navy bar at -30 (Sold, helper) ───┘
      // R66v — MONTHLY basis (added/sold in the month), matching the master's
      // Market Turnover chart. Was TTM rolling sums (added_ttm/sold_ttm, +/-300).
      const periodCol = findCol('period_end');
      const addedCol  = findCol('added_month');
      const soldCol   = findCol('sold_month');
      if (!periodCol || !addedCol || !soldCol) return null;
      // Helper col letters — net_ttm at G, sold_neg at H (relative to the
      // 6 regular cols A-F). After R53 wrapper inserts period_label at G,
      // these shift to H and I respectively (wrapper auto-shifts).
      const netColLetter     = String.fromCharCode(65 + cols.length);
      const soldNegColLetter = String.fromCharCode(65 + cols.length + 1);
      return {
        tabName,
        spec: {
          type: 'combo',
          tabName,
          catCol: periodCol,
          dataStart, dataEnd,
          // Bars + net line all share the same integer axis. Range
          // auto-scales so negative sold_neg + positive added both fit.
          barGrouping: 'clustered',
          sharedAxis:  true,
          valAxNumFmt: VAL_FMT_INTEGER,
          yLeftNumFmt: VAL_FMT_INTEGER,
          barSeries: [
            { titleCol: addedCol,         titleRow: headerRow, valCol: addedCol,         color: sky  },
            // R54 — Sold series renders from sold_neg helper col so it
            // appears below 0. Series TITLE still references the original
            // sold_ttm header cell so the legend reads "No. Sold (TTM)".
            { titleCol: soldCol,          titleRow: headerRow, valCol: soldNegColLetter, color: navy },
          ],
          lineSeries: [
            // Net to Market = added − sold (R50 gray helper col)
            { titleCol: netColLetter,     titleRow: headerRow, valCol: netColLetter,     color: '6A748C' },
          ],
          anchor: standardAnchor,
        },
        helperCols: [
          {
            key: 'net_ttm',
            header: 'Net to Market (Monthly)',
            format: 'integer_count',
            width: 22,
            getValue: (row) => {
              const a = row.added_month;
              const s = row.sold_month;
              return (a == null || s == null) ? null : Number(a) - Number(s);
            },
          },
          {
            key: 'sold_neg',
            header: 'No. Sold (chart)',
            format: 'integer_count',
            width: 18,
            // R66v — negated MONTHLY sold for the chart bar (renders below 0).
            getValue: (row) => row.sold_month == null ? null : -Number(row.sold_month),
          },
        ],
      };
    }

    case 'pace_of_cap_rate_expansion': {
      // R56 — restructured from 2-bar to 2-bar + 1-line combo. User
      // notes 2026-05-22: "We also have a YOY pace of change line in
      // our Excel/PDF version that is missing from this one."
      //
      // The synthetic composer at api/capital-markets.js already emits
      // a `pace_cost` field (YoY change in cost-of-capital, derived
      // from mortgage_30y_rate / treasury_10y_yield), but the prior
      // chart spec dropped it. R56 adds it back as an amber line on
      // the SHARED axis (pace_cost is in the same %bps units as the
      // other two pace series).
      const periodCol = findCol('period_end');
      const allCol    = findCol('pace_all');
      const coreCol   = findCol('pace_core');
      const costCol   = findCol('pace_cost');
      if (!periodCol || !allCol || !coreCol) return null;
      // Graceful fallback — if pace_cost isn't in cols (legacy view),
      // keep the original 2-bar shape.
      if (!costCol) {
        return {
          tabName,
          spec: {
            type: 'clustered-bar', tabName, catCol: periodCol, dataStart, dataEnd,
            yAxisRange: { min: -250, max: 350 },   // R70 A2 — bps
            valAxNumFmt: VAL_FMT_BPS,
            series: [
              { titleCol: allCol,  titleRow: headerRow, valCol: allCol,  color: navy },
              { titleCol: coreCol, titleRow: headerRow, valCol: coreCol, color: sky  },
            ],
            anchor: standardAnchor,
          },
        };
      }
      return {
        tabName,
        spec: {
          type: 'combo',
          tabName,
          catCol: periodCol,
          dataStart, dataEnd,
          barGrouping:    'clustered',
          sharedAxis:     true,   // pace_cost is in the same units as pace_all/core
          yAxisRange:     { min: -250, max: 350 },   // R70 A2 — bps
          valAxNumFmt:    VAL_FMT_BPS,
          yLeftNumFmt:    VAL_FMT_BPS,
          barSeries: [
            { titleCol: allCol,  titleRow: headerRow, valCol: allCol,  color: navy },
            { titleCol: coreCol, titleRow: headerRow, valCol: coreCol, color: sky  },
          ],
          lineSeries: [
            // R56 — Cost-of-capital YoY pace, amber (matches the
            // renderer's deferred 3rd series color noted in R45/R50).
            { titleCol: costCol, titleRow: headerRow, valCol: costCol, color: 'D97706' },
          ],
          anchor: standardAnchor,
        },
      };
    }

    // ────────────────────────────────────────────────────────────────
    // R35 P3 — final 2 simple-shape missed templates (post-R34 audit).
    // ────────────────────────────────────────────────────────────────

    case 'buyer_class_pct_by_year': {
      // Annual stacked bar — capital sources as % of pool by year.
      // Renderer at cm-chart-image-renderer.js line ~1244 stacks 4
      // series totaling 100%:
      //   Private        navy           palette[0]
      //   Public REITs   mid-blue       palette[2] = #265AB2
      //   Cross-Border   sky            palette[1]
      //   Institutional  pale           palette[3] = #E0E8F4
      //
      // X-axis is `year` (categorical), not period_end.
      //
      // The per-data-point datalabels (white text on navy/mid-blue bars,
      // dark text on sky/pale bars) the renderer adds aren't trivially
      // expressible in native chart XML — defer; native chart will have
      // no in-bar labels but is fully editable. Users can right-click
      // a series → Format Data Labels in Excel to add them manually.
      const yearCol = findCol('year');
      const privCol = findCol('private_pct');
      const reitCol = findCol('reit_pct');
      const cbCol   = findCol('cross_border_pct');
      const instCol = findCol('institutional_pct');
      if (!yearCol || !privCol || !reitCol || !cbCol || !instCol) return null;
      const blueMid = (palette.nm_blue_mid || '#265AB2').replace('#', '');
      const pale    = (palette.nm_pale     || '#E0E8F4').replace('#', '');
      return {
        tabName,
        spec: {
          type: 'stacked-bar',
          tabName,
          catCol: yearCol,
          dataStart, dataEnd,
          // R37 P1 — year x-axis (integer 2017, 2018, etc.), not quarter date.
          catAxNumFmt: '0',
          // R37 P2 — pct stack totals 100% (renderer line ~1249 sets max=1.0)
          yAxisRange:  { min: 0, max: 1 },
          valAxNumFmt: VAL_FMT_PERCENT_0DP,
          // R46 — per-segment in-bar % labels. User feedback 2026-05-21:
          // "Data_Buyer_Pool: Missing the data labels". Renderer (line
          // ~1244) renders white text on navy/mid-blue, dark text on
          // sky/pale fills (legibility). Mirror that here per-series:
          //   navy + mid-blue  → showSegmentVal: true, white text
          //   sky + pale       → showSegmentVal: true, dark text
          series: [
            { titleCol: privCol, titleRow: headerRow, valCol: privCol, color: navy,
              showSegmentVal: true, segmentLabelFmt: '0%', segmentLabelColor: 'FFFFFF' },
            { titleCol: reitCol, titleRow: headerRow, valCol: reitCol, color: blueMid,
              showSegmentVal: true, segmentLabelFmt: '0%', segmentLabelColor: 'FFFFFF' },
            { titleCol: cbCol,   titleRow: headerRow, valCol: cbCol,   color: sky,
              showSegmentVal: true, segmentLabelFmt: '0%', segmentLabelColor: '191919' },
            { titleCol: instCol, titleRow: headerRow, valCol: instCol, color: pale,
              showSegmentVal: true, segmentLabelFmt: '0%', segmentLabelColor: '191919' },
          ],
          anchor: standardAnchor,
        },
      };
    }

    case 'renewal_rent_growth': {
      // R66m — rebuilt to the deck p.32 combo ("Renewal Rent and its Growth
      // Rate Over Time"): pale-blue TTM rent/SF bars + dark-blue quartile
      // hi-low verticals (upper/lower Q markers) on the left $ axis, and the
      // Avg Renewal Rent CAGR as a sky line on the right % axis. Underlying
      // view (cm_gov_renewal_rent_growth_m) now outlier-trims rent_psf to
      // [$5,$100] so the TTM rent sits at a deck-consistent ~$30 (was inflating
      // to $54+) and cagr_5yr reads ~1-3% (was 10.6%). Prior build was a single
      // noisy quarterly-rent bar (spiked to $60).
      const periodCol = findCol('period_end');
      const rentCol   = findCol('ttm_avg_renewal_rent_psf');
      const upperCol  = findCol('upper_quartile_rpsf');
      const lowerCol  = findCol('lower_quartile_rpsf');
      // Per-lease renewal CAGR (deck p.32) — replaces the market-average
      // cagr_5yr line, which couldn't start before 2018. Falls back to
      // cagr_5yr if an older data tab without the per-lease column is fed in.
      const cagrCol   = findCol('cagr_per_lease') || findCol('cagr_5yr');
      if (!periodCol || !rentCol || !upperCol || !lowerCol || !cagrCol) {
        // Fallback to the legacy single-bar if columns are missing.
        return singleSeries('bar', 'avg_renewal_rent_psf', sky, {
          yAxisRange: { min: 0, max: 70 },
          valAxNumFmt: VAL_FMT_CURRENCY,
        });
      }
      return {
        tabName,
        spec: {
          type: 'renewal-combo',
          tabName,
          catCol: periodCol,
          dataStart, dataEnd,
          headerRow,
          rentCol, upperCol, lowerCol, cagrCol,
          title: 'Renewal Rent and its Growth Rate Over Time',
          leftRange:   { min: 0, max: 45 },
          leftNumFmt:  VAL_FMT_CURRENCY,
          // R69 Task 5 — the per-lease renewal CAGR runs ~0.1-1.5% (gov live
          // 2026-06: min 0.11%, max 1.52%, p05-p95 0.60-1.38%), but the old
          // -4%..+8% (1200bps) axis crushed it into ~3% of the height so the
          // line looked flat. Pin 0-2% (200bps) so the movement is visible.
          rightRange:  { min: 0, max: 0.02 },
          rightNumFmt: VAL_FMT_PERCENT_1DP,
          rentColor:     'BBDDF2',
          quartileColor: '003DA5',
          cagrColor:     '62B5E5',
          anchor: standardAnchor,
        },
      };
    }

    // ────────────────────────────────────────────────────────────────
    // R35 P4 — final 2 complex composites. After this case lands, 100%
    // of active-catalog chart_template_ids are native.
    // ────────────────────────────────────────────────────────────────

    case 'cost_of_capital': {
      // Renderer at cm-chart-image-renderer.js ~line 1166 (PDF p.23
      // dia / p.15 gov):
      //   • Pale gray floating range bar [low_loan, high_loan]
      //   • Sky line:  treasury_10y_yield
      //   • Navy line: avg_cap_rate
      //   • Single Y-axis (all series in 0-10% range)
      //
      // Native decomposition reuses the existing combo with stacked
      // bars + invisible base + sharedAxis (no right axis):
      //   barSeries[0] noFill=true: low_loan_constant (col E)
      //   barSeries[1] visible pale gray w/ darker gray border:
      //                helper col loan_band_width = high - low (col G)
      //   lineSeries[0] sky:  treasury_10y_yield (col B)
      //   lineSeries[1] navy: avg_cap_rate (col C)
      //
      // Renderer skips the 3rd "10+ Year Cap" line (cap_10plus_year is
      // in the data tab but not plotted). Native matches that.
      const periodCol  = findCol('period_end');
      const lowCol     = findCol('low_loan_constant');
      const highCol    = findCol('high_loan_constant');
      const treasCol   = findCol('treasury_10y_yield');
      const capCol     = findCol('avg_cap_rate');
      if (!periodCol || !lowCol || !highCol || !treasCol || !capCol) return null;

      const bandCol = String.fromCharCode(65 + cols.length);  // helper col letter
      const GRAY = '6A748C';  // nm_axis

      // R37 P3 — peak/trough/most-recent labels on the navy avg_cap_rate line
      // (renderer line 1217: buildAnnotations(rows, r => r.avg_cap_rate, fmtPct2))
      const capLabels = Array.isArray(rows)
        ? buildAnnotationsForSpec(rows, r => r.avg_cap_rate, fmtPct2Native)
        : undefined;

      return {
        tabName,
        spec: {
          type: 'combo',
          tabName,
          catCol: periodCol,
          dataStart, dataEnd,
          barGrouping: 'stacked',
          sharedAxis: true,  // band + lines all on the same val axis (0-10%)
          // R37 P2 — cost-of-capital 0-10% (renderer line ~1213)
          yLeftRange:  { min: 0, max: 0.10 },
          yLeftNumFmt: VAL_FMT_PERCENT_1DP,
          barSeries: [
            // Invisible base — lifts the band off 0 up to low_loan_constant
            { titleCol: lowCol,  titleRow: headerRow, valCol: lowCol,
              color: GRAY, noFill: true },
            // Visible band — pale gray fill with solid gray border
            // (matches renderer's rgba(106,116,140,0.12) fill + #6A748C border)
            { titleCol: bandCol, titleRow: headerRow, valCol: bandCol,
              color: GRAY, alpha: '12000', borderColor: GRAY },
          ],
          lineSeries: [
            { titleCol: treasCol, titleRow: headerRow, valCol: treasCol, color: sky  },
            { titleCol: capCol,   titleRow: headerRow, valCol: capCol,   color: navy,
              dataLabels: capLabels },
          ],
          anchor: standardAnchor,
        },
        helperCols: [{
          key: 'loan_band_width',
          header: 'Loan Constant Band Width',
          format: 'percent_basis_points',
          width: 24,
          getValue: (row) => {
            const lo = row.low_loan_constant;
            const hi = row.high_loan_constant;
            return (lo != null && hi != null) ? Number(hi) - Number(lo) : null;
          },
        }],
      };
    }

    case 'volume_cap_quartile_combo': {
      // Renderer at cm-chart-image-renderer.js ~line 1426 (PDF p.19
      // dia / p.11 gov). Three distinct visualization layers:
      //   1. LIGHT BLUE SHADED AREA (back, left axis $) — TTM volume
      //   2. PALE SKY FLOATING BARS (middle, right axis %) — Q1-Q3 cap range
      //   3. NAVY DOTS (front, right axis %) — TTM avg cap rate
      //
      // Native decomposition uses the new 'area-combo' dispatch:
      //   areaSeries: volume_dollars (col C) — pale fill, navy border, LEFT
      //   barSeries[0] noFill=true:  lower_quartile (col F)
      //   barSeries[1] pale sky 25% alpha w/ sky border:
      //                              iqr_width helper (col G) = upper - lower
      //   lineSeries[0] navy circle markers (no line):
      //                              cap_rate (col D), shows on top
      const periodCol  = findCol('period_end');
      const volCol     = findCol('volume_dollars');
      const capCol     = findCol('cap_rate');
      const upperCol   = findCol('upper_quartile');
      const lowerCol   = findCol('lower_quartile');
      if (!periodCol || !volCol || !capCol || !upperCol || !lowerCol) return null;

      const iqrCol = String.fromCharCode(65 + cols.length);  // helper col letter
      const pale = (palette.nm_pale || '#E0E8F4').replace('#', '');

      // R37 P3 — peak/trough/most-recent labels on the navy cap-rate dots
      // (renderer line 1489: buildAnnotations(rows, r => r.cap_rate, fmtPct2))
      const capLabels = Array.isArray(rows)
        ? buildAnnotationsForSpec(rows, r => r.cap_rate, fmtPct2Native)
        : undefined;

      return {
        tabName,
        spec: {
          type: 'area-combo',
          tabName,
          catCol: periodCol,
          dataStart, dataEnd,
          // R37 P2 — LEFT axis = volume $ (compact M format); RIGHT axis
          // = cap rate 5.0-10.5% (renderer line ~1481, widened from 5-9%
          // because gov upper-q hits 10.08%).
          yLeftNumFmt:  VAL_FMT_CURRENCY_M,
          yRightRange:  { min: 0.050, max: 0.105 },
          yRightNumFmt: VAL_FMT_PERCENT_2DP,
          areaSeries: {
            titleCol: volCol, titleRow: headerRow, valCol: volCol,
            fillColor: pale,     // pale blue fill
            borderColor: navy,   // navy border on the area edge
          },
          barSeries: [
            // Invisible base — lifts the IQR bar off 0 up to lower_quartile
            { titleCol: lowerCol, titleRow: headerRow, valCol: lowerCol,
              color: sky, noFill: true },
            // Visible IQR band — pale sky 25% alpha w/ solid sky border
            // (matches renderer's rgba(98,181,229,0.25) fill + sky border)
            { titleCol: iqrCol, titleRow: headerRow, valCol: iqrCol,
              color: sky, alpha: '25000', borderColor: sky },
          ],
          lineSeries: [
            // Avg cap rate dots — navy circle markers, no connecting line
            { titleCol: capCol, titleRow: headerRow, valCol: capCol,
              color: navy, showMarker: true, markerShape: 'circle', markerSize: 5,
              dataLabels: capLabels },
          ],
          anchor: standardAnchor,
        },
        helperCols: [{
          key: 'iqr_width',
          header: 'Quartile Range Width',
          format: 'percent_basis_points',
          width: 22,
          getValue: (row) => {
            const lo = row.lower_quartile;
            const hi = row.upper_quartile;
            return (lo != null && hi != null) ? Number(hi) - Number(lo) : null;
          },
        }],
      };
    }

    // ────────────────────────────────────────────────────────────────
    // R36 P1 — horizontal-bar state-ranking charts. Renderer at
    // cm-chart-image-renderer.js sets `indexAxis: 'y'` to flip the
    // bars sideways. Native equivalent uses <c:barDir val="bar"/> and
    // swaps the catAx/valAx positions.
    // ────────────────────────────────────────────────────────────────

    case 'leased_inventory_by_state': {
      // Top-N states ranked by lease_count. Renderer takes the first
      // 15 rows of the view (already sorted by rank_by_rsf, but the
      // bar value plotted is lease_count, not RSF — keep that mirror).
      // Native chart uses col B (state) as cat axis and col C
      // (lease_count) as the bar values. The data tab already arrives
      // pre-sorted from the view; if there are >15 rows the chart
      // shows them all (Excel doesn't auto-trim, but users can filter).
      const stateCol = findCol('state');
      const countCol = findCol('lease_count');
      if (!stateCol || !countCol) return null;
      return {
        tabName,
        spec: {
          type: 'bar',
          tabName,
          titleCol: countCol, titleRow: headerRow,
          catCol: stateCol, valCol: countCol,
          dataStart, dataEnd,
          color: navy,
          horizontal: true,
          // R37 P2 — integer lease count
          valAxNumFmt: VAL_FMT_INTEGER,
          anchor: standardAnchor,
        },
      };
    }

    case 'sources_of_capital': {
      // Top-N buyer states ranked by 15-yr volume. Renderer takes first
      // 15 rows (sorted by rank_15y); bar values are total_volume_15y.
      const stateCol  = findCol('buyer_state');
      const volumeCol = findCol('total_volume_15y');
      if (!stateCol || !volumeCol) return null;
      return {
        tabName,
        spec: {
          type: 'bar',
          tabName,
          titleCol: volumeCol, titleRow: headerRow,
          catCol: stateCol, valCol: volumeCol,
          dataStart, dataEnd,
          color: navy,
          horizontal: true,
          // R37 P2 — compact currency for $B/$M volume
          valAxNumFmt: VAL_FMT_CURRENCY_M,
          anchor: standardAnchor,
        },
      };
    }

    // ────────────────────────────────────────────────────────────────
    // R36 P2 — donut charts (single ring, N segments, no axes).
    // Each data row is one tenant segment; the renderer at
    // cm-chart-image-renderer.js line ~435 uses these PDF colors:
    //   idx 0 = DaVita      navy   (cap_short)
    //   idx 1 = FMC         sky    (cap_mid)
    //   idx 2 = US Renal    sage   (cap_mid_long)
    //   idx 3 = Other       gray   (cap_outside_firm)
    // Doughnut hole cutout = 55% to match cutout: '55%' in renderer.
    // ────────────────────────────────────────────────────────────────
    case 'available_by_tenant_count_donut':
    case 'available_by_tenant_volume_donut': {
      const isVolume = chart_template_id === 'available_by_tenant_volume_donut';
      const tenantCol = findCol('tenant');
      const valCol    = findCol(isVolume ? 'volume_available' : 'count_active');
      if (!tenantCol || !valCol) return null;
      // PDF segment colors (positional — DaVita first, FMC second, etc.).
      // Excess rows get the "Other" gray. The data tab arrives pre-sorted
      // from the view (per the renderer's expectation).
      const SEGMENT_COLORS = ['003DA5', '62B5E5', '4CB582', '6A748C'];
      // Build a per-row color array sized to the data range. Anything
      // past the 4 known segments falls back to the "Other" gray so
      // unknown tenants don't crash the chart.
      const rowCount = (dataEnd - dataStart) + 1;
      const colors = Array.from({ length: rowCount }, (_, i) =>
        SEGMENT_COLORS[i] || '6A748C'
      );
      return {
        tabName,
        spec: {
          type: 'doughnut',
          tabName,
          titleCol: valCol, titleRow: headerRow,
          catCol: tenantCol, valCol,
          dataStart, dataEnd,
          colors,
          holeSize: 55,
          // R46 — per-segment % labels (user feedback 2026-05-21)
          showSegmentLabels: true,
          anchor: standardAnchor,
        },
      };
    }

    // ────────────────────────────────────────────────────────────────
    // R36 P3 — bar + 4-scatter composites on categorical x-axis.
    // Renderer at cm-chart-image-renderer.js line ~526 (dia) and
    // ~2157 (gov firm-term variant). Identical chart shape:
    //   • 1 sky bar series  — Avg Price (left axis $)
    //   • 4 dot series      — Avg Cap (navy), Upper Q (purple),
    //                          Lower Q (gray), Median (sage)
    //                          all on RIGHT axis (cap rate %)
    //   • Categorical x-axis = term_bucket (text labels)
    //
    // Native version reuses the combo machinery with showMarker=true
    // on each line series for the dot overlay. Same pattern as
    // rent_by_year_built (R34 P9).
    // ────────────────────────────────────────────────────────────────
    case 'available_by_term_summary':
    case 'available_by_firm_term_summary': {
      const termCol     = findCol('term_bucket');
      const priceCol    = findCol('avg_price');
      const avgCapCol   = findCol('avg_cap');
      const upperQCol   = findCol('upper_quartile_cap');
      const lowerQCol   = findCol('lower_quartile_cap');
      const medianCol   = findCol('median_cap');
      if (!termCol || !priceCol || !avgCapCol || !upperQCol || !lowerQCol || !medianCol) {
        return null;
      }
      // R50 — colors realigned to master Market Size tab chart26
      // (user feedback 2026-05-22: "Adjust dot colors to match master,
      // Pin right-axis range (cap %), Diamond markers instead of circles").
      // Master uses navy/teal/purple/sky for the cap dots (no Median dot
      // — we keep ours as sage so existing PDF parity holds). Marker
      // shape stays as diamond per user preference (master uses circle
      // but user prefers diamond — diamond reads as more distinct from
      // the bar fill in tight Excel previews).
      //
      // Updated mapping (R50):
      //   Avg Cap        teal   (R50, was navy)    aquamarine #00B1B0
      //   Upper Quartile purple (unchanged)         #7E6BAD
      //   Lower Quartile sky   (R50, was gray)    #62B5E5
      //   Median         sage   (unchanged)         #4CB582
      // R60 — per-dot callout labels. User notes 2026-05-22 batch 4:
      // "We need the data points labeled with call outs so we can see
      // the data, maybe even adjust the cap rate axis so we can see
      // the movement better." dataLabels: 'all' tells the combo
      // builder to emit per-point labels on each marker.
      //
      // R60 — tighter right-axis range. CAP_RATE_DOT_RANGE (4-12%)
      // spans 800bps but the actual dia term-bucket caps cluster
      // 5.5-8% — a 250bps spread crushed into 28% of the chart height.
      // 5-9% pin (400bps span) doubles the visible vertical resolution.
      // R69 Task 5 — the 4 cap diamonds per bucket (avg/upper/lower/median)
      // cluster within ~200bps, so a single 't' label position stacked all four
      // labels on top of each other ("still cramped", Scott's G23/D9 note).
      // Spread them around each diamond: avg→right, upper→top, lower→bottom,
      // median→left. Four distinct positions => no overlap, axis range unchanged.
      const capLbl = (pos) => ({ showVal: true, numFmt: VAL_FMT_PERCENT_2DP, pos });
      return {
        tabName,
        spec: {
          type: 'combo',
          tabName,
          catCol: termCol,
          dataStart, dataEnd,
          // R64 — left axis "$X.XM" per user batch 5: "lets adjust the
          // number formatting of the x-axis to show $x.xM". Avg Price
          // for dia chair sale typically $1.5M-$5M; gov bldg $3M-$30M;
          // single-decimal millions is the right resolution.
          yLeftNumFmt:  VAL_FMT_CURRENCY_M_1DP,
          yRightRange:  { min: 0.05, max: 0.09 },  // R60 — tighter than CAP_RATE_DOT_RANGE
          yRightNumFmt: VAL_FMT_PERCENT_2DP,
          barSeries: [
            { titleCol: priceCol, titleRow: headerRow, valCol: priceCol, color: sky },
          ],
          lineSeries: [
            // 4 diamond markers on the right axis with per-point callout labels (R60).
            // R67 — was #00B1B0 (off-brand teal), swapped to navy #003DA5 so
            // the headline "Avg Cap" dot reads as the primary series and the
            // palette is brand-compliant. User feedback 2026-05-23 batch 6.
            { titleCol: avgCapCol,  titleRow: headerRow, valCol: avgCapCol,
              color: '003DA5', showMarker: true, markerShape: 'diamond', markerSize: 7,
              dataLabels: capLbl('r') },
            { titleCol: upperQCol,  titleRow: headerRow, valCol: upperQCol,
              color: '7E6BAD', showMarker: true, markerShape: 'diamond', markerSize: 7,
              dataLabels: capLbl('t') },
            { titleCol: lowerQCol,  titleRow: headerRow, valCol: lowerQCol,
              color: '62B5E5', showMarker: true, markerShape: 'diamond', markerSize: 7,
              dataLabels: capLbl('b') },
            { titleCol: medianCol,  titleRow: headerRow, valCol: medianCol,
              color: '4CB582', showMarker: true, markerShape: 'diamond', markerSize: 7,
              dataLabels: capLbl('l') },
          ],
          anchor: standardAnchor,
        },
      };
    }

    // ────────────────────────────────────────────────────────────────
    // R36 P4 — unblock 3 of 5 deferred templates with code-only changes.
    // The remaining 2 truly can't migrate: ppsf_box_quarterly (dropped
    // from catalog Round 6h, no view) and lease_structures (renderer
    // returns null — table only, no chart shape).
    // ────────────────────────────────────────────────────────────────

    case 'lease_termination_rate': {
      // Renderer at cm-chart-image-renderer.js ~line 1629 stacks two bars:
      //   Series 0 (bottom, navy): "Leases In Firm Term" = total - outside
      //   Series 1 (top, sky):     "Leases Outside Firm Term"
      //
      // The "In Firm Term" series is COMPUTED at render time, not stored.
      // Use the P8.5 helper-col infrastructure to write it as col E on
      // the data tab, then reference it as the bottom of a stacked bar.
      // R68-E G6 — add the PDF's soft-term termination LINE on a secondary
      // % axis. The two count bars (In Firm + Outside) stay on the left
      // integer axis; terminated_outside_firm_term_pct (a real view column,
      // decimal fraction) drives an amber line on the right % axis. Falls
      // back to the pure stacked-bar shape when the pct column is absent
      // (pre-R68-E view). pdf_reconcile.
      const periodCol  = findCol('period_end');
      const totalCol   = findCol('total_leases_active');
      const outsideCol = findCol('leases_outside_firm_term');
      const rateCol    = findCol('terminated_outside_firm_term_pct');
      if (!periodCol || !totalCol || !outsideCol) return null;

      // Helper col letter — lands one past the regular CHART_COLUMNS entries
      const inFirmCol = String.fromCharCode(65 + cols.length);

      const inFirmHelper = {
        key: 'in_firm_term',
        header: 'Leases In Firm Term (TTM)',
        format: 'integer_count',
        width: 22,
        getValue: (row) => {
          const total   = row.total_leases_active;
          const outside = row.leases_outside_firm_term;
          if (total == null || outside == null) return null;
          return Math.max(0, Number(total) - Number(outside));
        },
      };

      const barSeries = [
        // Bottom: In Firm Term (computed helper col), navy
        { titleCol: inFirmCol,  titleRow: headerRow, valCol: inFirmCol,  color: navy },
        // Top: Outside Firm Term, sky
        { titleCol: outsideCol, titleRow: headerRow, valCol: outsideCol, color: sky },
      ];

      // No line column available → keep the original stacked-bar visual.
      if (!rateCol) {
        return {
          tabName,
          spec: {
            type: 'stacked-bar',
            tabName,
            catCol: periodCol,
            dataStart, dataEnd,
            valAxNumFmt: VAL_FMT_INTEGER,
            series: barSeries,
            anchor: standardAnchor,
          },
          helperCols: [inFirmHelper],
        };
      }

      return {
        tabName,
        spec: {
          type: 'combo',
          tabName,
          catCol: periodCol,
          dataStart, dataEnd,
          barGrouping: 'stacked',
          yLeftNumFmt:  VAL_FMT_INTEGER,
          yRightNumFmt: VAL_FMT_PERCENT_1DP,
          // Soft-term rate runs ~1-19% over history (avg 8%); pin 0-25%.
          yRightRange:  { min: 0, max: 0.25 },
          barSeries,
          lineSeries: [
            { titleCol: rateCol, titleRow: headerRow, valCol: rateCol, color: 'D97706' },
          ],
          anchor: standardAnchor,
        },
        helperCols: [inFirmHelper],
      };
    }

    case 'net_lease_spread': {
      // Renderer at cm-chart-image-renderer.js ~line 1713 wants 3 lines:
      //   10Y Treasury Yield (sky)
      //   Average Cap Rate (TTM) (navy bold)
      //   10+ Year Cap (TTM) (mid-blue)
      //
      // But the 3rd series (`cap_10plus_year`) isn't in the Data_NL_Spread
      // schema — the renderer plots it as null. Native chart matches that
      // visual reality by emitting just the 2 series that exist in the
      // data tab. Same pattern as fed_funds_vs_treasury (R35 P1) and
      // cash_leveraged_returns (R35 P1).
      const periodCol = findCol('period_end');
      const treasCol  = findCol('treasury_10y_yield');
      const capCol    = findCol('avg_cap_rate');
      if (!periodCol || !treasCol || !capCol) return null;
      return {
        tabName,
        spec: {
          type: 'multi-line',
          tabName,
          catCol: periodCol,
          dataStart, dataEnd,
          // R37 P2 — cap rate percent
          valAxNumFmt: VAL_FMT_PERCENT_1DP,
          series: [
            { titleCol: treasCol, titleRow: headerRow, valCol: treasCol, color: sky  },
            { titleCol: capCol,   titleRow: headerRow, valCol: capCol,   color: navy },
          ],
          anchor: standardAnchor,
        },
      };
    }

    case 'rent_heat_map': {
      // Renderer at cm-chart-image-renderer.js ~line 1832 wants a US
      // choropleth, but QuickChart's hosted instance doesn't bundle
      // chartjs-chart-geo. The fallback is a horizontal bar of the
      // top 15 states by avg_rpsf. Migrate that fallback to native —
      // same pattern as leased_inventory_by_state + sources_of_capital
      // (R36 P1).
      const stateCol = findCol('state');
      const rpsfCol  = findCol('avg_rpsf');
      if (!stateCol || !rpsfCol) return null;
      return {
        tabName,
        spec: {
          type: 'bar',
          tabName,
          titleCol: rpsfCol, titleRow: headerRow,
          catCol: stateCol, valCol: rpsfCol,
          dataStart, dataEnd,
          color: navy,
          horizontal: true,
          // R37 P2 — rent PSF currency
          valAxNumFmt: VAL_FMT_CURRENCY,
          anchor: standardAnchor,
        },
      };
    }

    default:
      return null;
  }
}
