// Verify R37-R41 features landed correctly in the fresh exports.
// For each chart XML in the workbook, check presence of:
//   R37 P1 — quarter-format cat axis (q"Q-"yyyy)
//   R37 P2 — val axis range pinning + non-bare number format
//   R37 P3 — <c:dLbl> data labels (peak/trough/most-recent)
//   R38 A  — <c:title> with rich text
//   R38 B  — [Red] negative idiom on val format
//   R38 C  — donut legend "b" (bottom) where applicable
//   R39    — <c:trendline> on scatter charts (Excel-native, not helper-col)
//   R41    — <c:majorGridlines> on val axes
//   R41    — <c:roundedCorners val="0"/> on chart wrapper
//   R41    — NM-navy tab color on Data_* worksheets
//
// Output: per-chart pass/fail/N-A grid + summary count.

import fs from 'node:fs';
import JSZip from 'jszip';

const EXPORTS = {
  dia: 'C:/Users/scott/Downloads/NM-CapMarkets-Dialysis-2026-03-31 (1).xlsx',
  gov: 'C:/Users/scott/Downloads/NM-CapMarkets-GovLeased-2026-03-31 (1).xlsx',
};

function attr(s, name) {
  const m = s.match(new RegExp(`\\b${name}="([^"]+)"`));
  return m ? m[1] : null;
}

async function getSheetMap(zip) {
  const wb = await zip.file('xl/workbook.xml').async('string');
  const wbRels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const ridToTarget = {};
  for (const m of wbRels.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const id = attr(m[1], 'Id'); const target = attr(m[1], 'Target');
    if (id && target) ridToTarget[id] = target;
  }
  const sheets = [];
  for (const m of wb.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    const name = attr(m[1], 'name'); const rid = attr(m[1], 'r:id');
    if (!name || !rid) continue;
    const target = ridToTarget[rid];
    if (!target) continue;
    sheets.push({ name, path: target.startsWith('xl/') ? target : `xl/${target}` });
  }
  return sheets;
}

async function chartsForSheet(zip, sheet) {
  const sheetXml = await zip.file(sheet.path).async('string');
  const drawingTag = sheetXml.match(/<drawing\b([^>]*?)\/?>/);
  if (!drawingTag) return [];
  const drawingRid = attr(drawingTag[1], 'r:id');
  const sheetRels = await zip.file(sheet.path.replace('worksheets/', 'worksheets/_rels/') + '.rels').async('string');
  let drawingTarget = null;
  for (const m of sheetRels.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    if (attr(m[1], 'Id') === drawingRid) drawingTarget = attr(m[1], 'Target');
  }
  if (!drawingTarget) return [];
  const drawingPath = `xl/${drawingTarget.replace(/^\.\.\//, '')}`;
  const drawingXml = await zip.file(drawingPath).async('string');
  const drawingRelsPath = drawingPath.replace('drawings/', 'drawings/_rels/') + '.rels';
  const drawingRels = await zip.file(drawingRelsPath).async('string');
  const chartPaths = [];
  for (const m of drawingXml.matchAll(/<(?:c:chart|chart)\b([^>]*?)\/?>/g)) {
    const rid = attr(m[1], 'r:id');
    if (!rid) continue;
    for (const r of drawingRels.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
      if (attr(r[1], 'Id') === rid) {
        const t = attr(r[1], 'Target');
        if (t && t.includes('chart')) chartPaths.push(`xl/${t.replace(/^\.\.\//, '')}`);
      }
    }
  }
  return chartPaths;
}

