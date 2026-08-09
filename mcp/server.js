// ============================================================================
// LCC MCP Server — Model Context Protocol server for Life Command Center
// Standalone service (NOT a Vercel function) — deploy to Railway or similar
//
// Exposes read-only LCC tools to Claude.ai via direct JSON-RPC over HTTP.
// No SDK transport layer — maximum compatibility with Claude.ai.
// ============================================================================

import express from "express";
import cors from "cors";
import {
  assemblePropertyPacketViaApi,
  resolveContextPacket,
} from "./context-assemble.js";
import { makeCompsTools, makeCompsHttpRoutes, runGenerateCompsFromRequest } from "./comps-tools.js";
import { makeDealDossierTools, makeDealDossierHttpRoutes } from "./deal-dossier-tools.js";
import { makeSfWritebackRoutes } from "./sf-writeback.js";
import { makeOpportunitySyncRoute } from "./opportunity-sync.js";
import { makeDealRosterRoute } from "./deal-roster.js";
import { makeCadenceScanRoute } from "./cadence-scan.js";
import { makeEntityReconcileRoute } from "./entity-reconcile.js";
import { makeOfferContextRoute, makeOfferLogRoute } from "./offer-context.js";
import { makeDealEmailMatcherRoute } from "./deal-email-matcher.js";
import { boundHttpToolResult, enforceHttpResponseSize, jsonLen } from "./http-response-bound.js";
import { resolveSubject } from "./subject-resolver.js";

// ── Environment ──────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || "3100", 10);
const MCP_MIN_PROTOCOL_VERSION = "2025-03-26";
const LCC_API_KEY = process.env.LCC_API_KEY || "";

// Base URL of the main Express app (the tranquil-delight service). Used to
// assemble a property context packet on a cache miss via
// POST {LCC_API_BASE}/api/context?action=assemble. When unset, get_property_context
// falls back to the cache-only read (context_packet: null) — Phase 2 Slice 3a.1.
const LCC_API_BASE = process.env.LCC_API_BASE || "";

const OPS_SUPABASE_URL = process.env.OPS_SUPABASE_URL || "";
const OPS_SUPABASE_KEY = process.env.OPS_SUPABASE_KEY || "";
const GOV_SUPABASE_URL = process.env.GOV_SUPABASE_URL || "";
// Prefer service_role over anon — see GitHub issue #720.
const GOV_SUPABASE_KEY = process.env.GOV_SUPABASE_SERVICE_KEY || process.env.GOV_SUPABASE_KEY || "";

// BOV Generator service (Railway FastAPI microservice). Thin proxy: the
// generate_bov tool POSTs deal inputs to /generate-bov and returns a
// short-lived download link. BOV_API_KEY must match the BOV Railway service.
const BOV_SERVICE_URL = (process.env.BOV_SERVICE_URL || "https://pacific-love-production-f6b9.up.railway.app").replace(/\/+$/, "");
const BOV_API_KEY = process.env.BOV_API_KEY || "";

// Primary workspace ID — used as the default when callers omit workspace_id.
// Override via LCC_PRIMARY_WORKSPACE_ID env var if the deployment uses a
// different workspace. The production LCC workspace is a0000000-...-0001.
const PRIMARY_WORKSPACE_ID =
  process.env.LCC_PRIMARY_WORKSPACE_ID || "a0000000-0000-0000-0000-000000000001";

// ── Supabase fetch helper (mirrors api/_shared/ops-db.js pattern) ────────────

async function supabaseQuery(baseUrl, apiKey, method, path, body, prefer) {
  const url = `${baseUrl}/rest/v1/${path}`;
  const headers = {
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    // Callers may override Prefer (e.g. `resolution=merge-duplicates` for an upsert).
    Prefer: prefer || (method === "GET" ? "count=exact" : "return=representation"),
  };
  const opts = { method, headers };
  if (body && (method === "POST" || method === "PATCH")) {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url, opts);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  let count = 0;
  const contentRange = res.headers.get("content-range");
  if (contentRange) {
    const match = contentRange.match(/\/(\d+)/);
    if (match) count = parseInt(match[1], 10);
  }

  return { ok: res.ok, status: res.status, data, count };
}

function opsQuery(method, path, body, prefer) {
  return supabaseQuery(OPS_SUPABASE_URL, OPS_SUPABASE_KEY, method, path, body, prefer);
}

function govQuery(method, path, body, prefer) {
  return supabaseQuery(GOV_SUPABASE_URL, GOV_SUPABASE_KEY, method, path, body, prefer);
}

function enc(v) {
  return encodeURIComponent(String(v));
}

function normPropertyDomain(v) {
  const d = String(v || "").toLowerCase().trim();
  if (d === "dia" || d === "dialysis") return "dia";
  if (d === "gov" || d === "government") return "gov";
  return null;
}

// ── DIA domain (optional — Unit 4 dia address fallback) ──────────────────────
// The MCP server historically configured only OPS + GOV. The gov property
// fallback (Unit 4) is the live-verified path; the dia leg engages only when a
// DIA connection is provided, and is a graceful no-op otherwise.
const DIA_SUPABASE_URL = process.env.DIA_SUPABASE_URL || "";
const DIA_SUPABASE_KEY =
  process.env.DIA_SUPABASE_SERVICE_KEY || process.env.DIA_SUPABASE_KEY || "";
function diaQuery(method, path, body, prefer) {
  return supabaseQuery(DIA_SUPABASE_URL, DIA_SUPABASE_KEY, method, path, body, prefer);
}

// ── R30 discovery-ring helpers ───────────────────────────────────────────────

// Doctrinal priority-band order (mirrors api/admin.js BAND_ORDER). Lower index
// = more urgent. The pre-aggregated band-counts view and the queue rows are
// ranked by this, then by value, so the summary leads with the real work.
const BAND_ORDER = [
  'P0', 'P0.4', 'P0.5', 'P-BUYER', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7',
  'P-CONTACT', 'P8',
];
function bandRank(b) {
  const i = BAND_ORDER.indexOf(b);
  return i === -1 ? BAND_ORDER.length : i;
}

// Canonical short-form domain mapping. The queue/views + entities.domain use
// 'dia'/'gov'; agents pass 'dialysis'/'government'/'all'/'both'. Accept BOTH
// spellings on read so a 'government' filter doesn't silently match nothing
// (the pre-R30 entities query did `domain=eq.government`, which never matched
// the canonical 'gov').
function domainForms(domain) {
  if (!domain || domain === 'all' || domain === 'both') return null;
  if (domain === 'government' || domain === 'gov') return ['gov', 'government'];
  if (domain === 'dialysis' || domain === 'dia') return ['dia', 'dialysis'];
  return [domain];
}

// Prompt 58 — robust free-text argument extraction. The various connector
// surfaces (personal Claude, ChatGPT, Copilot) don't always send the arg under
// the exact inputSchema key: a plain "1050 Old Camp Rd" or "DaVita" arrives as
// { query }, { q }, { request }, { text }, or even a bare string instead of the
// documented { address } / { query }. Reading only the one canonical key made
// get_property_context resolve nothing (raw_ref {}) and made search_entities
// crash on `undefined.replace`. Pull the first non-empty string across the
// common aliases so a missing/renamed key can never strand or crash a tool.
export function firstNonEmptyString(...vals) {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
}

// Lightweight street-address normalizer (mirror of api/_shared/entity-link.js
// normalizeAddress) so the gov/dia property fallback resolves "350 Rhode Island
// St" the same way the rest of the app does. Kept local — the MCP server is a
// standalone deploy and does not import the api/ tree.
function normalizeAddressLite(addr) {
  if (!addr) return '';
  return String(addr).split(',')[0].trim()
    .replace(/\bStreet\b/gi, 'St').replace(/\bAvenue\b/gi, 'Ave')
    .replace(/\bBoulevard\b/gi, 'Blvd').replace(/\bDrive\b/gi, 'Dr')
    .replace(/\bRoad\b/gi, 'Rd').replace(/\bLane\b/gi, 'Ln')
    .replace(/\bCourt\b/gi, 'Ct').replace(/\bPlace\b/gi, 'Pl')
    .replace(/\bHighway\b/gi, 'Hwy').replace(/\bParkway\b/gi, 'Pkwy')
    .replace(/\bCircle\b/gi, 'Cir').replace(/\bTrail\b/gi, 'Trl')
    .replace(/\s+/g, ' ').toLowerCase();
}

// A query term is address-like when it leads with a street number — used to
// decide whether to engage the gov/dia property fallback in search.
function looksLikeAddress(term) {
  return /^\s*\d/.test(String(term || ''));
}

// R13/R25 junk guard: rows the entity graph soft-flagged as structural garbage
// (RCA "by <broker>" capture stubs, phone/email-embedded names, panel-header
// bleed-through). Excluded from discovery + name resolution.
function isJunkEntityRow(e) {
  const m = e && e.metadata;
  const v = m && m.junk_name_flagged;
  return v === true || v === 'true';
}

function entityHasSf(e) {
  return (e.external_identities || []).some((x) => x.source_system === 'salesforce');
}

// Resolve a search/contact NAME to its registered canonical buyer-parent entity
// via the built R5/R6 machinery (lcc_match_buyer_parent_by_name): "Boyd
// Watterson" / "Boyd Watterson by CBRE" both resolve to Boyd Watterson Global,
// never an RCA capture stub. Returns {id, name} or null (graceful on any error).
async function resolveCanonicalParentId(name) {
  if (!name) return null;
  try {
    const r = await opsQuery('POST', 'rpc/lcc_match_buyer_parent_by_name', { p_name: name });
    const row = r.ok && Array.isArray(r.data) ? r.data[0] : null;
    if (row && row.parent_entity_id) {
      return { id: row.parent_entity_id, name: row.parent_name || null };
    }
  } catch { /* graceful — fall through to plain ranking */ }
  return null;
}

// Batch-fetch the value signal (rank_annual_rent) for a set of entity ids from
// the materialized priority queue, so discovery leads with the real entity.
async function fetchEntityValueMap(ids) {
  const map = new Map();
  if (!ids.length) return map;
  try {
    const vr = await opsQuery(
      'GET',
      `v_priority_queue_enriched?entity_id=in.(${ids.map(enc).join(',')})&select=entity_id,rank_annual_rent`
    );
    for (const v of vr.data || []) {
      const cur = map.get(v.entity_id) || 0;
      const val = Number(v.rank_annual_rent) || 0;
      if (val > cur) map.set(v.entity_id, val);
    }
  } catch { /* graceful — empty value map, ranking falls through */ }
  return map;
}

