// R53 diagnostic — inspect the fresh export to confirm:
//  • tenant donut drawings present
//  • all chart cat-axis numFmts (expect "qQ-yyyy" literal text bug)
//  • count of broken cat axes
// Run from repo root: node audit/cm-style-audit/R53-peek-export.mjs
import fs from 'node:fs';
import JSZip from 'jszip';

const EXPORT = 'C:/Users/scott/Downloads/NM-CapMarkets-Dialysis-2026-03-31.xlsx';
const zip = await JSZip.loadAsync(fs.readFileSync(EXPORT));

// Sheet → drawing diagnostic
const wbXml = await zip.file('xl/workbook.xml').async('string');
const wbRelsXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');
const rels = {};
for (const m of wbRelsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) rels[m[1]] = m[2];
const sheetMap = [...wbXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)];

console.log('===== TENANT TABS =====');
for (const m of sheetMap) {
  const name = m[1], rid = m[2];
  if (!/Tenant/i.test(name)) continue;
  const sheetPath = 'xl/' + rels[rid];
  const sx = await zip.file(sheetPath).async('string');
  const drawingMatch = sx.match(/<drawing\s+r:id="([^"]+)"\s*\/>/);
  const sheetRelsPath = sheetPath.replace(/^xl\/(.*?)\/([^/]+)$/, 'xl/$1/_rels/$2.rels');
  let drawingTargets = '(no sheet rels)';
  const srf = zip.file(sheetRelsPath);
  if (srf) {
    const rx = await srf.async('string');
    const drels = [...rx.matchAll(/<Relationship[^>]*Type="[^"]*drawing[^"]*"[^>]*Target="([^"]+)"/g)];
    drawingTargets = drels.map(m => m[1]).join(',') || '(no drawing rels)';
  }
  console.log(`${name.padEnd(28)} drawingTag: ${drawingMatch ? drawingMatch[1] : 'NONE   '}  drawingTargets: ${drawingTargets}`);
}

// All chart cat-axis numFmts
console.log('\n===== CHART CAT-AXIS NUMFMTS =====');
const chartFiles = Object.keys(zip.files).filter(f => /^xl\/charts\/chart\d+\.xml$/.test(f)).sort((a, b) => {
  const an = parseInt(a.match(/chart(\d+)/)[1], 10);
  const bn = parseInt(b.match(/chart(\d+)/)[1], 10);
  return an - bn;
});
let qQbroken = 0;
for (const cf of chartFiles) {
  const xml = await zip.file(cf).async('string');
  // catAx numFmt is the FIRST numFmt in the file (cat axis comes before val axes)
  // More precisely, find the catAx block then its numFmt
  const catAxBlock = xml.match(/<c:catAx>[\s\S]*?<\/c:catAx>/);
  if (!catAxBlock) {
    console.log(`${cf}: (no catAx — likely scatter)`);
    continue;
  }
  const numFmt = catAxBlock[0].match(/<c:numFmt[^>]*formatCode="([^"]+)"/);
  const fmt = numFmt ? numFmt[1] : '(no numFmt)';
  if (fmt.includes('q&quot;Q-&quot;')) qQbroken++;
  console.log(`${cf}: catAx numFmt = ${fmt}`);
}
console.log(`\n${qQbroken} of ${chartFiles.length} charts use the broken q"Q-"yyyy literal format.`);