async function audit(label, path) {
  const buf = fs.readFileSync(path);
  const zip = await JSZip.loadAsync(buf);
  const sheets = await getSheetMap(zip);
  const dataSheets = sheets.filter(s => s.name.startsWith('Data_'));
  const tally = {
    R37_P1_quarter_cat: 0, R37_P1_total: 0,
    R37_P2_range: 0, R37_P2_total: 0,
    R37_P2_fmt: 0,
    R37_P3_dLbls: 0, R37_P3_total: 0,
    R38_title: 0, R38_total: 0,
    R38_red_fmt: 0,
    R38_donut_b: 0, R38_donut_total: 0,
    R39_trendline: 0, R39_total: 0,
    R41_roundedCorners: 0, R41_total: 0,
    R41_gridlines: 0,
    R41_tab_color: 0, R41_tab_total: 0,
  };
  const issues = [];

  // Tab-color check
  for (const s of dataSheets) {
    tally.R41_tab_total++;
    const sx = await zip.file(s.path).async('string');
    if (/<tabColor\b/.test(sx)) tally.R41_tab_color++;
    else issues.push(`${s.name}: no tabColor`);
  }

  // Per-chart checks
  for (const s of dataSheets) {
    const chartPaths = await chartsForSheet(zip, s);
    for (const cp of chartPaths) {
      const xml = await zip.file(cp).async('string');
      tally.R37_P1_total++;
      tally.R37_P2_total++;
      tally.R37_P3_total++;
      tally.R38_total++;
      tally.R41_total++;
      // R37 P1 — quarter cat axis (skip horizontal-bar / pure scatter / donut)
      const hasCatAx = /<c:catAx>/.test(xml);
      if (hasCatAx) {
        if (/q&quot;Q-&quot;yyyy/.test(xml) || /<c:catAx>[\s\S]*?numFmt formatCode="0"/.test(xml) ||
            /barDir val="bar"/.test(xml)) {
          tally.R37_P1_quarter_cat++;
        } else {
          // Cat axis present but no quarter format — could be year-axis or text axis
          const catBlock = xml.match(/<c:catAx>[\s\S]*?<\/c:catAx>/)[0];
          if (/<c:numFmt/.test(catBlock)) tally.R37_P1_quarter_cat++;
          else issues.push(`${s.name} chart: cat axis has no numFmt`);
        }
      }
      // R37 P2 — val axis pinning
      const valBlocks = Array.from(xml.matchAll(/<c:valAx>[\s\S]*?<\/c:valAx>/g));
      const anyMinMax = valBlocks.some(b => /<c:min val=|<c:max val=/.test(b[0]));
      const anyValFmt = valBlocks.some(b => /<c:numFmt/.test(b[0]));
      if (anyMinMax) tally.R37_P2_range++;
      if (anyValFmt) tally.R37_P2_fmt++;
      // R37 P3 — data labels
      if (/<c:dLbl>/.test(xml)) tally.R37_P3_dLbls++;
      // R38 A — title
      if (/<c:title>/.test(xml)) tally.R38_title++;
      else issues.push(`${s.name} chart: NO TITLE`);
      // R38 B — [Red] format
      if (xml.includes('[Red]')) tally.R38_red_fmt++;
      // R38 C — donut legend "b"
      if (/<c:doughnutChart>/.test(xml)) {
        tally.R38_donut_total++;
        if (/<c:legendPos val="b"\/>/.test(xml)) tally.R38_donut_b++;
        else issues.push(`${s.name} donut: legend not at bottom`);
      }
      // R39 — scatter trendline
      if (/<c:scatterChart>/.test(xml)) {
        tally.R39_total++;
        if (/<c:trendline>/.test(xml)) tally.R39_trendline++;
        else issues.push(`${s.name} scatter: NO TRENDLINE`);
      }
      // R41 — roundedCorners + gridlines
      if (/<c:roundedCorners val="0"\/>/.test(xml)) tally.R41_roundedCorners++;
      else issues.push(`${s.name} chart: NO roundedCorners=0`);
      if (/<c:majorGridlines>/.test(xml)) tally.R41_gridlines++;
      else issues.push(`${s.name} chart: NO majorGridlines`);
    }
  }

  console.log(`\n=== ${label.toUpperCase()} ===`);
  console.log(`File: ${path.split('/').pop()}`);
  console.log(`Data_* tabs: ${dataSheets.length}`);
  const fmt = (n, d) => `${n}/${d}  ${d > 0 ? Math.round(100 * n / d) + '%' : '-'}`;
  console.log(`\n  R37 P1 quarter cat axis  : ${fmt(tally.R37_P1_quarter_cat, tally.R37_P1_total)}`);
  console.log(`  R37 P2 val range pinned  : ${fmt(tally.R37_P2_range, tally.R37_P2_total)}`);
  console.log(`  R37 P2 val numFmt set    : ${fmt(tally.R37_P2_fmt, tally.R37_P2_total)}`);
  console.log(`  R37 P3 data labels (any) : ${fmt(tally.R37_P3_dLbls, tally.R37_P3_total)}`);
  console.log(`  R38 A chart title        : ${fmt(tally.R38_title, tally.R38_total)}`);
  console.log(`  R38 B [Red] negatives    : ${fmt(tally.R38_red_fmt, tally.R38_total)}`);
  console.log(`  R38 C donut legend bottom: ${fmt(tally.R38_donut_b, tally.R38_donut_total)}`);
  console.log(`  R39 scatter trendline    : ${fmt(tally.R39_trendline, tally.R39_total)}`);
  console.log(`  R41 roundedCorners=0     : ${fmt(tally.R41_roundedCorners, tally.R41_total)}`);
  console.log(`  R41 majorGridlines       : ${fmt(tally.R41_gridlines, tally.R41_total)}`);
  console.log(`  R41 tab color (Data_*)   : ${fmt(tally.R41_tab_color, tally.R41_tab_total)}`);

  if (issues.length > 0) {
    console.log(`\n  ISSUES (${issues.length}):`);
    for (const i of issues.slice(0, 30)) console.log(`    • ${i}`);
    if (issues.length > 30) console.log(`    ... +${issues.length - 30} more`);
  }
  return tally;
}

for (const [label, path] of Object.entries(EXPORTS)) {
  await audit(label, path);
}
