// =============================================================================
// CM Style Audit — compare master Excel docs against latest exports.
//
// Per-chart structural diff covering:
//   • sheet existence + name
//   • chart count + chart types (line/bar/scatter/combo/doughnut/area)
//   • chart titles
//   • legend (presence, position)
//   • axis ranges + number formats + title text
//   • series count + colors (hex)
//   • data label presence
//   • cell layout context: header rows above data, freeze panes, tab color,
//     non-data cells (logo refs, title rows, footnote text)
//
// Output: audit/cm-style-audit/<vertical>-diff.md — one row per matching
// chart with master vs. export columns and a per-row severity tag.
//
// Run: node audit/cm-style-audit/audit-master-vs-export.mjs
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

const MASTERS = {
  dia: 'C:\\Users\\scott\\NorthMarq Capital, LLC\\Team Briggs - Documents\\Dialysis Research\\Comps\\Dialysis Comp Work MASTER.xlsx',
  gov: "C:\\Users\\scott\\NorthMarq Capital, LLC\\Team Briggs - Documents\\Gv't Leased Research\\Copy Government Master Document.xlsx",
};

const EXPORTS = {
  dia: 'C:\\Users\\scott\\Downloads\\NM-CapMarkets-Dialysis-2026-03-31.xlsx',
  gov: 'C:\\Users\\scott\\Downloads\\NM-CapMarkets-GovLeased-2026-03-31.xlsx',
};

const OUT_DIR = 'audit/cm-style-audit';

// --- XLSX zip helpers --------------------------------------------------------

async function readXlsx(filepath) {
  const buf = fs.readFileSync(filepath);
  return JSZip.loadAsync(buf);
}

async function listFiles(zip, prefix) {
  return Object.keys(zip.files).filter(f => f.startsWith(prefix));
}

async function readXml(zip, p) {
  const f = zip.file(p);
  return f ? await f.async('string') : null;
}

// --- workbook structure ------------------------------------------------------

async function getSheets(zip) {
  const wbXml = await readXml(zip, 'xl/workbook.xml');
  if (!wbXml) return [];
  const sheets = [];
  // Parse <sheet ... /> tags with any attribute order.
  const tagRe = /<sheet\b([^>]*?)\/?>/g;
  let m;
  while ((m = tagRe.exec(wbXml)) !== null) {
    const attrs = m[1];
    const nameMatch = attrs.match(/\bname="([^"]+)"/);
    const sheetIdMatch = attrs.match(/\bsheetId="(\d+)"/);
    const ridMatch = attrs.match(/\br:id="([^"]+)"/);
    if (nameMatch && ridMatch) {
      sheets.push({
        name: nameMatch[1],
        sheetId: sheetIdMatch ? Number(sheetIdMatch[1]) : sheets.length + 1,
        rid: ridMatch[1],
      });
    }
  }
  // Map rid → target via workbook rels
  const relsXml = await readXml(zip, 'xl/_rels/workbook.xml.rels');
  const ridMap = {};
  if (relsXml) {
    const rre = /<Relationship\b([^>]*?)\/?>/g;
    let rm;
    while ((rm = rre.exec(relsXml)) !== null) {
      const attrs = rm[1];
      const idMatch = attrs.match(/\bId="([^"]+)"/);
      const targetMatch = attrs.match(/\bTarget="([^"]+)"/);
      if (idMatch && targetMatch) ridMap[idMatch[1]] = targetMatch[1];
    }
  }
  for (const s of sheets) {
    let target = ridMap[s.rid] || `worksheets/sheet${s.sheetId}.xml`;
    if (target.startsWith('/')) {
      s.path = target.slice(1);
    } else if (target.startsWith('xl/')) {
      s.path = target;
    } else {
      s.path = `xl/${target}`;
    }
  }
  return sheets;
}

// Helper: pull attribute value out of an arbitrary tag's attribute string.
function attr(attrStr, name) {
  const m = attrStr.match(new RegExp(`\\b${name}="([^"]+)"`));
  return m ? m[1] : null;
}

