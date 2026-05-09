import ExcelJS from 'exceljs';

const files = [
  { path: 'C:/Users/scott/Downloads/SJC Gov Track Record.xlsx', label: 'GOV' },
  { path: 'C:/Users/scott/Downloads/data.xlsx', label: 'DIA' },
];

for (const f of files) {
  console.log(`\n=== ${f.label}: ${f.path} ===`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(f.path);
  console.log(`Sheets: ${wb.worksheets.map(s => s.name).join(', ')}`);
  for (const sheet of wb.worksheets) {
    console.log(`\n--- Sheet: ${sheet.name} (${sheet.rowCount} rows x ${sheet.columnCount} cols) ---`);
    for (let r = 1; r <= Math.min(8, sheet.rowCount); r++) {
      const row = sheet.getRow(r);
      const values = [];
      for (let c = 1; c <= Math.min(20, sheet.columnCount); c++) {
        const v = row.getCell(c).value;
        values.push(typeof v === 'object' && v?.text ? v.text : v);
      }
      console.log(`R${r}: ${JSON.stringify(values)}`);
    }
  }
}
