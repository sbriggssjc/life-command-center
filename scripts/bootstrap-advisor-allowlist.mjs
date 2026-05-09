#!/usr/bin/env node
// ============================================================================
// scripts/bootstrap-advisor-allowlist.mjs
//
// Regenerate audit/supabase-advisor-allowlist.{project}.json from the
// CURRENT live state of each Supabase project.
//
// When to run:
//   - After fixing a batch of advisor findings, to re-baseline so the
//     workflow doesn't re-flag the just-fixed (now-removed) entries.
//   - When onboarding a new project to the audit.
//   - One-time, on the bootstrap commit (initial allowlists were built
//     this way).
//
// What it does:
//   GET https://api.supabase.com/v1/projects/{ref}/advisors/security
//   for each project, filters to {level: ERROR}, projects to {name, detail},
//   sorts deterministically, writes the JSON file.
//
// Requires: SUPABASE_ACCESS_TOKEN env var (Personal Access Token from
//   https://supabase.com/dashboard/account/tokens). Same secret the
//   .github/workflows/supabase-advisor-check.yml workflow uses.
//
// Usage:
//   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/bootstrap-advisor-allowlist.mjs
//   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/bootstrap-advisor-allowlist.mjs lcc-opps
// ============================================================================

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECTS = {
  'lcc-opps': 'xengecqvemvfknjvbvrq',
  'gov':      'scknotsqkcheojiaewwh',
  'dia':      'zqzrriwuavgrquhisnoa',
};

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) {
  console.error('SUPABASE_ACCESS_TOKEN not set. Get one at https://supabase.com/dashboard/account/tokens');
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const requested = process.argv.slice(2);
const targets = requested.length === 0
  ? Object.keys(PROJECTS)
  : requested.filter(p => {
      if (!(p in PROJECTS)) {
        console.error(`Unknown project: ${p}. Known: ${Object.keys(PROJECTS).join(', ')}`);
        process.exit(2);
      }
      return true;
    });

for (const project of targets) {
  const ref = PROJECTS[project];
  // Endpoint shape: GET /v1/projects/{ref}/advisors/security (path
  // segment, NOT ?type=security — the query-string form returns 404).
  // Response is either a bare array or {lints: [...]}; normalize below.
  const url = `https://api.supabase.com/v1/projects/${ref}/advisors/security`;
  process.stdout.write(`${project} (${ref}): fetching... `);

  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) {
    console.error(`\n  HTTP ${res.status}: ${await res.text()}`);
    process.exit(3);
  }
  const body = await res.json();
  const rawLints = Array.isArray(body) ? body : (body.lints ?? []);
  // Strip the \` decorative escapes from detail (must match the
  // workflow's gsub in supabase-advisor-check.yml — diffing live data
  // against the allowlist requires identical normalization on both
  // sides). Lint name + cleaned detail still uniquely identify the
  // finding.
  const errorLints = rawLints
    .filter(l => l.level === 'ERROR')
    .map(l => ({ name: l.name, detail: l.detail.replace(/\\`/g, '') }))
    .sort((a, b) => (a.name + a.detail).localeCompare(b.name + b.detail));

  const out = {
    _comment: `Generated allowlist of ERROR-level Supabase advisors known to be present on ${project} (project ${ref}) as of bootstrap. Anything ERROR-level not in this list will trigger an alert via the supabase-advisor-check workflow. To remove an entry: fix the underlying issue (enable RLS, switch SECURITY DEFINER -> SECURITY INVOKER, etc.) and delete the matching row. To regenerate from scratch: run scripts/bootstrap-advisor-allowlist.mjs.`,
    _project_ref: ref,
    lints: errorLints,
  };

  const path = resolve(REPO_ROOT, 'audit', `supabase-advisor-allowlist.${project}.json`);
  writeFileSync(path, JSON.stringify(out, null, 2) + '\n');
  console.log(`${errorLints.length} entries -> ${path}`);
}
