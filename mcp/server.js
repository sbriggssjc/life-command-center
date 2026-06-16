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

// ── Environment ──────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || "3100", 10);
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

// ── Supabase fetch helper (mirrors api/_shared/ops-db.js pattern) ────────────

async function supabaseQuery(baseUrl, apiKey, method, path, body) {
  const url = `${baseUrl}/rest/v1/${path}`;
  const headers = {
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Prefer: method === "GET" ? "count=exact" : "return=representation",
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

function opsQuery(method, path, body) {
  return supabaseQuery(OPS_SUPABASE_URL, OPS_SUPABASE_KEY, method, path, body);
}

function govQuery(method, path, body) {
  return supabaseQuery(GOV_SUPABASE_URL, GOV_SUPABASE_KEY, method, path, body);
}

function enc(v) {
  return encodeURIComponent(String(v));
}

// ── DIA domain (optional — Unit 4 dia address fallback) ──────────────────────
// The MCP server historically configured only OPS + GOV. The gov property
// fallback (Unit 4) is the live-verified path; the dia leg engages only when a
// DIA connection is provided, and is a graceful no-op otherwise.
const DIA_SUPABASE_URL = process.env.DIA_SUPABASE_URL || "";
const DIA_SUPABASE_KEY =
  process.env.DIA_SUPABASE_SERVICE_KEY || process.env.DIA_SUPABASE_KEY || "";
function diaQuery(method, path, body) {
  return supabaseQuery(DIA_SUPABASE_URL, DIA_SUPABASE_KEY, method, path, body);
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
  let r = await q('GET', `properties?address=ilike.*${enc(raw)}*&select=${sel}&limit=1`)
    .catch(() => ({ data: [] }));
  if (r.data && r.data[0]) return r.data[0];
  const norm = normalizeAddressLite(raw);
  if (norm && norm !== String(raw).toLowerCase()) {
    r = await q('GET', `properties?address=ilike.*${enc(norm)}*&select=${sel}&limit=1`)
      .catch(() => ({ data: [] }));
    if (r.data && r.data[0]) return r.data[0];
  }
  return null;
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
        address: { type: 'string', description: 'Property address (alternative to entity_id)' }
      }
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
};

// ── Tool handlers ─────────────────────────────────────────────────────────
// These are the exact same async functions from the former s.tool() calls.
const TOOL_HANDLERS = {
  get_daily_briefing: async ({ workspace_id }) => {
    return withTiming("get_daily_briefing", async () => {
      if (!OPS_SUPABASE_URL || !OPS_SUPABASE_KEY) {
        return textResult({ error: "OPS database not configured" });
      }

      // Try daily_briefing_snapshot first
      const snapshot = await opsQuery(
        "GET",
        `daily_briefing_snapshot?workspace_id=eq.${enc(workspace_id)}&order=created_at.desc&limit=1`
      );

      if (snapshot.ok && snapshot.data?.length) {
        return textResult({
          source: "daily_briefing_snapshot",
          briefing: snapshot.data[0],
        });
      }

      // Fallback: build from queue/action_items by priority
      const [urgent, high, normal] = await Promise.all([
        opsQuery(
          "GET",
          `action_items?workspace_id=eq.${enc(workspace_id)}&priority=eq.urgent&status=in.(open,in_progress)&select=id,title,status,due_date,entity_id,priority&order=due_date.asc.nullslast&limit=10`
        ),
        opsQuery(
          "GET",
          `action_items?workspace_id=eq.${enc(workspace_id)}&priority=eq.high&status=in.(open,in_progress)&select=id,title,status,due_date,entity_id,priority&order=due_date.asc.nullslast&limit=10`
        ),
        opsQuery(
          "GET",
          `action_items?workspace_id=eq.${enc(workspace_id)}&priority=eq.normal&status=in.(open,in_progress)&select=id,title,status,due_date,entity_id,priority&order=due_date.asc.nullslast&limit=10`
        ),
      ]);

      return textResult({
        source: "action_items_fallback",
        date: new Date().toISOString().split("T")[0],
        urgent: urgent.data || [],
        high: high.data || [],
        normal: normal.data || [],
      });
    });
  },

  search_entities: async ({ query, entity_type, domain, limit }) => {
    return withTiming("search_entities", async () => {
      if (!OPS_SUPABASE_URL || !OPS_SUPABASE_KEY) {
        return textResult({ error: "OPS database not configured" });
      }

      const searchTerm = query.replace(/[%_]/g, "").trim();
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

  get_property_context: async ({ entity_id, address }) => {
    return withTiming("get_property_context", async () => {
      if (!OPS_SUPABASE_URL || !OPS_SUPABASE_KEY) {
        return textResult({ error: "OPS database not configured" });
      }

      // Resolve entity
      let entity = null;
      if (entity_id) {
        const res = await opsQuery(
          "GET",
          `entities?id=eq.${enc(entity_id)}&entity_type=eq.asset&select=*,external_identities(*),entity_relationships!entity_relationships_from_entity_id_fkey(*)`
        );
        entity = res.data?.[0] || null;
      } else if (address) {
        const res = await opsQuery(
          "GET",
          `entities?entity_type=eq.asset&or=(address.ilike.*${enc(address)}*,name.ilike.*${enc(address)}*)&select=*,external_identities(*),entity_relationships!entity_relationships_from_entity_id_fkey(*)&limit=1`
        );
        entity = res.data?.[0] || null;
      }

      if (!entity) {
        // Unit 4: no LCC asset entity — fall back to resolving the address
        // directly against the gov (and dia, if configured) domain DBs, the way
        // the operator console surfaces gov properties that have no entity yet.
        if (address) {
          const fb = await resolvePropertyByAddressFromDomains(address);
          if (fb) return textResult(fb);
        }
        return textResult({ error: "Property not found", entity_id, address });
      }

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

  get_contact_context: async ({ entity_id, name, email }) => {
    return withTiming("get_contact_context", async () => {
      if (!OPS_SUPABASE_URL || !OPS_SUPABASE_KEY) {
        return textResult({ error: "OPS database not configured" });
      }

      // Resolve entity. R30: stop landing on junk/fragment stubs — exclude
      // junk-flagged rows, prefer the registered canonical buyer-parent, and
      // among remaining candidates pick the highest-value real entity.
      let entity = null;
      let canonicalResolution = null;
      if (entity_id) {
        // An id is an id — don't force entity_type=person (a buyer parent is an
        // organization).
        const res = await opsQuery(
          "GET",
          `entities?id=eq.${enc(entity_id)}&select=*,metadata,external_identities(*)`
        );
        entity = res.data?.[0] || null;
      } else if (email) {
        const res = await opsQuery(
          "GET",
          `entities?entity_type=eq.person&email=eq.${enc(email)}&select=*,metadata,external_identities(*)&limit=10`
        );
        entity = await chooseBestEntity(res.data);
      } else if (name) {
        // 1) Canonical buyer-parent (R5/R6): "Boyd Watterson" → Boyd Watterson
        //    Global, never "boyd watterson by cbre".
        const canonical = await resolveCanonicalParentId(name);
        if (canonical && canonical.id) {
          const cr = await opsQuery(
            "GET",
            `entities?id=eq.${enc(canonical.id)}&select=*,metadata,external_identities(*)`
          ).catch(() => ({ data: [] }));
          if (cr.data && cr.data[0]) {
            entity = cr.data[0];
            canonicalResolution = { resolved_to_parent: canonical.name || entity.name };
          }
        }
        // 2) Otherwise, the best non-junk candidate by value (person OR org).
        if (!entity) {
          const res = await opsQuery(
            "GET",
            `entities?or=(name.ilike.*${enc(name)}*,canonical_name.ilike.*${enc(name.toLowerCase())}*)&select=*,metadata,external_identities(*)&limit=25`
          );
          entity = await chooseBestEntity(res.data);
        }
      }

      if (!entity) {
        return textResult({
          error: "Contact not found",
          entity_id,
          name,
          email,
        });
      }
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
        canonical_resolution: canonicalResolution,
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

const app = express();

app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept"],
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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
    return res.status(401).json({ error: "Unauthorized — invalid or missing Bearer token" });
  }

  next();
}

// ── Auth middleware for /mcp ─────────────────────────────────────────────
app.use('/mcp', authenticate);

// ── MCP JSON-RPC endpoint ────────────────────────────────────────────────
// Implements the MCP protocol directly over HTTP JSON-RPC.
// No SDK transport layer — maximum compatibility with Claude.ai.
app.post('/mcp', async (req, res) => {
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
            protocolVersion: '2024-11-05',
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
app.delete('/mcp', (req, res) => res.status(200).end());

// GET /mcp — not supported (no server-push needed for these tools)
app.get('/mcp', (req, res) => {
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
app.get('/.well-known/oauth-protected-resource', (req, res) => {
  const base = process.env.MCP_BASE_URL ||
    `${req.protocol}://${req.get('host')}`;
  res.json({
    resource: `${base}/mcp`,
    authorization_servers: [base],
  });
});

// ── OAuth discovery metadata ──────────────────────────────────────────────
app.get('/.well-known/oauth-authorization-server', (req, res) => {
  const base = process.env.MCP_BASE_URL ||
    `${req.protocol}://${req.get('host')}`;
  res.json({
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/register`,
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
app.post('/register', (req, res) => {
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
app.get('/authorize', (req, res) => {
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
app.post('/oauth/token', async (req, res) => {
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
    tools: [
      "get_daily_briefing",
      "search_entities",
      "get_property_context",
      "get_contact_context",
      "get_queue_summary",
      "get_pipeline_health",
    ],
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

// ── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[MCP] Life Command Center MCP server running on port ${PORT}`);
  console.log(`[MCP] MCP endpoint: http://localhost:${PORT}/mcp`);
  console.log(`[MCP] Health check: http://localhost:${PORT}/health`);
  console.log(`[MCP] Auth: ${LCC_API_KEY ? "ENABLED" : "DISABLED (dev mode)"}`);
  console.log(`[MCP] OPS DB: ${OPS_SUPABASE_URL ? "configured" : "NOT configured"}`);
  console.log(`[MCP] GOV DB: ${GOV_SUPABASE_URL ? "configured" : "NOT configured"}`);
  console.log(`[MCP] Assemble-on-miss: ${LCC_API_BASE ? `via ${LCC_API_BASE}` : "DISABLED (LCC_API_BASE not set — cache-only)"}`);
});
