// ============================================================================
// om-comp-resolver.js — W3.7: OM-financials → automatic comp-review resolution
//
// Scott's concept, PROVEN by hand on Fort Wayne (gov comp id=11, 2500 E State
// Blvd — Northmarq-brokered VA sale): the comp review row flagged cap_mismatch
// (implied 6.96% vs reliable 8.0%) because properties.noi was a stale estimate;
// the Salesforce-linked Northmarq OM states in-place NOI $689,805 → sold
// $8,512,000 = 8.10% ≈ reliable 8.0%. Cowork corrected the NOI at source with
// confirmed_document provenance and resolved the row. This module does that
// automatically for every open comp review row whose deal has a reachable OM.
//
// FIVE stages (task W3.7), all deps-injected so it is unit-testable with the
// repo's global.fetch-mock harness (no live DB):
//   1. LINK    — comp review row → sale/property → sf_comp_staging (+ its deal/
//                listing ids) → sf_files (OM / flyer / financial PDFs, bytes
//                already in the salesforce-files bucket, discovered + extracted
//                by supabase/functions/intake-salesforce-files).
//   2. EXTRACT — REUSE the existing extraction: the sf_files stage-queued worker
//                already ran the shared document extractor (intake-extractor.js /
//                ai.js) over every stored OM and wrote the financial summary to
//                LCC Opps staged_intake_extractions.extraction_snapshot. We read
//                that snapshot (no duplicate extraction engine). process_notes
//                carries the intake id: `intake:<uuid> extract:… match:…`.
//   3. WRITE-THROUGH — gov: OM in-place NOI → properties.noi with
//                confirmed_document / authority_rank=3 provenance via
//                gov_apply_om_confirmed_noi (the id=11 shape), NEVER overwriting
//                confirmed/manual. Multi-year projections → property_financials
//                source='om_extract'. (dia has no field_value_provenance ledger
//                and per W3.6b takes no properties write-through — projections +
//                attach only.)
//   4. AUTO-RESOLVE — recompute implied = OM income ÷ sale_price; if it reconciles
//                to the reliable cap within tolerance, resolve with note
//                'om_confirmed:<sf_file_id>'; else leave OPEN with the OM figures
//                attached (detail.om + a durable note) for human review.
//   5. BACKFILL — run over the open rows in both domain queues; honest report.
//
// Honesty note (this codebase's standing pattern): the mechanism is the durable
// fix; realizing value is capture-gated. Today the linkage from comp review rows
// to reachable extracted OMs is thin (sf_comp_staging.linked_sale_id populated on
// a minority of comps), so a backfill auto-resolves few rows now and scales as SF
// file discovery + comp linkage grow. The report never inflates that.
// ============================================================================

// Reconciliation tolerance — MIRRORS CAP_MISMATCH_BPS in mcp/comps-tools.js
// (75 bps). Kept in lock-step so an OM that reconciles here is one the comp
// PRODUCER would no longer flag on its next pull.
export const OM_CAP_TOLERANCE = 0.0075;

// Flags whose PREMISE an OM income↔reliable-cap reconciliation actually settles:
// cap_mismatch ("implied cap doesn't reconcile") and rent_disagreement ("which
// rent is right" — the OM is the authoritative rent). A pure price_over_ask
// (sold > ask) or no_reliable_cap is NOT cleared by a cap reconciliation, so such
// a row gets the OM figures attached but stays open for human review even when
// the cap happens to reconcile.
const RESOLVABLE_FLAGS = new Set(['cap_mismatch', 'rent_disagreement']);

// Document types worth reading for financials (the extractor's document_type
// vocabulary). We do not hard-require a type — any snapshot carrying a usable
// NOI/rent is accepted — but these rank first when a comp has several files.
const OM_DOCTYPE_RANK = { om: 0, offering_memorandum: 0, marketing_brochure: 1, flyer: 2, comp: 3 };

