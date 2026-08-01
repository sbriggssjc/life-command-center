// ============================================================================
// Grounded Dossier Generator — Property & Deal
// Life Command Center
// ----------------------------------------------------------------------------
// Turns a *reconciled* DATA PACKET (assembled by buildPropertyPacket /
// buildDealPacket in api/_handlers/entities-handler.js) into a print-ready HTML
// dossier that matches the gold-standard render
// (docs/architecture/dossier-example-5247-airways-v2.html) and obeys the
// NON-NEGOTIABLE grounding contract in
// docs/architecture/dossier-standard-and-llm-contract.md §1:
//
//   • Only what's in the packet — absent field renders exactly "Not on file."
//   • Never invent / infer / estimate / round-to-impress.
//   • Every material figure carries provenance (source · as-of · confidence).
//   • Derived values are labeled "Derived" with the formula/inputs shown.
//   • Conflicts are surfaced (reconciled value + Conflict note), never resolved
//     silently or averaged.
//   • Owner ≠ operator — the operator is named only in the tenancy section.
//   • Facts vs. Analysis are separated; Analysis recombines stated facts only.
//
// HOW FABRICATION IS PREVENTED (architecture note):
//   The FACT sections are rendered *deterministically in code* straight from the
//   tagged packet — the LLM never touches a fact, so it structurally cannot
//   invent one. The local Ollama seam (invokeExtractionAI in _shared/ai.js) is
//   used ONLY to author the optional "Analysis (not a stated fact)" prose, which
//   is fenced, derived-only, and gracefully omitted when the model is
//   unavailable. This satisfies §1 while using the Ollama seam as specified.
//
// Packet shape (per §2 of the standard). Every leaf is a TAG or omitted:
//   TAG        = { v, source?, as_of?, confidence? }
//   DERIVED    = { v, derived: "<formula/inputs>", source?:"derived" }
//   CONFLICT   = { reconciled?, unverified?:true, conflict:"<note>", values?:[{v,source}] }
//   (a missing/omitted key renders "Not on file")
//
//   { meta:        { title, subtitle, domain_label, footer_ids },
//     identity:    { property_type, building_sf, land_acres, year_built,
//                    ownership_type, stations, price_per_sf },
//     ownership:   { owner_of_record, recorded_deed_owner, operator_tenant,
//                    owner_is_spe, developer },
//     tenancy_lease:{ tenant, guarantor, annual_base_rent, year1_rent_psf,
//                     current_base_rent, current_rent_psf, lease_start,
//                     lease_expiration, term_remaining_years, expense_structure,
//                     escalations_text, renewal_options },
//     operations:  { stations, patient_count, ttm_treatments, certification_date,
//                    _conflicts:[{field, values:[{v,source}], reconciled}] },
//     valuation:   { model_estimate, last_sale_price },
//     transactions:[ { date, grantor, grantee, price, cap_rate, source } ],
//     transaction_marketing_timeline:[ { kind:'listing'|'sale', date, ... } ],
//     documents:   [ { type, file_name, source, reconciled?, date? } ],
//     // deal only:
//     deal:        { stage, point_person, parties:[{role,name,flag,source}],
//                    correspondence:[{date,direction,subject,source}],
//                    offers:[{date,buyer,price,status}],
//                    cadence:{next_touch_due, next_touch_type},
//                    roe:{verdict, reason} } }
// ============================================================================

import { invokeExtractionAI } from './ai.js';
import { uploadArtifactToStorage, artifactObjectPath, ARTIFACT_BUCKET } from './artifact-storage.js';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// The gold-standard stylesheet (verbatim from dossier-example-5247-airways-v2.html
// so stored dossiers render identically to the reviewed target).
// ---------------------------------------------------------------------------
const DOSSIER_CSS = `
body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1a1a1a;margin:0;background:#f4f5f7}
.doc{max-width:860px;margin:24px auto;background:#fff;padding:40px 48px;box-shadow:0 1px 6px rgba(0,0,0,.12)}
header{border-bottom:3px solid #4f46e5;padding-bottom:16px;margin-bottom:8px}
.brand{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#4f46e5}
.type{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.1em;margin-top:2px}
h1{font-size:24px;margin:10px 0 2px}
.loc{color:#555;font-size:14px}
.meta{color:#999;font-size:11px;margin-top:8px}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#4f46e5;border-bottom:1px solid #eee;padding-bottom:5px;margin:26px 0 10px}
table.kv{width:100%;border-collapse:collapse}
table.kv td{padding:6px 0;vertical-align:top;border-bottom:1px solid #f0f0f0;font-size:13px}
td.k{color:#777;width:250px}
td.v{color:#1a1a1a;font-weight:500}
.src{color:#999;font-weight:400;font-size:11px}
.na{color:#b00;font-style:italic;font-weight:400}
.derived{color:#4f46e5;font-weight:400;font-size:11px;font-style:italic}
table.hist{width:100%;border-collapse:collapse;font-size:12.5px}
table.hist th{text-align:left;color:#777;font-weight:600;border-bottom:2px solid #eee;padding:6px 8px 6px 0}
table.hist td{padding:6px 8px 6px 0;border-bottom:1px solid #f2f2f2;vertical-align:top}
.badge{display:inline-block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:1px 6px;border-radius:4px;vertical-align:middle}
.b-live{background:#e6f4ea;color:#1e7e34}.b-off{background:#f0f0f0;color:#888}.b-rec{background:#e6f4ea;color:#1e7e34}.b-unrec{background:#fff3cd;color:#8a6d00}
.conflict{background:#fff8e1;border:1px solid #ffe082;border-radius:6px;padding:8px 10px;font-size:12px;color:#8a6d00;margin-top:8px}
.trend{color:#1e7e34;font-weight:600}
.analysis{background:#eef2ff;border:1px solid #c7d2fe;border-radius:6px;padding:12px 14px;margin-top:12px}
.analysis .lbl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#4f46e5}
.analysis ul{margin:8px 0 0;padding-left:18px;font-size:12.5px;color:#333}
.note{font-size:12.5px;color:#333;line-height:1.55;margin:6px 0}
footer{margin-top:32px;padding-top:14px;border-top:1px solid #eee;color:#999;font-size:10.5px}
@media print{body{background:#fff}.doc{box-shadow:none;margin:0;max-width:none}}
`.trim();