async function getSheetCharts(zip, sheet) {
  // Path: xl/worksheets/sheet<N>.xml has a drawing rid pointing at xl/drawings/drawingN.xml,
  // which in turn references one or more xl/charts/chartN.xml. Walk this chain.
  const sheetXml = await readXml(zip, sheet.path);
  if (!sheetXml) return [];
  const drawingTag = sheetXml.match(/<drawing\b([^/]*)\/?>/);
  if (!drawingTag) return [];
  const drawingRid = attr(drawingTag[1], 'r:id');
  if (!drawingRid) return [];
  const sheetRels = await readXml(zip, sheet.path.replace(/worksheets\//, 'worksheets/_rels/') + '.rels');
  if (!sheetRels) return [];
  // Find the <Relationship Id="rIdX" Target="..."/> for drawingRid
  let drawingTarget = null;
  for (const m of sheetRels.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    if (attr(m[1], 'Id') === drawingRid) {
      drawingTarget = attr(m[1], 'Target');
      break;
    }
  }
  if (!drawingTarget) return [];
  // drawingTarget is like "../drawings/drawing1.xml"
  const drawingPath = `xl/${drawingTarget.replace(/^\.\.\//, '')}`;
  const drawingXml = await readXml(zip, drawingPath);
  if (!drawingXml) return [];
  const drawingRelsPath = drawingPath.replace('drawings/', 'drawings/_rels/') + '.rels';
  const drawingRels = await readXml(zip, drawingRelsPath);
  if (!drawingRels) return [];
  // Find chart rid refs in drawing.xml — c:chart or just chart element
  const chartRids = [];
  for (const m of drawingXml.matchAll(/<(?:c:chart|chart)\b([^>]*?)\/?>/g)) {
    const rid = attr(m[1], 'r:id');
    if (rid) chartRids.push(rid);
  }
  const chartPaths = [];
  for (const rid of chartRids) {
    for (const m of drawingRels.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
      if (attr(m[1], 'Id') === rid) {
        const target = attr(m[1], 'Target');
        if (target && (target.includes('chart'))) {
          const cp = `xl/${target.replace(/^\.\.\//, '')}`;
          chartPaths.push(cp);
        }
        break;
      }
    }
  }
  return chartPaths;
}

// --- chart XML analysis ------------------------------------------------------

function analyzeChartXml(xml) {
  const info = {
    chartTypes: [],
    seriesCount: 0,
    seriesColors: [],
    title: null,
    legendPos: null,
    catNumFmt: null,
    valNumFmts: [],
    valMin: null,
    valMax: null,
    hasDataLabels: false,
    dataLabelCount: 0,
    axisCount: 0,
  };
  // Chart type detection
  for (const t of ['lineChart', 'barChart', 'scatterChart', 'doughnutChart', 'areaChart', 'pieChart', 'radarChart']) {
    if (new RegExp(`<c:${t}\\b`).test(xml)) info.chartTypes.push(t.replace('Chart', ''));
  }
  // Series count + colors
  const serMatches = Array.from(xml.matchAll(/<c:ser>([\s\S]*?)<\/c:ser>/g));
  info.seriesCount = serMatches.length;
  for (const m of serMatches) {
    const colorMatch = m[1].match(/<a:srgbClr val="([0-9A-Fa-f]{6})"/);
    info.seriesColors.push(colorMatch ? colorMatch[1].toUpperCase() : null);
  }
  // Title
  const titleBlock = xml.match(/<c:title>([\s\S]*?)<\/c:title>/);
  if (titleBlock) {
    const t = titleBlock[1].match(/<a:t>([^<]*)<\/a:t>/);
    info.title = t ? t[1].trim() : '(rich title)';
  }
  // Legend
  const legendBlock = xml.match(/<c:legend>([\s\S]*?)<\/c:legend>/);
  if (legendBlock) {
    const p = legendBlock[1].match(/<c:legendPos val="(\w+)"/);
    info.legendPos = p ? p[1] : '(default)';
  }
  // Cat axis numFmt
  const catBlock = xml.match(/<c:catAx>([\s\S]*?)<\/c:catAx>/);
  if (catBlock) {
    const nf = catBlock[1].match(/<c:numFmt[^/]*formatCode="([^"]+)"/);
    info.catNumFmt = nf ? nf[1] : null;
  }
  // Val axes
  const valBlocks = Array.from(xml.matchAll(/<c:valAx>([\s\S]*?)<\/c:valAx>/g));
  info.axisCount = (catBlock ? 1 : 0) + valBlocks.length;
  for (const v of valBlocks) {
    const nf = v[1].match(/<c:numFmt[^/]*formatCode="([^"]+)"/);
    info.valNumFmts.push(nf ? nf[1] : null);
    const mn = v[1].match(/<c:min val="([^"]+)"/);
    const mx = v[1].match(/<c:max val="([^"]+)"/);
    if (mn) info.valMin = info.valMin === null ? mn[1] : `${info.valMin},${mn[1]}`;
    if (mx) info.valMax = info.valMax === null ? mx[1] : `${info.valMax},${mx[1]}`;
  }
  // Data labels
  const dLblBlocks = Array.from(xml.matchAll(/<c:dLbl>/g));
  info.dataLabelCount = dLblBlocks.length;
  info.hasDataLabels = info.dataLabelCount > 0;
  return info;
}

