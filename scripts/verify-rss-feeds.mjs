#!/usr/bin/env node
// ============================================================================
// MB2a — fetch every RSS_FEEDS URL from the live edge-function source and
// fail loudly on a non-200 or a feed that parses to zero items. This is the
// "make a dead feed impossible to ship again" half of MB2a: MB2 shipped
// three URLs that were never egress-verified (403/404/404) because nothing
// checked them before they were committed.
//
// Deliberately NOT wired into `npm test` — this repo's suite is hermetic by
// guard (TEST-NET-LEAK, net-guard.mjs) and reaches no real host. Run this
// standalone, from a host with real egress, before adding/changing any feed
// URL or before flipping MARKET_BRIEF_PRSS:
//
//   node scripts/verify-rss-feeds.mjs                 # all streams
//   node scripts/verify-rss-feeds.mjs --stream=dialysis
//
// Exits 1 (and prints a table) if any feed 4xx/5xxs, times out, or returns a
// body with zero <item>/<entry> elements. Exits 0 only when every feed in
// scope is live and returning real content.
//
// The feed list is parsed OUT OF the edge-function source (never
// hand-duplicated here) so this check can never silently drift from what
// actually ships — the exact normaliser-drift class this repo's CLAUDE.md
// warns about repeatedly ("a JS copy of a source of truth").
// ============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_PATH = join(ROOT, 'supabase/functions/briefing-intel-snapshot/index.ts');
const TIMEOUT_MS = 15000;
const USER_AGENT = 'LCC-BriefingIntel/2.0'; // must match the edge fn's fetchText() UA — never a spoofed browser UA

function parseFeedTable(source) {
  const block = source.match(/const RSS_FEEDS[\s\S]*?=\s*\{([\s\S]*?)\n\};/);
  if (!block) throw new Error('Could not locate RSS_FEEDS in briefing-intel-snapshot/index.ts — has it moved?');
  const body = block[1];
  const streamRe = /(\w+):\s*\[([\s\S]*?)\],/g;
  const feeds = [];
  let sm;
  while ((sm = streamRe.exec(body))) {
    const stream = sm[1];
    const entryRe = /\{\s*source:\s*"([^"]+)"\s*,\s*url:\s*"([^"]+)"(?:\s*,\s*redirect:\s*(true|false))?\s*,?\s*\}/g;
    let em;
    while ((em = entryRe.exec(sm[2]))) {
      feeds.push({ stream, source: em[1], url: em[2], redirect: em[3] === 'true' });
    }
  }
  return feeds;
}

async function checkFeed(feed) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(feed.url, { signal: ctrl.signal, headers: { 'User-Agent': USER_AGENT } });
    clearTimeout(t);
    if (!r.ok) return { ...feed, ok: false, status: r.status, item_count: 0, error: `HTTP ${r.status}` };
    const xml = await r.text();
    const items = (xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || []).length;
    return { ...feed, ok: items > 0, status: r.status, item_count: items, error: items > 0 ? null : 'zero_items_parsed' };
  } catch (err) {
    clearTimeout(t);
    return { ...feed, ok: false, status: null, item_count: 0, error: err?.message || String(err) };
  }
}

async function main() {
  const streamArg = process.argv.find((a) => a.startsWith('--stream='))?.split('=')[1] || null;
  const source = readFileSync(SOURCE_PATH, 'utf8');
  let feeds = parseFeedTable(source);
  if (streamArg) feeds = feeds.filter((f) => f.stream === streamArg);
  if (!feeds.length) {
    console.error(`No feeds found${streamArg ? ` for stream "${streamArg}"` : ''}.`);
    process.exit(1);
  }

  console.log(`Checking ${feeds.length} feed(s)${streamArg ? ` in stream "${streamArg}"` : ''}...\n`);
  const results = await Promise.all(feeds.map(checkFeed));

  const rows = results.map((r) => ({
    stream: r.stream, source: r.source, status: r.status ?? 'ERR', items: r.item_count, ok: r.ok ? 'OK' : 'FAIL', error: r.error || '',
  }));
  console.table(rows);

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.error(`\n${failed.length} of ${results.length} feed(s) FAILED:`);
    for (const f of failed) console.error(`  - [${f.stream}] ${f.source} (${f.url}) -> ${f.error}`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} feed(s) OK.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('verify-rss-feeds.mjs crashed:', err);
  process.exit(1);
});