// The verbatim §1 grounding contract — becomes the LLM system preamble.
const GROUNDING_CONTRACT = `You are authoring the OPTIONAL "Analysis" prose for a Team Briggs / Northmarq property or deal dossier. You are given a reconciled DATA PACKET (JSON). NON-NEGOTIABLE RULES:
1. Only use what's in the DATA PACKET. Every statement must trace to a packet field. If it isn't in the packet, do not write it.
2. Never invent, infer, estimate, round-to-impress, or "fill in." No made-up rents, dates, sizes, names, cap rates, market color, or comps.
3. Derived values are allowed ONLY when every input is present in the packet, and MUST be labeled "Derived:" with the formula/inputs shown (e.g. "Implied cap rate 5.78% — Derived: rent $181,959 ÷ sale $3,150,000").
4. Conflicts are surfaced, never resolved silently or averaged.
5. Owner is never the operator.
6. No external knowledge — nothing you "know" about a tenant, market, REIT, or submarket. Only the packet.
7. You produce ANALYSIS ONLY (recombinations of stated facts). Introduce NO new data. If the facts don't support an analytical point, omit it.
OUTPUT FORMAT: return ONLY a sequence of HTML <li>…</li> list items (no <ul>, no other tags, no prose outside <li>). 1–5 items. Each item is one derived/recombined observation, and any computed figure is prefixed with "Derived: " and its inputs. If the packet does not support ANY grounded analysis, return exactly: <li>No analysis is supported by the facts on file.</li>`;

const VERIFICATION_FOOTER = 'Generated by the Life Command Center from the reconciled LCC data spine. Facts trace to LCC sources; figures are for internal BD use and must be verified against source documents before external distribution.';

// ---------------------------------------------------------------------------
// primitives
// ---------------------------------------------------------------------------
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fmtMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return esc(v);
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}
function fmtMoney2(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return esc(v);
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtNum(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return esc(v);
  return n.toLocaleString('en-US');
}
function fmtPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return esc(v);
  const pct = Math.abs(n) <= 1 ? n * 100 : n;
  return pct.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\.00$/, '') + '%';
}
function fmtDate(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return esc(v);
  return d.toISOString().slice(0, 10);
}
const NA = '<span class="na">Not on file</span>';

// Render one packet TAG. `fmt` is one of the formatter fns above (defaults to
// plain escape). Returns the "Not on file" span when the tag is absent — this is
// the single point that enforces "absence renders 'Not on file'" (§1.2).
function renderTag(tag, fmt = esc) {
  if (tag == null) return NA;
  // string / number shorthand (untagged) — still allowed, no provenance chip.
  if (typeof tag !== 'object') return fmt(tag);

  // Conflict tag — surface, don't resolve (§1.5).
  if (tag.conflict) {
    const shown = tag.reconciled != null
      ? fmt(tag.reconciled)
      : (tag.unverified ? '<span class="na">Unverified — not asserted</span>' : NA);
    return `${shown}<div class="conflict">Conflict: ${esc(tag.conflict)}</div>`;
  }

  const hasVal = tag.v != null && tag.v !== '';
  if (!hasVal) return NA;
  const val = fmt(tag.v);

  // Derived tag — label + inputs (§1.4).
  if (tag.derived) {
    return `${val}<br><span class="derived">Derived: ${esc(tag.derived)}</span>`;
  }

  // Provenance chip (source · as-of · confidence) (§1.3).
  const bits = [];
  if (tag.source) bits.push('source: ' + esc(tag.source));
  if (tag.as_of) bits.push('as-of ' + esc(fmtDate(tag.as_of)));
  if (tag.confidence != null) bits.push('confidence ' + esc(tag.confidence));
  const chip = bits.length ? ` <span class="src">&middot; ${bits.join(' &middot; ')}</span>` : '';
  return `${val}${chip}`;
}

function kvRow(label, tag, fmt) {
  return `<tr><td class="k">${esc(label)}</td><td class="v">${renderTag(tag, fmt)}</td></tr>`;
}

function kvRowHtml(label, html) {
  return `<tr><td class="k">${esc(label)}</td><td class="v">${html || NA}</td></tr>`;
}

function renderRentAndPsf(rentTag, psfTag) {
  const rent = renderTag(rentTag, fmtMoney);
  const psf = renderTag(psfTag, (v) => fmtMoney2(v) + '/SF');
  if (rent === NA && psf === NA) return NA;
  return `${rent} <span class="src">&middot;</span> ${psf}`;
}

function renderResponsibilitySplit(lease) {
  const rows = [
    ['Roof', lease.roof_responsibility],
    ['Structure', lease.structure_responsibility],
    ['Parking', lease.parking_responsibility],
    ['HVAC', lease.hvac_responsibility],
  ].map(([label, tag]) => `${esc(label)}: ${renderTag(tag)}`);
  return rows.join('<br>');
}

