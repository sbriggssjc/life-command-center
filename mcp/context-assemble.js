// ============================================================================
// MCP context-packet assemble-on-miss helper (Phase 2 Slice 3a.1)
//
// The deployed MCP server (server.js get_property_context) only READ the
// context_packets cache and returned context_packet: null on a cold miss,
// relying on the nightly pre-warm — which is bounded to the most-active assets,
// so a cold / long-tail property returned null to agents. This helper lets
// get_property_context assemble the packet on a cache miss by calling the main
// app's /api/context?action=assemble endpoint over HTTP (the same shared
// assembler the /api/property HTTP mirror uses in-process), so the "every agent
// fully informed" promise holds on the first ask, not just after a nightly warm.
//
// Graceful degradation (required): if LCC_API_BASE is unset, or the assemble
// call errors / times out, the caller falls back to the CURRENT cache-only
// behavior (context_packet: null). Never throws, never hangs.
//
// Kept dependency-free (no express) so the miss/hit branches are unit-testable
// without booting the server.
// ============================================================================

const ASSEMBLE_TIMEOUT_MS = 8000;

/**
 * POST {apiBase}/api/context?action=assemble for a property packet.
 *
 * Returns the parsed assemble response ({ payload, token_count, assembled_at,
 * expires_at, cache_hit, ... }) on success, or null on ANY failure (unset base,
 * non-2xx, timeout, bad body, thrown). Never throws. A one-line warn is logged
 * on the fallback path.
 */
export async function assemblePropertyPacketViaApi({
  entityId,
  workspaceId,
  apiBase,
  apiKey,
  fetchImpl = globalThis.fetch,
  timeoutMs = ASSEMBLE_TIMEOUT_MS,
}) {
  // Graceful: with no main-app base configured, stay cache-only (no HTTP call).
  if (!apiBase || !entityId) return null;

  const url = `${apiBase.replace(/\/+$/, "")}/api/context?action=assemble`;
  const headers = { "Content-Type": "application/json" };
  // X-LCC-Key is the standard the /api/context route authenticates with
  // (api/_shared/auth.js authenticate() → x-lcc-key).
  if (apiKey) headers["X-LCC-Key"] = apiKey;
  // The route resolves the workspace from x-lcc-workspace (else the owner's
  // first membership) — pass it through when the entity carries one.
  if (workspaceId) headers["X-LCC-Workspace"] = workspaceId;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        packet_type: "property",
        entity_id: entityId,
        entity_type: "asset",
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(
        `[MCP] assemble-on-miss non-2xx (${res.status}) for ${entityId} — cache-only fallback`
      );
      return null;
    }
    const data = await res.json();
    if (!data || !data.payload) {
      console.warn(
        `[MCP] assemble-on-miss returned no payload for ${entityId} — cache-only fallback`
      );
      return null;
    }
    return data;
  } catch (err) {
    const why = err && err.name === "AbortError" ? "timeout" : err && err.message;
    console.warn(
      `[MCP] assemble-on-miss failed for ${entityId} (${why}) — cache-only fallback`
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve the property context packet, assembling on a cache miss.
 *
 * A fresh cached row short-circuits (no assemble call). A miss calls assembleFn
 * (the HTTP assembler); a null/failed assemble yields context_packet: null (the
 * current cache-only behavior). The synthetic miss packet mirrors the HTTP
 * mirror's (api/_handlers/property-handler.js resolveContextPacket) shape so
 * downstream rendering is unchanged.
 */
export async function resolveContextPacket({ cachedRow, entity, assembleFn }) {
  if (cachedRow) {
    return { context_packet: cachedRow, assembled_on_miss: false };
  }
  const assembled = await assembleFn({
    entityId: entity.id,
    workspaceId: entity.workspace_id || null,
  });
  if (!assembled || !assembled.payload) {
    return { context_packet: null, assembled_on_miss: false };
  }
  return {
    context_packet: {
      packet_type: "property",
      entity_id: entity.id,
      payload: assembled.payload,
      token_count: assembled.token_count ?? null,
      assembled_at: assembled.assembled_at ?? null,
      expires_at: assembled.expires_at ?? null,
      cache_hit: !!assembled.cache_hit,
      assembled_on_miss: true,
    },
    assembled_on_miss: true,
  };
}
