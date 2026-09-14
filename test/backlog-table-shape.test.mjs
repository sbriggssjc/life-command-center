/**
 * Guard: docs/os/PLANNED-BACKLOG.md tables must not get structurally worse.
 *
 * WHY THIS EXISTS (DOC-TABLE1, 2026-09-12)
 * PLANNED-BACKLOG.md is the repo's answer to "what is intended work?", and a future session
 * reads it to decide what to do next. Two defects were measured in it on 2026-09-12, both
 * produced by the same habit: recording an update by APPENDING NEW CELLS to the right of an
 * existing row instead of editing the row in place.
 *
 *   1. WRONG-WIDTH ROWS (45 measured). Markdown renders only as many cells as the header
 *      declares. Every cell past the 4th is dropped from the rendered table — and the cell
 *      that gets appended is almost always the live-verification result, i.e. the most
 *      current fact in the row. The row looks complete in the raw file and reads as stale
 *      in the rendered one.
 *
 *   2. DUPLICATE IDs (17 measured). The same item ID appears two or three times, each copy
 *      a different snapshot of its history, so a reader takes whichever they scroll to
 *      first. MB2a/MB3/MB4 were deduplicated by hand on 2026-09-12 and were RE-INTRODUCED
 *      within the hour: a concurrent branch had edited its own copies, so the merge kept
 *      both sides and git reported no conflict. That is the real lesson here — with several
 *      sessions editing this file at once, a one-time cleanup does not hold. Only a guard
 *      that fails the build holds.
 *
 * WHY A RATCHET AND NOT A CLEAN ASSERTION
 * The 45 + 17 existing violations cannot be fixed mechanically: the duplicate copies differ
 * in content, so choosing a survivor is a judgment call per row. Asserting zero today would
 * mean either a red suite for everyone or a rushed merge that loses real facts. So the
 * baselines below are the MEASURED CURRENT STATE and may only ever go DOWN. New damage
 * fails immediately; existing damage gets paid off row by row, each payment lowering the
 * baseline so it can never come back.
 *
 * THE FIX WHEN THIS GOES RED:
 *   - Wrong width: do not add a column. Fold the new information INTO the existing Item
 *     cell (and update the State cell), which is what the 4-column header promises.
 *   - Duplicate ID: merge the copies into one row, keeping every fact from each, and delete
 *     the others. If a merge re-introduced a copy, resolve it by merging content rather than
 *     keeping both rows.
 *   - Then LOWER the baseline constant below to the new measured count, in the same commit.
 *     A fix that leaves the baseline high is not a fix; it just buys room for new damage.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKLOG_FILE = path.join(REPO_ROOT, 'docs', 'os', 'PLANNED-BACKLOG.md');

// Measured against the committed file on 2026-09-12 (DOC-TABLE1). RATCHET: may only DECREASE.
// 2026-09-12: duplicates 17 -> 14 after PR #2405 merged three restated rows. Baseline lowered
// to match, per the rule below: a fix that leaves the baseline high just buys room for new damage.
// Lower these in the same commit that fixes rows. Never raise them to make a build pass —
// raising one is the exact failure this guard exists to prevent.
export const WRONG_WIDTH_BASELINE = 45;
export const DUPLICATE_ID_BASELINE = 14;

/**
 * Split a markdown table row into cells, ignoring pipes inside `code spans` and escaped
 * pipes. The backlog is full of cells like `a|b` in code, so a naive split miscounts.
 */
export function splitCells(line) {
  const out = [];
  let cur = '';
  let inCode = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '`') inCode = !inCode;
    if (ch === '|' && !inCode && line[i - 1] !== '\\') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  // Leading/trailing pipes produce empty edge cells; they are delimiters, not columns.
  if (out.length && out[0].trim() === '') out.shift();
  if (out.length && out[out.length - 1].trim() === '') out.pop();
  return out;
}

const isSeparatorRow = (line) =>
  line.includes('-') && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line);

/** Parse every markdown table: a header row immediately followed by a |---|---| separator. */
export function parseTables(text) {
  const lines = text.split('\n');
  const tables = [];
  for (let i = 0; i < lines.length; i++) {
    const isHeader =
      lines[i].trim().startsWith('|') &&
      i + 1 < lines.length &&
      isSeparatorRow(lines[i + 1]);
    if (!isHeader) continue;

    const columns = splitCells(lines[i]).length;
    const rows = [];
    let j = i + 2;
    for (; j < lines.length && lines[j].trim().startsWith('|'); j++) {
      rows.push({ line: j + 1, cells: splitCells(lines[j]) });
    }
    tables.push({ headerLine: i + 1, columns, rows });
    i = j - 1;
  }
  return tables;
}

