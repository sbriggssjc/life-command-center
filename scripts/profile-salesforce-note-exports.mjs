import ExcelJS from 'exceljs';

const files = [
  {
    label: 'Company notes',
    path: 'C:/Users/scott/OneDrive - NorthMarq Capital, LLC/Desktop/Note Records - Company - Team Briggs.xlsx',
  },
  {
    label: 'Contact notes',
    path: 'C:/Users/scott/OneDrive - NorthMarq Capital, LLC/Desktop/Note Records - Contact - Team Briggs.xlsx',
  },
];

function cellText(value) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if (value.text) return String(value.text);
    if (value.richText) return value.richText.map((p) => p.text || '').join('');
    if (value.result != null) return cellText(value.result);
    if (value.hyperlink && value.text) return String(value.text);
    return JSON.stringify(value);
  }
  return String(value);
}

function rowValues(sheet, rowNumber, maxCols) {
  const row = sheet.getRow(rowNumber);
  const values = [];
  for (let c = 1; c <= maxCols; c += 1) values.push(cellText(row.getCell(c).value));
  return values;
}

for (const file of files) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file.path);
  console.log(`\n=== ${file.label} ===`);
  console.log(file.path);
  console.log(`Sheets: ${workbook.worksheets.map((s) => s.name).join(', ')}`);

  for (const sheet of workbook.worksheets) {
    const maxCols = Math.min(sheet.columnCount, 40);
    const headers = rowValues(sheet, 1, maxCols);
    const nonBlankHeaders = headers.map((h, i) => h || `Column ${i + 1}`);
    console.log(`\n--- ${sheet.name}: ${sheet.rowCount} rows x ${sheet.columnCount} cols ---`);
    console.log(`Headers: ${JSON.stringify(nonBlankHeaders)}`);

    const samples = [];
    for (let r = 2; r <= Math.min(sheet.rowCount, 6); r += 1) {
      const values = rowValues(sheet, r, maxCols);
      const sample = {};
      nonBlankHeaders.forEach((header, idx) => {
        const value = values[idx];
        if (value) sample[header] = value.length > 220 ? `${value.slice(0, 220)}...` : value;
      });
      samples.push(sample);
    }
    console.log(`Samples: ${JSON.stringify(samples, null, 2)}`);

    const titleIdx = nonBlankHeaders.findIndex((h) => /title|subject|note/i.test(h));
    if (titleIdx >= 0) {
      const titleCounts = new Map();
      const noteIdIdx = nonBlankHeaders.findIndex((h) => /^note id$/i.test(h.trim()));
      const parentIdIdx = nonBlankHeaders.findIndex((h) => /^(company|contact) id/i.test(h.trim()));
      const noteIds = new Set();
      const duplicateNoteIds = new Set();
      const parentIds = new Set();
      let cityStateLike = 0;
      let soldLike = 0;
      let untitled = 0;
      for (let r = 2; r <= sheet.rowCount; r += 1) {
        const title = cellText(sheet.getRow(r).getCell(titleIdx + 1).value).trim();
        if (title) {
          titleCounts.set(title, (titleCounts.get(title) || 0) + 1);
          if (/\s-\s[^-]+,\s*[A-Z]{2}(?:\s|$| - )/.test(title)) cityStateLike += 1;
          if (/\bSOLD\b/i.test(title)) soldLike += 1;
          if (/^Untitled Note$/i.test(title)) untitled += 1;
        }
        if (noteIdIdx >= 0) {
          const noteId = cellText(sheet.getRow(r).getCell(noteIdIdx + 1).value).trim();
          if (noteId) {
            if (noteIds.has(noteId)) duplicateNoteIds.add(noteId);
            noteIds.add(noteId);
          }
        }
        if (parentIdIdx >= 0) {
          const parentId = cellText(sheet.getRow(r).getCell(parentIdIdx + 1).value).trim();
          if (parentId) parentIds.add(parentId);
        }
      }
      const topTitles = [...titleCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
      console.log(`Summary: ${JSON.stringify({
        dataRows: Math.max(0, sheet.rowCount - 1),
        uniqueNoteIds: noteIds.size,
        duplicateNoteIds: duplicateNoteIds.size,
        uniqueParentIds: parentIds.size,
        uniqueTitles: titleCounts.size,
        cityStateLikeTitles: cityStateLike,
        soldLikeTitles: soldLike,
        untitledNotes: untitled,
      })}`);
      console.log(`Top values in "${nonBlankHeaders[titleIdx]}": ${JSON.stringify(topTitles)}`);
    }
  }
}