function renderExpenseStructureProse(lease) {
  const bits = [];
  const structure = renderTag(lease.expense_structure);
  if (structure !== NA) bits.push(`Lease structure: ${structure}`);
  const responsibilities = [
    ['roof', lease.roof_responsibility],
    ['structure', lease.structure_responsibility],
    ['parking', lease.parking_responsibility],
    ['HVAC', lease.hvac_responsibility],
  ].map(([label, tag]) => `${label} ${renderTag(tag)}`);
  bits.push(`Responsibilities: ${responsibilities.join(' · ')}`);
  return bits.join('<br>');
}

// A section is emitted only when it has a title; rows are always emitted (missing
// fields become "Not on file" so the reader sees the gap, per §1.8).
function kvSection(title, rows) {
  return `<h2>${esc(title)}</h2><table class="kv">${rows.join('')}</table>`;
}

// ---------------------------------------------------------------------------
// FACT sections — deterministic, packet-driven (no LLM)
// ---------------------------------------------------------------------------
function renderRelocation(reloc) {
  if (!reloc) return NA;
  const priorAddr = renderTag(reloc.prior_address);
  const priorStations = renderTag(reloc.prior_stations, fmtNum);
  const currentStations = renderTag(reloc.current_stations, fmtNum);
  const distance = renderTag(reloc.distance_miles, (v) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 1 }) + ' mi');
  const originalCert = renderTag(reloc.original_certification_date, fmtDate);
  const facilityCert = renderTag(reloc.facility_certification_date, fmtDate);
  return [
    `Operator prior certification: ${originalCert}`,
    `Current facility certification: ${facilityCert}`,
    `Prior site: ${priorAddr}`,
    `Stations: ${priorStations} → ${currentStations}`,
    `Distance moved: ${distance}`,
  ].join('<br>');
}

function renderMarketCompetition(rows) {
  if (!Array.isArray(rows) || !rows.length) {
    return `<h2>Market Competition</h2><table class="kv"><tr><td class="v">${NA}</td></tr></table>`;
  }
  const body = rows.map(r => {
    const place = [r.address, [r.city, r.state].filter(Boolean).join(', ')].filter(Boolean)
      .map(x => esc(x))
      .join('<br>');
    const rent = r.rent_per_sf != null
      ? `${fmtMoney2(r.rent_per_sf)}/SF${r.rent_source ? ` <span class="src">&middot; ${esc(r.rent_source)}</span>` : ''}`
      : NA;
    return `<tr>` +
      `<td>${esc(r.medicare_id || '')}</td>` +
      `<td>${esc(r.facility_name || '')}<br><span class="src">${place}</span></td>` +
      `<td>${r.distance_miles != null ? esc(Number(r.distance_miles).toFixed(2) + ' mi') : NA}</td>` +
      `<td>${esc(r.operator || '') || NA}</td>` +
      `<td>${r.stations != null ? fmtNum(r.stations) : NA}</td>` +
      `<td>${r.patients != null ? fmtNum(r.patients) : NA}</td>` +
      `<td>${rent}</td>` +
      `</tr>`;
  }).join('');
  return `<h2>Market Competition</h2><table class="hist"><thead><tr><th>CCN</th><th>Facility</th><th>Distance</th><th>Operator</th><th>Stations</th><th>Patients</th><th>Rent/SF</th></tr></thead><tbody>${body}</tbody></table>`;
}

