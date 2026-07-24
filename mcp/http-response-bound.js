// ============================================================================
// http-response-bound.js — bound the /api/* HTTP read-route responses
//
// The Option A HTTP read routes (server.js makeReadHttpRoute + the comps HTTP
// routes) reuse the SAME rich handlers the Claude MCP surface uses. Claude
// handles very large payloads natively; a ChatGPT Custom GPT Action caps a
// single Action response at ~100,000 characters (ResponseTooLargeError beyond
// that) and Microsoft Copilot connectors have a similar limit. So the HTTP
// layer — and ONLY the HTTP layer — must keep responses Action-safe.
//
// This module is pure (no DB, no I/O) so it is unit-testable and so it can be
// shared by server.js and comps-tools.js WITHOUT touching the MCP tool outputs:
//   • Per-tool SHAPERS make the default response small (top-N, display fields,
//     drop the verbose context_packet blobs) — expandable via `verbose` /
//     `limit` / `sections` on the request.
//   • A generic size GUARD (enforceHttpResponseSize) shrinks anything still over
//     the ceiling: caps large arrays (trims the TAIL — keeps the highest-ranked
//     head), drops raw/document/base64/embedding blobs, truncates over-long
//     strings, and stamps `truncated: true` + `truncation_note`.
//
// The MCP (/mcp) surface never calls anything here, so its payloads stay full.
// ============================================================================

// ~45 KB — comfortably under both the ChatGPT (~100k chars) and Copilot caps,
// with headroom for the JSON the model then wraps around the tool result.
export const MAX_HTTP_RESPONSE_CHARS = 45000;

// Keys whose values are verbose blobs (raw source rows, base64 docs, OCR text,
// embeddings, long HTML) — dropped first when a response is over the ceiling,
// and dropped by default from the heavy property-context packet.
export const HTTP_HEAVY_FIELD_KEYS = new Set([
  "raw", "raw_payload", "raw_text", "raw_html", "html", "body_html",
  "inline_data", "base64", "content_base64", "pdf", "screenshot", "image",
  "embedding", "embeddings", "vector",
  "full_text", "document_text", "extracted_text",
]);

// Free-text strings longer than this are truncated (with a marker) once a
// response is being shrunk.
export const HTTP_STRING_CAP = 2000;

// Serialized length; defensive against a serialization failure (never throws).
export function jsonLen(v) {
  try {
    const s = JSON.stringify(v);
    return typeof s === "string" ? s.length : 0;
  } catch {
    return Infinity;
  }
}

