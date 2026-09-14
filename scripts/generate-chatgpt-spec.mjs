#!/usr/bin/env node
// Generate the curated ChatGPT GPT-Action spec (Prompt 59) to
// docs/comps-rollout/lcc-openapi.yaml as a STAMPED, generated artifact.
//
// The live source of truth is the endpoint — GET {base}/api/gpt-spec (or
// /api/copilot-spec?surface=chatgpt). Import THAT URL into ChatGPT; it can never
// drift. This file is a convenience snapshot only. Regenerate with:
//   node scripts/generate-chatgpt-spec.mjs        (or: npm run spec:chatgpt)
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { generateChatGptSpec } from '../api/_shared/action-schemas.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'comps-rollout', 'lcc-openapi.yaml');
const BASE = process.env.LCC_BASE_URL || 'https://tranquil-delight-production-633f.up.railway.app';

const spec = generateChatGptSpec(BASE);
const banner =
  '# ─────────────────────────────────────────────────────────────────────────\n' +
  '# GENERATED — DO NOT HAND-EDIT.\n' +
  '#\n' +
  '# This is the curated ChatGPT GPT-Action spec (Prompt 59), the ≤30-op\n' +
  '# user-facing subset of the LCC HTTP surface. It is generated from\n' +
  '# api/_shared/action-schemas.js::generateChatGptSpec by\n' +
  '# scripts/generate-chatgpt-spec.mjs (npm run spec:chatgpt).\n' +
  '#\n' +
  '# DO NOT paste this file into ChatGPT. Import the LIVE URL instead so the\n' +
  "# GPT's tool set can never drift and never trips the 30-op cap:\n" +
  `#     ${BASE}/api/gpt-spec\n` +
  `#   (equivalently ${BASE}/api/copilot-spec?surface=chatgpt)\n` +
  '#\n' +
  '# Setup: docs/setup/GPT_ACTIONS_SETUP.md.  Full Copilot spec (46 ops, do NOT\n' +
  '# import into ChatGPT): /api/copilot-spec  and  /api/copilot-spec-v2.\n' +
  '# ─────────────────────────────────────────────────────────────────────────\n';

writeFileSync(OUT, banner + yaml.dump(spec, { lineWidth: 120, noRefs: true }));
let ops = 0;
for (const m of Object.values(spec.paths)) ops += Object.keys(m).length;
console.log(`[spec:chatgpt] wrote ${OUT} (${ops} operations, base ${BASE})`);