// Pick the canonical/best entity from a candidate set: drop junk, then rank by
// value (priority-queue rent) → Salesforce identity → has contact info → name.
async function chooseBestEntity(rows) {
  const list = (rows || []).filter((e) => !isJunkEntityRow(e));
  if (list.length <= 1) return list[0] || null;
  const valueMap = await fetchEntityValueMap(list.map((e) => e.id));
  list.sort((a, b) => {
    const va = valueMap.get(a.id) || 0;
    const vb = valueMap.get(b.id) || 0;
    if (vb !== va) return vb - va;
    const sa = entityHasSf(a) ? 1 : 0;
    const sb = entityHasSf(b) ? 1 : 0;
    if (sb !== sa) return sb - sa;
    const ca = (a.email || a.phone) ? 1 : 0;
    const cb = (b.email || b.phone) ? 1 : 0;
    if (cb !== ca) return cb - ca;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
  return list[0];
}

// Find a domain property by address (raw ILIKE, then normalized). Used by the
// gov/dia get_property_context fallback when no LCC asset entity exists yet.
async function findDomainProperty(q, raw, extraSelect = '') {
  const sel = `property_id,address,city,state${extraSelect ? ',' + extraSelect : ''}`;
  let r = await q('GET', `properties?address=ilike.*${enc(raw)}*&select=${sel}&limit=25`)
    .catch(() => ({ data: [] }));
  let hits = [...new Map((r.data || []).filter((p) => p?.property_id != null).map((p) => [p.property_id, p])).values()];
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) return null;
  const norm = normalizeAddressLite(raw);
  if (norm && norm !== String(raw).toLowerCase()) {
    r = await q('GET', `properties?address=ilike.*${enc(norm)}*&select=${sel}&limit=25`)
      .catch(() => ({ data: [] }));
    hits = [...new Map((r.data || []).filter((p) => p?.property_id != null).map((p) => [p.property_id, p])).values()];
    if (hits.length === 1) return hits[0];
  }
  return null;
}

async function resolveEntityByPropertyIdentity({ domain, propertyId }) {
  if (propertyId === null || propertyId === undefined || String(propertyId).trim() === "") return null;
  const domains = normPropertyDomain(domain) ? [normPropertyDomain(domain)] : ["dia", "gov"];
  const matches = [];
  for (const dom of domains) {
    const idRes = await opsQuery(
      "GET",
      `external_identities?source_system=eq.${enc(dom)}&source_type=eq.asset` +
        `&external_id=eq.${enc(propertyId)}&select=entity_id`
    ).catch(() => ({ data: [] }));
    const entityIds = [...new Set((idRes.data || []).map((r) => r.entity_id).filter(Boolean))];
    for (const entityId of entityIds) {
      const entRes = await opsQuery(
        "GET",
        `entities?id=eq.${enc(entityId)}&entity_type=eq.asset&select=*,external_identities(*),entity_relationships!entity_relationships_from_entity_id_fkey(*)&limit=1`
      ).catch(() => ({ data: [] }));
      if (entRes.data?.[0]) matches.push(entRes.data[0]);
    }
  }
  const unique = [...new Map(matches.map((e) => [e.id, e])).values()];
  return unique.length === 1 ? unique[0] : null;
}

async function resolveEntityByAddressPropertyIdentity(address) {
  const matches = [];
  if (DIA_SUPABASE_URL && DIA_SUPABASE_KEY) {
    const hit = await findDomainProperty(diaQuery, address, 'tenant,operator,chain_canonical');
    if (hit?.property_id != null) {
      const entity = await resolveEntityByPropertyIdentity({ domain: "dia", propertyId: hit.property_id });
      if (entity) matches.push(entity);
    }
  }
  if (GOV_SUPABASE_URL && GOV_SUPABASE_KEY) {
    const hit = await findDomainProperty(govQuery, address, 'agency');
    if (hit?.property_id != null) {
      const entity = await resolveEntityByPropertyIdentity({ domain: "gov", propertyId: hit.property_id });
      if (entity) matches.push(entity);
    }
  }
  const unique = [...new Map(matches.map((e) => [e.id, e])).values()];
  return unique.length === 1 ? unique[0] : null;
}

// Unit 4: resolve a property by address straight from the domain DBs when no
// LCC asset entity exists (gov is widely under-represented as entities — only
// ~1,899 of ~12k gov properties have an asset entity). Mirrors how the operator
// console surfaces these. Returns a get_property_context-shaped payload or null.
async function resolvePropertyByAddressFromDomains(address) {
  if (GOV_SUPABASE_URL && GOV_SUPABASE_KEY) {
    const hit = await findDomainProperty(govQuery, address, 'agency');
    if (hit) {
      const pid = hit.property_id;
      const [leases, owners, lead] = await Promise.all([
        govQuery('GET', `gsa_leases?property_id=eq.${enc(pid)}&select=*&limit=5`).catch(() => ({ data: [] })),
        govQuery('GET', `ownership_history?property_id=eq.${enc(pid)}&select=*&order=transfer_date.desc&limit=10`).catch(() => ({ data: [] })),
        govQuery('GET', `prospect_leads?property_id=eq.${enc(pid)}&select=*&limit=1`).catch(() => ({ data: [] })),
      ]);
      return {
        resolved_via: 'gov_property_fallback',
        note: 'No LCC asset entity for this property yet — resolved directly from the government domain by address.',
        property: { domain: 'gov', ...hit },
        entity: null,
        context_packet: null,
        gov_data: {
          gsa_leases: leases.data || [],
          ownership_history: owners.data || [],
          prospect_lead: (lead.data && lead.data[0]) || null,
        },
      };
    }
  }
  if (DIA_SUPABASE_URL && DIA_SUPABASE_KEY) {
    const hit = await findDomainProperty(diaQuery, address, 'tenant');
    if (hit) {
      const leases = await diaQuery('GET', `leases?property_id=eq.${enc(hit.property_id)}&select=*&limit=5`)
        .catch(() => ({ data: [] }));
      return {
        resolved_via: 'dia_property_fallback',
        note: 'No LCC asset entity for this property yet — resolved directly from the dialysis domain by address.',
        property: { domain: 'dia', ...hit },
        entity: null,
        context_packet: null,
        dia_data: { leases: leases.data || [] },
      };
    }
  }
  return null;
}

// Unit 4: surface gov/dia domain properties that have no LCC asset entity yet,
// so an address/name search still finds them. Conservative — address-anchored.
async function searchDomainProperties(term, max) {
  const out = [];
  const pull = async (q, dom, extra) => {
    try {
      const r = await q(
        'GET',
        `properties?or=(address.ilike.*${enc(term)}*,${extra}.ilike.*${enc(term)}*)` +
          `&select=property_id,address,city,state,${extra}&limit=${max}`
      );
      for (const p of r.data || []) {
        out.push({
          kind: 'domain_property',
          source_domain: dom,
          property_id: p.property_id,
          name: p.address,
          address: p.address,
          city: p.city,
          state: p.state,
          [extra]: p[extra],
          note: `${dom} property — no LCC entity yet; call get_property_context(address) for full context`,
        });
      }
    } catch { /* graceful */ }
  };
  if (GOV_SUPABASE_URL && GOV_SUPABASE_KEY) await pull(govQuery, 'gov', 'agency');
  if (DIA_SUPABASE_URL && DIA_SUPABASE_KEY) await pull(diaQuery, 'dia', 'tenant');
  return out;
}

// ── Tool timing wrapper ──────────────────────────────────────────────────────

async function withTiming(toolName, fn) {
  const start = Date.now();
  try {
    const result = await fn();
    const durationMs = Date.now() - start;
    console.log(`[MCP] ${toolName} completed in ${durationMs}ms`);
    return result;
  } catch (err) {
    const durationMs = Date.now() - start;
    console.error(`[MCP] ${toolName} FAILED in ${durationMs}ms:`, err.message);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: true,
            tool: toolName,
            message: err.message,
            duration_ms: durationMs,
          }),
        },
      ],
    };
  }
}

function textResult(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

// Compact one-line provenance summary for a rent-timeline row (get_property_rent_timeline).
function summarizeRentProvenance(r) {
  const p = r.provenance || {};
  const a = r.assumptions || {};
  if (p.evidence === true) {
    const tbl = p.table || 'evidence';
    return p.corroborated_by ? `${tbl} (corroborated by ${p.corroborated_by})` : `${tbl} evidence`;
  }
  if (p.shell === true) return `convention shell (${p.intercept_source || 'intercept'})`;
  if (p.projected_from) {
    const src = a.convention_source ? ` via ${a.convention_source}` : '';
    return `projected from ${p.projected_from}${src}`;
  }
  return 'modeled';
}

// ── Tool definitions for direct JSON-RPC dispatch ─────────────────────────
const TOOL_DEFINITIONS = {
  get_daily_briefing: {
    name: 'get_daily_briefing',
    description: "Get today's strategic, important, and urgent priorities for the team",
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string', description: 'LCC workspace ID' }
      }
    }
  },
  search_entities: {
    name: 'search_entities',
    description: 'Search for properties, contacts, or organizations in the LCC database. For an organization/person match, also returns the deals where it is the tenant or guarantor (e.g. "deals with Total Renal Care, Inc. as tenant or guarantor").',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name, address, or keyword to search' },
        entity_type: { type: 'string', enum: ['person', 'organization', 'asset'], description: 'Optional filter by entity type' },
        domain: { type: 'string', enum: ['government', 'dialysis', 'both'], description: 'Optional domain filter' },
        limit: { type: 'number', description: 'Max results to return' }
      }
    }
  },
  get_property_context: {
    name: 'get_property_context',
    description: 'Get full context for a specific property: lease details, ownership history, comps, investment score, research status, related contacts, and the property\'s tenant(s) + guarantor(s) from the lease/guaranty graph',
    inputSchema: {
      type: 'object',
      properties: {
        entity_id: { type: 'string', description: 'LCC entity UUID' },
        property_id: { type: 'string', description: 'Domain properties.property_id; pair with domain when known' },
        domain: { type: 'string', enum: ['dia', 'dialysis', 'gov', 'government'], description: 'Domain for property_id identity resolution' },
        address: { type: 'string', description: 'Property address (alternative to entity_id)' },
        query: { type: 'string', description: 'Free-text property reference (address, name, or "domain:id") — resolved the same as address' }
      }
    }
  },
  get_capmarkets_packet: {
    name: 'get_capmarkets_packet',
    description: 'Freeze-or-fetch the Capital Markets report packet for a vertical and quarter. Returns the same frozen packet used by the LCC app tab and Excel export.',
    inputSchema: {
      type: 'object',
      properties: {
        vertical: { type: 'string', enum: ['dialysis', 'dia', 'gov', 'government'], description: 'Report vertical.' },
        quarter: { type: 'string', description: 'Fiscal quarter label, e.g. Q2-2026.' },
        as_of: { type: 'string', description: 'Optional quarter-end date YYYY-MM-DD.' }
      },
      required: ['vertical']
    }
  },
  get_property_rent_timeline: {
    name: 'get_property_rent_timeline',
    description: "Rent Intelligence Engine: the versioned, provenance-tracked rent-by-year timeline for a dialysis property. Returns per-year rent_annual, rent_psf, lease_phase, basis (contract|stated|projected|convention), confidence, and a compact provenance summary. Prefer this over ad-hoc rent_at_sale lookups for rent anchoring in cap-rate / BOV work. Current (unsuperseded) version by default; pass include_superseded for the full version history (audit).",
    inputSchema: {
      type: 'object',
      properties: {
        property_id: { type: 'string', description: 'dia properties.property_id (preferred)' },
        address: { type: 'string', description: 'Property address (resolved to a dia property when property_id is absent)' },
        query: { type: 'string', description: 'Free-text property reference (address or "dia:id")' },
        year_range: { type: 'string', description: 'Optional "YYYY-YYYY" filter, e.g. "2011-2026"' },
        include_superseded: { type: 'boolean', description: 'Include prior forked versions for audit (default false = current only)' }
      }
    }
  },
  get_offer_context: {
    name: 'get_offer_context',
    description: "Assemble full context for an inbound offer on one of our listings — deal identity, resolved seller (of-record + contact), listing economics (ask/NOI/cap/lease), linked documents, external correspondents, and a gaps[] list. Call FIRST in the offer-submission flow. Pass a property name/address, e.g. 'DaVita Snellville'.",
    inputSchema: {
      type: 'object',
      properties: { deal: { type: 'string', description: "Property name/address (e.g. 'DaVita Snellville' or '2155 Main Street East')" } },
      required: ['deal']
    }
  },
  log_offer: {
    name: 'log_offer',
    description: "Log an inbound offer atomically: activity_event + review To-Do (due on the offer expiration) + a generic Salesforce create_task enqueue. Idempotent. Call LAST in the offer-submission flow. Pass the deal and the extracted offer terms (with an ISO expiration_date).",
    inputSchema: {
      type: 'object',
      properties: {
        deal: { type: 'string', description: 'Property name/address the offer is on' },
        offer: { type: 'object', description: 'Extracted LOI terms: buyer, price, cap_rate, deposit, dd_days, financing, expiration, expiration_date (ISO), summary' }
      },
      required: ['deal']
    }
  },
  get_contact_context: {
    name: 'get_contact_context',
    description: 'Get relationship context for a contact: touchpoint history, active deals, last interaction, outreach recommendations',
    inputSchema: {
      type: 'object',
      properties: {
        entity_id: { type: 'string', description: 'LCC entity UUID' },
        name: { type: 'string', description: 'Contact name (alternative to entity_id)' },
        email: { type: 'string', description: 'Email address (alternative to entity_id)' }
      }
    }
  },
  get_queue_summary: {
    name: 'get_queue_summary',
    description: 'Get the current research and action queue — what needs to be done, in priority order',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', enum: ['government', 'dialysis', 'all'], description: 'Filter by domain' },
        status: { type: 'string', enum: ['pending', 'in_progress', 'all'], description: 'Filter by status' },
        limit: { type: 'number', description: 'Max items to return' }
      }
    }
  },
  get_pipeline_health: {
    name: 'get_pipeline_health',
    description: 'Check the status of all data pipelines — last run times, success rates, and any failures',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  recall_memory: {
    name: 'recall_memory',
    description: 'Recall shared Cortex memory — the decisions, facts, outcomes, and preferences logged across past work sessions (any account/agent). Call this at the start of a task to load relevant prior context so output stays consistent with how things were done before. Filter by query/domain/kind.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword to match within the memory summary (optional)' },
        domain: { type: 'string', enum: ['work', 'personal', 'global'], description: 'Optional domain filter' },
        kind: { type: 'string', enum: ['decision', 'fact', 'outcome', 'preference', 'note'], description: 'Optional kind filter' },
        limit: { type: 'number', description: 'Max entries (default 20, max 50)' }
      }
    }
  },
  log_memory: {
    name: 'log_memory',
    description: 'Log a new entry to shared Cortex memory so future sessions (any account/agent) remember it. Use for durable decisions, facts learned, outcomes, or stated preferences — not transient chatter.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'One-line summary of the decision/fact/outcome (required)' },
        domain: { type: 'string', enum: ['work', 'personal', 'global'], description: 'Domain (default global)' },
        kind: { type: 'string', enum: ['decision', 'fact', 'outcome', 'preference', 'note'], description: 'Entry kind (default note)' },
        detail: { type: 'string', description: 'Optional supporting detail' }
      },
      required: ['summary']
    }
  },
  generate_bov: {
    name: 'generate_bov',
    description: "Generate a Briggs CRE BOV Excel workbook (10 tabs, all formulas recalculated) and return a short-lived download link to the finished .xlsx. TWO ways to call: (1) PREFERRED for a known LCC property — pass ONLY `property_lookup` (an address like '207 Fob James Dr, Valley, AL') or `cre_property_id`; the server loads that property's reviewed lease/financial record and builds the identical workbook every team member would get. (2) For a brand-new deal not yet in LCC — hand-author asset_type + property + tenants + underwriting + client. You may also pass property_lookup/cre_property_id AND override specific fields (e.g. client) — posted fields win over the loaded record.",
    inputSchema: {
      type: 'object',
      properties: {
        property_lookup: { type: 'string', description: "PREFERRED path: an address (or numeric id as a string) to resolve to the LCC property's reviewed BOV record — e.g. '207 Fob James Dr, Valley, AL'. No other fields needed. On an ambiguous address the service returns the candidate list so you can re-call with cre_property_id." },
        cre_property_id: { type: 'integer', description: "LCC Opps lcc_cre_properties.id — load that property's reviewed BOV record directly (alternative to property_lookup)." },
        asset_type: { type: 'string', enum: ['NNN', 'MOB'], description: 'NNN = Single-Tenant Net Lease | MOB = Multi-Tenant Medical Office Building (required only when hand-authoring a new deal)' },
        property: {
          type: 'object',
          required: ['address'],
          properties: {
            address: { type: 'string', description: 'Street address' },
            city_state: { type: 'string', description: 'City, ST' },
            building_sf: { type: 'number', description: 'Rentable SF' },
            close_date: { type: 'string', description: 'YYYY-MM-DD estimated close date' }
          }
        },
        tenants: {
          type: 'array',
          description: 'NNN: one tenant. MOB: up to 5 tenants.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              guarantor: { type: 'string' },
              suite: { type: 'string', description: 'MOB suite label' },
              sf: { type: 'number', description: 'Leased SF (MOB)' },
              lease_type: { type: 'string', description: 'NNN | NN | MG | Gross' },
              year1_rent: { type: 'number', description: 'Annual base rent Year 1 ($)' },
              escalation_pct: { type: 'number', description: 'Annual escalation (0.02 = 2%)' },
              reimbursements: { type: 'number' },
              mgmt_fee_pct: { type: 'number' }
            }
          }
        },
        underwriting: {
          type: 'object',
          properties: {
            purchase_price: { type: 'number' },
            going_in_cap: { type: 'number', description: '0.065 = 6.5%' },
            exit_cap: { type: 'number' },
            hold_years: { type: 'integer', description: 'default 10' },
            ltv: { type: 'number', description: 'default 0.65' },
            interest_rate: { type: 'number', description: 'default 0.065' },
            amortization_years: { type: 'integer', description: 'default 25' },
            vacancy_pct: { type: 'number', description: 'MOB vacancy/credit loss (default 0.05)' },
            capital_reserves: { type: 'number' },
            real_estate_taxes: { type: 'number', description: 'MOB LL-responsible expense' },
            insurance: { type: 'number', description: 'MOB LL-responsible expense' },
            cam: { type: 'number', description: 'MOB LL-responsible expense' },
            mgmt_fee_pct: { type: 'number', description: 'MOB mgmt fee % (default 0.04)' }
          }
        },
        client: {
          type: 'object',
          required: ['last_name', 'file_month'],
          properties: {
            last_name: { type: 'string', description: 'Client last name — used in filename' },
            file_month: { type: 'string', description: 'YYYYMM e.g. 202607 — used in filename' }
          }
        }
      }
    }
  },
  generate_comps: {
    name: 'generate_comps',
    description: "Generate a Briggs CRE comps workbook and return only a short-lived download link plus compact counts. DEFAULT for appraisal/workbook requests: pass `request` with Scott's original text; the server runs synthesize_comps and builds the Team Briggs workbook server-side, so comp rows never round-trip through the model or connector. Legacy small-pull mode remains: pass structured rows with comp_type:'sales' or 'lease'. The shared engine writes template INPUT columns and leaves formula-protected columns (RENT/SF, all $/SF, all CAP, TERM, BPS, PRICE ADJ, DOM, EFF. RENT/SF, #) to calculate. DIALYSIS row mode: set vertical:'dialysis' and include `chairs` and `patients`. buyer / seller / financing are OPT-IN only. Omit fields you don't have.",
    inputSchema: {
      type: 'object',
      properties: {
        request: { type: 'string', description: 'One-shot workbook mode. Pass the comp/appraisal request verbatim; the server synthesizes rows and returns only the workbook link.' },
        limit: { type: 'number', description: 'One-shot mode row target. Default 25, max 50.' },
        include_unreliable_noi: { type: 'boolean', description: 'One-shot mode: include modeled/estimated NOI rows. Appraisal mode defaults true.' },
        include_on_market: { type: 'boolean', description: 'One-shot mode: include active listings. Appraisal mode defaults true.' },
        comp_type: { type: 'string', enum: ['sales', 'lease'], description: 'sales = On Market + Sold sheets | lease = Lease Comps sheet' },
        vertical: { type: 'string', description: "Set to 'dialysis' for dialysis comps — selects the dialysis sales template with CHAIRS + PATIENTS columns after RBA. Omit otherwise." },
        on_market: { type: 'array', description: 'Sales: active listings (each an object keyed by Briggs column name; dialysis: include chairs, patients).', items: { type: 'object', additionalProperties: true } },
        sold: { type: 'array', description: 'Sales: closed comps (On Market fields + last_price, sale_price, sale_date; dialysis: include chairs, patients. buyer/seller/financing are opt-in only — include just when the user explicitly requests them).', items: { type: 'object', additionalProperties: true } },
        comps: { type: 'array', description: 'Lease: lease comp rows (object per row).', items: { type: 'object', additionalProperties: true } },
        name: { type: 'string', description: 'Label for the filename (property/market/tenant); defaults to client last name or "Briggs".' },
        client: { type: 'object', properties: { last_name: { type: 'string' }, file_month: { type: 'string', description: 'YYYYMM' } } },
      }
    }
  },
};

