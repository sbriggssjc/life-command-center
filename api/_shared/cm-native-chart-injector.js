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
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${NS_CHART}" xmlns:a="${NS_DRAWINGML}" xmlns:r="${NS_REL}">
  <c:chart>
    <c:autoTitleDeleted val="1"/>
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
        <c:crossAx val="2"/>
      </c:catAx>
      <c:valAx>
        <c:axId val="2"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="l"/>
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
  // Horizontal bar: orient cat axis maxMin so largest values appear at top
  const catOrientation = horizontal ? 'maxMin' : 'minMax';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${NS_CHART}" xmlns:a="${NS_DRAWINGML}" xmlns:r="${NS_REL}">
  <c:chart>
    <c:autoTitleDeleted val="1"/>
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
        <c:crossAx val="2"/>
      </c:catAx>
      <c:valAx>
        <c:axId val="2"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="${valAxPos}"/>
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
    return `        <c:ser>
          <c:idx val="${i}"/>
          <c:order val="${i}"/>
          <c:tx><c:strRef><c:f>'${sheet}'!$${s.titleCol}$${s.titleRow}</c:f></c:strRef></c:tx>
          <c:spPr>${fillFrag}${lineFrag}</c:spPr>
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
  <c:chart>
    <c:autoTitleDeleted val="1"/>
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
        <c:crossAx val="2"/>
      </c:catAx>
      <c:valAx>
        <c:axId val="2"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="l"/>
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
 * @returns {string} chart XML
 */
function buildMultiLineChartXml(spec) {
  const sheet = escapeXml(spec.tabName);
  const seriesXml = spec.series.map((s, i) => {
    const color = (s.color || '003DA5').replace('#', '');
    // Dashed line variant (e.g. gov "Outside Firm" cohort) — Excel
    // renders <a:prstDash val="dash"/> as a regular dashed stroke.
    const dashFrag = s.dashed
      ? `<a:prstDash val="dash"/>`
      : '';
    return `        <c:ser>
          <c:idx val="${i}"/>
          <c:order val="${i}"/>
          <c:tx><c:strRef><c:f>'${sheet}'!$${s.titleCol}$${s.titleRow}</c:f></c:strRef></c:tx>
          <c:spPr>
            <a:ln w="22225" cap="rnd"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill>${dashFrag}<a:round/></a:ln>
          </c:spPr>
          <c:marker><c:symbol val="none"/></c:marker>
          <c:cat><c:numRef><c:f>'${sheet}'!$${spec.catCol}$${spec.dataStart}:$${spec.catCol}$${spec.dataEnd}</c:f></c:numRef></c:cat>
          <c:val><c:numRef><c:f>'${sheet}'!$${s.valCol}$${spec.dataStart}:$${s.valCol}$${spec.dataEnd}</c:f></c:numRef></c:val>
          <c:smooth val="0"/>
        </c:ser>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${NS_CHART}" xmlns:a="${NS_DRAWINGML}" xmlns:r="${NS_REL}">
  <c:chart>
    <c:autoTitleDeleted val="1"/>
    <c:plotArea>
      <c:layout/>
      <c:lineChart>
        <c:grouping val="standard"/>
        <c:varyColors val="0"/>
${seriesXml}
        <c:marker val="0"/>
        <c:axId val="1"/>
        <c:axId val="2"/>
      </c:lineChart>
      <c:catAx>
        <c:axId val="1"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="b"/>
        <c:crossAx val="2"/>
      </c:catAx>
      <c:valAx>
        <c:axId val="2"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="l"/>
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
  // P8.5 — barGrouping + sharedAxis support
  const barGrouping = spec.barGrouping === 'stacked' ? 'stacked' : 'clustered';
  const overlap     = barGrouping === 'stacked' ? 100 : -20;
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
    return `        <c:ser>
          <c:idx val="${i}"/>
          <c:order val="${i}"/>
          <c:tx><c:strRef><c:f>'${sheet}'!$${s.titleCol}$${s.titleRow}</c:f></c:strRef></c:tx>
          <c:spPr>${fillFrag}${lineFrag}</c:spPr>
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
          <c:cat><c:numRef><c:f>'${sheet}'!$${spec.catCol}$${spec.dataStart}:$${spec.catCol}$${spec.dataEnd}</c:f></c:numRef></c:cat>
          <c:val><c:numRef><c:f>'${sheet}'!$${s.valCol}$${spec.dataStart}:$${s.valCol}$${spec.dataEnd}</c:f></c:numRef></c:val>
          <c:smooth val="0"/>
        </c:ser>`;
  }).join('\n');

  // Bar block uses primary axes (1=cat, 2=left val).
  // Line block shares the cat axis (1) but uses the secondary val axis (3).
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${NS_CHART}" xmlns:a="${NS_DRAWINGML}" xmlns:r="${NS_REL}">
  <c:chart>
    <c:autoTitleDeleted val="1"/>
    <c:plotArea>
      <c:layout/>
      <c:barChart>
        <c:barDir val="col"/>
        <c:grouping val="${barGrouping}"/>
        <c:varyColors val="0"/>
