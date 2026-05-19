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
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${NS_CHART}" xmlns:a="${NS_DRAWINGML}" xmlns:r="${NS_REL}">
  <c:chart>
    <c:autoTitleDeleted val="1"/>
    <c:plotArea>
      <c:layout/>
      <c:barChart>
        <c:barDir val="col"/>
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
    return `        <c:ser>
          <c:idx val="${i}"/>
          <c:order val="${i}"/>
          <c:tx><c:strRef><c:f>'${sheet}'!$${s.titleCol}$${s.titleRow}</c:f></c:strRef></c:tx>
          <c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr>
          <c:cat><c:numRef><c:f>'${sheet}'!$${spec.catCol}$${spec.dataStart}:$${spec.catCol}$${spec.dataEnd}</c:f></c:numRef></c:cat>
          <c:val><c:numRef><c:f>'${sheet}'!$${s.valCol}$${spec.dataStart}:$${s.valCol}$${spec.dataEnd}</c:f></c:numRef></c:val>
        </c:ser>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${NS_CHART}" xmlns:a="${NS_DRAWINGML}" xmlns:r="${NS_REL}">
  <c:chart>
    <c:autoTitleDeleted val="1"/>
    <c:plotArea>
      <c:layout/>
      <c:barChart>
        <c:barDir val="col"/>
        <c:grouping val="stacked"/>
        <c:varyColors val="0"/>
${seriesXml}
        <c:gapWidth val="60"/>
        <c:overlap val="100"/>
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
 * @param {Array}  spec.barSeries     List of { titleCol, titleRow, valCol, color }
 * @param {Array}  spec.lineSeries    List of { titleCol, titleRow, valCol, color }
 * @returns {string} chart XML
 */
function buildComboChartXml(spec) {
  const sheet = escapeXml(spec.tabName);
  const barSeries = spec.barSeries || [];
  const lineSeries = spec.lineSeries || [];

  const barXml = barSeries.map((s, i) => {
    const color = (s.color || '003DA5').replace('#', '');
    return `        <c:ser>
          <c:idx val="${i}"/>
          <c:order val="${i}"/>
          <c:tx><c:strRef><c:f>'${sheet}'!$${s.titleCol}$${s.titleRow}</c:f></c:strRef></c:tx>
          <c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr>
          <c:cat><c:numRef><c:f>'${sheet}'!$${spec.catCol}$${spec.dataStart}:$${spec.catCol}$${spec.dataEnd}</c:f></c:numRef></c:cat>
          <c:val><c:numRef><c:f>'${sheet}'!$${s.valCol}$${spec.dataStart}:$${s.valCol}$${spec.dataEnd}</c:f></c:numRef></c:val>
        </c:ser>`;
  }).join('\n');

  // Line series idx continues from where bar series ended so each
  // series in the chart has a unique index (Excel relies on this).
  const lineXml = lineSeries.map((s, i) => {
    const idx = barSeries.length + i;
    const color = (s.color || '003DA5').replace('#', '');
    return `        <c:ser>
          <c:idx val="${idx}"/>
          <c:order val="${idx}"/>
          <c:tx><c:strRef><c:f>'${sheet}'!$${s.titleCol}$${s.titleRow}</c:f></c:strRef></c:tx>
          <c:spPr>
            <a:ln w="22225" cap="rnd"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:round/></a:ln>
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
        <c:grouping val="clustered"/>
        <c:varyColors val="0"/>
${barXml}
        <c:gapWidth val="60"/>
        <c:overlap val="-20"/>
        <c:axId val="1"/>
        <c:axId val="2"/>
      </c:barChart>
      <c:lineChart>
        <c:grouping val="standard"/>
        <c:varyColors val="0"/>
${lineXml}
        <c:marker val="0"/>
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
    // Marker shape: filled circle, no border emphasis (mirrors
    // chart.js pointStyle:'circle' + pointRadius:3 from the renderer).
    // <c:size val="5"/> ≈ pointRadius 3-4 in pixels. <c:symbol val="circle"/>.
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
    } else if (spec.type === 'bar') {
      chartXml = buildSingleBarChartXml(spec);
    } else if (spec.type === 'multi-line') {
      chartXml = buildMultiLineChartXml(spec);
    } else if (spec.type === 'combo') {
      chartXml = buildComboChartXml(spec);
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
  // Deferred: rent_by_year_built (whisker+median+avg composite — needs
  //   floating-bar builder, same family as bid_ask_spread). P8 candidate.
  // Deferred: trendlines on the cap-rate dot plots (12-mo rolling avg /
  //   linear regression). The renderer computes them in JS from the
  //   data; native chart needs the trendline values pre-computed into
  //   helper columns on the data tab. Plumbing for P7.5.
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
      // Renderer also adds a 12-mo rolling-avg trendline (computed in JS),
      // but that requires a derived helper column on the data tab —
      // deferred. Native chart shows just the dot cloud.
      const xCol = findCol('period_end');
      const yCol = findCol('cap_rate');
      if (!xCol || !yCol) return null;
      return {
        tabName,
        spec: {
          type: 'scatter',
          tabName,
          dataStart, dataEnd,
          series: [{
            titleCol: yCol, titleRow: headerRow,
            xCol, yCol,
            color: sky,  // sky w/ alpha — matches renderer rgba(98,181,229,0.55)
          }],
          anchor: standardAnchor,
        },
      };
    }

    case 'available_cap_rate_dot_plot': {
      // Active-listing scatter: x = firm_term_years, y = cap_rate.
      // Renderer adds a linear regression trendline — deferred (see
      // core_cap_rate_dot_plot above).
      const xCol = findCol('firm_term_years');
      const yCol = findCol('cap_rate');
      if (!xCol || !yCol) return null;
      return {
        tabName,
        spec: {
          type: 'scatter',
          tabName,
          dataStart, dataEnd,
          series: [{
            titleCol: yCol, titleRow: headerRow,
            xCol, yCol,
            color: sky,
          }],
          anchor: standardAnchor,
        },
      };
    }

    default:
      return null;
  }
}