async function postCompsWorkbook(payload) {
  if (!BOV_SERVICE_URL || !BOV_API_KEY) {
    throw new Error("Comps service not configured — set BOV_SERVICE_URL and BOV_API_KEY on the MCP service.");
  }
  const url = BOV_SERVICE_URL + "/generate-comps";
  let resp, text;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": BOV_API_KEY },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(180000),
    });
    text = await resp.text();
  } catch (e) {
    throw new Error("Could not reach comps service: " + e.message);
  }
  if (!resp.ok) {
    throw new Error("Comps service returned HTTP " + resp.status + ": " + text.slice(0, 500));
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Comps service returned non-JSON: " + text.slice(0, 300));
  }
  const { file_base64, ...rest } = data;
  return rest;
}

function compactCompsWorkbookResult(data) {
  const recalc = data.recalc_result || {};
  const mins = Math.round((data.expires_in_seconds || 3600) / 60);
  return {
    status: data.status,
    filename: data.filename,
    download_url: data.download_url,
    comp_type: data.comp_type,
    rows_by_sheet: data.rows_by_sheet,
    skipped_formula_keys: data.skipped_formula_keys,
    unknown_keys: data.unknown_keys,
    recalc_errors: recalc.total_errors || 0,
    message: "Comps workbook generated: " + data.filename + ". Download it here (link expires in " + mins + " min): " + data.download_url,
  };
}