${barXml}
        <c:gapWidth val="60"/>
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
        <c:crossAx val="2"/>
      </c:catAx>
      <c:valAx>
        <c:axId val="2"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="l"/>
        <c:crossAx val="1"/>
      </c:valAx>${spec.sharedAxis ? '' : `
      <c:valAx>
        <c:axId val="3"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="r"/>
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
function buildScatterChartXml(spec) {
  const sheet = escapeXml(spec.tabName);
  const seriesXml = spec.series.map((s, i) => {
    const color = (s.color || '003DA5').replace('#', '');
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
          <c:xVal><c:numRef><c:f>'${sheet}'!$${s.xCol}$${spec.dataStart}:$${s.xCol}$${spec.dataEnd}</c:f></c:numRef></c:xVal>
          <c:yVal><c:numRef><c:f>'${sheet}'!$${s.yCol}$${spec.dataStart}:$${s.yCol}$${spec.dataEnd}</c:f></c:numRef></c:yVal>
          <c:smooth val="0"/>
        </c:ser>`;
    }
    // Default dot-cloud series: visible markers, no connecting line.
    // Filled circle marker, no border emphasis (mirrors chart.js
    // pointStyle:'circle' + pointRadius:3 from the renderer).
    // <c:size val="5"/> ≈ pointRadius 3-4 in pixels.
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
          <c:xVal><c:numRef><c:f>'${sheet}'!$${s.xCol}$${spec.dataStart}:$${s.xCol}$${spec.dataEnd}</c:f></c:numRef></c:xVal>
          <c:yVal><c:numRef><c:f>'${sheet}'!$${s.yCol}$${spec.dataStart}:$${s.yCol}$${spec.dataEnd}</c:f></c:numRef></c:yVal>
          <c:smooth val="0"/>
        </c:ser>`;
  }).join('\n');

  // Both axes are valAx (continuous). Axis IDs 1 (x, bottom) + 2 (y, left).
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${NS_CHART}" xmlns:a="${NS_DRAWINGML}" xmlns:r="${NS_REL}">
  <c:chart>
    <c:autoTitleDeleted val="1"/>
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
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="b"/>
        <c:crossAx val="2"/>
      </c:valAx>
      <c:valAx>
        <c:axId val="2"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="l"/>
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
          <c:cat><c:numRef><c:f>'${sheet}'!$${spec.catCol}$${spec.dataStart}:$${spec.catCol}$${spec.dataEnd}</c:f></c:numRef></c:cat>
          <c:val><c:numRef><c:f>'${sheet}'!$${s.valCol}$${spec.dataStart}:$${s.valCol}$${spec.dataEnd}</c:f></c:numRef></c:val>
          <c:smooth val="0"/>
        </c:ser>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${NS_CHART}" xmlns:a="${NS_DRAWINGML}" xmlns:r="${NS_REL}">
  <c:chart>
    <c:autoTitleDeleted val="1"/>
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
        <c:crossAx val="2"/>
      </c:catAx>
      <c:valAx>
        <c:axId val="2"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="l"/>
        <c:crossAx val="1"/>
      </c:valAx>
      <c:valAx>
        <c:axId val="3"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="r"/>
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
 * Generate a drawing.xml that anchors a single chart to a cell range.
 * Anchor: top-left at (col0, row0), bottom-right at (col1, row1) — both
 * zero-indexed.
 */
function buildDrawingXml({ chartRelId, anchor }) {
  const a = anchor || { col0: 0, row0: 0, col1: 13, row1: 21 };
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="${NS_SS_DRAW}" xmlns:a="${NS_DRAWINGML}" xmlns:r="${NS_REL}" xmlns:c="${NS_CHART}">
  <xdr:twoCellAnchor editAs="oneCell">
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
        <xdr:cNvPr id="2" name="Chart 1"/>
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
  </xdr:twoCellAnchor>
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

  for (const { tabName, spec } of injections) {
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

    const chartFile   = `xl/charts/chart${nextChartId}.xml`;
    const drawingFile = `xl/drawings/drawing${nextDrawingId}.xml`;
    const drawingRels = `xl/drawings/_rels/drawing${nextDrawingId}.xml.rels`;
    const sheetRels   = cleanSheetPath.replace(/^(xl\/worksheets\/)([^.]+)\.xml$/, '$1_rels/$2.xml.rels');

    // 1. Generate chart XML — dispatch by spec.type
    let chartXml;
    if (spec.type === 'stacked-bar') {
      chartXml = buildStackedBarChartXml(spec);
    } else if (spec.type === 'clustered-bar') {
      // R35 P2 — shares the builder with stacked-bar but forces
      // grouping='clustered'. Used for inventory_backlog and
      // pace_of_cap_rate_expansion (multi-bar single-axis charts).
      chartXml = buildStackedBarChartXml({ ...spec, grouping: 'clustered' });
    } else if (spec.type === 'bar') {
      chartXml = buildSingleBarChartXml(spec);
    } else if (spec.type === 'multi-line') {
      chartXml = buildMultiLineChartXml(spec);
    } else if (spec.type === 'combo') {
      chartXml = buildComboChartXml(spec);
    } else if (spec.type === 'area-combo') {
      // R35 P4 — 3-block combo (area + bar + line) for volume_cap_quartile_combo.
      chartXml = buildAreaComboChartXml(spec);
    } else if (spec.type === 'scatter') {
      chartXml = buildScatterChartXml(spec);
    } else {
      // 'line' (default) and any future shapes that don't have their own
      // builder yet fall back to the line builder.
      chartXml = buildSingleLineChartXml(spec);
    }
    zip.file(chartFile, chartXml);

    // 2. Generate drawing XML + its rels (drawing → chart)
    zip.file(drawingFile, buildDrawingXml({ chartRelId: 'rId1', anchor: spec.anchor }));
    zip.file(drawingRels, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="${REL_CHART}" Target="../charts/chart${nextChartId}.xml"/>
</Relationships>`);

    // 3. Update sheet's rels to include the drawing reference
    let sheetRelsXml = await (zip.file(sheetRels)?.async('string')) || `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
    // Find next rId for this sheet's rels
    const usedRids = Array.from(sheetRelsXml.matchAll(/Id="rId(\d+)"/g)).map(m => Number(m[1]));
    const sheetRelNextId = usedRids.length ? Math.max(...usedRids) + 1 : 1;
    const drawingRid = `rId${sheetRelNextId}`;
    const newRel = `<Relationship Id="${drawingRid}" Type="${REL_DRAWING}" Target="../drawings/drawing${nextDrawingId}.xml"/>`;
    sheetRelsXml = sheetRelsXml.replace('</Relationships>', `${newRel}</Relationships>`);
    zip.file(sheetRels, sheetRelsXml);

    // 4. Update sheet XML to reference the drawing (insert <drawing r:id="..."/>
    // before </worksheet>). If a <drawing/> already exists (PNG image was on
    // this sheet), append the new chart drawing as a SECOND drawing entry —
    // Excel will render both. Caller is responsible for omitting the PNG if
    // they want the chart to replace it.
    let sheetXml = await zip.file(cleanSheetPath).async('string');
    if (!sheetXml.includes(`<drawing r:id="${drawingRid}"/>`)) {
      // Excel requires only ONE <drawing/> element per sheet. If an existing
      // drawing tag is present (from a PNG image), we leave it alone and
      // rely on the caller having NOT embedded the PNG for migrated charts.
      // If no drawing exists yet, insert ours before </worksheet>.
      if (!/<drawing\s+r:id="[^"]+"\s*\/>/.test(sheetXml)) {
        sheetXml = sheetXml.replace('</worksheet>', `  <drawing r:id="${drawingRid}"/>\n</worksheet>`);
        zip.file(cleanSheetPath, sheetXml);
      } else {
        console.warn(`[cm-native-chart-injector] ${tabName} already has a drawing element — caller should suppress PNG for migrated charts`);
      }
    }

    // 5. Track content-types overrides
    newOverrides.push(`<Override PartName="/${chartFile}" ContentType="${CT_CHART}"/>`);
    newOverrides.push(`<Override PartName="/${drawingFile}" ContentType="${CT_DRAWING}"/>`);

    nextChartId++;
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
export function buildInjectionSpec({ chart_template_id, tabName, cols, dataStart, dataEnd, brand, rows }) {
  const palette = brand?.palette || {};
  const navy   = (palette.nm_navy   || '#003DA5').replace('#', '');
  const sky    = (palette.nm_sky    || '#62B5E5').replace('#', '');
  const headerRow = dataStart - 1;  // header row sits one row above first data row
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
  const singleSeries = (type, valKeys, color) => {
    const periodCol = findCol('period_end');
    const valCol = findCol(...(Array.isArray(valKeys) ? valKeys : [valKeys]));
    if (!periodCol || !valCol) return null;
    return {
      tabName,
      spec: {
        type, tabName,
        titleCol: valCol, titleRow: headerRow,
        catCol: periodCol, valCol,
        dataStart, dataEnd,
        color,
        anchor: standardAnchor,
      },
    };
  };

  switch (chart_template_id) {
    // P2 — first migration
    case 'volume_ttm_by_quarter':
      // master_m mapper renames ttm_volume → volume_dollars in some places
      return singleSeries('line', ['volume_dollars', 'ttm_volume'], navy);

    // P3 — simple single-series line + bar charts
    case 'cap_rate_ttm_by_quarter':
      return singleSeries('line', 'ttm_weighted_cap_rate', navy);
    case 'transaction_count_ttm':
      return singleSeries('bar', ['ttm_count', 'count'], navy);
    case 'avg_deal_size':
      return singleSeries('bar', 'avg_deal_size', navy);
    case 'yoy_volume_change':
      // Renderer uses signed colors (navy positive, lighter negative).
      // Native chart XML doesn't easily express per-point conditional
      // colors — accept navy across the board for now (mirrors most-recent
      // values; negative bars still render correctly, just without the
      // red highlight). Could add point-level dPt color overrides later.
      return singleSeries('bar', 'yoy_change_pct', navy);
    case 'market_turnover':
      return singleSeries('line', 'turnover_rate', navy);
    case 'quarterly_volume_bars':
      return singleSeries('bar', 'quarterly_volume', sky);

    // P4 — stacked bar charts
    case 'lease_renewal_rate': {
      // 5-series stack matching the renderer's color scheme
      // (api/_shared/cm-chart-image-renderer.js around line 1602).
      // First Gen (palette nm_pale ish — light), Renewed (PDF.cap_short navy),
      // Succ/Super (palette[2] mid blue), Expired (PDF.cap_mid sky),
      // Terminated (amber #D97706).
      const periodCol = findCol('period_end');
      const seriesDefs = [
        { key: 'first_generation_commencements', color: 'E0E8F4' },  // pale
        { key: 'renewed_leases',                 color: '003DA5' },  // navy
        { key: 'succeeding_superseding_leases',  color: '265AB2' },  // mid blue
        { key: 'expired_leases',                 color: '62B5E5' },  // sky
        { key: 'terminated_leases',              color: 'D97706' },  // amber
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
      return {
        tabName,
        spec: {
          type: 'multi-line',
          tabName,
          catCol: periodCol,
          dataStart, dataEnd,
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
      // 2-series line — NM Average Cap (navy) vs Non-NM Average Cap (sky).
      // Color order from cm-chart-image-renderer.js around line 707:
      // palette[0] navy / palette[1] sky.
      const periodCol = findCol('period_end');
      const nmCol     = findCol('nm_cap_rate');
      const marketCol = findCol('market_cap_rate');
      if (!periodCol || !nmCol || !marketCol) return null;
      return {
        tabName,
        spec: {
          type: 'multi-line',
          tabName,
          catCol: periodCol,
          dataStart, dataEnd,
          series: [
            { titleCol: nmCol,     titleRow: headerRow, valCol: nmCol,     color: navy },
            { titleCol: marketCol, titleRow: headerRow, valCol: marketCol, color: sky  },
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
      return {
        tabName,
        spec: {
          type: 'combo',
          tabName,
          catCol: periodCol,
          dataStart, dataEnd,
          barSeries: [
            { titleCol: domCol, titleRow: headerRow, valCol: domCol, color: sky },
          ],
          lineSeries: [
            { titleCol: pctCol, titleRow: headerRow, valCol: pctCol, color: navy },
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
      return {
        tabName,
        spec: {
          type: 'combo',
          tabName,
          catCol: yearCol,
          dataStart, dataEnd,
          barSeries: [
            { titleCol: cntCol, titleRow: headerRow, valCol: cntCol, color: sky },
          ],
          lineSeries: [
            { titleCol: rentCol, titleRow: headerRow, valCol: rentCol, color: navy },
          ],
          anchor: standardAnchor,
        },
      };
    }

    case 'available_market_size_combo': {
      // 4-series combo: 2 bars (count_total / count_core_10plus) on left
      // axis + 2 lines (avg_cap_total / avg_cap_core_10plus) on right axis.
      // Colors per cm-chart-image-renderer.js line 1294:
      //   count_total         sky    (palette[3])
      //   count_core_10plus   sage   (palette[1])
      //   avg_cap_total       navy   (palette[0])
      //   avg_cap_core_10plus amber  #D97706
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
          barSeries: [
            { titleCol: cntTotCol,  titleRow: headerRow, valCol: cntTotCol,  color: sky    },
            { titleCol: cntCoreCol, titleRow: headerRow, valCol: cntCoreCol, color: '4CB582' },
          ],
          lineSeries: [
            { titleCol: capTotCol,  titleRow: headerRow, valCol: capTotCol,  color: navy   },
            { titleCol: capCoreCol, titleRow: headerRow, valCol: capCoreCol, color: 'D97706' },
          ],
          anchor: standardAnchor,
        },
      };
    }

    // P7 — scatter (xy) charts — one point per data row, no connecting line
    case 'core_cap_rate_dot_plot': {
      // Closed-sale scatter: x = period_end (sale date), y = cap_rate.
      //
      // P7.5 — uses the helper-column infrastructure to add a 12-month
      // rolling-average trendline, matching cm-chart-image-renderer.js
      // around line 2033. For each row, the helper value is the mean of
      // cap_rate over all rows whose period_end falls within ±182 days
      // of the current row's period_end. Plotted as a 2nd scatter series
      // with showLine=true (line, no markers) in navy.
      const xCol = findCol('period_end');
      const yCol = findCol('cap_rate');
      if (!xCol || !yCol) return null;

      // Pre-extract valid (date_ms, cap) pairs so the per-row getValue
      // doesn't keep re-parsing dates from the rows array.
      const SIX_MO_MS = 182 * 24 * 60 * 60 * 1000;
      const validPairs = (rows || [])
        .map(r => {
          const t = r.period_end ? new Date(r.period_end).getTime() : NaN;
          const y = r.cap_rate != null ? Number(r.cap_rate) : NaN;
          return Number.isFinite(t) && Number.isFinite(y) ? { t, y } : null;
        })
        .filter(Boolean);
      const hasTrendData = validPairs.length > 0;

      // Helper column letter lands at cols.length + 1
      const trendCol = String.fromCharCode(65 + cols.length);

      const series = [
        // Dot cloud (sky semi-transparent fill)
        { titleCol: yCol, titleRow: headerRow, xCol, yCol, color: sky },
      ];
      if (hasTrendData) {
        // Trendline (navy connected line, no markers)
        series.push({
          titleCol: trendCol, titleRow: headerRow,
          xCol, yCol: trendCol,
          color: navy,
          showLine: true,
        });
      }

      const result = {
        tabName,
        spec: {
          type: 'scatter',
          tabName,
          dataStart, dataEnd,
          series,
          anchor: standardAnchor,
        },
      };
      if (hasTrendData) {
        result.helperCols = [{
          key: 'trendline_12mo',
          header: '12-mo Rolling Avg',
          format: 'percent_basis_points',
          width: 18,
          getValue: (row) => {
            if (row.period_end == null || row.cap_rate == null) return null;
            const center = new Date(row.period_end).getTime();
            if (!Number.isFinite(center)) return null;
            let sum = 0, n = 0;
            for (const p of validPairs) {
              if (p.t >= center - SIX_MO_MS && p.t <= center + SIX_MO_MS) {
                sum += p.y; n++;
              }
            }
            return n > 0 ? sum / n : null;
          },
        }];
      }
      return result;
    }

    case 'available_cap_rate_dot_plot': {
      // Active-listing scatter: x = firm_term_years, y = cap_rate.
      //
      // P7.5 — uses the helper-column infrastructure to add a linear
      // regression trendline, matching cm-chart-image-renderer.js around
      // line 2109. Compute (m, b) via least-squares ONCE across the rows
      // array; helper getValue is just (m * x + b). The trendline series
      // is plotted as a 2nd scatter series with showLine=true + dashed
      // (matches renderer's borderDash: [6, 4]).
      const xCol = findCol('firm_term_years');
      const yCol = findCol('cap_rate');
      if (!xCol || !yCol) return null;

      // Compute least-squares m, b once.
      const validRows = (rows || []).filter(r =>
        r.cap_rate != null && r.firm_term_years != null
      );
      let m = 0, b = 0;
      if (validRows.length >= 2) {
        let sx = 0, sy = 0, sxx = 0, sxy = 0;
        const n = validRows.length;
        for (const r of validRows) {
          const x = Number(r.firm_term_years);
          const y = Number(r.cap_rate);
          sx += x; sy += y; sxx += x * x; sxy += x * y;
        }
        const denom = n * sxx - sx * sx;
        if (denom !== 0) {
          m = (n * sxy - sx * sy) / denom;
          b = (sy - m * sx) / n;
        }
      }
      const hasTrendData = validRows.length >= 2;

      const trendCol = String.fromCharCode(65 + cols.length);

      const series = [
        { titleCol: yCol, titleRow: headerRow, xCol, yCol, color: sky },
      ];
      if (hasTrendData) {
        series.push({
          titleCol: trendCol, titleRow: headerRow,
          xCol, yCol: trendCol,
          color: navy,
          showLine: true,
          dashed: true,
        });
      }

      const result = {
        tabName,
        spec: {
          type: 'scatter',
          tabName,
          dataStart, dataEnd,
          series,
          anchor: standardAnchor,
        },
      };
      if (hasTrendData) {
        result.helperCols = [{
          key: 'trendline_linear',
          header: 'Linear Trendline',
          format: 'percent_basis_points',
          width: 18,
          getValue: (row) => {
            if (row.firm_term_years == null) return null;
            const x = Number(row.firm_term_years);
            if (!Number.isFinite(x)) return null;
            return m * x + b;
          },
        }];
      }
      return result;
    }

    // P8 — floating-bar / box-whisker family
    case 'bid_ask_spread': {
      // Quarterly bid-ask only carries avg_bid_ask_spread (no last_ask).
      // Renderer falls back to a single-line chart with palette[3] fill;
      // mirror that as a plain line chart in the native version.
      return singleSeries('line', 'avg_bid_ask_spread', navy);
    }

    case 'bid_ask_spread_monthly': {
      // Monthly tab has both avg_last_ask_cap AND avg_bid_ask_spread, so
      // we can build a TRUE floating-bar visual:
      //
      //   Visible band = [last_ask, last_ask + spread]
      //
      // Decompose into a stacked bar where:
      //   • Bottom series (invisible): val = avg_last_ask_cap (last_ask)
      //   • Top series (visible sky):  val = avg_bid_ask_spread (the band width)
      //
      // The total stacked height = last_ask + spread, exactly matching
      // the PDF's floating-bar top. The invisible base hides the bar
      // segment from 0 to last_ask so only the spread band shows.
      //
      // Native Excel can read it as a stacked column chart — users can
      // re-style the bottom series back to visible if they want a
      // stacked-from-zero view instead of the floating band.
      const periodCol  = findCol('period_end');
      const lastAskCol = findCol('avg_last_ask_cap');
      const spreadCol  = findCol('avg_bid_ask_spread');
      if (!periodCol || !lastAskCol || !spreadCol) return null;
      return {
        tabName,
        spec: {
          type: 'stacked-bar',
          tabName,
          catCol: periodCol,
          dataStart, dataEnd,
          series: [
            // Invisible base — gets the chart off 0 up to last_ask
            { titleCol: lastAskCol, titleRow: headerRow, valCol: lastAskCol,
              color: '003DA5', noFill: true },
            // Visible spread band — sky fill, sits on top of the invisible base
            { titleCol: spreadCol,  titleRow: headerRow, valCol: spreadCol,
              color: sky },
          ],
          anchor: standardAnchor,
        },
      };
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
      return {
        tabName,
        spec: {
          type: 'combo',
          tabName,
          catCol: periodCol,
          dataStart, dataEnd,
          swapAxes: true,  // line on LEFT, bars on RIGHT (matches PDF)
          barSeries: [
            // YoY % Change — sky color, no per-point amber treatment
            // (can be added later via <c:dPt> color overrides if needed)
            { titleCol: yoyCol, titleRow: headerRow, valCol: yoyCol,
              color: sky },
          ],
          lineSeries: [
            // Valuation Index — navy line, no markers
            { titleCol: indexCol, titleRow: headerRow, valCol: indexCol,
              color: navy },
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
      return {
        tabName,
        spec: {
          type: 'multi-line',
          tabName, catCol: periodCol, dataStart, dataEnd,
          series: [
            { titleCol: cpiCol,  titleRow: headerRow, valCol: cpiCol,  color: sky  },
            { titleCol: cagrCol, titleRow: headerRow, valCol: cagrCol, color: navy },
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
          series: [
            { titleCol: cashCol,   titleRow: headerRow, valCol: cashCol,   color: navy },
            { titleCol: lvgMidCol, titleRow: headerRow, valCol: lvgMidCol, color: sky  },
          ],
          anchor: standardAnchor,
        },
      };
    }

    case 'asking_cap_quartiles_active': {
      // 4-line: total market (solid) + 10+ year core (dashed), each
      // with upper_q (light blue) and lower_q (dark blue). Colors per
      // cm-chart-image-renderer.js line ~1354 (literal hex, palette-
      // independent so it survives brand-tokens overrides).
      const COLOR_LIGHT_BLUE = '9DC3E6';
      const COLOR_DARK_BLUE  = '1F4E79';
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
          series: [
            { titleCol: upTotCol, titleRow: headerRow, valCol: upTotCol,
              color: COLOR_LIGHT_BLUE },                          // total upper, solid light
            { titleCol: loTotCol, titleRow: headerRow, valCol: loTotCol,
              color: COLOR_DARK_BLUE },                           // total lower, solid dark
            { titleCol: upCorCol, titleRow: headerRow, valCol: upCorCol,
              color: COLOR_LIGHT_BLUE, dashed: true },            // core upper, dashed light
            { titleCol: loCorCol, titleRow: headerRow, valCol: loCorCol,
              color: COLOR_DARK_BLUE, dashed: true },             // core lower, dashed dark
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
      return {
        tabName,
        spec: {
          type: 'combo',
          tabName,
          catCol: periodCol,
          dataStart, dataEnd,
          barSeries:  [{ titleCol: cntCol, titleRow: headerRow, valCol: cntCol, color: sky }],
          lineSeries: [{ titleCol: avgCol, titleRow: headerRow, valCol: avgCol, color: navy }],
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
      return {
        tabName,
        spec: {
          type: 'combo',
          tabName,
          catCol: periodCol,
          dataStart, dataEnd,
          barSeries:  [{ titleCol: rentCol,  titleRow: headerRow, valCol: rentCol,  color: sky  }],
          lineSeries: [{ titleCol: priceCol, titleRow: headerRow, valCol: priceCol, color: navy }],
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
      return {
        tabName,
        spec: {
          type: 'combo',
          tabName,
          catCol: periodCol,
          dataStart, dataEnd,
          barSeries:  [{ titleCol: rentCol,  titleRow: headerRow, valCol: rentCol,  color: sky  }],
          lineSeries: [{ titleCol: priceCol, titleRow: headerRow, valCol: priceCol, color: navy }],
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
      return {
        tabName,
        spec: {
          type: 'combo',
          tabName,
          catCol: periodCol,
          dataStart, dataEnd,
          swapAxes: true,  // lines LEFT, bars RIGHT (PDF p.35/p.22)
          barSeries: [
            { titleCol: barAllCol,  titleRow: headerRow, valCol: barAllCol,  color: '4CB582' },  // sage
            { titleCol: barLongCol, titleRow: headerRow, valCol: barLongCol, color: '7E6BAD' },  // light purple
          ],
          lineSeries: [
            { titleCol: lineAllCol,  titleRow: headerRow, valCol: lineAllCol,  color: navy },
            { titleCol: lineLongCol, titleRow: headerRow, valCol: lineLongCol, color: sky  },
          ],
          anchor: standardAnchor,
        },
      };
    }

    // Clustered bar — multi-bar single-axis (renderer's "line" series
    // isn't in the data tab schema; native plots just the bars).
    case 'inventory_backlog': {
      // 2 bars: No. Added (sky) + No. Sold (navy). Single axis (integer).
      // Renderer uses commonOpts (not comboOpts) — no secondary axis.
      const periodCol = findCol('period_end');
      const addedCol  = findCol('added_ttm');
      const soldCol   = findCol('sold_ttm');
      if (!periodCol || !addedCol || !soldCol) return null;
      return {
        tabName,
        spec: {
          type: 'clustered-bar',
          tabName,
          catCol: periodCol,
          dataStart, dataEnd,
          series: [
            { titleCol: addedCol, titleRow: headerRow, valCol: addedCol, color: sky  },
            { titleCol: soldCol,  titleRow: headerRow, valCol: soldCol,  color: navy },
          ],
          anchor: standardAnchor,
        },
      };
    }

    case 'pace_of_cap_rate_expansion': {
      // 2 bars: pace_all (navy) + pace_core (sky). Renderer also wants
      // a 3rd amber line (pace_cost) but the data tab schema doesn't
      // include it — same pattern as net_lease_spread + fed_funds_vs_treasury.
      // Plot the 2 bars that exist.
      const periodCol = findCol('period_end');
      const allCol    = findCol('pace_all');
      const coreCol   = findCol('pace_core');
      if (!periodCol || !allCol || !coreCol) return null;
      return {
        tabName,
        spec: {
          type: 'clustered-bar',
          tabName,
          catCol: periodCol,
          dataStart, dataEnd,
          series: [
            { titleCol: allCol,  titleRow: headerRow, valCol: allCol,  color: navy },
            { titleCol: coreCol, titleRow: headerRow, valCol: coreCol, color: sky  },
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
          series: [
            { titleCol: privCol, titleRow: headerRow, valCol: privCol, color: navy    },  // Private
            { titleCol: reitCol, titleRow: headerRow, valCol: reitCol, color: blueMid },  // Public REITs
            { titleCol: cbCol,   titleRow: headerRow, valCol: cbCol,   color: sky     },  // Cross-Border
            { titleCol: instCol, titleRow: headerRow, valCol: instCol, color: pale    },  // Institutional
          ],
          anchor: standardAnchor,
        },
      };
    }

    case 'renewal_rent_growth': {
      // R33 Tier D simplified this from a 3-series combo to a single-
      // series bar matching master Excel chart 14 ('Renewal Rent/SF').
      // Sky bars, currency Y-axis. The quartile whisker + CAGR dots
      // were moved to cpi_vs_renewal_cagr in R33 Tier D.
      return singleSeries('bar', 'avg_renewal_rent_psf', sky);
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

      return {
        tabName,
        spec: {
          type: 'combo',
          tabName,
          catCol: periodCol,
          dataStart, dataEnd,
          barGrouping: 'stacked',
          sharedAxis: true,  // band + lines all on the same val axis (0-10%)
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
            { titleCol: capCol,   titleRow: headerRow, valCol: capCol,   color: navy },
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

      return {
        tabName,
        spec: {
          type: 'area-combo',
          tabName,
          catCol: periodCol,
          dataStart, dataEnd,
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
              color: navy, showMarker: true, markerShape: 'circle', markerSize: 5 },
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
          anchor: standardAnchor,
        },
      };
    }

    default:
      return null;
  }
}
