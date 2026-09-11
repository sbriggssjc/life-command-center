#!/usr/bin/env node
/**
 * OC3 — renders docs/os/OPERATOR-INBOX.md from the live `operator_notes`
 * table. Run from .claude/hooks/session-start.sh so every Claude Code
 * session starts with a fresh inbox (spec §6). Reads .env.local for
 * OPS_SUPABASE_URL/OPS_SUPABASE_KEY (matches other scripts/*.mjs).
 *
 * Usage:
 *   node scripts/render-operator-inbox.mjs            # print to stdout
 *   node scripts/render-operator-inbox.mjs --write     # write docs/os/OPERATOR-INBOX.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fetchInboxNotes, groupAndSortInbox, renderInboxMarkdown } from '../api/_shared/operator-inbox.js';

function loadEnvLocal() {
  for (const f of ['.env.local', '.env']) {
    const p = path.resolve(process.cwd(), f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      const v = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
    return f;
  }
  return null;
}

async function main() {
  loadEnvLocal();
  const write = process.argv.includes('--write');

  if (!process.env.OPS_SUPABASE_URL || !process.env.OPS_SUPABASE_KEY) {
    console.error('OPS_SUPABASE_URL / OPS_SUPABASE_KEY not set — cannot fetch operator_notes. '
      + 'Skipping inbox render (this is expected in a sandbox with no DB egress).');
    process.exitCode = 0; // never break the session-start hook over a missing DB
    return;
  }

  const notes = await fetchInboxNotes().catch((err) => {
    console.error('Failed to fetch operator_notes:', err?.message || err);
    return null;
  });
  if (notes === null) { process.exitCode = 0; return; }

  const grouped = groupAndSortInbox(notes);
  const md = renderInboxMarkdown(grouped);

  if (write) {
    const outPath = path.resolve(process.cwd(), 'docs/os/OPERATOR-INBOX.md');
    fs.writeFileSync(outPath, md);
    console.log(`Wrote ${notes.length} note(s) across ${grouped.length} thread(s) to ${outPath}`);
  } else {
    process.stdout.write(md);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