// ── Tool handlers ─────────────────────────────────────────────────────────
// These are the exact same async functions from the former s.tool() calls.
export const TOOL_HANDLERS = {
  get_capmarkets_packet: async (args = {}) => {
    return withTiming("get_capmarkets_packet", async () => {
      if (!LCC_API_BASE) {
        return textResult({ error: "LCC_API_BASE is not configured on the MCP service." });
      }
      const params = new URLSearchParams();
      params.set("action", "packet");
      params.set("vertical", args.vertical || "dialysis");
      if (args.quarter) params.set("quarter", args.quarter);
      if (args.as_of) params.set("as_of", args.as_of);
      const resp = await fetch(`${LCC_API_BASE.replace(/\/+$/, "")}/api/capital-markets?${params.toString()}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...(LCC_API_KEY ? { "X-LCC-Key": LCC_API_KEY } : {}),
          "x-lcc-workspace": PRIMARY_WORKSPACE_ID,
        },
        signal: AbortSignal.timeout(120000),
      });
      const text = await resp.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 1000) }; }
      if (!resp.ok) return textResult({ error: `LCC packet API returned HTTP ${resp.status}`, detail: data });
      const packet = data.packet || {};
      return textResult({
        ok: true,
        snapshot_id: data.snapshot_id || null,
        frozen_at: data.frozen_at || null,
        vertical: data.vertical,
        quarter: data.quarter,
        period_end: data.period_end,
        flags: packet.flags || [],
        chart_count: Array.isArray(packet.charts) ? packet.charts.length : 0,
        packet,
      });
    });
  },
  generate_comps: async (args) => {
    return withTiming("generate_comps", async () => {
      const payload = args || {};
      if (String(payload.request || '').trim()) {
        const result = await runGenerateCompsFromRequest(payload, { govQuery, diaQuery }, postCompsWorkbook);
        return textResult(result);
      }
      const ct = String(payload.comp_type || '').toLowerCase();
      if (ct !== 'sales' && ct !== 'lease') {
        return textResult({ error: "generate_comps requires either `request` for one-shot workbook mode, or comp_type 'sales'/'lease' plus rows." });
      }
      const data = await postCompsWorkbook(payload);
      return textResult(compactCompsWorkbookResult(data));
    });
  },
  generate_bov: async (args) => {
    return withTiming("generate_bov", async () => {
      if (!BOV_SERVICE_URL || !BOV_API_KEY) {
        return textResult({ error: "BOV service not configured — set BOV_SERVICE_URL and BOV_API_KEY env vars on the MCP service." });
      }
      // Two valid shapes: a record call (property_lookup OR cre_property_id) — the
      // server loads the reviewed record — or a hand-authored call (asset_type +
      // property + client). Only reject when NEITHER is satisfied.
      const hasRecordRef = !!(args && (args.property_lookup || args.cre_property_id));
      const hasHandAuthored = !!(args && args.asset_type && args.property && args.client);
      if (!hasRecordRef && !hasHandAuthored) {
        return textResult({ error: "generate_bov needs either property_lookup / cre_property_id (to build from the property's reviewed LCC record) OR asset_type + property + client (to hand-author a new deal)." });
      }
      const url = BOV_SERVICE_URL + "/generate-bov";
      let resp, text;
      try {
        resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-API-Key": BOV_API_KEY },
          body: JSON.stringify(args),
          signal: AbortSignal.timeout(180000),
        });
        text = await resp.text();
      } catch (e) {
        return textResult({ error: "Could not reach BOV service: " + e.message });
      }
      if (!resp.ok) {
        return textResult({ error: "BOV service returned HTTP " + resp.status, detail: text.slice(0, 500) });
      }
      let data;
      try { data = JSON.parse(text); } catch (e) { return textResult({ error: "BOV service returned non-JSON", raw: text.slice(0, 300) }); }
      const recalc = data.recalc_result || {};
      const mins = Math.round((data.expires_in_seconds || 3600) / 60);
      return textResult({
        status: data.status,
        filename: data.filename,
        download_url: data.download_url,
        expires_in_seconds: data.expires_in_seconds,
        file_size_kb: data.file_size_kb,
        formulas_recalculated: recalc.total_formulas,
        recalc_errors: recalc.total_errors || 0,
        message: "BOV workbook generated: " + data.filename + ". Download it here (link expires in " + mins + " min): " + data.download_url,
      });
    });
  },
  recall_memory: async ({ query, domain, kind, limit }) => {
    return withTiming("recall_memory", async () => {
      if (!OPS_SUPABASE_URL || !OPS_SUPABASE_KEY) {
        return textResult({ error: "OPS database not configured" });
      }
      const lim = Math.min(parseInt(limit, 10) || 20, 50);
      let path = `cortex_memory?active=eq.true&select=created_at,domain,kind,summary,source&order=created_at.desc&limit=${lim}`;
      if (domain) path += `&domain=eq.${enc(domain)}`;
      if (kind) path += `&kind=eq.${enc(kind)}`;
      if (query) path += `&summary=ilike.*${enc(query)}*`;
      const r = await opsQuery("GET", path);
      return textResult({ count: r.data?.length || 0, memory: r.data || [] });
    });
  },
  log_memory: async ({ summary, domain, kind, detail }) => {
    return withTiming("log_memory", async () => {
      if (!OPS_SUPABASE_URL || !OPS_SUPABASE_KEY) {
        return textResult({ error: "OPS database not configured" });
      }
      if (!summary) return textResult({ error: "summary is required" });
      const validKind = ['decision', 'fact', 'outcome', 'preference', 'note'].includes(kind) ? kind : 'note';
      const row = {
        domain: domain || 'global',
        kind: validKind,
        summary,
        detail: detail ? { text: String(detail) } : {},
        source: 'mcp:log_memory'
      };
      const r = await opsQuery("POST", "cortex_memory", row);
      return textResult({ ok: r.ok !== false, logged: summary });
    });
  },
  get_daily_briefing: async ({ workspace_id }) => {
    return withTiming("get_daily_briefing", async () => {
      if (!OPS_SUPABASE_URL || !OPS_SUPABASE_KEY) {
        return textResult({ error: "OPS database not configured" });
      }

      // Default to primary workspace when caller omits workspace_id.
      // Without this guard, enc(undefined) produces the string "undefined",
      // which causes a PostgreSQL 22P02 UUID parse error on action_items.
      const wsId = workspace_id || PRIMARY_WORKSPACE_ID;

      // The curated intel briefing lives in `briefing_intel_snapshot` (the
      // `lcc-briefing-intel-snapshot` cron populates it daily; the retired
      // `daily_briefing_snapshot` table never existed — see the fix note).
      // It is a GLOBAL snapshot: `workspace_id` is NULL on every row, so we
      // take the latest by (as_of_date, generated_at) and do NOT filter on
      // `workspace_id=eq.<ws>` — that matched nothing and always fell through
      // to the raw action-items fallback. Two variants coexist ('daily' /
      // 'friday_deep_dive'); the newest snapshot wins regardless of variant.
      // Action items are ALWAYS fetched now: they ride along as a `priorities`
      // section of the full briefing, and stand alone only when no snapshot
      // exists.
      const [snapshot, urgent, high, normal] = await Promise.all([
        opsQuery(
          "GET",
          `briefing_intel_snapshot?order=as_of_date.desc,generated_at.desc&limit=1`
        ),
        opsQuery(
          "GET",
          `action_items?workspace_id=eq.${enc(wsId)}&priority=eq.urgent&status=in.(open,in_progress)&select=id,title,status,due_date,entity_id,priority&order=due_date.asc.nullslast&limit=10`
        ),
        opsQuery(
          "GET",
          `action_items?workspace_id=eq.${enc(wsId)}&priority=eq.high&status=in.(open,in_progress)&select=id,title,status,due_date,entity_id,priority&order=due_date.asc.nullslast&limit=10`
        ),
        opsQuery(
          "GET",
          `action_items?workspace_id=eq.${enc(wsId)}&priority=eq.normal&status=in.(open,in_progress)&select=id,title,status,due_date,entity_id,priority&order=due_date.asc.nullslast&limit=10`
        ),
      ]);

      const priorities = {
        urgent: urgent.data || [],
        high: high.data || [],
        normal: normal.data || [],
      };

      if (snapshot.ok && snapshot.data?.length) {
        const s = snapshot.data[0];
        return textResult({
          source: "briefing_intel_snapshot",
          as_of_date: s.as_of_date,
          variant: s.variant,
          generated_at: s.generated_at,
          key_numbers: s.key_numbers,
          market_data: s.market_data,
          fed_outlook: s.fed_outlook,
          analyst_take: s.analyst_take,
          capital_markets: s.capital_markets,
          sector_news: s.sector_news,
          reading_list: s.reading_list,
          weekly_changes: s.weekly_changes,
          priorities,
        });
      }

      // No snapshot exists — fall back to the raw priority action-items only.
      return textResult({
        source: "action_items_fallback",
        date: new Date().toISOString().split("T")[0],
        urgent: priorities.urgent,
        high: priorities.high,
        normal: priorities.normal,
      });
    });
  },

  search_entities: async (args = {}) => {
    return withTiming("search_entities", async () => {
      if (!OPS_SUPABASE_URL || !OPS_SUPABASE_KEY) {
        return textResult({ error: "OPS database not configured" });
      }

      // Accept the search string from the documented `query` key OR any of the
      // aliases a connector may send it under (or a bare string). Null-safe so a
      // missing key returns a clean error instead of crashing on `.replace`.
      const rawQuery = typeof args === 'string'
        ? args
        : firstNonEmptyString(
            args.query, args.q, args.search, args.request,
            args.text, args.term, args.name, args.keyword
          );
      const { entity_type, domain, limit } = (typeof args === 'object' && args) || {};
      if (!rawQuery) {
        return textResult({ error: "Search term is required (pass `query`)" });
      }

      const searchTerm = rawQuery.replace(/[%_]/g, "").trim();
      if (searchTerm.length < 2) {
        return textResult({ error: "Search term must be at least 2 characters" });
      }

      const want = Math.min(limit || 10, 50);
      const ENTITY_COLS =
        'id,entity_type,name,domain,city,state,email,phone,address,org_type,asset_type,metadata,external_identities(source_system,source_type,external_id)';

      // Over-fetch so junk rows (R13/R25 soft-flagged capture stubs) don't
      // consume result slots — they're filtered in JS below.
      let path =
        `entities?or=(name.ilike.*${enc(searchTerm)}*,canonical_name.ilike.*${enc(searchTerm.toLowerCase())}*)` +
        `&select=${ENTITY_COLS}`;

      if (entity_type) {
        path += `&entity_type=eq.${enc(entity_type)}`;
      }
      // R30: map agent domain spellings to the canonical entities.domain
      // ('gov'/'dia'), accepting both forms. The pre-R30 `domain=eq.government`
      // matched nothing (entities store 'gov').
      const forms = domainForms(domain);
      if (forms) {
        path += `&domain=in.(${forms.map(enc).join(',')})`;
      }

      path += `&limit=${Math.min(want * 3, 150)}&order=name`;

      const result = await opsQuery("GET", path);
      let entities = (result.data || []).filter((e) => !isJunkEntityRow(e));

      // Canonical buyer-parent resolution (R5/R6): float the registered parent
      // to the top so "Boyd Watterson" leads with Boyd Watterson Global, not a
      // "boyd watterson by <broker>" stub. Fetch the parent if it isn't already
      // in the result set.
      const canonical = await resolveCanonicalParentId(searchTerm);
      const canonicalId = canonical && canonical.id ? canonical.id : null;
      if (canonicalId && !entities.some((e) => e.id === canonicalId)) {
        const cr = await opsQuery("GET", `entities?id=eq.${enc(canonicalId)}&select=${ENTITY_COLS}`)
          .catch(() => ({ data: [] }));
        if (cr.data && cr.data[0] && !isJunkEntityRow(cr.data[0])) entities.unshift(cr.data[0]);
      }

      // Value ranking: pull rank_annual_rent for the matched ids so the real,
      // valuable entity leads (canonical parent always first).
      const valueMap = await fetchEntityValueMap(entities.map((e) => e.id));
      entities.sort((a, b) => {
        if (canonicalId) {
          if (a.id === canonicalId && b.id !== canonicalId) return -1;
          if (b.id === canonicalId && a.id !== canonicalId) return 1;
        }
        const va = valueMap.get(a.id) || 0;
        const vb = valueMap.get(b.id) || 0;
        if (vb !== va) return vb - va;
        const sa = entityHasSf(a) ? 1 : 0;
        const sb = entityHasSf(b) ? 1 : 0;
        if (sb !== sa) return sb - sa;
        return String(a.name || '').localeCompare(String(b.name || ''));
      });

      // De-dup by id (the canonical unshift can collide) and trim, annotating
      // the value signal + canonical flag and stripping raw metadata.
      const seen = new Set();
      entities = entities.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
      for (const e of entities) {
        e.rank_annual_rent = valueMap.has(e.id) ? valueMap.get(e.id) : null;
        if (canonicalId && e.id === canonicalId) e.is_canonical_parent = true;
        delete e.metadata;
      }
      entities = entities.slice(0, want);

      // Unit 4: gov/dia properties without an LCC asset entity (the majority of
      // gov) are otherwise invisible to search. Surface them as property hits
      // when the term is address-like or entity matches are sparse.
      let properties = [];
      if ((looksLikeAddress(searchTerm) || entities.length < want) &&
          (!entity_type || entity_type === 'asset')) {
        properties = await searchDomainProperties(searchTerm, Math.min(want, 10));
      }

      // Cross-deal tenant/guarantor resolution (Stage B widen): for every
      // org/person match, attach the DEALS where it is the tenant or guarantor,
      // so "deals we've sold with Total Renal Care, Inc. as tenant or guarantor"
      // resolves from a name search. tenant edges are relationship_type='leases',
      // guarantor edges are 'guaranteed_by' (both point FROM the org/person TO
      // the asset). One batched query over the matched ids.
      const orgPersonIds = entities
        .filter((e) => e.entity_type === "organization" || e.entity_type === "person")
        .map((e) => e.id);
      if (orgPersonIds.length > 0) {
        const idList = orgPersonIds.map(enc).join(",");
        const rel = await opsQuery(
          "GET",
          `entity_relationships?from_entity_id=in.(${idList})` +
            `&relationship_type=in.(leases,guaranteed_by)` +
            `&select=from_entity_id,relationship_type,asset:entities!entity_relationships_to_entity_id_fkey(id,name,address,city,state,domain,entity_type)`
        ).catch(() => ({ data: [] }));
        const byEntity = new Map();
        for (const r of rel.data || []) {
          if (!r.asset) continue;
          const role = r.relationship_type === "guaranteed_by" ? "guarantor" : "tenant";
          const arr = byEntity.get(r.from_entity_id) || [];
          arr.push({ role, asset: r.asset });
          byEntity.set(r.from_entity_id, arr);
        }
        for (const e of entities) {
          const deals = byEntity.get(e.id);
          if (deals && deals.length) {
            e.as_tenant_or_guarantor = deals;
            e.deal_count = deals.length;
          }
        }
      }

      return textResult({
        query: searchTerm,
        count: entities.length,
        entities,
        properties,
      });
    });
  },

  get_offer_context: async ({ deal }) => {
    return withTiming("get_offer_context", async () => {
      if (!OPS_SUPABASE_URL || !OPS_SUPABASE_KEY) return textResult({ error: "OPS database not configured" });
      if (!deal) return textResult({ error: "deal is required" });
      const r = await opsQuery("POST", "rpc/lcc_offer_context", { p_deal: String(deal) });
      const packet = Array.isArray(r.data) ? r.data[0] : r.data;
      return textResult(packet || { error: `rpc_failed_${r.status}` });
    });
  },
  log_offer: async ({ deal, offer }) => {
    return withTiming("log_offer", async () => {
      if (!OPS_SUPABASE_URL || !OPS_SUPABASE_KEY) return textResult({ error: "OPS database not configured" });
      if (!deal) return textResult({ error: "deal is required" });
      const r = await opsQuery("POST", "rpc/lcc_log_offer", { p_deal: String(deal), p_offer: offer || {} });
      const packet = Array.isArray(r.data) ? r.data[0] : r.data;
      return textResult(packet || { error: `rpc_failed_${r.status}` });
    });
  },

  get_property_context: async (args = {}) => {
    return withTiming("get_property_context", async () => {
      if (!OPS_SUPABASE_URL || !OPS_SUPABASE_KEY) {
        return textResult({ error: "OPS database not configured" });
      }

      // A bare string, or the property reference sent under an alias key
      // (query/q/ref/request/text/property/name), must resolve exactly like the
      // documented { address }. Pull the canonical keys first, then fall back to
      // a generic free-text ref that the resolver's own q-parsing routes to
      // address / property_id / entity_id. This is why raw_ref used to come back
      // {} — the free text arrived under a key this handler didn't read.
      const a = typeof args === 'string' ? { q: args } : (args || {});
      const entity_id = a.entity_id || a.entityId || null;
      let property_id = a.property_id || a.propertyId || null;
      const domain = a.domain || null;
      const address = a.address || null;
      const freeText = firstNonEmptyString(
        address, a.query, a.q, a.ref, a.request, a.text, a.property, a.name
      );

      const resolution = await resolveSubject(
        { entity_id, address, property_id, domain, q: freeText },
        {
          type: 'property',
          tool: 'get_property_context',
          surface: 'mcp',
          opsQuery,
          diaQuery,
          govQuery,
          domainAvailable: (dom) => dom === 'dia'
            ? !!(DIA_SUPABASE_URL && DIA_SUPABASE_KEY)
            : !!(GOV_SUPABASE_URL && GOV_SUPABASE_KEY),
        }
      );

      if (resolution.status === 'ambiguous') return textResult(resolution);
      if (resolution.status === 'not_on_file') {
        return textResult({ ...resolution, error: "Property not found", entity_id, property_id, domain, address });
      }
      if (!resolution.entity && resolution.domain_property) {
        const fb = await assembleDomainPropertyFallback(resolution.domain_property);
        if (fb) return textResult({ ...fb, resolution });
      }

      const entity = resolution.entity;
      if (!entity) return textResult({ ...resolution, error: "Property not found", entity_id, property_id, domain, address });

      const eid = entity.id;

      // Identify linked external records
      const extIds = entity.external_identities || [];
      // R4-A: canonical 'gov'/'dia'; accept deprecated spellings during transition.
      const govIds = extIds.filter(
        (x) => ["gov", "gov_db", "gov_supabase", "government"].includes(x.source_system)
      );
      const diaIds = extIds.filter(
        (x) => ["dia", "dia_db", "dia_supabase", "dialysis"].includes(x.source_system)
      );

      // Parallel fetches
      const promises = [];

      // Operations / research tasks for this entity
      promises.push(
        opsQuery(
          "GET",
          `action_items?entity_id=eq.${enc(eid)}&status=in.(open,in_progress,waiting)&select=id,title,status,priority,due_date,action_type&order=due_date.asc.nullslast&limit=20`
        )
      );

      // Context packet cache — fresh rows only (a stale/invalidated row counts
      // as a miss so assemble-on-miss rebuilds it below, mirroring the
      // /api/property HTTP mirror's fresh-only predicate).
      promises.push(
        opsQuery(
          "GET",
          `context_packets?entity_id=eq.${enc(eid)}&packet_type=eq.property` +
            `&invalidated=eq.false&expires_at=gt.${enc(new Date().toISOString())}` +
            `&order=created_at.desc&limit=1`
        )
      );

      // GSA lease data from gov DB (if configured and entity has gov links)
      let gsaPromise = Promise.resolve(null);
      if (GOV_SUPABASE_URL && GOV_SUPABASE_KEY && govIds.length > 0) {
        const govExtId = govIds[0].external_id;
        gsaPromise = Promise.all([
          govQuery(
            "GET",
            `gsa_leases?property_id=eq.${enc(govExtId)}&select=*&limit=5`
          ),
          govQuery(
            "GET",
            `ownership_history?property_id=eq.${enc(govExtId)}&select=*&order=transfer_date.desc&limit=10`
          ),
          govQuery(
            "GET",
            `prospect_leads?property_id=eq.${enc(govExtId)}&select=*&limit=1`
          ),
        ]).catch(() => null);
      }
      promises.push(gsaPromise);

      // Tenant + guarantor of THIS asset (Stage B widen): edges that point TO the
      // asset — relationship_type='leases' (tenant) and 'guaranteed_by'
      // (guarantor) — with the org/person entity embedded. Makes the lease/
      // guaranty graph visible on the property card and feeds cross-deal search.
      promises.push(
        opsQuery(
          "GET",
          `entity_relationships?to_entity_id=eq.${enc(eid)}` +
            `&relationship_type=in.(leases,guaranteed_by)` +
            `&select=relationship_type,metadata,party:entities!entity_relationships_from_entity_id_fkey(id,name,entity_type,domain)`
        ).catch(() => ({ data: [] }))
      );

      const [actionsRes, contextRes, govData, tgRes] = await Promise.all(promises);
      const tenantGuarantor = { tenants: [], guarantors: [] };
      for (const r of tgRes?.data || []) {
        if (!r.party) continue;
        const bucket = r.relationship_type === "guaranteed_by" ? tenantGuarantor.guarantors : tenantGuarantor.tenants;
        bucket.push({ id: r.party.id, name: r.party.name, entity_type: r.party.entity_type, domain: r.party.domain });
      }

      // Assemble-on-miss: a cold / long-tail property has no fresh cached packet
      // (the nightly pre-warm is bounded to the most-active assets). Call the
      // main app's shared assembler over HTTP so agents get the SAME rich packet
      // the HTTP mirror returns. Graceful: unset LCC_API_BASE or any
      // error/timeout falls back to the cache-only null. Phase 2 Slice 3a.1.
      const { context_packet } = await resolveContextPacket({
        cachedRow: contextRes.data?.[0] || null,
        entity,
        assembleFn: ({ entityId, workspaceId }) =>
          assemblePropertyPacketViaApi({
            entityId,
            workspaceId,
            apiBase: LCC_API_BASE,
            apiKey: LCC_API_KEY,
          }),
      });

      const result = {
        resolution: {
          status: resolution.status,
          type: resolution.type,
          confidence: resolution.confidence,
          resolved_via: resolution.resolved_via,
          candidates: resolution.candidates,
        },
        entity,
        active_tasks: actionsRes.data || [],
        context_packet,
        tenant_guarantor: tenantGuarantor,
        gov_data: null,
      };

      if (govData && Array.isArray(govData)) {
        result.gov_data = {
          gsa_leases: govData[0]?.data || [],
          ownership_history: govData[1]?.data || [],
          prospect_lead: govData[2]?.data?.[0] || null,
        };
      }

      return textResult(result);
    });
  },

  get_property_rent_timeline: async (args = {}) => {
    return withTiming("get_property_rent_timeline", async () => {
      if (!DIA_SUPABASE_URL || !DIA_SUPABASE_KEY) {
        return textResult({ error: "DIA database not configured" });
      }
      const a = typeof args === 'string' ? { q: args } : (args || {});
      let propertyId = a.property_id || a.propertyId || null;
      const freeText = firstNonEmptyString(a.address, a.query, a.q, a.ref, a.text, a.property, a.name);

      // Resolve the dia property_id when only an address/free-text ref is given.
      if (!propertyId && freeText) {
        const resolution = await resolveSubject(
          { address: a.address || null, q: freeText, domain: 'dia' },
          { type: 'property', tool: 'get_property_rent_timeline', surface: 'mcp',
            opsQuery, diaQuery, govQuery,
            domainAvailable: (dom) => dom === 'dia' ? !!(DIA_SUPABASE_URL && DIA_SUPABASE_KEY) : !!(GOV_SUPABASE_URL && GOV_SUPABASE_KEY) }
        );
        if (resolution.status === 'ambiguous') return textResult(resolution);
        propertyId = resolution.domain_property?.property_id
          || (resolution.entity?.external_identities || [])
              .filter((x) => ["dia","dia_db","dia_supabase","dialysis"].includes(x.source_system))
              .map((x) => x.external_id)[0]
          || null;
      }
      if (!propertyId) {
        return textResult({ error: "Property not resolved", property_id: a.property_id || null, address: a.address || null });
      }

      // year_range "YYYY-YYYY"
      let yrLo = null, yrHi = null;
      if (typeof a.year_range === 'string') {
        const m = a.year_range.match(/(\d{4})\s*-\s*(\d{4})/);
        if (m) { yrLo = Number(m[1]); yrHi = Number(m[2]); }
      }

      const includeSuperseded = a.include_superseded === true || a.include_superseded === 'true';
      const src = includeSuperseded ? 'property_rent_timeline' : 'v_property_rent_current';
      let path = `${src}?property_id=eq.${enc(propertyId)}` +
        `&select=year,version,rent_annual,rent_psf,rba_sf,lease_phase,basis,confidence,provenance,assumptions` +
        (includeSuperseded ? ',superseded_at' : '') +
        `&order=year.asc` + (includeSuperseded ? ',version.asc' : '');
      if (yrLo != null) path += `&year=gte.${yrLo}`;
      if (yrHi != null) path += `&year=lte.${yrHi}`;

      const res = await diaQuery("GET", path);
      if (!res.ok) return textResult({ error: "rent timeline query failed", status: res.status, property_id: propertyId });
      const rows = Array.isArray(res.data) ? res.data : [];
      if (!rows.length) {
        return textResult({ property_id: propertyId, rows: [], note: "No rent timeline on file (property may be in the research backlog)." });
      }

      // Compact provenance summary per year + a roll-up.
      const compact = rows.map((r) => ({
        year: r.year,
        ...(includeSuperseded ? { version: r.version, superseded: r.superseded_at != null } : {}),
        rent_annual: r.rent_annual,
        rent_psf: r.rent_psf,
        lease_phase: r.lease_phase,
        basis: r.basis,
        confidence: r.confidence,
        provenance: summarizeRentProvenance(r),
      }));
      const currentRows = includeSuperseded ? rows.filter((r) => r.superseded_at == null) : rows;
      const basisMix = currentRows.reduce((m, r) => { m[r.basis] = (m[r.basis] || 0) + 1; return m; }, {});
      return textResult({
        property_id: propertyId,
        current_version: currentRows[0]?.version ?? null,
        year_span: currentRows.length ? [currentRows[0].year, currentRows[currentRows.length - 1].year] : null,
        rba_sf: currentRows[0]?.rba_sf ?? null,
        basis_mix: basisMix,
        include_superseded: includeSuperseded,
        rows: compact,
      });
    });
  },

  get_contact_context: async ({ entity_id, name, email }) => {
    return withTiming("get_contact_context", async () => {
      if (!OPS_SUPABASE_URL || !OPS_SUPABASE_KEY) {
        return textResult({ error: "OPS database not configured" });
      }

      const resolution = await resolveSubject(
        { entity_id, name, email },
        { type: 'contact', tool: 'get_contact_context', surface: 'mcp', opsQuery }
      );
      if (resolution.status === 'ambiguous') return textResult(resolution);
      if (resolution.status === 'not_on_file' || !resolution.entity) {
        return textResult({ ...resolution, error: "Contact not found", entity_id, name, email });
      }
      const entity = resolution.entity;
      if (entity.metadata) delete entity.metadata;

      const eid = entity.id;

      // Parallel fetches
      const [eventsRes, signalsRes, dealsRes] = await Promise.all([
        // Activity events (last 20)
        opsQuery(
          "GET",
          `activity_events?entity_id=eq.${enc(eid)}&select=id,category,title,source_type,occurred_at,metadata&order=occurred_at.desc&limit=20`
        ),
        // Signals (touchpoint_logged)
        opsQuery(
          "GET",
          `signals?entity_id=eq.${enc(eid)}&signal_type=eq.touchpoint_logged&select=id,signal_type,created_at,metadata&order=created_at.desc&limit=10`
        ),
        // Active deals (action_items linked to this entity)
        opsQuery(
          "GET",
          `action_items?entity_id=eq.${enc(eid)}&status=in.(open,in_progress,waiting)&select=id,title,status,priority,due_date,action_type&order=due_date.asc.nullslast&limit=10`
        ),
      ]);

      const events = eventsRes.data || [];
      const signals = signalsRes.data || [];

      // Derive touchpoint stats
      const touchpoints = signals.length;
      const lastTouch = events.length > 0 ? events[0].occurred_at : null;
      const daysSinceContact = lastTouch
        ? Math.floor(
            (Date.now() - new Date(lastTouch).getTime()) / 86400000
          )
        : null;

      // Salesforce ID from external_identities
      const sfIdentity = (entity.external_identities || []).find(
        (x) =>
          x.source_system === "salesforce" || x.source_system === "sf"
      );

      // Simple outreach recommendation
      let recommendedNextAction = "No recommendation";
      if (daysSinceContact === null) {
        recommendedNextAction = "No prior touchpoints — consider introductory outreach";
      } else if (daysSinceContact > 30) {
        recommendedNextAction = `${daysSinceContact} days since last contact — re-engagement outreach recommended`;
      } else if (daysSinceContact > 14) {
        recommendedNextAction = `${daysSinceContact} days since last contact — follow-up recommended`;
      } else {
        recommendedNextAction = "Recently contacted — maintain cadence";
      }

      return textResult({
        entity,
        resolution: {
          status: resolution.status,
          type: resolution.type,
          confidence: resolution.confidence,
          resolved_via: resolution.resolved_via,
          candidates: resolution.candidates,
        },
        canonical_resolution: resolution.resolved_via === 'canonical_buyer_parent'
          ? { resolved_to_parent: resolution.candidates?.[0]?.canonical_parent_name || entity.name }
          : null,
        salesforce_id: sfIdentity?.external_id || null,
        last_touch_date: lastTouch,
        touchpoint_count: touchpoints,
        days_since_contact: daysSinceContact,
        active_deals: dealsRes.data || [],
        recent_events: events,
        recommended_next_action: recommendedNextAction,
      });
    });
  },

  get_queue_summary: async ({ domain, status, limit }) => {
    return withTiming("get_queue_summary", async () => {
      if (!OPS_SUPABASE_URL || !OPS_SUPABASE_KEY) {
        return textResult({ error: "OPS database not configured" });
      }

      // R30 Unit 1: read the OPERATOR'S REAL WORK — the materialized, value-
      // ranked priority queue (v_priority_queue_enriched) — NOT action_items
      // (a near-empty legacy table that left this tool blind to the ~1,300-row
      // queue). Mirrors api/admin.js handlePriorityQueueList.
      const max = Math.min(limit || 25, 100);
      const forms = domainForms(domain);

      const selectCols = [
        'entity_id', 'name', 'vertical', 'priority_band', 'reason', 'days_overdue',
        'rank_annual_rent', 'source_domain', 'effective_domain', 'source_property_address',
        'source_property_city', 'source_property_state', 'resolve_true_owner_name',
      ].join(',');
      // The queue is ~1.3k rows (< the 1000-row PostgREST cap per fetch is a
      // risk, so order by value and take the page that matters); fetch ordered
      // by value, then re-sort by doctrinal band priority in JS so urgent bands
      // lead, value breaks ties within band.
      let itemsPath = 'v_priority_queue_enriched?select=' + selectCols
        + '&order=rank_annual_rent.desc.nullslast&limit=1000';
      // R31: filter on effective_domain (= COALESCE(source_domain,
      // entities.domain)), NOT source_domain — which is NULL on every
      // owner-entity row, so the old filter returned ~37 of ~545 dia rows. Each
      // domain is well under the 1000-row fetch cap (dia ~545 / gov ~738).
      if (forms) itemsPath += '&effective_domain=in.(' + forms.map(enc).join(',') + ')';

      // Research-gap universe (the NBA feed) so "what needs to be done" matches
      // what the operator sees — optional/graceful, lives on the domain DBs.
      const govGapP = (GOV_SUPABASE_URL && GOV_SUPABASE_KEY)
        ? govQuery('GET', 'v_next_best_research?select=*&limit=1').catch(() => ({ count: 0 }))
        : Promise.resolve({ count: 0 });
      const diaGapP = (DIA_SUPABASE_URL && DIA_SUPABASE_KEY)
        ? diaQuery('GET', 'v_next_best_research?select=*&limit=1').catch(() => ({ count: 0 }))
        : Promise.resolve({ count: 0 });

      const [itemsR, countsR, govGap, diaGap] = await Promise.all([
        opsQuery('GET', itemsPath),
        opsQuery('GET', 'v_priority_queue_band_counts?select=priority_band,n')
          .catch(() => ({ ok: false, data: null })),
        govGapP,
        diaGapP,
      ]);

      if (!itemsR.ok) {
        return textResult({ error: 'queue_read_failed', detail: itemsR.data });
      }
      const all = Array.isArray(itemsR.data) ? itemsR.data : [];
      // Doctrinal band-priority order; within a band the rank-desc fetch order
      // is preserved (V8 stable sort).
      all.sort((a, b) => bandRank(a.priority_band) - bandRank(b.priority_band));
      const items = all.slice(0, max).map((r) => ({
        entity_id: r.entity_id,
        name: r.name,
        priority_band: r.priority_band,
        reason: r.reason,
        days_overdue: r.days_overdue,
        rank_annual_rent: r.rank_annual_rent,
        domain: r.effective_domain || r.source_domain,
        true_owner: r.resolve_true_owner_name || null,
        property: r.source_property_address
          ? { address: r.source_property_address, city: r.source_property_city, state: r.source_property_state }
          : null,
      }));

      // Band counts: pre-aggregated view for the unfiltered total (exact); when
      // a domain filter is set the queue (<1000) is fully fetched, so derive
      // filtered counts from the items.
      const bandCounts = {};
      let total = 0;
      if (forms) {
        for (const r of all) {
          const b = r.priority_band || '?';
          bandCounts[b] = (bandCounts[b] || 0) + 1;
          total += 1;
        }
      } else if (countsR.ok && Array.isArray(countsR.data)) {
        for (const r of countsR.data) {
          const n = Number(r.n) || 0;
          bandCounts[r.priority_band || '?'] = n;
          total += n;
        }
      }
      const bands = Object.keys(bandCounts)
        .sort((a, b) => bandRank(a) - bandRank(b))
        .map((b) => ({ band: b, n: bandCounts[b] }));

      return textResult({
        source: 'priority_queue',
        summary: {
          total,
          bands,
          research_gaps: {
            government: govGap.count || 0,
            dialysis: diaGap.count || 0,
          },
        },
        filters: { domain: domain || 'all', status: status || 'all' },
        items,
      });
    });
  },

  get_pipeline_health: async () => {
    return withTiming("get_pipeline_health", async () => {
      const recommendations = [];
      const out = { domains: {}, lcc_health_alerts: [], recommendation: "" };

      // R30 Unit 2: the gov ingestion_tracker columns are run_status /
      // started_at / finished_at / rows_upserted / rows_errored / error_log /
      // task_name — NOT status/completed_at/records_*/error_message (the pre-R30
      // query referenced columns that don't exist, so this tool always returned
      // "unavailable").
      const govReady = !!(GOV_SUPABASE_URL && GOV_SUPABASE_KEY);
      const diaReady = !!(DIA_SUPABASE_URL && DIA_SUPABASE_KEY);

      const trackerCols =
        "source,task_name,run_status,rows_fetched,rows_upserted,rows_errored,error_log,started_at,finished_at";
      const [govR, diaR, alertsR] = await Promise.all([
        govReady
          ? govQuery("GET", `ingestion_tracker?select=${trackerCols}&order=started_at.desc&limit=120`)
              .catch((e) => ({ ok: false, data: { error: e?.message } }))
          : Promise.resolve(null),
        diaReady
          ? diaQuery("GET", `ingestion_tracker?select=${trackerCols}&order=started_at.desc&limit=120`)
              .catch((e) => ({ ok: false, data: { error: e?.message } }))
          : Promise.resolve(null),
        // LCC Opps automation health — the same open-alert feed the operator
        // console + cron-health surface use.
        opsQuery(
          "GET",
          "v_cron_health_summary?select=alert_kind,source,severity,summary,detected_at&resolved_at=is.null&order=detected_at.desc&limit=25"
        ).catch(() => ({ ok: false, data: [] })),
      ]);

      out.domains.government = govReady
        ? summarizePipelineRuns(govR, recommendations, "government")
        : { status: "not_configured" };
      out.domains.dialysis = diaReady
        ? summarizePipelineRuns(diaR, recommendations, "dialysis")
        : { status: "not_configured" };

      out.lcc_health_alerts = (alertsR && Array.isArray(alertsR.data)) ? alertsR.data : [];
      if (out.lcc_health_alerts.length) {
        recommendations.push(`${out.lcc_health_alerts.length} open LCC automation alert(s) — review Ops Health`);
      }

      out.recommendation = recommendations.length ? recommendations.join("; ") : "All pipelines healthy";
      return textResult(out);
    });
  },
};

// Summarize a domain's ingestion_tracker runs into per-pipeline last-run /
// success-rate / failure rows. Groups by task_name (the human label), reads the
// real column names. Pushes staleness/failure notes into `recommendations`.
function summarizePipelineRuns(res, recommendations, label) {
  if (!res || !res.ok || !Array.isArray(res.data)) {
    const why = res && res.data && (res.data.message || res.data.error);
    return { status: "unavailable", detail: why || "no pipeline data" };
  }
  const runs = res.data;
  const SUCCESS = new Set(["completed", "success", "ok", "done"]);
  const FAIL = new Set(["failed", "error", "errored"]);
  const byTask = {};
  for (const run of runs) {
    const k = run.task_name || run.source || "unknown";
    (byTask[k] = byTask[k] || []).push(run);
  }
  const pipelines = [];
  const failedRecent = [];
  for (const [task, list] of Object.entries(byTask)) {
    const last = list[0];
    const lastRun = last.finished_at || last.started_at || null;
    const total = list.length;
    const succ = list.filter((r) => SUCCESS.has(String(r.run_status || "").toLowerCase())).length;
    const lastStatus = String(last.run_status || "").toLowerCase();
    const daysSince = lastRun ? Math.floor((Date.now() - new Date(lastRun).getTime()) / 86400000) : null;
    const entry = {
      pipeline: task,
      source: last.source || null,
      last_run: lastRun,
      last_status: last.run_status || null,
      last_rows_upserted: last.rows_upserted ?? null,
      last_rows_errored: last.rows_errored ?? null,
      success_rate_pct: total ? Math.round((succ / total) * 100) : 0,
      runs_considered: total,
    };
    if (FAIL.has(lastStatus)) {
      entry.last_error = last.error_log || null;
      failedRecent.push(task);
    }
    if (daysSince !== null && daysSince >= 3) {
      recommendations.push(`${label}: ${task} last ran ${daysSince}d ago`);
    }
    pipelines.push(entry);
  }
  pipelines.sort((a, b) => String(b.last_run || "").localeCompare(String(a.last_run || "")));
  if (failedRecent.length) {
    recommendations.push(`${label}: recent failure(s) — ${failedRecent.slice(0, 5).join(", ")}`);
  }
  return { status: pipelines.length ? "ok" : "no_runs", pipelines };
}

// ── Express HTTP Transport ──────────────────────────────────────────────────

export function negotiateProtocolVersion(requestedVersion) {
  const requested = String(requestedVersion || "");
  return requested >= MCP_MIN_PROTOCOL_VERSION ? requested : MCP_MIN_PROTOCOL_VERSION;
}

async function assembleDomainPropertyFallback(domainProperty) {
  const dom = normPropertyDomain(domainProperty?.domain);
  if (!dom || !domainProperty?.property_id) return null;
  if (dom === 'gov') {
    const pid = domainProperty.property_id;
    const [leases, owners, lead] = await Promise.all([
      govQuery('GET', `gsa_leases?property_id=eq.${enc(pid)}&select=*&limit=5`).catch(() => ({ data: [] })),
      govQuery('GET', `ownership_history?property_id=eq.${enc(pid)}&select=*&order=transfer_date.desc&limit=10`).catch(() => ({ data: [] })),
      govQuery('GET', `prospect_leads?property_id=eq.${enc(pid)}&select=*&limit=1`).catch(() => ({ data: [] })),
    ]);
    return {
      resolved_via: 'gov_property_fallback',
      note: 'No LCC asset entity for this property yet — resolved directly from the government domain by address.',
      property: { ...domainProperty, domain: 'gov' },
      entity: null,
      context_packet: null,
      gov_data: {
        gsa_leases: leases.data || [],
        ownership_history: owners.data || [],
        prospect_lead: (lead.data && lead.data[0]) || null,
      },
    };
  }
  if (dom === 'dia') {
    const leases = await diaQuery('GET', `leases?property_id=eq.${enc(domainProperty.property_id)}&select=*&limit=5`)
      .catch(() => ({ data: [] }));
    return {
      resolved_via: 'dia_property_fallback',
      note: 'No LCC asset entity for this property yet — resolved directly from the dialysis domain by address.',
      property: { ...domainProperty, domain: 'dia' },
      entity: null,
      context_packet: null,
      dia_data: { leases: leases.data || [] },
    };
  }
  return null;
}

export function mountLccMcp(app, { installMiddleware = false, apiPrefix = "" } = {}) {
  const prefixed = (path) => `${apiPrefix}${path}`;
  const publicBase = (req) => process.env.MCP_BASE_URL || `${req.protocol}://${req.get('host')}`;
  const publicUrl = (req, path) => `${publicBase(req)}${prefixed(path)}`;
  if (installMiddleware) {
    app.use(
      cors({
        origin: true,
        methods: ["GET", "POST", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "Accept"],
        credentials: true,
      })
    );
    app.use(express.json({ limit: '30mb' }));   // batch opportunity sync posts the whole SF Get-records array
    app.use(express.urlencoded({ extended: true }));
  }
// ── Auth middleware ───────────────────────────────────────────────────────────

function authenticate(req, res, next) {
  if (!LCC_API_KEY) {
    // No API key configured — allow through (development mode)
    return next();
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";

  if (!token || token !== LCC_API_KEY) {
    // RFC 9728 §5.1 / MCP Authorization spec: an unauthenticated request to the
    // resource MUST advertise where to begin OAuth via a WWW-Authenticate header
    // pointing at the protected-resource metadata. MCP clients (Claude/Cowork)
    // read `resource_metadata` here to bootstrap discovery; without it a strict
    // client cannot start the OAuth flow and reports "error connecting".
    const base = process.env.MCP_BASE_URL
      || `${req.protocol}://${req.get('host')}`;
    res.set(
      'WWW-Authenticate',
      `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`,
    );
    return res.status(401).json({ error: "Unauthorized — invalid or missing Bearer token" });
  }

  next();
}

// ── Read-tool HTTP surface (Option A — full read-capability parity) ──────────
// Every READ tool is exposed over HTTP by reusing the EXACT same
// TOOL_HANDLERS[name] implementation the MCP surface uses, then unwrapping the
// textResult envelope back to the raw JSON the tool produced. One implementation
// per tool ⇒ the MCP and HTTP surfaces cannot diverge — the same guarantee
// comps-tools gets from a shared runComps, without relocating the handlers'
// DB logic out of server.js.
//
// READ-ONLY by construction: only tools in READ_ONLY_HTTP_TOOLS may be mounted.
// None of them mutates domain/CRM/queue data (they SELECT and return);
// get_property_context may warm the shared context-packet cache exactly as its
// MCP counterpart does. The one WRITE tool (log_memory) is intentionally
// excluded and can never reach HTTP — makeReadHttpRoute throws if asked.
const READ_ONLY_HTTP_TOOLS = new Set([
  "search_entities",
  "get_property_context",
  "get_contact_context",
  "get_daily_briefing",
  "get_queue_summary",
  "get_pipeline_health",
  "recall_memory",
]);

// MCP tools return { content: [{ type: 'text', text: <JSON string> }] } (and
// withTiming wraps thrown errors in the same envelope). Peel it back to the
// object the tool actually returned so HTTP callers get plain JSON.
function unwrapToolResult(result) {
  const text = result?.content?.[0]?.text;
  if (typeof text === "string") {
    try { return JSON.parse(text); } catch { return { raw: text }; }
  }
  return result;
}

function makeReadHttpRoute(toolName) {
  // Belt-and-suspenders: a wiring mistake can never expose a write tool.
  if (!READ_ONLY_HTTP_TOOLS.has(toolName)) {
    throw new Error(`makeReadHttpRoute refused non-read-only tool: ${toolName}`);
  }
  return async (req, res) => {
    // Read-only: this route calls the read tool's handler and returns its JSON,
    // BOUNDED so the payload stays under the ChatGPT Action / Copilot ~100k-char
    // cap. The MCP surface calls the same handler unbounded (Claude keeps full
    // fidelity) — only this HTTP layer shrinks. See mcp/http-response-bound.js.
    try {
      const handler = TOOL_HANDLERS[toolName];
      if (typeof handler !== "function") {
        return res.status(500).json({ error: `tool ${toolName} not registered` });
      }
      const args = req.body || {};
      const raw = unwrapToolResult(await handler(args));
      const before = jsonLen(raw);
      const bounded = boundHttpToolResult(toolName, raw, args);
      const after = jsonLen(bounded);
      console.log(
        `[http-bound] ${toolName} before=${before} after=${after} truncated=${!!(bounded && bounded.truncated)}`
      );
      res.json(bounded);
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  };
}

// ── Auth middleware for /mcp ─────────────────────────────────────────────
app.use(prefixed('/mcp'), authenticate);

// ── MCP JSON-RPC endpoint ────────────────────────────────────────────────
// Implements the MCP protocol directly over HTTP JSON-RPC.
// No SDK transport layer — maximum compatibility with Claude.ai.
app.post(prefixed('/mcp'), async (req, res) => {
  const body = req.body;

  console.log('[MCP] Request method:', body?.method, 'id:', body?.id);

  // Validate JSON-RPC structure
  if (!body || body.jsonrpc !== '2.0') {
    return res.status(400).json({
      jsonrpc: '2.0', id: null,
      error: { code: -32600, message: 'Invalid Request' }
    });
  }

  const { method, id, params } = body;
  const isNotification = id === undefined || id === null;

  try {
    switch (method) {

      // ── MCP Lifecycle ──────────────────────────────────────────────────
      case 'initialize':
        console.log('[MCP] Initializing with protocol version:',
          params?.protocolVersion);
        return res.json({
          jsonrpc: '2.0', id,
          result: {
            protocolVersion: negotiateProtocolVersion(params?.protocolVersion),
            capabilities: { tools: {} },
            serverInfo: { name: 'LCC MCP Server', version: '1.0.0' }
          }
        });

      case 'notifications/initialized':
      case 'initialized':
        console.log('[MCP] Client initialized');
        if (isNotification) return res.status(200).end();
        return res.json({ jsonrpc: '2.0', id, result: {} });

      // ── Tools ──────────────────────────────────────────────────────────
      case 'tools/list':
        return res.json({
          jsonrpc: '2.0', id,
          result: {
            tools: Object.values(TOOL_DEFINITIONS)
          }
        });

      case 'tools/call': {
        const toolName = params?.name;
        const toolArgs = params?.arguments || {};

        console.log('[MCP] Tool call:', toolName, 'args:', JSON.stringify(toolArgs).substring(0, 100));

        const handler = TOOL_HANDLERS[toolName];
        if (!handler) {
          return res.json({
            jsonrpc: '2.0', id,
            error: { code: -32601, message: `Tool not found: ${toolName}` }
          });
        }

        const result = await handler(toolArgs);

        // Normalize result to MCP content format
        // The handlers return various shapes — normalize to text content
        let content;
        if (typeof result === 'string') {
          content = [{ type: 'text', text: result }];
        } else if (result && result.content) {
          content = result.content; // already in MCP format
        } else {
          content = [{ type: 'text', text: JSON.stringify(result, null, 2) }];
        }

        return res.json({
          jsonrpc: '2.0', id,
          result: { content }
        });
      }

      // ── Ping / misc ────────────────────────────────────────────────────
      case 'ping':
        return res.json({ jsonrpc: '2.0', id, result: {} });

      default:
        console.log('[MCP] Unknown method:', method);
        if (isNotification) return res.status(200).end();
        return res.json({
          jsonrpc: '2.0', id,
          error: { code: -32601, message: `Method not found: ${method}` }
        });
    }
  } catch (err) {
    console.error('[MCP] Tool error:', err.message);
    return res.json({
      jsonrpc: '2.0', id: id || null,
      error: { code: -32000, message: err.message }
    });
  }
});

// DELETE /mcp — session cleanup (Streamable HTTP spec requirement)
app.delete(prefixed('/mcp'), (req, res) => res.status(200).end());

// GET /mcp — not supported (no server-push needed for these tools)
app.get(prefixed('/mcp'), (req, res) => {
  res.status(405).json({ error: 'Use POST for MCP requests' });
});


// ── PKCE verification ─────────────────────────────────────────────────────
async function verifyPKCE(codeVerifier, codeChallenge, method = 'S256') {
  if (!codeVerifier || !codeChallenge) return false;
  if (method === 'plain') return codeVerifier === codeChallenge;
  if (method === 'S256') {
    const encoder = new TextEncoder();
    const data = encoder.encode(codeVerifier);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = new Uint8Array(hashBuffer);
    const base64 = btoa(String.fromCharCode(...hashArray))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    return base64 === codeChallenge;
  }
  return false;
}

// ── In-memory authorization code store (auto-expires after 5 minutes) ────
const authCodes = new Map();
function generateCode() {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}
// Use Web Crypto API (available in Node 20 without import)
const crypto = globalThis.crypto;

// ── OAuth Protected Resource Metadata (RFC 9396 / MCP OAuth June 2025) ──
// Required by Claude.ai to discover the authorization server for /mcp.
// Without this, Claude.ai cannot find OAuth endpoints and reports auth failure.
// RFC 9728 §3.1: for a protected resource whose id has a path component
// (`/mcp`), the metadata lives at the PATH-SUFFIXED well-known URL
// (`/.well-known/oauth-protected-resource/mcp`). Spec-compliant MCP clients
// (Claude/Cowork, 2025-06-18) request that suffixed URL — without this route it
// falls through to the SPA catch-all and returns index.html (200 text/html),
// which the connector fails to parse as JSON → "error connecting to the server".
// Serve BOTH the suffixed and the bare path so every client generation resolves.
app.get([
  prefixed('/.well-known/oauth-protected-resource'),
  prefixed('/.well-known/oauth-protected-resource/mcp'),
], (req, res) => {
  res.json({
    resource: publicUrl(req, '/mcp'),
    authorization_servers: [publicBase(req)],
  });
});

// ── OAuth discovery metadata ──────────────────────────────────────────────
// Serve the auth-server metadata at the bare path (issuer has no path
// component) AND at the `/mcp`-suffixed path that some clients derive from the
// resource id — same JSON, same SPA-fallthrough guard as above.
app.get([
  prefixed('/.well-known/oauth-authorization-server'),
  prefixed('/.well-known/oauth-authorization-server/mcp'),
], (req, res) => {
  res.json({
    issuer: publicBase(req),
    authorization_endpoint: publicUrl(req, '/authorize'),
    token_endpoint: publicUrl(req, '/oauth/token'),
    registration_endpoint: publicUrl(req, '/register'),
    grant_types_supported: ['authorization_code'],
    response_types_supported: ['code'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
    code_challenge_methods_supported: ['S256', 'plain'],
    scopes_supported: ['read'],
  });
});

// ── Dynamic Client Registration (RFC 7591) ────────────────────────────────
// Claude.ai may attempt to register before the OAuth flow.
// We accept any registration and return LCC_API_KEY as the client_secret.
app.post(prefixed('/register'), (req, res) => {
  const apiKey = LCC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'server_error' });
  }
  const clientId = `lcc-${Date.now()}`;
  console.log(`[OAuth] DCR registration → client_id: ${clientId}`);
  res.status(201).json({
    client_id: clientId,
    client_secret: apiKey,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_secret_expires_at: 0,
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'client_secret_post',
  });
});

// ── Step 1: Authorization endpoint ───────────────────────────────────────
// Claude.ai redirects the user here. We auto-approve and redirect back
// immediately — no login page needed for an internal personal tool.
app.get(prefixed('/authorize'), (req, res) => {
  const {
    response_type, client_id, redirect_uri, state,
    code_challenge, code_challenge_method,
  } = req.query;

  console.log('[OAuth] /authorize called:', {
    response_type, client_id,
    redirect_uri: redirect_uri?.substring(0, 60),
    has_pkce: !!code_challenge,
    state: state?.substring(0, 10),
  });

  if (response_type !== 'code') {
    return res.status(400).send('unsupported_response_type');
  }
  if (!redirect_uri) {
    return res.status(400).send('missing redirect_uri');
  }

  const code = generateCode();
  const expires = Date.now() + 5 * 60 * 1000;

  authCodes.set(code, {
    client_id,
    redirect_uri,
    code_challenge: code_challenge || null,
    code_challenge_method: code_challenge_method || 'S256',
    expires,
  });

  // Housekeeping: remove expired codes
  for (const [k, v] of authCodes.entries()) {
    if (v.expires < Date.now()) authCodes.delete(k);
  }

  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set('code', code);
  if (state) redirectUrl.searchParams.set('state', state);

  console.log(`[OAuth] Redirecting to ${redirectUrl.origin} with code`);
  return res.redirect(302, redirectUrl.toString());
});

// ── Step 2: Token endpoint ────────────────────────────────────────────────
// Claude.ai exchanges the authorization code for an access token.
// Handles both application/x-www-form-urlencoded and application/json.
app.post(prefixed('/oauth/token'), async (req, res) => {
  const {
    grant_type,
    code,
    client_id,
    client_secret,
    redirect_uri,
    code_verifier,
  } = req.body || {};

  console.log('[OAuth] /oauth/token called:', {
    grant_type,
    has_code: !!code,
    has_client_secret: !!client_secret,
    has_code_verifier: !!code_verifier,
    content_type: req.get('content-type'),
    body_keys: Object.keys(req.body || {}),
  });

  const apiKey = LCC_API_KEY;
  if (!apiKey) {
    console.error('[OAuth] LCC_API_KEY not set');
    return res.status(500).json({
      error: 'server_error',
      error_description: 'LCC_API_KEY not configured on server',
    });
  }

  if (grant_type !== 'authorization_code') {
    console.warn('[OAuth] Bad grant_type:', grant_type);
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }

  if (!code) {
    console.warn('[OAuth] Missing code in request body. Body:', req.body);
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'Missing authorization code',
    });
  }

  const stored = authCodes.get(code);
  if (!stored) {
    console.warn('[OAuth] Code not found in store. Active codes:', authCodes.size);
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Authorization code not found or already used',
    });
  }

  if (stored.expires < Date.now()) {
    authCodes.delete(code);
    console.warn('[OAuth] Code expired');
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Authorization code expired',
    });
  }

  // Validate credentials: accept if client_secret matches LCC_API_KEY
  // OR if no client_secret provided but PKCE validates (public client)
  let credentialsValid = false;

  if (client_secret && client_secret === apiKey) {
    // Confidential client: secret matches
    credentialsValid = true;
    console.log('[OAuth] Validated via client_secret match');
  } else if (!client_secret && code_verifier && stored.code_challenge) {
    // Public client: validate PKCE
    const valid = await verifyPKCE(
      code_verifier,
      stored.code_challenge,
      stored.code_challenge_method
    );
    if (valid) {
      credentialsValid = true;
      console.log('[OAuth] Validated via PKCE');
    } else {
      console.warn('[OAuth] PKCE validation failed');
    }
  } else if (!client_secret && !stored.code_challenge) {
    // No secret, no PKCE — allow for development/loose mode
    // Comment this out to require authentication
    credentialsValid = true;
    console.warn('[OAuth] No credentials provided — allowing (no PKCE stored)');
  } else {
    console.warn('[OAuth] Credential validation failed:', {
      has_secret: !!client_secret,
      secret_matches: client_secret === apiKey,
      has_verifier: !!code_verifier,
      has_challenge: !!stored.code_challenge,
    });
  }

  if (!credentialsValid) {
    return res.status(401).json({
      error: 'invalid_client',
      error_description: 'Client authentication failed',
    });
  }

  // One-time use: consume the code
  authCodes.delete(code);

  console.log('[OAuth] Token issued successfully');

  return res.json({
    access_token: apiKey,
    token_type: 'bearer',
    expires_in: 315360000,
    scope: 'read',
  });
});

