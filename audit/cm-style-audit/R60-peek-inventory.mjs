import fs from 'node:fs';
import JSZip from 'jszip';
const EXPORT = 'C:/Users/scott/Downloads/NM-CapMarkets-Dialysis-2026-03-31 (1).xlsx';
const zip = await JSZip.loadAsync(fs.readFileSync(EXPORT));
const wbXml = await zip.file('xl/workbook.xml').async('string');
const wbRelsXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');
const rels = {};
for (const m of wbRelsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) rels[m[1]] = m[2];
const sm = wbXml.match(/<sheet[^>]*name="Data_Inventory_Backlog"[^>]*r:id="([^"]+)"/);
const sheetPath = 'xl/' + rels[sm[1]];
const sheetRelsPath = sheetPath.replace(/^xl\/(.*?)\/([^/]+)$/, 'xl/$1/_rels/$2.rels');
const rx = await zip.file(sheetRelsPath).async('string');
const drawTarget = rx.match(/Target="(\.\.\/drawings\/[^"]+)"/)?.[1];
const drawPath = 'xl/drawings/' + drawTarget.replace(/^.*\//, '');
const drawRelsPath = drawPath.replace(/^xl\/drawings\/(.*)$/, 'xl/drawings/_rels/$1.rels');
const drx = await zip.file(drawRelsPath).async('string');
const chartTarget = drx.match(/Target="(\.\.\/charts\/[^"]+)"/)?.[1];
const chartPath = 'xl/charts/' + chartTarget.replace(/^.*\//, '');

const xml = await zip.file(chartPath).async('string');
const title = xml.match(/<c:title>[\s\S]*?<a:t>([^<]+)<\/a:t>/);
console.log('Chart title:', title?.[1] || '(none)');

const ssXml = await zip.file('xl/sharedStrings.xml').async('string');
const sis = [...ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => {
  let t = m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, '');
  return [...t.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('');
});

async function resolveCell(ref) {
  const m = ref.match(/'?([^'!]+)'?!\$?([A-Z]+)\$?(\d+)/);
  if (!m) return '(unparseable)';
  const [, tab, col, row] = m;
  const tabPath = 'xl/' + rels[wbXml.match(new RegExp(`<sheet[^>]*name="${tab}"[^>]*r:id="([^"]+)"`))[1]];
  const sx = await zip.file(tabPath).async('string');
  const rm = sx.match(new RegExp(`<row r="${row}"[^>]*>([\\s\\S]*?)</row>`));
  if (!rm) return '(no row)';
  const cm = rm[1].match(new RegExp(`<c r="${col}${row}"[^>]*(?:t="([^"]+)")?[^>]*>(?:<v>([^<]+)</v>)?<\\/c>`));
  if (!cm) return '(no cell)';
  if (cm[1] === 's' && cm[2] != null) return `"${sis[parseInt(cm[2], 10)] ?? '?'}"`;
  return cm[2] ?? '∅';
}

const series = [...xml.matchAll(/<c:ser>([\s\S]*?)<\/c:ser>/g)];
for (let i = 0; i < series.length; i++) {
  const s = series[i][1];
  const order = s.match(/<c:order val="(\d+)"/);
  const colorMatches = [...s.matchAll(/srgbClr val="([0-9A-F]+)"/g)].map(c => c[1]);
  const titleRef = s.match(/<c:tx><c:strRef><c:f>([^<]+)<\/c:f>/);
  const valRef = s.match(/<c:val>[\s\S]*?<c:f>([^<]+)<\/c:f>/);
  console.log(`\nseries ${i}: order=${order?.[1]} colors=${colorMatches.join(',')}`);
  if (titleRef) console.log(`  title ref: ${titleRef[1]} → ${await resolveCell(titleRef[1])}`);
  if (valRef) console.log(`  val ref:   ${valRef[1]}`);
}