function renderPropertySections(p) {
  const id = p.identity || {};
  const own = p.ownership || {};
  const lease = p.tenancy_lease || {};
  const ops = p.operations || {};
  const val = p.valuation || {};
  const out = [];

  // 2. Snapshot
  out.push(kvSection('Snapshot', [
    kvRow('Property type', id.property_type),
    kvRow('Building size', id.building_sf, (v) => fmtNum(v) + ' SF'),
    kvRow('Land area', id.land_acres, (v) => fmtNum(v) + ' acres'),
    kvRow('Year built', id.year_built),
    id.stations ? kvRow('Stations (chairs)', id.stations, fmtNum) : '',
    kvRow('Ownership type', id.ownership_type),
    id.price_per_sf ? kvRow('Price / SF', id.price_per_sf, (v) => fmtMoney(v) + '/SF') : '',
    kvRow('LCC value estimate', val.model_estimate, fmtMoney),
  ].filter(Boolean)));

  // 3. Ownership — Owner is never the operator (§1.6).
  out.push(kvSection('Ownership', [
    kvRow('Owner of record', own.owner_of_record),
    own.recorded_deed_owner ? kvRow('Recorded deed owner', own.recorded_deed_owner) : '',
    kvRow('Operator / tenant', own.operator_tenant
      ? { ...own.operator_tenant, v: (own.operator_tenant.v != null ? own.operator_tenant.v + ' — the operator, not the owner' : own.operator_tenant.v) }
      : null),
    kvRow('Owner is a single-purpose entity', own.owner_is_spe),
    own.developer ? kvRow('Original developer', own.developer) : '',
  ].filter(Boolean)));

  // 4. Tenancy & Lease
  out.push(kvSection('Tenancy & Lease', [
    kvRow('Tenant', lease.tenant),
    kvRow('Guarantor', lease.guarantor),
    kvRow('Guaranty scope', lease.guaranty_scope),
    kvRowHtml('Year-1 rent + $/SF', renderRentAndPsf(lease.annual_base_rent, lease.year1_rent_psf)),
    kvRowHtml('Current rent + $/SF', renderRentAndPsf(lease.current_base_rent, lease.current_rent_psf)),
    kvRow('Lease term', lease.lease_term || renderTermTag(lease)),
    lease.term_remaining_years ? kvRow('Term remaining (years)', lease.term_remaining_years) : '',
    kvRow('Expense structure', lease.expense_structure),
    kvRowHtml('Expense-structure prose', renderExpenseStructureProse(lease)),
    kvRowHtml('Responsibilities (roof / structure / parking / HVAC)', renderResponsibilitySplit(lease)),
    kvRow('Escalations', lease.escalations_text),
    kvRow('Renewal options', lease.renewal_options),
    kvRow('Bumps continue through options?', lease.option_bumps_continue),
  ].filter(Boolean)));

  // 5. Operations (CMS / agency)
  if (ops && (ops.stations || ops.patient_count || ops.ttm_treatments || ops.certification_date || (ops._conflicts && ops._conflicts.length) || ops.agency)) {
    const rows = [];
    if (ops.agency) rows.push(kvRow('Agency', ops.agency));
    if (ops.gsa_lease_number) rows.push(kvRow('GSA lease #', ops.gsa_lease_number));
    rows.push(kvRow('Stations (chairs)', ops.stations, fmtNum));
    rows.push(kvRow('Current patient count', ops.patient_count, fmtNum));
    rows.push(kvRow('Annual treatments (TTM)', ops.ttm_treatments, fmtNum));
    rows.push(kvRow('Certification date', ops.certification_date));
    rows.push(kvRowHtml('Relocation lineage', renderRelocation(ops.relocation)));
    let block = `<h2>Operations</h2><table class="kv">${rows.filter(Boolean).join('')}</table>`;
    for (const c of (ops._conflicts || [])) {
      const vals = (c.values || []).map(x => `${esc(x.v)} (${esc(x.source)})`).join(' vs ');
      block += `<div class="conflict">Conflict — ${esc(c.field)}: ${vals}${c.reconciled != null ? ` — reconciled: ${esc(c.reconciled)}` : ' — not reconciled; shown as unverified, not asserted.'}</div>`;
    }
    out.push(block);
    out.push(renderMarketCompetition(ops.market_competition));
  }

  // 6. Transaction & Marketing Timeline
  out.push(renderTransactionMarketingTimeline(p.transaction_marketing_timeline, p.transactions));

  // 7. Documents
  out.push(renderDocuments(p.documents));

  return out.join('\n');
}

function renderTermTag(lease) {
  const s = lease.lease_start, e = lease.lease_expiration;
  if (!s && !e) return null;
  const sv = s ? renderTag(s, fmtDate) : NA;
  const ev = e ? renderTag(e, fmtDate) : NA;
  // Build a synthetic display tag (no provenance chip — the endpoints carry theirs)
  return { v: `${(s && s.v) ? fmtDate(s.v) : 'Not on file'} → ${(e && e.v) ? fmtDate(e.v) : 'Not on file'}` };
}

function unwrap(v) {
  return v && typeof v === 'object' && v.v !== undefined ? v.v : v;
}

function renderTimelineBadge(status, kind) {
  const s = String(status || '').toLowerCase();
  if (kind === 'sale' || s === 'live' || s === 'active') return '<span class="badge b-live">' + esc(status || (kind === 'sale' ? 'live' : 'active')) + '</span>';
  return '<span class="badge b-off">' + esc(status || 'off-market') + '</span>';
}

function renderTransactionMarketingTimeline(timeline, txns) {
  const events = Array.isArray(timeline) && timeline.length ? timeline : null;
  if (!events) return renderTransactions(txns);

  const rows = events.map(ev => {
    const date = ev.date ? fmtDate(unwrap(ev.date)) : '';
    if (ev.kind === 'sale') {
      const capBits = [];
      if (ev.stated_cap_rate) capBits.push(`${renderTag(ev.stated_cap_rate, fmtPct).replace(/ <span class="src">[\s\S]*?<\/span>/, '')} stated`);
      if (ev.calculated_cap_rate) capBits.push(`${renderTag(ev.calculated_cap_rate, fmtPct).replace(/ <span class="src">[\s\S]*?<\/span>/, '')} calc`);
      const term = ev.firm_term_years_at_sale ? `${renderTag(ev.firm_term_years_at_sale, (v) => Number(v).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' yr').replace(/ <span class="src">[\s\S]*?<\/span>/, '')} firm at close` : '';
      return `<tr><td>${esc(date) || '&mdash;'}</td>` +
        `<td>${esc(ev.event || 'Sale')} ${renderTimelineBadge(ev.status || 'live', 'sale')}</td>` +
        `<td>${renderTag(ev.party)}</td>` +
        `<td>${renderTag(ev.price, fmtMoney)}</td>` +
        `<td>${[capBits.join(' / '), term].filter(Boolean).join(' &middot; ') || '<span class="src">&mdash;</span>'}</td></tr>`;
    }

    const price = renderTag(ev.asking_price, fmtMoney);
    const psf = ev.price_per_sf ? renderTag(ev.price_per_sf, (v) => fmtMoney2(v) + '/SF') : '';
    const cap = ev.cap_rate ? renderTag(ev.cap_rate, fmtPct).replace(/ <span class="src">[\s\S]*?<\/span>/, '') : '';
    const dom = ev.days_on_market ? renderTag(ev.days_on_market, (v) => fmtNum(v) + ' days').replace(/<br><span class="derived">[\s\S]*?<\/span>/, '') : '';
    const priceHtml = [price, psf].filter(Boolean).join('<br>');
    const metricHtml = [cap, dom, renderTag(ev.portfolio_flag)].filter(Boolean).join('<br>');
    return `<tr><td>${esc(date) || '&mdash;'}</td>` +
      `<td>${esc(ev.event || 'Listed for sale')} ${renderTimelineBadge(ev.status, 'listing')}</td>` +
      `<td>${renderTag(ev.broker)}</td>` +
      `<td>${priceHtml}</td>` +
      `<td>${metricHtml}</td></tr>`;
  }).join('');

  const notes = events
    .filter(ev => ev.portfolio_note)
    .map(ev => `<div class="conflict"><b>Portfolio listing:</b> ${renderTag(ev.portfolio_note)}</div>`)
    .join('');

  return `<h2>Transaction &amp; Marketing Timeline</h2><table class="hist"><thead><tr><th>Date</th><th>Event</th><th>Party / Broker</th><th>Price / Ask</th><th>Cap / Term / Market</th></tr></thead><tbody>${rows}</tbody></table>${notes}`;
}