// ── Health check ─────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    server: "lcc-mcp-server",
    version: "1.0.0",
    // Derived so it always reflects every registered tool (incl. comps, which
    // are Object.assign'd onto TOOL_DEFINITIONS at startup).
    tools: Object.keys(TOOL_DEFINITIONS),
    http_read_routes: Object.keys(READ_HTTP_ROUTES),
    http_comps_routes: ["/api/query-comps", "/api/synthesize-comps", "/api/comps"],
    ops_configured: !!(OPS_SUPABASE_URL && OPS_SUPABASE_KEY),
    gov_configured: !!(GOV_SUPABASE_URL && GOV_SUPABASE_KEY),
  });
});

app.get("/", (_req, res) => {
  res.json({
    name: "Life Command Center MCP Server",
    description: "Connect Claude.ai to LCC via direct JSON-RPC — search entities, get briefings, check pipelines",
    endpoints: {
      mcp: "/mcp",
      health: "/health",
    },
  });
});

// ── Comps tools (query_comps + synthesize_comps) — registered onto the maps above ──
{
  const { defs: __compsDefs, handlers: __compsHandlers } = makeCompsTools({
    govQuery, diaQuery, textResult, withTiming,
  });
  Object.assign(TOOL_DEFINITIONS, __compsDefs);
  Object.assign(TOOL_HANDLERS, __compsHandlers);
  console.log("[MCP] Registered comps tools:", Object.keys(__compsDefs).join(", "));

  // Shared REST surface — same engine as the MCP tools above, for Copilot Studio
  // custom connector + ChatGPT GPT Actions. Bearer-authenticated via `authenticate`.
  const __compsRoutes = makeCompsHttpRoutes({ govQuery, diaQuery });
  app.post(prefixed("/api/query-comps"), authenticate, __compsRoutes.queryComps);
  app.post(prefixed("/api/synthesize-comps"), authenticate, __compsRoutes.synthesizeComps);
  app.post(prefixed("/api/comps"), authenticate, async (req, res) => {
    // Prompt 71 — instrument the engine /api/comps handler so the failing hop is visible in logs.
    const __t0 = Date.now();
    try {
      const payload = req.body || {};
      const hasRequest = !!String(payload.request || '').trim();
      const hasRows = Array.isArray(payload.sold) || Array.isArray(payload.on_market) || Array.isArray(payload.comps);
      console.log('[api/comps] hit; hasRequest=' + hasRequest + ' hasRows=' + hasRows);
      if (hasRequest) {
        const result = await runGenerateCompsFromRequest(payload, { govQuery, diaQuery }, postCompsWorkbook);
        console.log('[api/comps] one-shot ok in ' + (Date.now() - __t0) + 'ms; error=' + !!result.error);
        res.status(result.error ? 400 : 200).json(enforceHttpResponseSize(result));
        return;
      }
      const data = await postCompsWorkbook(payload);
      res.json(enforceHttpResponseSize(compactCompsWorkbookResult(data)));
    } catch (e) {
      console.error('[api/comps] one-shot threw after ' + (Date.now() - __t0) + 'ms: ' + (e?.message || e));
      res.status(502).json({ error: String(e?.message || e) });
    }
  });
  // W3.4: the comp-review DRAIN — list + resolve the flagged-comp queues. GET
  // lists open reviews across dia+gov; POST records a disposition. Same engine
  // the Decision-Center comp-review lane (ops.js) proxies to via /api/comp-reviews.
  app.get(prefixed("/api/comp-reviews"), authenticate, __compsRoutes.listCompReviews);
  app.post(prefixed("/api/comp-reviews/resolve"), authenticate, __compsRoutes.resolveCompReview);
  console.log("[MCP] Registered comps HTTP routes: /api/query-comps, /api/synthesize-comps, /api/comps, /api/comp-reviews[, /resolve]");
}