// ── numeric / cap helpers ───────────────────────────────────────────────────
export function posNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
// The extractor prompt asks for a DECIMAL cap, but the AI sometimes returns a
// whole-number percent (observed live: San Angelo "7.28", Augusta "0.0637").
// Normalize: a value > 1 is a percent → /100. We prefer computing implied cap
// from income ÷ price anyway; this is only for display of the OM's stated cap.
export function normCap(v) {
  const n = posNum(v);
  if (n == null) return null;
  return n > 1 ? +(n / 100).toFixed(6) : +n.toFixed(6);
}

// Parse the intake id out of sf_files.process_notes (`intake:<uuid> extract:…`).
export function parseIntakeId(processNotes) {
  const m = String(processNotes || '').match(/intake:([0-9a-f-]{36})/i);
  return m ? m[1] : null;
}

// The income PRICE is divided into, per domain (mirrors computeReviewSignals):
// gov = NOI; dia (net-lease rent basis) = annual_rent, falling back to NOI.
export function pickOmIncome(fin, isGov) {
  if (!fin) return { income: null, kind: null };
  if (isGov) return { income: posNum(fin.noi), kind: 'NOI' };
  const rent = posNum(fin.annual_rent);
  if (rent != null) return { income: rent, kind: 'RENT' };
  return { income: posNum(fin.noi), kind: 'NOI' };
}

// Normalize an extraction_snapshot into the financial summary we consume.
export function normalizeOmSnapshot(snapshot) {
  const s = snapshot || {};
  const projections = Array.isArray(s.financial_projections) ? s.financial_projections : [];
  return {
    doctype: s.document_type || null,
    noi: posNum(s.noi),
    annual_rent: posNum(s.annual_rent),
    cap_rate: normCap(s.cap_rate),
    asking_price: posNum(s.asking_price),
    sold_price: posNum(s.sold_price),
    lease_expiration: s.lease_expiration || null,
    rba: posNum(s.building_sf),                 // building_sf == RBA
    projections,
  };
}

// ── PURE reconciliation (the Fort Wayne would-have-resolved test target) ─────
// Given a review row + the OM income, decide resolve | leave_open | no_reliable_cap
// | insufficient_data. resolve iff |OM income/price − reliable_cap| ≤ tolerance.
export function reconcileOmAgainstReview({ review, income, incomeKind, sfFileId }) {
  const price = posNum(review && review.sale_price);
  const reliableCap = posNum(review && review.reliable_cap);
  if (!price || income == null) {
    return { decision: 'insufficient_data', implied_cap: null, reliable_cap: reliableCap,
      within_tolerance: false, note: null };
  }
  const impliedCap = +(income / price).toFixed(6);
  if (reliableCap == null) {
    return { decision: 'no_reliable_cap', implied_cap: impliedCap, reliable_cap: null,
      within_tolerance: false, note: null, income_kind: incomeKind };
  }
  const within = Math.abs(impliedCap - reliableCap) <= OM_CAP_TOLERANCE;
  return {
    decision: within ? 'resolve' : 'leave_open',
    implied_cap: impliedCap,
    reliable_cap: reliableCap,
    within_tolerance: within,
    income_kind: incomeKind,
    note: within ? `om_confirmed:${sfFileId}` : null,
  };
}

function isGovDomain(d) { const s = String(d || '').toLowerCase(); return s === 'gov' || s === 'government'; }
function domainKey(d) { return isGovDomain(d) ? 'government' : 'dialysis'; }
function reviewTable(d) { return isGovDomain(d) ? 'gov_comp_review_queue' : 'dia_comp_review_queue'; }

