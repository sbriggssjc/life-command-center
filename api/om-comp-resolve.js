// ============================================================================
// api/om-comp-resolve.js — W3.7 front door for the OM → comp-resolution engine.
//
// GET/POST /api/om-comp-resolve?domain=&apply=&limit=&status=
// Dry-run by default; `apply=true` writes (NOI write-through + projections +
// disposition). Gated with the same X-LCC-Key the other admin/comp routes use.
//
// The engine (api/_handlers/om-comp-resolver.js) is deps-injected with the LCC
// service-role query helpers so it can reach the gov/dia domain queues + the
// LCC-Opps extraction snapshots in one process. Mounted in server.js.
// ============================================================================

import { handleCors } from './_shared/auth.js';
import { domainQuery } from './_shared/domain-db.js';
import { opsQuery } from './_shared/ops-db.js';
import { makeOmCompResolveHandler } from './_handlers/om-comp-resolver.js';

const LCC_API_KEY = process.env.LCC_API_KEY || '';
const engine = makeOmCompResolveHandler({ domainQuery, opsQuery });

export default async function omCompResolveHandler(req, res) {
  if (handleCors(req, res)) return;

  if (LCC_API_KEY) {
    const provided = req.headers['x-lcc-key']
      || (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
      || (req.body && req.body._k) || '';
    if (provided !== LCC_API_KEY) {
      res.status(401).json({ error: 'Unauthorized — invalid or missing X-LCC-Key.' });
      return;
    }
  }
  return engine(req, res);
}