function renderTransactions(txns) {
  if (!Array.isArray(txns) || !txns.length) {
    return `<h2>Transaction History</h2><table class="kv"><tr><td class="v">${NA}</td></tr></table>`;
  }
  const rows = txns.map(t => {
    const date = t.date ? fmtDate(t.date && t.date.v != null ? t.date.v : t.date) : '';
    const grantor = t.grantor && t.grantor.v != null ? t.grantor.v : (t.grantor || '');
    const grantee = t.grantee && t.grantee.v != null ? t.grantee.v : (t.grantee || '');
    const price = t.price != null ? (t.price.v != null ? t.price.v : t.price) : null;
    const cap = t.cap_rate != null ? (t.cap_rate.v != null ? t.cap_rate.v : t.cap_rate) : null;
    const src = t.source && t.source.v != null ? t.source.v : (t.source || '');
    return `<tr><td>${esc(date) || '&mdash;'}</td>` +
      `<td>${esc(grantor)} &rarr; ${esc(grantee)}</td>` +
      `<td>${price != null ? fmtMoney(price) : '&mdash;'}${cap != null ? ` <span class="src">@ ${esc(cap)}</span>` : ''}</td>` +
      `<td class="src">${esc(src)}</td></tr>`;
  }).join('');
  return `<h2>Transaction History</h2><table class="hist"><thead><tr><th>Date</th><th>Grantor &rarr; Grantee</th><th>Price</th><th>Source</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderDocuments(docs) {
  if (!Array.isArray(docs) || !docs.length) {
    return `<h2>Documents on File</h2><table class="kv"><tr><td class="v">${NA}</td></tr></table>`;
  }
  const rows = docs.map(d => {
    const type = d.type && d.type.v != null ? d.type.v : (d.type || 'document');
    const name = d.file_name && d.file_name.v != null ? d.file_name.v : (d.file_name || '(document)');
    const src = d.source && d.source.v != null ? d.source.v : (d.source || '');
    const date = d.date ? fmtDate(d.date.v != null ? d.date.v : d.date) : '';
    const badge = d.reconciled === false
      ? '<span class="badge b-unrec">not reconciled</span>'
      : (d.reconciled === true ? '<span class="badge b-rec">linked</span>' : '');
    return `<tr><td>${esc(type)}</td><td>${esc(name)} ${badge}</td><td class="src">${esc(src)}${date ? ' &middot; ' + esc(date) : ''}</td></tr>`;
  }).join('');
  return `<h2>Documents on File</h2><table class="hist"><thead><tr><th>Type</th><th>File</th><th>Source</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderDealSections(p) {
  const d = p.deal || {};
  const out = [];

  // 2. The property (compact)
  const id = p.identity || {};
  const own = p.ownership || {};
  const lease = p.tenancy_lease || {};
  out.push(kvSection('The Property', [
    kvRow('Property type', id.property_type),
    kvRow('Owner of record', own.owner_of_record),
    kvRow('Operator / tenant', own.operator_tenant),
    kvRow('Year-1 base rent', lease.annual_base_rent, fmtMoney),
    kvRow('Lease term', renderTermTag(lease)),
  ].filter(Boolean)));

  // 2b. Commission (stage-aware). Absent → "Not on file" (no ELA linked).
  if (Array.isArray(d.commission) && d.commission.length) {
    const rows = d.commission.map(c => {
      const parts = [];
      if (c.direct_pct != null) parts.push(`direct ${fmtPct(c.direct_pct)}`);
      if (c.co_broker_pct != null) parts.push(`co-broker ${fmtPct(c.co_broker_pct)}`);
      if (c.co_broker_split != null) parts.push(`split ${fmtPct(c.co_broker_split)}`);
      const fee = c.fee_amount != null ? fmtMoney(c.fee_amount) : '&mdash;';
      return `<tr><td>${esc(c.stage_basis || '')}</td><td>${esc(parts.join(', ') || c.structure || '')}</td><td>${fee}</td><td class="src">${esc(c.source || '')}</td></tr>`;
    }).join('');
    out.push(`<h2>Commission</h2><table class="hist"><thead><tr><th>Stage</th><th>Structure</th><th>Fee</th><th>Source</th></tr></thead><tbody>${rows}</tbody></table>`);
  } else {
    out.push(`<h2>Commission</h2><table class="kv"><tr><td class="v">${NA}</td></tr></table>`);
  }

  // 2c. Transaction story & milestones (compress older, expand recent).
  if (Array.isArray(d.milestones) && d.milestones.length) {
    const rows = d.milestones.map(mi =>
      `<tr><td>${esc(fmtDate(mi.date))}</td><td>${esc(mi.milestone_key || '')}</td><td>${esc(mi.status || '')}</td><td>${esc(mi.summary || '')}</td><td class="src">${esc(mi.source || '')}</td></tr>`
    ).join('');
    out.push(`<h2>Transaction Story &amp; Milestones</h2><table class="hist"><thead><tr><th>Date</th><th>Milestone</th><th>Status</th><th>Summary</th><th>Source</th></tr></thead><tbody>${rows}</tbody></table>`);
  } else {
    out.push(`<h2>Transaction Story &amp; Milestones</h2><table class="kv"><tr><td class="v">${NA}</td></tr></table>`);
  }

  // 3. Parties (by side/role; CoStar-sourced broker flagged unverified until our own systems confirm).
  if (Array.isArray(d.parties) && d.parties.length) {
    const rows = d.parties.map(pt => {
      const flag = pt.flag ? ` <span class="badge b-off">${esc(pt.flag)}</span>` : '';
      return `<tr><td>${esc(pt.side || '')}</td><td>${esc(pt.role || '')}</td><td>${esc(pt.name || '')}${flag}</td><td class="src">${esc(pt.source || '')}</td></tr>`;
    }).join('');
    out.push(`<h2>Parties</h2><table class="hist"><thead><tr><th>Side</th><th>Role</th><th>Party</th><th>Source</th></tr></thead><tbody>${rows}</tbody></table>`);
  } else {
    out.push(`<h2>Parties</h2><table class="kv"><tr><td class="v">${NA}</td></tr></table>`);
  }

  // 3b. Conflicts (surfaced, never auto-resolved).
  if (Array.isArray(d.conflicts) && d.conflicts.length) {
    const rows = d.conflicts.map(cf => {
      const vals = Array.isArray(cf.values) ? cf.values.map(x => `${esc(x.v || '')} <span class="src">(${esc(x.source || '')})</span>`).join('<br>') : '';
      return `<tr><td>${esc(cf.field || '')}</td><td>${vals}</td><td>${esc(cf.note || '')}</td></tr>`;
    }).join('');
    out.push(`<h2>Conflicts to reconcile</h2><table class="hist"><thead><tr><th>Field</th><th>Values</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table>`);
  }

  // 3c. Diligence & vendors.
  if (Array.isArray(d.diligence) && d.diligence.length) {
    const rows = d.diligence.map(v =>
      `<tr><td>${esc(v.vendor || '')}</td><td>${esc(v.type || '')}</td><td>${esc(fmtDate(v.ordered_date))}</td><td>${esc(fmtDate(v.report_eta))}</td><td>${v.lender_required ? 'Yes' : ''}</td></tr>`
    ).join('');
    out.push(`<h2>Diligence &amp; Vendors</h2><table class="hist"><thead><tr><th>Vendor</th><th>Type</th><th>Ordered</th><th>Report ETA</th><th>Lender req.</th></tr></thead><tbody>${rows}</tbody></table>`);
  } else {
    out.push(`<h2>Diligence &amp; Vendors</h2><table class="kv"><tr><td class="v">${NA}</td></tr></table>`);
  }

  // 4. Correspondence — living rollup summary + the thread list.
  if (d.correspondence_summary && d.correspondence_summary.summary) {
    const cs = d.correspondence_summary;
    out.push(`<h2>Correspondence Summary</h2><table class="kv"><tr><td class="v">${esc(cs.summary)}</td></tr>` +
      `<tr><td class="src">${cs.thread_count != null ? esc(cs.thread_count + ' thread(s)') : ''} · source ${esc(cs.source || '')}</td></tr></table>`);
  }
  if (Array.isArray(d.correspondence) && d.correspondence.length) {
    const rows = d.correspondence.map(c =>
      `<tr><td>${esc(fmtDate(c.date))}</td><td>${esc(c.direction || '')}</td><td>${esc(c.subject || '')}</td><td class="src">${esc(c.source || '')}</td></tr>`
    ).join('');
    out.push(`<h2>Correspondence</h2><table class="hist"><thead><tr><th>Date</th><th>Direction</th><th>Subject</th><th>Source</th></tr></thead><tbody>${rows}</tbody></table>`);
  } else if (!(d.correspondence_summary && d.correspondence_summary.summary)) {
    out.push(`<h2>Correspondence</h2><table class="kv"><tr><td class="v">${NA}</td></tr></table>`);
  }

  // 4b. Documents (deal room / SF / Sharefile, reconciled status).
  if (Array.isArray(d.documents) && d.documents.length) {
    const rows = d.documents.map(doc =>
      `<tr><td>${esc(doc.type || '')}</td><td>${esc(doc.name || '')}</td><td>${esc(fmtDate(doc.date))}</td><td>${doc.reconciled ? 'reconciled' : 'unreconciled'}</td><td class="src">${esc(doc.source || '')}</td></tr>`
    ).join('');
    out.push(`<h2>Documents</h2><table class="hist"><thead><tr><th>Type</th><th>Name</th><th>Date</th><th>Status</th><th>Source</th></tr></thead><tbody>${rows}</tbody></table>`);
  } else {
    out.push(`<h2>Documents</h2><table class="kv"><tr><td class="v">${NA}</td></tr></table>`);
  }

  // 4c. Connected sources (which systems feed this record + gaps).
  const csx = d.connected_sources || {};
  if (Object.keys(csx).length) {
    out.push(kvSection('Connected Sources', [
      kvRow('CoStar', csx.costar ? { v: csx.costar } : undefined),
      kvRow('Salesforce', csx.salesforce ? { v: csx.salesforce } : undefined),
      kvRow('Outlook', csx.outlook ? { v: csx.outlook } : undefined),
      kvRow('Sharefile', csx.sharefile ? { v: csx.sharefile } : undefined),
      kvRow('Deal spine', csx.deal_spine ? { v: csx.deal_spine } : undefined),
    ].filter(Boolean)));
  }

  // 5. Offers / LOIs
  if (Array.isArray(d.offers) && d.offers.length) {
    const rows = d.offers.map(o =>
      `<tr><td>${esc(fmtDate(o.date))}</td><td>${esc(o.buyer || '')}</td><td>${o.price != null ? fmtMoney(o.price) : '&mdash;'}</td><td>${esc(o.status || '')}</td></tr>`
    ).join('');
    out.push(`<h2>Offers / LOIs</h2><table class="hist"><thead><tr><th>Date</th><th>Buyer</th><th>Price</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`);
  } else {
    out.push(`<h2>Offers / LOIs</h2><table class="kv"><tr><td class="v">${NA}</td></tr></table>`);
  }

  // 6. Cadence & next action
  const cad = d.cadence || {};
  out.push(kvSection('Cadence & Next Action', [
    kvRow('Next touch due', cad.next_touch_due, fmtDate),
    kvRow('Next touch type', cad.next_touch_type),
  ]));

  // 7. Rules of engagement
  const roe = d.roe || {};
  out.push(kvSection('Rules of Engagement', [
    kvRow('Verdict', roe.verdict),
    kvRow('Reason', roe.reason),
  ]));

  return out.join('\n');
}

// ---------------------------------------------------------------------------
// ANALYSIS section — LLM authored (local Ollama seam), fenced + derived-only.
// Returns a sanitized <li>…</li> fragment, or null on any failure/unavailability
// (the dossier is complete without it).
// ---------------------------------------------------------------------------
function sanitizeAnalysisFragment(raw) {
  if (!raw || typeof raw !== 'string') return null;
  // Strip anything that isn't an <li> list item. We keep only <li>…</li> chunks
  // and re-escape nothing inside (the model was told to emit plain text in <li>),
  // but we DO strip scripts / event handlers / other tags defensively.
  const items = [];
  const re = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = re.exec(raw)) !== null) {
    let inner = m[1]
      .replace(/<\/?(?:script|style|iframe|object|embed|link|meta)[^>]*>/gi, '')
      .replace(/<[^>]+>/g, '')            // drop any remaining tags → plain text
      .replace(/\s+/g, ' ')
      .trim();
    if (inner) items.push(`<li>${esc(inner)}</li>`);
    if (items.length >= 6) break;
  }
  if (!items.length) return null;
  return items.join('');
}

