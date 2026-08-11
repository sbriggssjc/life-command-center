import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';

import { APPROVED_SEED_CODES } from './manifest.mjs';

export const EXPECTED_SEED_CONCEPTS = Object.freeze({
  '261QX0200X': { grouping: 'Ambulatory Health Care Facilities', classification: 'Clinic/Center', specialization: 'Oncology' },
  '261QI0500X': { grouping: 'Ambulatory Health Care Facilities', classification: 'Clinic/Center', specialization: 'Infusion Therapy' },
  '261QX0203X': { grouping: 'Ambulatory Health Care Facilities', classification: 'Clinic/Center', specialization: 'Oncology, Radiation' },
});

export async function validateNuccTaxonomyFile(filePath) {
  const rows = parse(await readFile(filePath, 'utf8'), { columns: true, bom: true, skip_empty_lines: true, trim: true });
  const byCode = new Map();
  for (const row of rows) {
    if (!APPROVED_SEED_CODES.includes(row.Code)) continue;
    if (byCode.has(row.Code)) throw new Error(`Duplicate approved taxonomy code: ${row.Code}`);
    byCode.set(row.Code, row);
  }
  const assertions = [];
  for (const code of APPROVED_SEED_CODES) {
    const row = byCode.get(code);
    if (!row) throw new Error(`Missing approved taxonomy code: ${code}`);
    const expected = EXPECTED_SEED_CONCEPTS[code];
    if (row.Grouping !== expected.grouping || row.Classification !== expected.classification || row.Specialization !== expected.specialization) {
      throw new Error(`Material taxonomy drift for code: ${code}`);
    }
    if (!row.Definition) throw new Error(`Missing taxonomy definition for code: ${code}`);
    if (!code.startsWith('261Q')) throw new Error(`Taxonomy code is not a facility role: ${code}`);
    assertions.push({ code, classification: row.Classification, grouping: row.Grouping, specialization: row.Specialization, status: 'pass' });
  }
  return assertions;
}