// ── Property metadata-backfill worklist (W3.4, audit 3.4 item 4) ─────────────
// The prioritized backfill worklist (v_property_metadata_backfill_queue, with a
// suggested CoStar URL per property) was psql-only. Surface it for the Research
// sub-page via the service-role domain readers here (no data-query edge
// allowlist dependency), proxied by the root app at /api/metadata-backfill.
{
  const MB_SELECT_GOV = 'queue_id,property_id,missing_fields,priority,status,attempts,last_attempt_at,address,city,state,agency_full,most_recent_sale_date,most_recent_sold_price,costar_search_url';
  const MB_SELECT_DIA = 'queue_id,property_id,missing_fields,priority,status,attempts,last_attempt_at,address,city,state,tenant,parcel_number,most_recent_sale_date,most_recent_sold_price,costar_search_url';
  app.get(prefixed("/api/metadata-backfill"), authenticate, async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
    const only = String(req.query.domain || '').toLowerCase();
    const wantGov = !only || only === 'gov' || only === 'government';
    const wantDia = !only || only === 'dia' || only === 'dialysis';
    const order = 'order=priority.desc.nullslast,most_recent_sold_price.desc.nullslast';
    const items = []; const counts = {}; const errors = [];
    const legs = [];
    if (wantGov) legs.push({ dom: 'gov', q: govQuery, sel: MB_SELECT_GOV });
    if (wantDia) legs.push({ dom: 'dia', q: diaQuery, sel: MB_SELECT_DIA });
    await Promise.all(legs.map(async (leg) => {
      if (typeof leg.q !== 'function') { errors.push({ domain: leg.dom, error: 'not configured' }); return; }
      try {
        const r = await leg.q('GET',
          `v_property_metadata_backfill_queue?select=${leg.sel}&${order}&limit=${limit}`,
          undefined, 'count=exact');
        const rows = Array.isArray(r && r.data) ? r.data : [];
        counts[leg.dom] = (r && typeof r.count === 'number') ? r.count : rows.length;
        for (const row of rows) items.push({ domain: leg.dom, ...row });
      } catch (e) { errors.push({ domain: leg.dom, error: String(e && e.message || e) }); }
    }));
    // Value-rank across domains (priority desc, then most-recent sold price desc), cap.
    items.sort((a, b) =>
      (Number(b.priority) || 0) - (Number(a.priority) || 0)
      || (Number(b.most_recent_sold_price) || 0) - (Number(a.most_recent_sold_price) || 0));
    res.json({ items: items.slice(0, limit), counts, total: items.length, errors });
  });
  console.log("[MCP] Registered metadata-backfill HTTP route: /api/metadata-backfill");
}