// ── 1. LINK — reachable sf_files for one comp review row ─────────────────────
// Traverse sale/property → sf_comp_staging (matching linked_sale_id OR
// linked_property_id) → collect the comp's SF id plus its sf_deal_id/sf_listing_id
// → sf_files linked to any of those. W3.7b: file discovery now reaches Listing__c
// and Deal (Opportunity) attachments, not only Comp__c — the Fort Wayne OM lives
// on the LISTING (a0jVs…). A discovered file carries linked_entity_sf_id (the SF
// record the ContentDocumentLink hangs off) AND a stamped sf_comp_id/sf_listing_id/
// sf_deal_id traversal column; we match on either so a listing/deal-attached OM is
// reachable regardless of which its linked_entity_sf_id happens to be.
export async function findOmFilesForReview(domain, review, deps) {
  const dq = deps.domainQuery;
  const dom = domainKey(domain);
  const pid = review.property_id != null ? String(review.property_id) : null;
  const sid = review.sale_id != null ? String(review.sale_id) : null;

  const ors = [];
  if (pid && /^\d+$/.test(pid)) ors.push(`linked_property_id.eq.${pid}`);
  if (sid) ors.push(`linked_sale_id.eq.${encodeURIComponent(sid)}`);
  if (!ors.length) return [];

  const cs = await dq(dom, 'GET',
    `sf_comp_staging?select=sf_comp_id,sf_deal_id,sf_listing_id,linked_property_id,linked_sale_id&or=(${ors.join(',')})`);
  if (!cs.ok || !Array.isArray(cs.data) || !cs.data.length) return [];

  const sfIds = new Set();
  for (const row of cs.data) {
    for (const k of ['sf_comp_id', 'sf_deal_id', 'sf_listing_id']) {
      if (row[k]) sfIds.add(String(row[k]));
    }
  }
  if (!sfIds.size) return [];

  const inList = [...sfIds].map((x) => `"${x}"`).join(',');
  // Match a file whose linked_entity_sf_id OR any of the traversal columns
  // (sf_comp_id/sf_listing_id/sf_deal_id) is one of the comp's SF ids.
  const orFilter = [
    `linked_entity_sf_id.in.(${inList})`,
    `sf_comp_id.in.(${inList})`,
    `sf_listing_id.in.(${inList})`,
    `sf_deal_id.in.(${inList})`,
  ].join(',');
  const fq = await dq(dom, 'GET',
    `sf_files?select=file_id,content_document_id,content_version_id,linked_entity_type,linked_entity_sf_id,sf_comp_id,sf_listing_id,sf_deal_id,title,file_name,extension,extraction_status,ingestion_status,process_notes,storage_path&or=(${orFilter})`);
  if (!fq.ok || !Array.isArray(fq.data)) return [];
  return fq.data;
}

// ── 2. EXTRACT — read the financial summary the sf_files pipeline already made ─
// REUSE: staged_intake_extractions.extraction_snapshot (LCC Opps), keyed by the
// intake id carried in sf_files.process_notes. No re-download, no duplicate AI.
export async function readOmFinancials(sfFile, deps) {
  const intakeId = parseIntakeId(sfFile && sfFile.process_notes);
  if (!intakeId) {
    return { available: false, reason: `no intake id in process_notes (status=${sfFile && sfFile.extraction_status})` };
  }
  if (String(sfFile.extraction_status || '') !== 'extracted') {
    return { available: false, reason: `sf_file not extracted yet (status=${sfFile.extraction_status})`, intake_id: intakeId };
  }
  const r = await deps.opsQuery('GET',
    `staged_intake_extractions?select=extraction_snapshot&intake_id=eq.${encodeURIComponent(intakeId)}&limit=1`,
    undefined, { countMode: 'none' });
  const snap = r.ok && Array.isArray(r.data) && r.data[0] ? r.data[0].extraction_snapshot : null;
  if (!snap) return { available: false, reason: 'no extraction_snapshot for intake', intake_id: intakeId };
  return { available: true, intake_id: intakeId, financials: normalizeOmSnapshot(snap) };
}

