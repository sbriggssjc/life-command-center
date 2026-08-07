import { generateSwagger2Spec, ACTION_SCHEMAS } from './api/_shared/action-schemas.js';
const registry = Object.fromEntries(Object.keys(ACTION_SCHEMAS).map(k => [k, {tier:0}]));
const spec = generateSwagger2Spec(registry, 'https://tranquil-delight-production-633f.up.railway.app');
const rows = [];
for (const [p, methods] of Object.entries(spec.paths)) {
  if (p.includes('/compat/') || p === '/api/chat') continue;
  const op = methods.post || Object.values(methods)[0];
  if (!op) continue;
  rows.push([op.operationId, (op.summary||'').slice(0,80)]);
}
rows.sort((a,b)=>a[0].localeCompare(b[0]));
console.log('COUNT (discrete, post-66 view): ' + rows.length);
for (const r of rows) console.log(r[0] + '  ::  ' + r[1]);
