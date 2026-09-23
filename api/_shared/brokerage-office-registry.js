// GOV-AVAIL1: brokerage-office registry = the builtin own-office rows plus the
// active rows of LCC Opps lcc_brokerage_office_address. Cached 10 minutes; a
// failed read falls back to the builtin rows (our own office is never a subject).
//
// SIDEBAR5 (2026-09-23): moved here from intake-extractor.js so the sidebar
// pipeline can consult the same registry without importing the OM extractor.
// intake-extractor.js re-exports it, so existing callers are unchanged.
import { opsQuery } from './ops-db.js';
import { BUILTIN_BROKERAGE_OFFICES } from './intake-address-guard.js';

let _officeRegistryCache = null;
let _officeRegistryAt = 0;
export async function loadBrokerageOfficeRegistry() {
  if (_officeRegistryCache && Date.now() - _officeRegistryAt < 10 * 60 * 1000) return _officeRegistryCache;
  let rows = [];
  try {
    const r = await opsQuery('GET',
      'lcc_brokerage_office_address?is_active=eq.true&select=firm_name,address,city,state,source&limit=1000');
    if (r.ok && Array.isArray(r.data)) rows = r.data;
  } catch { /* fall back to builtin */ }
  _officeRegistryCache = [...BUILTIN_BROKERAGE_OFFICES, ...rows];
  _officeRegistryAt = Date.now();
  return _officeRegistryCache;
}