// Choose the best OM file for a review: prefer an extracted OM/flyer whose
// snapshot carries a usable income (NOI for gov, rent/NOI for dia).
async function selectOmForReview(domain, review, files, deps) {
  const isGov = isGovDomain(domain);
  const ranked = [...files].sort((a, b) => {
    const ra = OM_DOCTYPE_RANK[String(a.title || '').toLowerCase().includes('flyer') ? 'flyer' : 'om'] ?? 5;
    const rb = OM_DOCTYPE_RANK[String(b.title || '').toLowerCase().includes('flyer') ? 'flyer' : 'om'] ?? 5;
    return ra - rb;
  });
  let firstReadable = null;
  for (const f of ranked) {
    const read = await readOmFinancials(f, deps);
    if (!read.available) continue;
    const { income } = pickOmIncome(read.financials, isGov);
    if (!firstReadable) firstReadable = { file: f, ...read };
    if (income != null) return { file: f, ...read };   // usable income → take it
  }
  return firstReadable;   // extracted but income-less, or null
}

// ── 3. WRITE-THROUGH ────────────────────────────────────────────────────────
// gov: OM NOI → properties.noi (confirmed_document rank 3) via the guarded RPC.
export async function applyGovNoiWriteThrough({ propertyId, noi, asOf, sfFileId, apply }, deps) {
  const r = await deps.domainQuery('government', 'POST', 'rpc/gov_apply_om_confirmed_noi', {
    p_property_id: Number(propertyId),
    p_noi: noi,
    p_as_of: asOf || null,
    p_sf_file_id: sfFileId || null,
    p_dry_run: !apply,
  });
  if (!r.ok) return { ok: false, decision: 'rpc_error', detail: r.data };
  return { ok: true, ...(r.data || {}) };
}

// Multi-year projections → property_financials source='om_extract'. Fill-blanks
// per (property_id, fiscal_year): a year that already has ANY financials row is
// left untouched (conservative — never fights a unique-year constraint or
// clobbers curated actuals). Returns { written, skipped, years }.
export async function writeOmProjections({ domain, propertyId, projections, sfFileId, apply }, deps) {
  const dom = domainKey(domain);
  const isGov = isGovDomain(domain);
  const out = { written: 0, skipped: 0, years: [] };
  const rows = (projections || [])
    .map((p) => ({
      year: parseInt(p && (p.year ?? p.fiscal_year), 10),
      gross_rent: posNum(p.gross_rent ?? p.base_rent ?? p.gross_income),
      expenses: posNum(p.expenses ?? p.total_expenses ?? p.operating_expenses),
      noi: posNum(p.noi),
    }))
    .filter((p) => Number.isInteger(p.year) && p.year > 1990 && p.year < 2100
      && (p.gross_rent != null || p.expenses != null || p.noi != null));
  if (!rows.length) return out;

  for (const p of rows) {
    // Fill-blanks: skip a year that already has any financials row.
    const chk = await deps.domainQuery(dom, 'GET',
      `property_financials?select=property_id&property_id=eq.${Number(propertyId)}&fiscal_year=eq.${p.year}&limit=1`);
    if (chk.ok && Array.isArray(chk.data) && chk.data.length) { out.skipped++; continue; }

    const notes = `om_extract:${sfFileId || 'om'}`;
    const row = isGov
      ? { property_id: Number(propertyId), fiscal_year: p.year, gross_rent: p.gross_rent,
          total_expenses: p.expenses, noi: p.noi, source: 'om_extract', data_source: 'om_extract', notes }
      : { property_id: Number(propertyId), fiscal_year: p.year, gross_income: p.gross_rent,
          operating_expenses: p.expenses, noi: p.noi, source: 'om_extract', notes };
    if (!apply) { out.written++; out.years.push(p.year); continue; }   // dry-run counts intent
    const ins = await deps.domainQuery(dom, 'POST', 'property_financials', row,
      { Prefer: 'return=minimal' });
    if (ins.ok) { out.written++; out.years.push(p.year); } else { out.skipped++; }
  }
  return out;
}

