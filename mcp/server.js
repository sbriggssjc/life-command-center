// ============================================================================
// LCC MCP Server — Model Context Protocol server for Life Command Center
// Standalone service (NOT a Vercel function) — deploy to Railway or similar
//
// Exposes read-only LCC tools to Claude.ai via direct JSON-RPC over HTTP.
// No SDK transport layer — maximum compatibility with Claude.ai.
// ============================================================================

import express from "express";
import cors from "cors";

// ── Environment ──────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || "3100", 10);
const LCC_API_KEY = process.env.LCC_API_KEY || "";

const OPS_SUPABASE_URL = process.env.OPS_SUPABASE_URL || "";
const OPS_SUPABASE_KEY = process.env.OPS_SUPABASE_KEY || "";
const GOV_SUPABASE_URL = process.env.GOV_SUPABASE_URL || "";
const GOV_SUPABASE_KEY = process.env.GOV_SUPABASE_KEY || "";

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
    description: 'Search for properties, contacts, or organizations in the LCC database',
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
    description: 'Get full context for a specific property: lease details, ownership history, comps, investment score, research status, and related contacts',
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

      // Fallback: build from queue/action_items by priority_class
      const [strategic, important, urgent] = await Promise.all([
        opsQuery(
          "GET",
          `action_items?workspace_id=eq.${enc(workspace_id)}&priority_class=eq.strategic&status=in.(open,in_progress)&select=id,title,status,due_date,entity_id,priority_class&order=due_date.asc.nullslast&limit=10`
        ),
        opsQuery(
          "GET",
          `action_items?workspace_id=eq.${enc(workspace_id)}&priority_class=eq.important&status=in.(open,in_progress)&select=id,title,status,due_date,entity_id,priority_class&order=due_date.asc.nullslast&limit=10`
        ),
        opsQuery(
          "GET",
          `action_items?workspace_id=eq.${enc(workspace_id)}&priority_class=eq.urgent&status=in.(open,in_progress)&select=id,title,status,due_date,entity_id,priority_class&order=due_date.asc.nullslast&limit=10`
        ),
      ]);

      return textResult({
        source: "action_items_fallback",
        date: new Date().toISOString().split("T")[0],
        strategic: strategic.data || [],
        important: important.data || [],
        urgent: urgent.data || [],
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

      let path =
        `entities?or=(name.ilike.*${enc(searchTerm)}*,canonical_name.ilike.*${enc(searchTerm.toLowerCase())}*)` +
        `&select=id,entity_type,name,domain,city,state,email,phone,address,org_type,asset_type,external_identities(source_system,source_type,external_id)`;

      if (entity_type) {
        path += `&entity_type=eq.${enc(entity_type)}`;
      }
      if (domain && domain !== "both") {
        path += `&domain=eq.${enc(domain)}`;
      }

      path += `&limit=${Math.min(limit || 10, 50)}&order=name`;

      const result = await opsQuery("GET", path);
      return textResult({
        query: searchTerm,
        count: result.count || (result.data || []).length,
        entities: result.data || [],
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
        return textResult({ error: "Property not found", entity_id, address });
      }

      const eid = entity.id;

      // Identify linked external records
      const extIds = entity.external_identities || [];
      const govIds = extIds.filter(
        (x) => x.source_system === "gov_db" || x.source_system === "government"
      );
      const diaIds = extIds.filter(
        (x) => x.source_system === "dia_db" || x.source_system === "dialysis"
      );

      // Parallel fetches
      const promises = [];

      // Operations / research tasks for this entity
      promises.push(
        opsQuery(
          "GET",
          `action_items?entity_id=eq.${enc(eid)}&status=in.(open,in_progress,waiting)&select=id,title,status,priority_class,due_date,action_type&order=due_date.asc.nullslast&limit=20`
        )
      );

      // Context packet cache
      promises.push(
        opsQuery(
          "GET",
          `context_packets?entity_id=eq.${enc(eid)}&packet_type=eq.property&order=created_at.desc&limit=1`
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
            `ownership_history?property_id=eq.${enc(govExtId)}&select=*&order=recorded_date.desc&limit=10`
          ),
          govQuery(
            "GET",
            `prospect_leads?property_id=eq.${enc(govExtId)}&select=*&limit=1`
          ),
        ]).catch(() => null);
      }
      promises.push(gsaPromise);

      const [actionsRes, contextRes, govData] = await Promise.all(promises);

      const result = {
        entity,
        active_tasks: actionsRes.data || [],
        context_packet: contextRes.data?.[0] || null,
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

      // Resolve entity
      let entity = null;
      if (entity_id) {
        const res = await opsQuery(
          "GET",
          `entities?id=eq.${enc(entity_id)}&entity_type=eq.person&select=*,external_identities(*)`
        );
        entity = res.data?.[0] || null;
      } else if (email) {
        const res = await opsQuery(
          "GET",
          `entities?entity_type=eq.person&email=eq.${enc(email)}&select=*,external_identities(*)&limit=1`
        );
        entity = res.data?.[0] || null;
      } else if (name) {
        const res = await opsQuery(
          "GET",
          `entities?entity_type=eq.person&or=(name.ilike.*${enc(name)}*,canonical_name.ilike.*${enc(name.toLowerCase())}*)&select=*,external_identities(*)&limit=1`
        );
        entity = res.data?.[0] || null;
      }

      if (!entity) {
        return textResult({
          error: "Contact not found",
          entity_id,
          name,
          email,
        });
      }

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
          `action_items?entity_id=eq.${enc(eid)}&status=in.(open,in_progress,waiting)&select=id,title,status,priority_class,due_date,action_type&order=due_date.asc.nullslast&limit=10`
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

      let path =
        `action_items?select=id,title,status,priority_class,due_date,action_type,entity_id,domain,created_at,assigned_to`;

      // Status filter
      if (status === "pending") {
        path += `&status=eq.open`;
      } else if (status === "in_progress") {
        path += `&status=eq.in_progress`;
      } else {
        path += `&status=in.(open,in_progress,waiting)`;
      }

      // Domain filter
      if (domain && domain !== "all") {
        path += `&domain=eq.${enc(domain)}`;
      }

      path += `&order=priority_class.asc,due_date.asc.nullslast&limit=${Math.min(limit || 20, 50)}`;

      const result = await opsQuery("GET", path);

      // Also get counts by status for the summary header
      const [openCount, inProgressCount, waitingCount] = await Promise.all([
        opsQuery("GET", `action_items?status=eq.open&select=id&limit=0`),
        opsQuery("GET", `action_items?status=eq.in_progress&select=id&limit=0`),
        opsQuery("GET", `action_items?status=eq.waiting&select=id&limit=0`),
      ]);

      return textResult({
        summary: {
          open: openCount.count || 0,
          in_progress: inProgressCount.count || 0,
          waiting: waitingCount.count || 0,
        },
        filters: { domain, status },
        items: result.data || [],
        total_matching: result.count || (result.data || []).length,
      });
    });
  },

  get_pipeline_health: async () => {
    return withTiming("get_pipeline_health", async () => {
      if (!GOV_SUPABASE_URL || !GOV_SUPABASE_KEY) {
        return textResult({ error: "GOV database not configured — pipeline health unavailable" });
      }

      // Query ingestion_tracker for recent runs
      const trackerRes = await govQuery(
        "GET",
        `ingestion_tracker?select=id,source,status,started_at,completed_at,records_processed,records_failed,error_message&order=started_at.desc&limit=50`
      );

      const runs = trackerRes.data || [];

      // Group by source
      const bySource = {};
      for (const run of runs) {
        const src = run.source || "unknown";
        if (!bySource[src]) bySource[src] = [];
        bySource[src].push(run);
      }

      const lastRunBySource = {};
      const successRateBySource = {};
      const failedRuns = [];
      let oldestSuccessfulRun = null;

      for (const [source, sourceRuns] of Object.entries(bySource)) {
        lastRunBySource[source] = sourceRuns[0]?.completed_at || sourceRuns[0]?.started_at || null;

        const total = sourceRuns.length;
        const successes = sourceRuns.filter((r) => r.status === "success" || r.status === "completed").length;
        successRateBySource[source] = total > 0 ? Math.round((successes / total) * 100) : 0;

        const failures = sourceRuns.filter((r) => r.status === "failed" || r.status === "error");
        failedRuns.push(...failures.map((r) => ({ ...r, source })));

        // Track oldest successful run
        const lastSuccess = sourceRuns.find((r) => r.status === "success" || r.status === "completed");
        if (lastSuccess) {
          const ts = lastSuccess.completed_at || lastSuccess.started_at;
          if (!oldestSuccessfulRun || ts < oldestSuccessfulRun) {
            oldestSuccessfulRun = ts;
          }
        }
      }

      // Build recommendation
      const recommendations = [];
      for (const [source, lastRun] of Object.entries(lastRunBySource)) {
        if (!lastRun) {
          recommendations.push(`${source}: no completed runs found`);
          continue;
        }
        const daysSince = Math.floor(
          (Date.now() - new Date(lastRun).getTime()) / 86400000
        );
        if (daysSince >= 3) {
          recommendations.push(
            `${source} last ran ${daysSince} days ago — consider manual trigger`
          );
        }
      }
      if (failedRuns.length > 0) {
        recommendations.push(
          `${failedRuns.length} failed run(s) in recent history — review error messages`
        );
      }

      return textResult({
        last_run_by_source: lastRunBySource,
        success_rate_by_source: successRateBySource,
        failed_runs: failedRuns.slice(0, 10),
        oldest_successful_run: oldestSuccessfulRun,
        recommendation:
          recommendations.length > 0
            ? recommendations.join("; ")
            : "All pipelines healthy",
      });
    });
  },
};

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
});