// ── Deal dossier + Salesforce write-back — tools + REST surface (same engine) ──
{
  const logMemory = (a) => TOOL_HANDLERS.log_memory(a);

  const { defs: __ddDefs, handlers: __ddHandlers } = makeDealDossierTools({
    opsQuery, textResult, withTiming, enc, WORKSPACE_ID: PRIMARY_WORKSPACE_ID,
  });
  Object.assign(TOOL_DEFINITIONS, __ddDefs);
  Object.assign(TOOL_HANDLERS, __ddHandlers);
  console.log("[MCP] Registered deal-dossier tools:", Object.keys(__ddDefs).join(", "));

  // REST surface (POST + JSON body) — the root proxy forwards POST, so these are POST.
  const __ddRoutes = makeDealDossierHttpRoutes({ opsQuery, enc });
  app.post(prefixed("/api/deal/dossier"),     authenticate, __ddRoutes.getDossier);
  app.post(prefixed("/api/deal/checkpoints"), authenticate, __ddRoutes.listCheckpoints);

  // Salesforce write-back — enqueue into sf_sync_queue (confirmation-gated in the module).
  const __sfRoutes = makeSfWritebackRoutes({ opsQuery, enc, logMemory, WORKSPACE_ID: PRIMARY_WORKSPACE_ID });
  app.post(prefixed("/api/sf/log-activity"),       authenticate, __sfRoutes.logActivity);
  app.post(prefixed("/api/sf/create-task"),        authenticate, __sfRoutes.createTask);
  app.post(prefixed("/api/sf/update-opportunity"), authenticate, __sfRoutes.updateOpportunity);

  // Inbound SF Opportunity -> LCC deal backbone (BUILD 01) — idempotent on (workspace_id, sf_opp_id).
  const __oppSync = makeOpportunitySyncRoute({ opsQuery, enc, WORKSPACE_ID: PRIMARY_WORKSPACE_ID });
  app.post(prefixed("/api/pipeline/ingest-opportunity"),   authenticate, __oppSync.ingest);       // single deal
  app.post(prefixed("/api/pipeline/ingest-opportunities"), authenticate, __oppSync.ingestBatch);  // batch (PA sends whole array)

  // Deal Roster (BUILD 02, Slice A) — Team Briggs deal-team edges for owned/partnership scope.
  const __roster = makeDealRosterRoute({ opsQuery, enc, WORKSPACE_ID: PRIMARY_WORKSPACE_ID });
  app.post(prefixed("/api/pipeline/ingest-deal-parties"),  authenticate, __roster.ingestParties);       // team members
  app.post(prefixed("/api/pipeline/ingest-deal-contacts"), authenticate, __roster.ingestContactRoles);   // external contact roles

  // Cadence Engine (BUILD 03) — read-only "what needs a touch" scan over in-scope open deals.
  const __cadence = makeCadenceScanRoute({ opsQuery, enc, WORKSPACE_ID: PRIMARY_WORKSPACE_ID });
  app.get(prefixed("/api/pipeline/cadence-scan"),  authenticate, __cadence.scan);
  app.post(prefixed("/api/pipeline/cadence-scan"), authenticate, __cadence.scan);
  app.get(prefixed("/api/pipeline/weekly-digest"),  authenticate, __cadence.weeklyDigest);   // engine-composed email
  app.post(prefixed("/api/pipeline/weekly-digest"), authenticate, __cadence.weeklyDigest);
  // A1 entity reconciliation — review flagged deals + merge a placeholder onto a canonical asset.
  const __reconcile = makeEntityReconcileRoute({ opsQuery });
  app.get(prefixed("/api/pipeline/flagged-deals"),     authenticate, __reconcile.list);
  app.post(prefixed("/api/pipeline/flagged-deals"),    authenticate, __reconcile.list);
  app.post(prefixed("/api/pipeline/reconcile-entity"), authenticate, __reconcile.reconcile);

  // Offer-submission (BUILD 05) — assemble context + log an inbound offer (LCC + generic SF).
  const __offerCtx = makeOfferContextRoute({ opsQuery });
  const __offerLog = makeOfferLogRoute({ opsQuery });
  app.get (prefixed("/api/pipeline/offer-context"), authenticate, __offerCtx.get);
  app.post(prefixed("/api/pipeline/offer-context"), authenticate, __offerCtx.get);
  app.post(prefixed("/api/pipeline/offer-log"),     authenticate, __offerLog.post);

  // Deal-Email Matcher (BUILD 04) — attribute Outlook emails to deals by tenant+city; self-builds roster.
  const __matcher = makeDealEmailMatcherRoute({ opsQuery, enc, WORKSPACE_ID: PRIMARY_WORKSPACE_ID });
  app.post(prefixed("/api/pipeline/match-deal-emails"), authenticate, __matcher.match);
  console.log("[MCP] Registered deal-dossier + SF write-back + opportunity-sync HTTP routes");
}