// Attach OM figures onto the review row (detail.om) + set the disposition/note.
async function patchReviewRow({ domain, review, detailOm, status, note, apply }, deps) {
  if (!apply) return { ok: true, applied: false };
  const dom = domainKey(domain);
  const mergedDetail = Object.assign({}, review.detail || {}, { om: detailOm });
  const patch = { detail: mergedDetail };
  if (status) {
    patch.status = status;
    patch.resolved_at = status === 'resolved' ? new Date().toISOString() : null;
  }
  if (note != null) patch.resolution_note = String(note).slice(0, 2000);
  const r = await deps.domainQuery(dom, 'PATCH',
    `${reviewTable(domain)}?id=eq.${encodeURIComponent(review.id)}`, patch, { Prefer: 'return=minimal' });
  return { ok: !!r.ok, applied: true, status: r.status, detail: r.ok ? undefined : r.data };
}

// ── Orchestrate ONE review row through LINK → EXTRACT → WRITE → RESOLVE ──────
export async function resolveReviewRow({ domain, review, apply }, deps) {
  const isGov = isGovDomain(domain);
  const base = { id: review.id, domain: isGov ? 'gov' : 'dia', property_id: review.property_id,
    sale_id: review.sale_id, flags: review.flags || [] };

  const files = await findOmFilesForReview(domain, review, deps);
  if (!files.length) return { ...base, outcome: 'no_linked_file' };

  const picked = await selectOmForReview(domain, review, files, deps);
  if (!picked) return { ...base, outcome: 'linked_not_extracted', linked_files: files.length };

  const fin = picked.financials;
  const sfFileId = String(picked.file.file_id);
  const { income, kind } = pickOmIncome(fin, isGov);

  // 3a. gov NOI write-through (guarded/idempotent/dry-run-aware). dia: none.
  let writethrough = null;
  if (isGov && fin.noi != null && review.property_id && /^\d+$/.test(String(review.property_id))) {
    writethrough = await applyGovNoiWriteThrough(
      { propertyId: review.property_id, noi: fin.noi, asOf: review.sale_date, sfFileId, apply }, deps);
  }
  // 3b. projections → property_financials (both domains, fill-blanks).
  const projections = await writeOmProjections(
    { domain, propertyId: review.property_id, projections: fin.projections, sfFileId, apply }, deps);

  // 4. reconcile using the OM income.
  const recon = reconcileOmAgainstReview({ review, income, incomeKind: kind, sfFileId });

  const detailOm = {
    source: 'om_extract', sf_file_id: sfFileId, title: picked.file.title || picked.file.file_name || null,
    doctype: fin.doctype, noi: fin.noi, annual_rent: fin.annual_rent, cap_rate: fin.cap_rate,
    asking_price: fin.asking_price, sold_price: fin.sold_price, lease_expiration: fin.lease_expiration,
    rba: fin.rba, income_used: income, income_kind: kind,
    implied_cap_from_om: recon.implied_cap, reliable_cap: recon.reliable_cap,
    within_tolerance: recon.within_tolerance,
  };

  // Auto-resolve only when the OM reconciles AND at least one flag's premise the
  // reconciliation actually settles is present. Otherwise attach + leave open.
  const flagsResolvable = (review.flags || []).some((f) => RESOLVABLE_FLAGS.has(f));

  let status = null, note = null, outcome;
  if (recon.decision === 'resolve' && flagsResolvable) {
    status = 'resolved'; note = recon.note; outcome = 'resolved';
  } else if (recon.decision === 'resolve') {
    // Reconciles, but no cap/rent flag to clear (e.g. price_over_ask only).
    note = `om_attached:${sfFileId} — OM ${kind} $${income} reconciles to reliable ${(recon.reliable_cap * 100).toFixed(2)}%, but the open flag(s) are not cap/rent — human review`;
    outcome = 'left_open_flag_not_reconcilable';
  } else if (recon.decision === 'insufficient_data') {
    // OM present but no usable income → attach what we have, leave open.
    note = `om_attached:${sfFileId} — OM lacks a usable ${isGov ? 'NOI' : 'rent/NOI'}; human review`;
    outcome = 'left_open_no_income';
  } else if (recon.decision === 'no_reliable_cap') {
    note = `om_attached:${sfFileId} — OM ${kind} $${income} → implied ${(recon.implied_cap * 100).toFixed(2)}%; no reliable cap to reconcile; human review`;
    outcome = 'left_open_no_reliable_cap';
  } else { // leave_open (mismatch persists)
    note = `om_attached:${sfFileId} — OM ${kind} $${income} → implied ${(recon.implied_cap * 100).toFixed(2)}% vs reliable ${(recon.reliable_cap * 100).toFixed(2)}%; does not reconcile; human review`;
    outcome = 'left_open_mismatch';
  }

  const patched = await patchReviewRow({ domain, review, detailOm, status, note, apply }, deps);

  return { ...base, outcome, sf_file_id: sfFileId, om_income: income, income_kind: kind,
    implied_cap_from_om: recon.implied_cap, reliable_cap: recon.reliable_cap,
    within_tolerance: recon.within_tolerance, writethrough: writethrough ? writethrough.decision : null,
    projections_written: projections.written, patched: patched.applied ? patched.ok : 'dry_run' };
}

