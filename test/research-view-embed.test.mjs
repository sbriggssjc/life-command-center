// P132 — PostgREST dual-embed alias collision.
//
// Both research branches in api/queue.js embedded `users` TWICE (assignee +
// creator) via two FK hints with NO alias, so PostgREST assigned both the same
// internal alias and aborted the whole query with
//   "table name \"research_tasks_users_1\" specified more than once".
// v1 swallowed it as a generic 500; v2 leaked it. Either way the ENTIRE
// operator-facing Research task list rendered "0 tasks" for every lane and every
// status filter — while `?view=research_lanes` kept reporting healthy open
// counts off a different view. That badge-vs-list split is why it went unnoticed
// (Dead-End playbook classes 3 + 7: the surface exists but is unreachable), and
// it also hid the 453 P131 ownership-chain drafts, which only render on a card.
//
// The same shape was live in api/operations.js getOversight() (escalations
// embedding users twice for escalated_by + escalated_to), where the result is
// read as `escalations.data || []` with no .ok check — a 400 rendered as "no
// open escalations".
//
// Fix = PostgREST's documented alias-per-embed form `alias:table!fkey(cols)`
// (the docs' own two-FKs-to-one-table example is
// `start_scan:scans!scan_id_start(...)` + `end_scan:scans!scan_id_end(...)`).
//
// GUARD DESIGN: test 1 is a GENERAL invariant swept over every api/ select=
// string — no select list may embed two relations that resolve to the same
// response key — so a NEW instance anywhere in api/ fails, not just the two
// fixed here. Per the CLAUDE.md block-slice footgun it never slices a source
// region or pins a line number; it parses the select= tokens themselves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const API_DIR = join(ROOT, 'api');

function jsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...jsFiles(p));
    else if (name.endsWith('.js') || name.endsWith('.mjs')) out.push(p);
  }
  return out;
}

// Pull every `select=<list>` occurrence out of a source file. A select list ends
// at the next PostgREST param separator (&) or the end of the JS string literal.
function extractSelectLists(src) {
  const out = [];
  const re = /select=/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const rest = src.slice(m.index + 'select='.length);
    const end = rest.search(/[&`'"\n]/);
    const list = end === -1 ? rest : rest.slice(0, end);
    if (list.includes('(')) out.push(list);
  }
  return out;
}

// Split a select list on TOP-LEVEL commas only (an embed's own column list is
// parenthesised and must not be split).
function splitTopLevel(list) {
  const parts = [];
  let depth = 0, cur = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur) parts.push(cur);
  return parts;
}

// The JSON key an embed lands under: its alias when one is given, else the bare
// table name. Two embeds sharing a key is exactly the collision PostgREST
// rejects (and would be an unreadable response even if it did not).
function embedKey(token) {
  const t = token.trim();
  if (!t.includes('(')) return null;             // plain column, not an embed
  const head = t.slice(0, t.indexOf('('));
  const alias = head.includes(':') ? head.slice(0, head.indexOf(':')) : null;
  if (alias) return alias.trim();
  return head.split('!')[0].trim();
}

test('no api/ select= embeds two relations under the same response key', () => {
  const offenders = [];
  for (const file of jsFiles(API_DIR)) {
    const src = readFileSync(file, 'utf8');
    for (const list of extractSelectLists(src)) {
      const seen = new Map();
      for (const token of splitTopLevel(list)) {
        const key = embedKey(token);
        if (!key) continue;
        if (seen.has(key)) {
          offenders.push(
            `${relative(ROOT, file)}: embed key "${key}" appears twice in ` +
            `select=${list}\n    (${seen.get(key).trim()}) and (${token.trim()})\n` +
            `    → PostgREST aborts: 'table name "..." specified more than once'. ` +
            `Alias each embed: alias:table!fkey(cols)`
          );
        }
        seen.set(key, token);
      }
    }
  }
  assert.deepEqual(offenders, [], `Duplicate PostgREST embed keys:\n  ${offenders.join('\n  ')}`);
});

test('both research selects alias the two users embeds, and the mappers read the aliases', () => {
  const src = readFileSync(join(API_DIR, 'queue.js'), 'utf8');

  // Both branches (v1 `case 'research':` and v2 v2GetResearch) build this select.
  const assignee = 'assignee:users!research_tasks_assigned_to_fkey(display_name)';
  const creator = 'creator:users!research_tasks_created_by_fkey(display_name)';
  assert.equal(src.split(assignee).length - 1, 2, `expected 2 aliased assignee embeds: ${assignee}`);
  assert.equal(src.split(creator).length - 1, 2, `expected 2 aliased creator embeds: ${creator}`);

  // No un-aliased users! embed may survive in this file.
  for (const m of src.matchAll(/(.{0,12})users!research_tasks_\w+_fkey\(/g)) {
    assert.match(m[1], /(assignee|creator):$/,
      `un-aliased users! embed in queue.js — every one must carry an alias prefix: ...${m[0]}`);
  }

  // The row mappers must read the aliased embeds, never the old bracket keys.
  assert.ok(src.includes('r.assignee?.display_name'), 'mapper must read r.assignee');
  assert.ok(src.includes('r.creator?.display_name'), 'mapper must read r.creator');
  assert.ok(!src.includes("r['users!research_tasks_assigned_to_fkey']"),
    'stale bracket read of the un-aliased embed key still present');
  assert.ok(!src.includes("r['users!research_tasks_created_by_fkey']"),
    'stale bracket read of the un-aliased embed key still present');
  assert.ok(!src.includes('r.users?.display_name'),
    'stale r.users read still present — the embed is aliased now');
});

test('the oversight escalations select aliases both users embeds', () => {
  const src = readFileSync(join(API_DIR, 'operations.js'), 'utf8');
  for (const m of src.matchAll(/(.{0,22})users!escalations_\w+_fkey\(/g)) {
    assert.match(m[1], /(escalated_by_user|escalated_to_user):$/,
      `un-aliased users! embed in operations.js: ...${m[0]}`);
  }
});