function analyze(text) {
  const tables = parseTables(text);
  const wrongWidth = [];
  const duplicateIds = [];
  for (const table of tables) {
    const seen = new Map();
    for (const row of table.rows) {
      if (row.cells.length !== table.columns) {
        wrongWidth.push(
          `  line ${row.line}: ${row.cells.length} cells, header declares ${table.columns}` +
            ` — "${row.cells[0].replace(/[*~`]/g, '').trim().slice(0, 40)}"`
        );
      }
      const id = row.cells[0].replace(/[*~`]/g, '').trim();
      if (!id) continue;
      if (seen.has(id)) {
        duplicateIds.push(`  "${id}" at lines ${seen.get(id)} and ${row.line}`);
      } else {
        seen.set(id, row.line);
      }
    }
  }
  return { tables, wrongWidth, duplicateIds };
}

const read = () => fs.readFileSync(BACKLOG_FILE, 'utf8');

test('PLANNED-BACKLOG.md rows match their table header width (ratchet)', () => {
  const { wrongWidth } = analyze(read());
  assert.ok(
    wrongWidth.length <= WRONG_WIDTH_BASELINE,
    `PLANNED-BACKLOG.md has ${wrongWidth.length} rows whose cell count differs from their ` +
      `table header, above the ratchet baseline of ${WRONG_WIDTH_BASELINE}.\n\n` +
      `Markdown DROPS every cell past the header width when rendering, and the dropped cell ` +
      `is usually the live-verification result — the most current fact in the row.\n\n` +
      `Fix: fold the new information into the existing Item cell and update the State cell. ` +
      `Do not add a column.\n\n${wrongWidth.join('\n')}`
  );
});

test('PLANNED-BACKLOG.md has no new duplicate item IDs (ratchet)', () => {
  const { duplicateIds } = analyze(read());
  assert.ok(
    duplicateIds.length <= DUPLICATE_ID_BASELINE,
    `PLANNED-BACKLOG.md has ${duplicateIds.length} duplicate item IDs, above the ratchet ` +
      `baseline of ${DUPLICATE_ID_BASELINE}.\n\n` +
      `Each copy is a different snapshot of the item's history, so a reader takes whichever ` +
      `they scroll to first. This commonly arrives via a MERGE: two branches each edited ` +
      `their own copy of a row, so git kept both sides without reporting a conflict.\n\n` +
      `Fix: merge the copies into one row keeping every fact, delete the others, and lower ` +
      `DUPLICATE_ID_BASELINE in the same commit.\n\n${duplicateIds.join('\n')}`
  );
});

test('the ratchet baselines are finite and the parser actually finds tables', () => {
  // Positive control: prove the assertions above can fail, so an edit that hollows out the
  // check (baseline set to Infinity, or a parser change that silently finds nothing) is caught.
  assert.ok(Number.isFinite(WRONG_WIDTH_BASELINE) && WRONG_WIDTH_BASELINE >= 0);
  assert.ok(Number.isFinite(DUPLICATE_ID_BASELINE) && DUPLICATE_ID_BASELINE >= 0);

  const { tables } = analyze(read());
  assert.ok(tables.length > 10, `expected many tables in the backlog, found ${tables.length}`);
  const rowCount = tables.reduce((sum, t) => sum + t.rows.length, 0);
  assert.ok(rowCount > 100, `expected hundreds of backlog rows, found ${rowCount}`);
});

test('the detectors fire on known-bad fixtures', () => {
  // Positive control on the detectors themselves, independent of the real file.
  const tooWide = ['| # | Item |', '|---|---|', '| A | ok |', '| B | one | two |'].join('\n');
  assert.equal(analyze(tooWide).wrongWidth.length, 1);

  const duped = ['| # | Item |', '|---|---|', '| A | first |', '| A | second |'].join('\n');
  assert.equal(analyze(duped).duplicateIds.length, 1);

  const clean = ['| # | Item |', '|---|---|', '| A | ok |', '| B | ok |'].join('\n');
  assert.equal(analyze(clean).wrongWidth.length, 0);
  assert.equal(analyze(clean).duplicateIds.length, 0);

  // A pipe inside a code span must not be counted as a cell delimiter.
  const codePipe = ['| # | Item |', '|---|---|', '| A | `a|b` |'].join('\n');
  assert.equal(analyze(codePipe).wrongWidth.length, 0);
});