async function authorAnalysis(packet, kind) {
  try {
    const prompt = `${GROUNDING_CONTRACT}\n\nDATA PACKET (kind=${kind}):\n${JSON.stringify(packet)}`;
    // Bound the optional analysis so a slow/unreachable model (whose fallback
    // chain can back off tens of seconds) can never stall dossier generation —
    // the facts are already rendered, so we just omit analysis on timeout.
    const capMs = Number(process.env.DOSSIER_ANALYSIS_TIMEOUT_MS || 20000);
    const res = await Promise.race([
      invokeExtractionAI({ prompt }),
      new Promise((resolve) => setTimeout(() => resolve({ ok: false, data: { error: 'analysis_timeout' } }), capMs)),
    ]);
    if (!res || !res.ok) return { fragment: null, ok: false, model: res?.data?.model || null };
    const text = res.data?.response || '';
    const fragment = sanitizeAnalysisFragment(text);
    return { fragment, ok: !!fragment, model: res.data?.model || null, tried: res.tried || null };
  } catch (_e) {
    return { fragment: null, ok: false, model: null };
  }
}

// ---------------------------------------------------------------------------
// Document shell
// ---------------------------------------------------------------------------
function wrapDocument({ kind, meta, sectionsHtml, analysisFragment }) {
  const title = (meta && meta.title) || (kind === 'deal' ? 'Deal Dossier' : 'Property Dossier');
  const subtitle = (meta && meta.subtitle) || '';
  const typeLabel = kind === 'deal' ? 'Deal Dossier' : 'Property Dossier';
  const domainLabel = (meta && meta.domain_label) || '';
  const footerIds = (meta && meta.footer_ids) || '';
  const gen = (meta && meta.generated_date) || new Date().toISOString().slice(0, 10);

  const analysisBlock = analysisFragment
    ? `<h2>Analysis (not a stated fact)</h2><div class="analysis"><div class="lbl">Analysis — derived only; recombines stated facts, introduces no new data</div><ul>${analysisFragment}</ul></div>`
    : '';

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} — ${esc(typeLabel)}</title><style>${DOSSIER_CSS}</style></head>` +
    `<body><div class="doc">` +
    `<header>` +
    `<div class="brand">Team Briggs &middot; Northmarq</div>` +
    `<div class="type">${esc(typeLabel)}</div>` +
    `<h1>${esc(title)}</h1>` +
    (subtitle ? `<div class="loc">${esc(subtitle)}</div>` : '') +
    `<div class="meta">${[domainLabel, `Generated ${esc(gen)}`, 'Life Command Center', footerIds].filter(Boolean).join(' &middot; ')}</div>` +
    `</header>` +
    sectionsHtml +
    analysisBlock +
    `<footer>${esc(VERIFICATION_FOOTER)}</footer>` +
    `</div></body></html>`;
}

// ---------------------------------------------------------------------------
// Public: generateDossier
// ---------------------------------------------------------------------------
/**
 * Produce the dossier HTML from a reconciled packet.
 * @param {object}   o
 * @param {'property'|'deal'} o.kind
 * @param {object}   o.packet     the reconciled DATA PACKET (§2 shape)
 * @param {string}   o.entityId   the LCC asset/deal entity id (for source hash)
 * @param {string}  [o.title]     overrides packet.meta.title
 * @returns {Promise<{html, source_hash, title, kind, analysis:{ok,model,tried}}>}
 */
export async function generateDossier({ kind, packet, entityId, title }) {
  const k = kind === 'deal' ? 'deal' : 'property';
  const meta = { ...(packet.meta || {}) };
  if (title) meta.title = title;
  if (!meta.generated_date) meta.generated_date = new Date().toISOString().slice(0, 10);

  // Source hash of the FACT packet only (excludes generated_date so an identical
  // record on a different day yields the same hash → true staleness detection).
  const hashInput = { ...packet, meta: { ...meta, generated_date: undefined } };
  const source_hash = createHash('sha256').update(JSON.stringify(hashInput)).digest('hex');

  const sectionsHtml = k === 'deal' ? renderDealSections(packet) : renderPropertySections(packet);
  const analysis = await authorAnalysis(packet, k);
  const html = wrapDocument({ kind: k, meta, sectionsHtml, analysisFragment: analysis.fragment });

  return {
    html,
    source_hash,
    title: meta.title || (k === 'deal' ? 'Deal Dossier' : 'Property Dossier'),
    kind: k,
    analysis: { ok: analysis.ok, model: analysis.model, tried: analysis.tried || null },
  };
}

// ---------------------------------------------------------------------------
// Public: recordDossier — store the HTML + insert the lcc_dossiers row.
// ---------------------------------------------------------------------------
/**
 * Upload the dossier HTML to Supabase Storage and insert a versioned
 * lcc_dossiers row. Returns { ok, id, storage_ref, version, format }.
 *
 * @param {object}   o
 * @param {'property'|'deal'} o.kind
 * @param {string}   o.entityId       lcc_dossiers.entity_id (NOT NULL)
 * @param {string}  [o.workspaceId]
 * @param {string}   o.title
 * @param {string}   o.html
 * @param {string}   o.sourceHash
 * @param {string}  [o.generatedBy]   lcc_user id
 * @param {object}  [o.metadata]      merged into lcc_dossiers.metadata
 * @param {function} o.opsQuery       ops-db opsQuery('METHOD', path, body)
 * @param {string}   o.opsUrl         OPS_SUPABASE_URL
 * @param {string}   o.opsKey         OPS_SUPABASE_KEY
 * @param {function} o.fetchImpl
 */
export async function recordDossier({
  kind, entityId, workspaceId, title, html, sourceHash, generatedBy,
  metadata, opsQuery, opsUrl, opsKey, fetchImpl,
}) {
  const k = kind === 'deal' ? 'deal' : 'property';
  if (!entityId) return { ok: false, error: 'entity_id required' };
  if (!html) return { ok: false, error: 'html required' };

  // Next version for this (entity, type).
  let version = 1;
  try {
    const prev = await opsQuery('GET',
      `lcc_dossiers?entity_id=eq.${encodeURIComponent(entityId)}&dossier_type=eq.${k}` +
      `&select=version&order=version.desc&limit=1`);
    if (prev.ok && prev.data?.[0]?.version != null) version = Number(prev.data[0].version) + 1;
  } catch { /* default v1 */ }

  // Upload the HTML to the shared artifact bucket.
  const buffer = Buffer.from(html, 'utf8');
  const fileName = `${k}-dossier-v${version}.html`;
  const objectPath = artifactObjectPath({ key: `dossier-${entityId}`, fileName, mimeType: 'text/html' });
  const up = await uploadArtifactToStorage({
    opsUrl, opsKey, bucket: ARTIFACT_BUCKET, objectPath, mimeType: 'text/html', buffer, fetchImpl,
  });
  if (!up.ok) return { ok: false, error: 'storage_upload_failed', status: up.status, detail: up.detail };
  const storage_ref = up.storage_path; // "<bucket>/<object>"

  // Insert the versioned row.
  const insertRow = {
    workspace_id: workspaceId || null,
    entity_id: entityId,
    dossier_type: k,
    storage_ref,
    format: 'html',
    version,
    source_hash: sourceHash || null,
    title: title || null,
    generated_by: generatedBy || null,
    metadata: metadata || {},
  };
  const ins = await opsQuery('POST', 'lcc_dossiers', insertRow, { headers: { Prefer: 'return=representation' } })
    .catch((e) => ({ ok: false, error: e?.message }));
  const row = (ins.ok && Array.isArray(ins.data) && ins.data[0]) ? ins.data[0] : null;

  return {
    ok: !!(ins.ok),
    id: row?.id || null,
    storage_ref,
    version,
    format: 'html',
    insert_error: ins.ok ? null : (ins.error || ins.detail || 'insert_failed'),
  };
}

export const __test__ = { renderTag, sanitizeAnalysisFragment, renderPropertySections, renderDealSections, esc, NA };
