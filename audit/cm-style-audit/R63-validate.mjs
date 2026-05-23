// R63 — comprehensive diagnostic on fresh post-R62 export:
//  • re-run R61 valAx schema-order validator
//  • check catAx text-rotation / alignment settings
//  • verify tenant donut data is still populated
//  • check Volume_TTM data labels presence
import fs from 'node:fs';
import JSZip from 'jszip';

const EXPORT = 'C:/Users/scott/Downloads/NM-CapMarkets-Dialysis-2026-03-31.xlsx';
const zip = await JSZip.loadAsync(fs.readFileSync(EXPORT));

// ---- 1. Re-run valAx schema-order check
const VAL_AX_ORDER = ['c:axId','c:scaling','c:delete','c:axPos','c:majorGridlines','c:minorGridlines','c:title','c:numFmt','c:majorTickMark','c:minorTickMark','c:tickLblPos','c:spPr','c:txPr','c:crossAx','c:crosses','c:crossesAt','c:crossBetween','c:majorUnit','c:minorUnit','c:dispUnits','c:extLst'];

function getChildren(inner) {
  const out = [];
  let depth = 0, pos = 0;
  while (pos < inner.length) {
    const ts = inner.indexOf('<', pos);
    if (ts === -1) break;
    const te = inner.indexOf('>', ts);
    const tag = inner.substring(ts + 1, te);
    const isClose = tag.startsWith('/');
    const isSelf = tag.endsWith('/');
    const name = tag.replace(/^\//, '').replace(/\/$/, '').split(/\s/)[0];
    if (depth === 0 && !isClose) out.push(name);
    if (!isSelf && !isClose) depth++;
    else if (isClose) depth--;
    pos = te + 1;
  }
  return out;
}

const chartFiles = Object.keys(zip.files).filter(f => /^xl\/charts\/chart\d+\.xml$/.test(f)).sort();
const valAxIssues = [];
const catAxRotations = new Set();
for (const cf of chartFiles) {
  const xml = await zip.file(cf).async('string');
  // valAx order check
  const blocks = xml.match(/<c:valAx>([\s\S]*?)<\/c:valAx>/g) || [];
  for (const b of blocks) {
    const inner = b.replace(/^<c:valAx>/, '').replace(/<\/c:valAx>$/, '');
    const kids = getChildren(inner);
    let lastIdx = -1;
    for (const k of kids) {
      const idx = VAL_AX_ORDER.indexOf(k);
      if (idx === -1) continue;
      if (idx < lastIdx) { valAxIssues.push(`${cf}: <${k}> AFTER higher-order sibling`); break; }
      lastIdx = idx;
    }
  }
  // catAx text rotation
  const catAx = xml.match(/<c:catAx>[\s\S]*?<\/c:catAx>/);
  if (catAx) {
    const rotMatch = catAx[0].match(/<a:bodyPr[^>]*rot="(-?\d+)"/);
    catAxRotations.add(rotMatch ? rotMatch[1] : 'none');
  }
}
console.log('===== R61 valAx schema-order check =====');
console.log(`Total issues: ${valAxIssues.length}`);
for (const i of valAxIssues.slice(0, 5)) console.log('  ' + i);

console.log('\n===== catAx text rotations seen =====');
console.log('Distinct: ' + [...catAxRotations].join(', '));
console.log('("none" means no explicit <a:bodyPr rot=...> — Excel auto-rotates when labels overflow)');

// ---- 2. Tenant donut data still present?
console.log('\n===== Tenant donut tabs =====');
const wbXml = await zip.file('xl/workbook.xml').async('string');
const wbRelsXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');
const rels = {};
for (const m of wbRelsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) rels[m[1]] = m[2];
for (const tab of ['Data_Avail_Tenant_CountD', 'Data_Avail_Tenant_VolD']) {
  const sm = wbXml.match(new RegExp(`<sheet[^>]*name="${tab}"[^>]*r:id="([^"]+)"`));
  if (!sm) { console.log(`${tab}: TAB MISSING from workbook`); continue; }
  const sheetPath = 'xl/' + rels[sm[1]];
  const sx = await zip.file(sheetPath).async('string');
  const rowCount = (sx.match(/<row /g) || []).length;
  const hasDrawing = /<drawing\s+r:id="[^"]+"/.test(sx);
  console.log(`${tab}: rows=${rowCount}, drawing=${hasDrawing}`);
}

// ---- 3. Volume_TTM dLbls
console.log('\n===== Volume_TTM data labels =====');
const volTab = wbXml.match(/<sheet[^>]*name="Data_Volume_TTM"[^>]*r:id="([^"]+)"/);
if (volTab) {
  const sheetPath = 'xl/' + rels[volTab[1]];
  const sheetRelsPath = sheetPath.replace(/^xl\/(.*?)\/([^/]+)$/, 'xl/$1/_rels/$2.rels');
  const rx = await zip.file(sheetRelsPath).async('string');
  const drawTarget = rx.match(/Target="(\.\.\/drawings\/[^"]+)"/)?.[1];
  if (drawTarget) {
    const drawPath = 'xl/drawings/' + drawTarget.replace(/^.*\//, '');
    const drawRelsPath = drawPath.replace(/^xl\/drawings\/(.*)$/, 'xl/drawings/_rels/$1.rels');
    const drx = await zip.file(drawRelsPath).async('string');
    const chartTarget = drx.match(/Target="(\.\.\/charts\/[^"]+)"/)?.[1];
    const chartPath = 'xl/charts/' + chartTarget.replace(/^.*\//, '');
    const xml = await zip.file(chartPath).async('string');
    const dLblCount = (xml.match(/<c:dLbl>/g) || []).length;
    const dLblsBlock = xml.match(/<c:dLbls>[\s\S]*?<\/c:dLbls>/g) || [];
    console.log(`Data_Volume_TTM (${chartPath}): dLbl count=${dLblCount}, dLbls blocks=${dLblsBlock.length}`);
    if (dLblCount === 0) console.log('  → MISSING peak/trough/last annotations');
    // Check yAxis format
    const valAx = xml.match(/<c:valAx>[\s\S]*?<\/c:valAx>/);
    if (valAx) {
      const fmt = valAx[0].match(/<c:numFmt[^>]*formatCode="([^"]+)"/);
      console.log(`  yAxis numFmt: ${fmt?.[1] || '(none)'}`);
    }
  }
}