// ── Read-tool HTTP routes — full surface parity for ChatGPT + Copilot ────────
// Same engine as the MCP tools above (each route reuses TOOL_HANDLERS[name] via
// makeReadHttpRoute), Bearer-authenticated via `authenticate`. Read-only; the
// WRITE tool log_memory has no route (stays Claude/MCP-only by design).
const READ_HTTP_ROUTES = {
  "/api/search-entities": "search_entities",
  "/api/property-context": "get_property_context",
  "/api/contact-context": "get_contact_context",
  "/api/daily-briefing": "get_daily_briefing",
  "/api/queue-summary": "get_queue_summary",
  "/api/pipeline-health": "get_pipeline_health",
  "/api/recall-memory": "recall_memory",
};
for (const [routePath, toolName] of Object.entries(READ_HTTP_ROUTES)) {
  app.post(prefixed(routePath), authenticate, makeReadHttpRoute(toolName));
}
console.log("[MCP] Registered read HTTP routes:", Object.keys(READ_HTTP_ROUTES).join(", "));
}

// ── Start ────────────────────────────────────────────────────────────────────

const isStandalone = process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href;
if (isStandalone) {
  const app = express();
  mountLccMcp(app, { installMiddleware: true });
  app.listen(PORT, () => {
    console.log(`[MCP] Life Command Center MCP server running on port ${PORT}`);
    console.log(`[MCP] MCP endpoint: http://localhost:${PORT}/mcp`);
    console.log(`[MCP] Health check: http://localhost:${PORT}/health`);
    console.log(`[MCP] Auth: ${LCC_API_KEY ? "ENABLED" : "DISABLED (dev mode)"}`);
    console.log(`[MCP] OPS DB: ${OPS_SUPABASE_URL ? "configured" : "NOT configured"}`);
    console.log(`[MCP] GOV DB: ${GOV_SUPABASE_URL ? "configured" : "NOT configured"}`);
    console.log(`[MCP] Assemble-on-miss: ${LCC_API_BASE ? `via ${LCC_API_BASE}` : "DISABLED (LCC_API_BASE not set — cache-only)"}`);
  });
}