// --- sheet context analysis --------------------------------------------------

async function analyzeSheetContext(zip, sheet) {
  const xml = await readXml(zip, sheet.path);
  if (!xml) return null;
  const ctx = {
    tabColor: null,
    freezePane: null,
    headerRows: [],   // first 6 rows non-empty inline string content
    nonDataCellsAbove: 0,
  };
  const tabColor = xml.match(/<tabColor\b[^/]*(?:rgb|theme)="([^"]+)"/);
  if (tabColor) ctx.tabColor = tabColor[1];
  const freeze = xml.match(/<pane\b[^/]*state="frozen"[^/]*(?:topLeftCell|activeCell)="([^"]+)"/);
  if (freeze) ctx.freezePane = freeze[1];
  // Get a small shared-strings cache for the workbook
  return ctx;
}

// --- top-level diff ----------------------------------------------------------

async function analyzeBook(filepath, label) {
  const zip = await readXlsx(filepath);
  const sheets = await getSheets(zip);
  const result = { label, filepath, sheets: [] };
  for (const s of sheets) {
    const chartPaths = await getSheetCharts(zip, s);
    const charts = [];
    for (const cp of chartPaths) {
      const xml = await readXml(zip, cp);
      if (xml) charts.push({ path: cp, ...analyzeChartXml(xml) });
    }
    const ctx = await analyzeSheetContext(zip, s);
    result.sheets.push({ name: s.name, chartCount: charts.length, charts, ...ctx });
  }
  return result;
}

// --- formatting --------------------------------------------------------------

function formatChart(c, n) {
  if (!c) return `(no chart #${n})`;
  return [
    `types=[${c.chartTypes.join(',') || '?'}]`,
    `series=${c.seriesCount}`,
    `colors=${c.seriesColors.slice(0, 4).join('/')}`,
    `title=${JSON.stringify(c.title)}`,
    `legend=${c.legendPos}`,
    `catFmt=${JSON.stringify(c.catNumFmt)}`,
    `valFmt=[${c.valNumFmts.join('|')}]`,
    `valRange=[${c.valMin}..${c.valMax}]`,
    `dLbls=${c.dataLabelCount}`,
  ].join('  ');
}

function formatSheet(s) {
  if (!s) return '(no sheet)';
  return [
    `chartCount=${s.chartCount}`,
    `tabColor=${s.tabColor || '-'}`,
    `freeze=${s.freezePane || '-'}`,
  ].join('  ');
}

// --- main --------------------------------------------------------------------