// Parse an optional integer request arg with a default + hard bounds.
export function clampInt(v, def, min, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function isTruthyFlag(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

// Recursively bound a value:
//   • arrays  → capped to `arrayCap` (TAIL dropped, head kept)
//   • objects → heavy-blob keys dropped when `dropHeavy`; recursed otherwise
//   • strings → truncated to `stringCap` (with a `…[+N chars]` marker)
// Deterministic + side-effect-free (returns a new structure).
export function deepTrim(
  value,
  { arrayCap = 10, stringCap = HTTP_STRING_CAP, dropHeavy = true } = {},
  depth = 0
) {
  if (depth > 12) return null; // hard recursion backstop (cycles / pathological nesting)
  if (Array.isArray(value)) {
    const capped = value.length > arrayCap ? value.slice(0, arrayCap) : value;
    return capped.map((v) => deepTrim(v, { arrayCap, stringCap, dropHeavy }, depth + 1));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (dropHeavy && HTTP_HEAVY_FIELD_KEYS.has(k)) continue;
      out[k] = deepTrim(v, { arrayCap, stringCap, dropHeavy }, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && Number.isFinite(stringCap) && value.length > stringCap) {
    return value.slice(0, stringCap) + `…[+${value.length - stringCap} chars]`;
  }
  return value;
}

// Cap arrays to N everywhere WITHOUT dropping fields or truncating strings —
// the gentle default-shaping pass (a comp row, a lease row stays intact).
function capArrays(value, n) {
  return deepTrim(value, { arrayCap: n, stringCap: Infinity, dropHeavy: false });
}

// The generic GUARD: if `result` serializes over `max`, shrink it deterministically
// and stamp the truncation markers. Under the ceiling ⇒ returned byte-identical.
export function enforceHttpResponseSize(result, { max = MAX_HTTP_RESPONSE_CHARS } = {}) {
  if (jsonLen(result) <= max) return result;

  // Escalate: drop heavy blobs + truncate long strings, with progressively
  // smaller array caps, re-checking after each step. Recomputed from the
  // ORIGINAL each pass so it is deterministic.
  let trimmed = result;
  let appliedCap = null;
  for (const cap of [10, 5, 3, 1]) {
    trimmed = deepTrim(result, { arrayCap: cap, stringCap: HTTP_STRING_CAP, dropHeavy: true });
    appliedCap = cap;
    if (jsonLen(trimmed) <= max) break;
  }

  if (trimmed && typeof trimmed === "object" && !Array.isArray(trimmed)) {
    trimmed.truncated = true;
    trimmed.truncation_note =
      `Response exceeded the Action size limit (~${max} chars) and was shrunk: ` +
      `arrays capped at ${appliedCap} (tail dropped — highest-ranked kept), raw/document/` +
      `embedding blobs removed, long text truncated. Request the specific record ` +
      `(e.g. a single entity_id / property) or pass a smaller \`limit\` for full detail.`;
  }
  return trimmed;
}

// ── Per-tool shapers (HTTP-only; MCP output is never shaped) ─────────────────

// get_daily_briefing — return the top-N of each band with display fields only,
// never the full snapshot row. `limit` (default 10, 1..50) tunes N.
export function shapeDailyBriefing(result, args = {}) {
  if (!result || typeof result !== "object") return result;
  const n = clampInt(args.limit, 10, 1, 50);
  const pickFields = (r) =>
    r && typeof r === "object" && !Array.isArray(r)
      ? {
          id: r.id,
          title: r.title,
          status: r.status,
          due_date: r.due_date,
          priority: r.priority,
          entity_id: r.entity_id,
        }
      : r;
  const band = (rows) => (Array.isArray(rows) ? rows.slice(0, n).map(pickFields) : rows);

  // Curated intel snapshot (briefing_intel_snapshot): keep the short text
  // fields whole (analyst_take / capital_markets — deepTrim only touches
  // objects, so plain strings pass through), cap the verbose jsonb arrays &
  // objects (market_data / sector_news / reading_list / weekly_changes /
  // key_numbers / fed_outlook) to top-N and drop any raw blobs, and cap the
  // priorities bands. A real ~16 KB snapshot stays well under the HTTP ceiling.
  if (result.source === "briefing_intel_snapshot") {
    const out = { ...result };
    for (const k of ["market_data", "sector_news", "reading_list", "weekly_changes", "key_numbers", "fed_outlook"]) {
      if (out[k] && typeof out[k] === "object") {
        out[k] = deepTrim(out[k], { arrayCap: n, dropHeavy: true });
      }
    }
    if (out.priorities && typeof out.priorities === "object") {
      const p = out.priorities;
      out.priorities = { urgent: band(p.urgent), high: band(p.high), normal: band(p.normal) };
    }
    return out;
  }

  if (Array.isArray(result.urgent) || Array.isArray(result.high) || Array.isArray(result.normal)) {
    return { ...result, urgent: band(result.urgent), high: band(result.high), normal: band(result.normal) };
  }
  // Legacy snapshot path (a single, potentially large `briefing` row): bound it
  // — cap any nested arrays to N and drop raw/document blobs — rather than
  // return it whole.
  if (result.briefing) {
    return { ...result, briefing: deepTrim(result.briefing, { arrayCap: n, dropHeavy: true }) };
  }
  return result;
}

// The richest read tool. By default cap each nested array (comps, ownership
// history, leases, related contacts, tasks) to top-N and drop the verbose
// context_packet raw/document blobs. `verbose:true` returns the full packet
// (still subject to the hard guard); `sections:[...]` selects top-level keys;
// `limit` tunes the per-array N.
const PROPERTY_CONTEXT_SECTIONS = new Set([
  "entity", "property", "active_tasks", "context_packet",
  "tenant_guarantor", "gov_data", "dia_data",
]);
export function shapePropertyContext(result, args = {}) {
  if (!result || typeof result !== "object") return result;
  // An error / not-found payload has nothing heavy — leave it.
  if (result.error) return result;

  const verbose = isTruthyFlag(args.verbose);
  const n = clampInt(args.limit, 8, 1, 50);

  let out = { ...result };

  if (!verbose) {
    if (out.gov_data && typeof out.gov_data === "object") out.gov_data = capArrays(out.gov_data, n);
    if (out.dia_data && typeof out.dia_data === "object") out.dia_data = capArrays(out.dia_data, n);
    if (Array.isArray(out.active_tasks)) out.active_tasks = out.active_tasks.slice(0, n);
    if (out.tenant_guarantor && typeof out.tenant_guarantor === "object") {
      const tg = out.tenant_guarantor;
      out.tenant_guarantor = {
        tenants: Array.isArray(tg.tenants) ? tg.tenants.slice(0, n) : tg.tenants,
        guarantors: Array.isArray(tg.guarantors) ? tg.guarantors.slice(0, n) : tg.guarantors,
      };
    }
    if (out.context_packet && typeof out.context_packet === "object") {
      out.context_packet = deepTrim(out.context_packet, { arrayCap: n, dropHeavy: true });
      out.context_packet_note =
        "Bounded for HTTP: nested arrays capped and raw/document blobs removed. " +
        "Pass verbose:true for the full context packet.";
    }
  }

  // Optional section selection — keep only the requested top-level sections
  // (identity fields always retained so the record stays recognizable).
  const sections = Array.isArray(args.sections)
    ? args.sections.map((s) => String(s)).filter((s) => PROPERTY_CONTEXT_SECTIONS.has(s))
    : null;
  if (sections && sections.length) {
    const keep = new Set([...sections, "resolved_via", "note"]);
    const picked = {};
    for (const [k, v] of Object.entries(out)) if (keep.has(k)) picked[k] = v;
    // Always keep a minimal entity identity even if `entity` wasn't requested.
    if (!picked.entity && out.entity && typeof out.entity === "object") {
      picked.entity = { id: out.entity.id, name: out.entity.name, entity_type: out.entity.entity_type };
    }
    picked.sections_selected = sections;
    out = picked;
  }

  return out;
}

// Only the two rich tools need custom shaping. search_entities / get_queue_summary
// / recall_memory / get_contact_context already apply small default `limit`s in
// their handlers (10 / 25 / 20 / best-candidate), and get_pipeline_health is
// bounded by its own logic — the generic guard is their safety net.
export const HTTP_TOOL_SHAPERS = {
  get_daily_briefing: shapeDailyBriefing,
  get_property_context: shapePropertyContext,
};

// One call for server.js: apply the per-tool shaper (if any), then the guard.
export function boundHttpToolResult(toolName, result, args = {}, opts = {}) {
  const shaper = HTTP_TOOL_SHAPERS[toolName];
  const shaped = shaper ? shaper(result, args) : result;
  return enforceHttpResponseSize(shaped, opts);
}
