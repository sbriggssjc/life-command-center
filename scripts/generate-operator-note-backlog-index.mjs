#!/usr/bin/env node
/**
 * OC2 — parses docs/os/PLANNED-BACKLOG.md's table rows into a flat index of
 * {row_id, title} so the triage tick can dedupe a new operator note against
 * an already-filed backlog row (spec §6: "dedupe against open PLANNED-
 * BACKLOG rows"). A backlog row is not itself an operator_notes id, so a
 * match records the reference in metadata.duplicate_of_backlog_row per the
 * operator_note_contract.md.
 *
 * The parser is regex-over-markdown-tables, deliberately narrow: it only
 * reads `| ID | Title text | State | Source |`-shaped rows where ID looks
 * like a short code (letters+digits, e.g. EB1, OC2, P196, C13b, A2a). It is
 * NOT a general markdown table parser — PLANNED-BACKLOG.md's rows are
 * consistent enough for this and a general parser would be guessing at
 * structure the same way an LLM would (the same reasoning EB1's seed script
 * uses for the exemplar brief).
 *
 * Usage: node scripts/generate-operator-note-backlog-index.mjs [--write]
 *   (no flag) prints the count + first few entries
 *   --write   writes docs/os/operator-note-backlog-index.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROW_RE = /^\|\s*([A-Z]{1,4}\d{1,4}[a-z]{0,2})\s*\|\s*(.+?)\s*\|/;

export function parseBacklogIndex(markdown) {
  const out = [];
  const seen = new Set();
  for (const line of String(markdown || '').split(/\r?\n/)) {
    const m = line.match(ROW_RE);
    if (!m) continue;
    const rowId = m[1];
    // Strip leading bold/emoji/markdown noise from the title cell.
    let title = m[2].replace(/\*\*/g, '').replace(/^[⚠️🔴🟢✅⚪👤\s]+/, '').trim();
    if (title.length > 300) title = title.slice(0, 300);
    const key = rowId + '|' + title;
    if (seen.has(key) || !title) continue;
    seen.add(key);
    out.push({ row_id: rowId, title });
  }
  return out;
}

async function main() {
  const write = process.argv.includes('--write');
  const backlogPath = path.resolve(process.cwd(), 'docs/os/PLANNED-BACKLOG.md');
  const md = fs.readFileSync(backlogPath, 'utf8');
  const index = parseBacklogIndex(md);

  if (write) {
    const outPath = path.resolve(process.cwd(), 'docs/os/operator-note-backlog-index.json');
    fs.writeFileSync(outPath, JSON.stringify(index, null, 2) + '\n');
    console.log(`Wrote ${index.length} backlog rows to ${outPath}`);
  } else {
    console.log(`Parsed ${index.length} backlog rows.`);
    for (const row of index.slice(0, 10)) console.log(`  [${row.row_id}] ${row.title.slice(0, 90)}`);
    console.log('Run with --write to save docs/os/operator-note-backlog-index.json');
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