// ── 5. BACKFILL — run over open rows in one or both domain queues + report ───
export async function runOmCompResolution({ domain, apply = false, limit = 200, status = 'open' }, deps) {
  const doms = domain ? [domainKey(domain)] : ['government', 'dialysis'];
  const report = { apply: !!apply, status, by_domain: {}, results: [], errors: [] };

  for (const dom of doms) {
    const short = dom === 'government' ? 'gov' : 'dia';
    const q = await deps.domainQuery(dom, 'GET',
      `${reviewTable(dom)}?select=id,sale_id,property_id,comp_id,flags,detail,implied_cap,reliable_cap,sale_date,sale_price,status,address,city,state,tenant&status=eq.${encodeURIComponent(status)}&order=first_flagged_at.desc&limit=${Math.min(Number(limit) || 200, 500)}`);
    if (!q.ok || !Array.isArray(q.data)) {
      report.errors.push({ domain: short, error: q.data || `HTTP ${q.status}` });
      continue;
    }
    const agg = { scanned: q.data.length, with_linked_file: 0, with_om: 0, resolved: 0,
      left_open: 0, no_om: 0, writethroughs: 0, projections: 0 };
    for (const review of q.data) {
      try {
        const r = await resolveReviewRow({ domain: short, review, apply }, deps);
        report.results.push(r);
        if (r.outcome === 'no_linked_file') { agg.no_om++; continue; }
        if (r.outcome === 'linked_not_extracted') { agg.with_linked_file++; agg.no_om++; continue; }
        agg.with_linked_file++; agg.with_om++;
        if (r.outcome === 'resolved') agg.resolved++; else agg.left_open++;
        if (r.writethrough === 'written' || r.writethrough === 'dry_run') agg.writethroughs++;
        agg.projections += r.projections_written || 0;
      } catch (e) {
        report.errors.push({ domain: short, id: review.id, error: String(e && e.message || e) });
      }
    }
    report.by_domain[short] = agg;
  }
  return report;
}

// ── HTTP handler ────────────────────────────────────────────────────────────
// GET/POST /api/om-comp-resolve?domain=&apply=&limit=&status=
// Dry-run by default (apply must be explicitly true). Gated by X-LCC-Key like
// the other admin routes; auth is enforced by the server mount.
export function makeOmCompResolveHandler({ domainQuery, opsQuery }) {
  const deps = { domainQuery, opsQuery };
  return async function omCompResolveHandler(req, res) {
    try {
      const src = Object.assign({}, req.query || {}, req.body || {});
      const apply = src.apply === true || String(src.apply) === 'true';
      const domain = src.domain ? String(src.domain) : null;
      const limit = src.limit != null ? Number(src.limit) : 200;
      const status = src.status ? String(src.status) : 'open';
      const report = await runOmCompResolution({ domain, apply, limit, status }, deps);
      res.status(200).json(report);
    } catch (e) {
      res.status(500).json({ error: String(e && e.message || e) });
    }
  };
}
