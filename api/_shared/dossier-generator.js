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
function fmtNum(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return esc(v);
  return n.toLocaleString('en-US');
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

// A section is emitted only when it has a title; rows are always emitted (missing
// fields become "Not on file" so the reader sees the gap, per §1.8).
function kvSection(title, rows) {
  return `<h2>${esc(title)}</h2><table class="kv">${rows.join('')}</table>`;
}

// ---------------------------------------------------------------------------
// FACT sections — deterministic, packet-driven (no LLM)
// ---------------------------------------------------------------------------
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
    lease.guarantor ? kvRow('Guarantor', lease.guarantor) : '',
    kvRow('Year-1 base rent', lease.annual_base_rent, fmtMoney),
    lease.year1_rent_psf ? kvRow('Year-1 base rent / SF', lease.year1_rent_psf, (v) => fmtMoney(v) + '/SF') : '',
    lease.current_base_rent ? kvRow('Current (escalated) base rent', lease.current_base_rent, fmtMoney) : '',
    lease.current_rent_psf ? kvRow('Current base rent / SF', lease.current_rent_psf, (v) => fmtMoney(v) + '/SF') : '',
    kvRow('Lease term', lease.lease_term || renderTermTag(lease)),
    lease.term_remaining_years ? kvRow('Term remaining (years)', lease.term_remaining_years) : '',
    kvRow('Expense structure', lease.expense_structure),
    kvRow('Escalations', lease.escalations_text),
    kvRow('Renewal options', lease.renewal_options),
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
    let block = `<h2>Operations</h2><table class="kv">${rows.filter(Boolean).join('')}</table>`;
    for (const c of (ops._conflicts || [])) {
      const vals = (c.values || []).map(x => `${esc(x.v)} (${esc(x.source)})`).join(' vs ');
      block += `<div class="conflict">Conflict — ${esc(c.field)}: ${vals}${c.reconciled != null ? ` — reconciled: ${esc(c.reconciled)}` : ' — not reconciled; shown as unverified, not asserted.'}</div>`;
    }
    out.push(block);
  }

  // 6. Transaction History
  out.push(renderTransactions(p.transactions));

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

  // 3. Parties
  if (Array.isArray(d.parties) && d.parties.length) {
    const rows = d.parties.map(pt => {
      const flag = pt.flag ? ` <span class="badge b-off">${esc(pt.flag)}</span>` : '';
      return `<tr><td>${esc(pt.role || '')}</td><td>${esc(pt.name || '')}${flag}</td><td class="src">${esc(pt.source || '')}</td></tr>`;
    }).join('');
    out.push(`<h2>Parties</h2><table class="hist"><thead><tr><th>Role</th><th>Party</th><th>Source</th></tr></thead><tbody>${rows}</tbody></table>`);
  } else {
    out.push(`<h2>Parties</h2><table class="kv"><tr><td class="v">${NA}</td></tr></table>`);
  }

  // 4. Correspondence
  if (Array.isArray(d.correspondence) && d.correspondence.length) {
    const rows = d.correspondence.map(c =>
      `<tr><td>${esc(fmtDate(c.date))}</td><td>${esc(c.direction || '')}</td><td>${esc(c.subject || '')}</td><td class="src">${esc(c.source || '')}</td></tr>`
    ).join('');
    out.push(`<h2>Correspondence</h2><table class="hist"><thead><tr><th>Date</th><th>Direction</th><th>Subject</th><th>Source</th></tr></thead><tbody>${rows}</tbody></table>`);
  } else {
    out.push(`<h2>Correspondence</h2><table class="kv"><tr><td class="v">${NA}</td></tr></table>`);
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
// api/_shared/dossier-generator.js
// ============================================================================
// Grounded dossier author — property & deal.
//
// Turns a pre-reconciled DATA PACKET into a fixed-format HTML dossier using the
// LOCAL Ollama model (via invokeExtractionAI, which tries Ollama first, then
// falls back to the cloud chain), then stores the result in Supabase Storage and
// returns a row ready for lcc_dossiers.
//
// The model authors PROSE + LAYOUT only — never FACTS. Every fact must trace to a
// field in the packet; absent fields render "Not on file"; computed values are
// labeled "Derived" with inputs; conflicts are surfaced, not resolved. See
// docs/architecture/dossier-standard-and-llm-contract.md (§1 the contract, §3
// property sections, §4 deal sections, §7/§8 v2 fields) and the gold-standard
// renders dossier-example-5247-airways-v2.html + deal-dossier-fresenius-woodland-hills.html.
//
// Wiring notes:
//   - LLM seam:   invokeExtractionAI({ prompt })  (api/_shared/ai.js) — Ollama-first.
//                 Configure OLLAMA_URL + OLLAMA_MODEL (default qwen2.5:14b) in the env.
//   - Storage:    uploadArtifactToStorage(...) into the lcc-om-uploads bucket.
//   - Registry:   returns a dossierRow for lcc_dossiers (entity_id is NOT NULL —
//                 the caller must supply an asset entity; see recordDossier()).
// ============================================================================

import { invokeExtractionAI } from './ai.js';
import { artifactObjectPath, uploadArtifactToStorage, ARTIFACT_BUCKET } from './artifact-storage.js';

export const DOSSIER_BUCKET = ARTIFACT_BUCKET; // lcc-om-uploads

// ---------------------------------------------------------------------------
// §1 — the grounding contract (goes verbatim into the system prompt).
// ---------------------------------------------------------------------------
export const DOSSIER_SYSTEM_CONTRACT = `You are the Life Command Center dossier author for Team Briggs (Northmarq),
net-lease dialysis and government-leased assets. You write a grounded PROPERTY or DEAL dossier as a single
self-contained HTML document. You author PROSE and LAYOUT only — you never author FACTS.

NON-NEGOTIABLE GROUNDING RULES:
1. Only use what is in the DATA PACKET below. Every fact must trace to a packet field. If it is not in the
   packet, it does not go in the dossier.
2. Never invent, infer, estimate, round-to-impress, or "fill in." No made-up rents, dates, sizes, names, cap
   rates, market color, or comps. An absent field renders exactly: Not on file.
3. Every material figure shows its provenance when the packet provides it (source system + as-of + confidence).
4. Derived values are allowed ONLY when every input is present in the packet, and must be labeled "Derived"
   with the formula shown (e.g. "Implied cap 5.78% — Derived: rent 181,959 / sale 3,150,000"). Never derive
   from a missing input.
5. Conflicts are surfaced, not resolved silently: show the reconciled value and add a one-line "Conflict" note.
6. Owner is never the operator. The owner is the packet's reconciled property owner; the operator/tenant is
   named only in the tenancy section.
7. Facts vs. Analysis are separated. Interpretive lines live under a clearly marked "Analysis (not a stated
   fact)" block, may only recombine stated facts, and introduce no new data.
8. No external knowledge — nothing you "know" about DaVita, Fresenius, a market, or a REIT. Only the packet.
9. Output ONLY the HTML document (starting with <!doctype html>). No commentary before or after, no code fences.

One-line rule: "If it's not in the packet, it's 'Not on file.' If you compute it, label it 'Derived' and show
the inputs. Owner is never the operator."`;

// ---------------------------------------------------------------------------
// Section order per dossier kind — the model fills these, matching the examples.
// ---------------------------------------------------------------------------
const PROPERTY_SECTIONS = [
  'Header (property name/address · domain · "Property Dossier" · generated date · Team Briggs · Northmarq)',
  'Snapshot (type, building SF, land, year built, stations w/ capacity, ownership type, LCC value estimate w/ basis + $/SF)',
  'Location & Trade Area (map thumbnail from geocode; 1/3/5-mi demographics or coverage-gap note; ZIP census proxy; dialysis payer-mix market context; fenced trade-area read)',
  'Ownership (owner of record = reconciled; operator/tenant marked NOT the owner; original developer; owner-is-SPE)',
  'Tenancy & Lease (tenant; guarantor w/ scope; Year-1 rent + $/SF and Current escalated rent + $/SF [Derived]; term; term remaining [Derived]; expense structure; escalations verbatim; renewal options + bumps-in-options; roof/structure/parking/HVAC responsibilities)',
  'Operations (CMS: stations, patient count + trend, annual treatments, est. revenue/EBITDA only if computed else Not on file, certification date, relocation paragraph, market competition)',
  'Transaction & Marketing Timeline (prior listings → sale w/ cap + firm-term-at-close → current listing w/ $/SF, brokers, DOM, portfolio flag)',
  'BD Efforts (owner-entity cadence / touches / ROE, if present)',
  'Documents on File (each source + date + reconciled status badge)',
  'Analysis (not a stated fact) — Derived-only',
  'Footer (verification disclaimer + Not-on-file/Derived/Conflict legend)',
];

const DEAL_SECTIONS = [
  'Header (deal/property name · stage badge · point person · "Deal Dossier" · generated date · Northmarq role)',
  'Hero metrics (for a closed deal: close date, sale price, cap rate, firm term at sale)',
  'The Property (compact identity + geocode)',
  'Transaction (close date, price, cap, firm term remaining at sale, Northmarq role, source)',
  'Tenancy & Guaranty (tenant, guarantor, base rent + $/SF, term, expense structure, escalations w/ conflict note, renewal options, landlord responsibilities)',
  'Parties (seller, buyer/new owner, listing broker, procuring broker, lender — Not on file where absent)',
  'Location & Trade Area (ZIP census proxy; radius rings or coverage-gap note)',
  'Deal Spine (correspondence · offers/LOIs · cadence · ROE — render a gap note if there is no asset entity)',
  'Documents on File (source + reconciled status)',
  'Analysis (not a stated fact) — Derived-only',
  'Footer (verification disclaimer + legend)',
];

// ---------------------------------------------------------------------------
// buildDossierPrompt — the full self-contained prompt (contract + packet + sections).
// ---------------------------------------------------------------------------
export function buildDossierPrompt(kind, packet) {
  const isDeal = String(kind).toLowerCase() === 'deal';
  const sections = isDeal ? DEAL_SECTIONS : PROPERTY_SECTIONS;
  const title = isDeal ? 'DEAL DOSSIER' : 'PROPERTY DOSSIER';
  return [
    DOSSIER_SYSTEM_CONTRACT,
    ``,
    `Produce a ${title} as one self-contained HTML document. Use clean inline CSS in a <style> block (no`,
    `external resources except an optional static-map <img> when the packet supplies a map_url). Match the`,
    `visual style of the LCC gold-standard examples: a boxed .doc, indigo (property) or teal (deal) accents,`,
    `key/value tables, "Not on file" in muted red italic, "Derived" notes in the accent color, "Conflict"/gap`,
    `callout boxes. Render these sections in order (omit a section only if the packet has no data AND the`,
    `section is optional; otherwise render the header + "Not on file"):`,
    ...sections.map((s, i) => `  ${i + 1}. ${s}`),
    ``,
    `DATA PACKET (the ONLY source of facts — JSON; every value is tagged with source/as_of/confidence where`,
    `known; missing fields are omitted and MUST render "Not on file"):`,
    '```json',
    JSON.stringify(packet ?? {}, null, 2),
    '```',
    ``,
    `Output ONLY the HTML document, beginning with <!doctype html>. No preamble, no code fences.`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// generateDossier — packet → Ollama → HTML → Supabase Storage.
// Returns { ok, storage_path, html, model, tried, dossierRow } or an error with `stage`.
// ---------------------------------------------------------------------------
export async function generateDossier({
  kind,               // 'property' | 'deal'
  packet,             // reconciled DATA PACKET (assembled by the caller from live loaders)
  entityId,           // LCC asset entity uuid (required to record in lcc_dossiers)
  title,              // human title, e.g. "5247 Airways Blvd — Property Dossier"
  workspaceId = null,
  generatedBy = null,
  opsUrl,             // OPS_SUPABASE_URL
  opsKey,             // OPS_SUPABASE_KEY (service role)
  fetchImpl,          // fetchWithTimeout or global fetch
}) {
  if (!packet || typeof packet !== 'object') {
    return { ok: false, stage: 'input', detail: 'missing packet' };
  }
  const kindNorm = String(kind || 'property').toLowerCase() === 'deal' ? 'deal' : 'property';

  // 1) Author via the local Ollama model (falls back to cloud chain automatically).
  const prompt = buildDossierPrompt(kindNorm, packet);
  const ai = await invokeExtractionAI({ prompt });
  if (!ai?.ok) {
    return { ok: false, stage: 'llm', detail: ai?.data?.error || 'llm_failed', tried: ai?.tried };
  }

  // 2) Extract + sanitize the HTML the model returned.
  let html = String(ai?.data?.response || '').trim();
  html = html.replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/i, '').trim();
  if (!/^<!doctype html|^<html/i.test(html)) {
    return { ok: false, stage: 'render', detail: 'model_did_not_return_html', raw: html.slice(0, 400), tried: ai?.tried };
  }

  // 3) Store the HTML in Supabase Storage (lcc-om-uploads bucket).
  const createdAt = new Date().toISOString();
  const keyBase = `dossier-${kindNorm}-${entityId || packet?.identity?.property_id || packet?.property_id || 'x'}`;
  const objectPath = artifactObjectPath({
    key: keyBase,
    fileName: `${(title || keyBase).replace(/[^\w.\-]+/g, '-')}.html`,
    mimeType: 'text/html',
    createdAt,
  });
  const up = await uploadArtifactToStorage({
    opsUrl, opsKey, bucket: DOSSIER_BUCKET, objectPath,
    mimeType: 'text/html; charset=utf-8',
    buffer: Buffer.from(html, 'utf8'),
    fetchImpl,
  });
  if (!up.ok) {
    return { ok: false, stage: 'storage', detail: up.detail || 'upload_failed', html };
  }

  // 4) Build the lcc_dossiers row (entity_id is NOT NULL — caller records it).
  const dossierRow = {
    entity_id:    entityId || null,
    dossier_type: kindNorm,                 // 'property' | 'deal'
    storage_ref:  up.storage_path,          // "<bucket>/<objectPath>"
    format:       'html',
    title:        title || keyBase,
    generated_at: createdAt,
    generated_by: generatedBy,
    workspace_id: workspaceId,
    metadata: {
      model:        ai?.data?.model || null,
      tried:        ai?.tried || null,
      property_id:  packet?.identity?.property_id ?? packet?.property_id ?? null,
      domain:       packet?.identity?.domain ?? packet?.domain ?? null,
      contract_version: 'v2-2026-08-01',
    },
  };

  return { ok: true, storage_path: up.storage_path, html, model: ai?.data?.model, tried: ai?.tried, dossierRow };
}

// ---------------------------------------------------------------------------
// recordDossier — insert the row into lcc_dossiers via PostgREST.
// Skips gracefully when entity_id is absent (the deal-without-entity case) so the
// generated HTML is still stored + returned; surface `skipped_no_entity` to the UI.
// ---------------------------------------------------------------------------
export async function recordDossier({ dossierRow, opsUrl, opsKey, fetchImpl }) {
  if (!dossierRow?.entity_id) {
    return { ok: false, skipped: 'no_entity', detail: 'lcc_dossiers.entity_id is NOT NULL; create the asset entity first' };
  }
  const doFetch = fetchImpl || ((u, opts) => fetch(u, opts));
  try {
    const res = await doFetch(`${opsUrl}/rest/v1/lcc_dossiers?on_conflict=entity_id,dossier_type`, {
      method: 'POST',
      headers: {
        'apikey':        opsKey,
        'Authorization': `Bearer ${opsKey}`,
        'Content-Type':  'application/json',
        'Prefer':        'return=representation,resolution=merge-duplicates',
      },
      body: JSON.stringify(dossierRow),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, status: res.status, detail: detail.slice(0, 300) };
    }
    const rows = await res.json().catch(() => []);
    return { ok: true, row: Array.isArray(rows) ? rows[0] : rows };
  } catch (err) {
    return { ok: false, detail: err?.message?.slice(0, 200) || 'record_error' };
  }
}