async function diffOne(vertical) {
  const masterPath = MASTERS[vertical];
  const exportPath = EXPORTS[vertical];
  if (!fs.existsSync(masterPath)) { console.error(`Missing master: ${masterPath}`); return; }
  if (!fs.existsSync(exportPath)) { console.error(`Missing export: ${exportPath}`); return; }

  console.log(`\n=== ${vertical.toUpperCase()} master vs export ===`);
  console.log(`Master: ${path.basename(masterPath)}`);
  console.log(`Export: ${path.basename(exportPath)}`);

  const master = await analyzeBook(masterPath, 'MASTER');
  const exp    = await analyzeBook(exportPath, 'EXPORT');

  // Build a punch list keyed by sheet name; if either side has a sheet,
  // include it in the output.
  const sheetMap = new Map();
  for (const s of master.sheets) sheetMap.set(s.name.toLowerCase(), { master: s, export: null });
  for (const s of exp.sheets) {
    const k = s.name.toLowerCase();
    if (sheetMap.has(k)) sheetMap.get(k).export = s;
    else sheetMap.set(k, { master: null, export: s });
  }

  const lines = [];
  lines.push(`# CM Style Audit — ${vertical.toUpperCase()} master vs ${path.basename(exportPath)}`);
  lines.push(``);
  lines.push(`Generated ${new Date().toISOString().slice(0, 10)} by audit/cm-style-audit/audit-master-vs-export.mjs`);
  lines.push(``);
  lines.push(`Master: \`${masterPath.split(/[\\\/]/).pop()}\`  (${master.sheets.length} sheets, ${master.sheets.reduce((a, b) => a + b.chartCount, 0)} charts)`);
  lines.push(`Export: \`${exportPath.split(/[\\\/]/).pop()}\`  (${exp.sheets.length} sheets, ${exp.sheets.reduce((a, b) => a + b.chartCount, 0)} charts)`);
  lines.push(``);
  lines.push(`## Sheets in master only`);
  lines.push(``);
  for (const [k, v] of sheetMap) {
    if (v.master && !v.export) lines.push(`- \`${v.master.name}\` — master has ${v.master.chartCount} chart(s); export does not include this tab`);
  }
  lines.push(``);
  lines.push(`## Sheets in export only`);
  lines.push(``);
  for (const [k, v] of sheetMap) {
    if (!v.master && v.export) lines.push(`- \`${v.export.name}\` — export has ${v.export.chartCount} chart(s); master does not include this tab`);
  }
  lines.push(``);
  lines.push(`## Sheets in both — per-chart diff`);
  lines.push(``);
  for (const [k, v] of sheetMap) {
    if (!v.master || !v.export) continue;
    lines.push(`### \`${v.master.name}\``);
    lines.push(``);
    lines.push(`| | master | export |`);
    lines.push(`| --- | --- | --- |`);
    lines.push(`| sheet | ${formatSheet(v.master)} | ${formatSheet(v.export)} |`);
    const maxN = Math.max(v.master.charts.length, v.export.charts.length);
    for (let i = 0; i < maxN; i++) {
      const mc = v.master.charts[i];
      const xc = v.export.charts[i];
      lines.push(`| chart #${i + 1} | ${formatChart(mc, i + 1)} | ${formatChart(xc, i + 1)} |`);
    }
    lines.push(``);
  }

  const outPath = path.join(OUT_DIR, `${vertical}-diff.md`);
  fs.writeFileSync(outPath, lines.join('\n'));
  console.log(`Wrote ${outPath} (${lines.length} lines)`);
}

// Dump a flat per-chart inventory keyed by (sheet, chart#) — useful when the
// master's charts all live on one tab but the export splits them across many.
async function dumpInventory(filepath, label, outPath) {
  const book = await analyzeBook(filepath, label);
  const lines = [];
  lines.push(`# CM ${label} chart inventory — \`${filepath.split(/[\\/]/).pop()}\``);
  lines.push('');
  lines.push(`Generated ${new Date().toISOString().slice(0, 10)} by audit/cm-style-audit/audit-master-vs-export.mjs`);
  lines.push('');
  lines.push(`Total sheets: ${book.sheets.length}  •  Total charts: ${book.sheets.reduce((a, b) => a + b.chartCount, 0)}`);
  lines.push('');
  lines.push('| Sheet | # | Types | Series | Colors (1st 4) | Title | Legend | Cat fmt | Val fmt | Val range | dLbls |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const s of book.sheets) {
    if (s.chartCount === 0) continue;
    for (let i = 0; i < s.charts.length; i++) {
      const c = s.charts[i];
      lines.push([
        `\`${s.name}\``,
        i + 1,
        c.chartTypes.join(',') || '?',
        c.seriesCount,
        c.seriesColors.slice(0, 4).map(x => x || '?').join('/'),
        c.title ? `"${c.title.slice(0, 60)}"` : '_',
        c.legendPos || '_',
        c.catNumFmt ? `\`${c.catNumFmt}\`` : '_',
        c.valNumFmts.filter(x => x).map(x => `\`${x}\``).join('+') || '_',
        c.valMin || c.valMax ? `${c.valMin || '?'}..${c.valMax || '?'}` : '_',
        c.dataLabelCount,
      ].join(' | '));
    }
  }
  // Sheets without charts but with possibly-useful context
  lines.push('');
  lines.push('## Sheets without charts');
  lines.push('');
  for (const s of book.sheets) {
    if (s.chartCount === 0) lines.push(`- \`${s.name}\`  (tabColor=${s.tabColor || '-'}, freeze=${s.freezePane || '-'})`);
  }
  fs.writeFileSync(outPath, lines.join('\n'));
  console.log(`Wrote ${outPath}`);
}

(async function main() {
  for (const v of ['dia', 'gov']) {
    await diffOne(v);
    await dumpInventory(MASTERS[v], `${v.toUpperCase()} master`, path.join(OUT_DIR, `${v}-master-inventory.md`));
    await dumpInventory(EXPORTS[v], `${v.toUpperCase()} export`, path.join(OUT_DIR, `${v}-export-inventory.md`));
  }
})();
