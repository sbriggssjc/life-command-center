import { generateSwagger2Spec, generateOpenApiSpec, ACTION_SCHEMAS } from './api/_shared/action-schemas.js';
import fs from 'node:fs';
// registry from ACTION_SCHEMAS keys, tier from operations.js registry if available
let reg;
try {
  const src = fs.readFileSync('./api/operations.js','utf8');
  reg = {};
  const re = /^\s*([a-z_]+):\s*\{\s*tier:\s*(\d)/gm; let m;
  while ((m = re.exec(src))) reg[m[1]] = { tier: Number(m[2]) };
} catch { reg = Object.fromEntries(Object.keys(ACTION_SCHEMAS).map(k=>[k,{tier:0}])); }
const v2 = generateSwagger2Spec(reg, 'https://x');
const full = generateOpenApiSpec(reg, 'https://x');
function findOp(spec, needle) {
  for (const [p,methods] of Object.entries(spec.paths)) {
    for (const op of Object.values(methods)) {
      if (op && (op.operationId===needle || (op.summary||'').toLowerCase().includes('daily briefing'))) 
        return {path:p, operationId:op.operationId, desc:(op.description||'').slice(0,140)};
    }
  }
  return null;
}
console.log('--- V2 (copilot-spec-v2) daily briefing ---');
console.log(JSON.stringify(findOp(v2,'GetDailyBriefingSnapshot'),null,1));
console.log('--- FULL (copilot-spec) daily briefing ---');
console.log(JSON.stringify(findOp(full,'GetDailyBriefingSnapshot'),null,1));
console.log('--- counts ---');
console.log('v2 paths:', Object.keys(v2.paths).length, '| full paths:', Object.keys(full.paths).length);
