# Context Broker API Specification

> **Owner:** Team Briggs / NorthMarq
> **Date:** 2026-04-06
> **Status:** Draft
> **Dependencies:** `context_packet_schema.md`, `signal_table_schema.sql`

---

## 1. What the Context Broker Is

The Context Broker is an **LCC-owned microservice** that sits between the domain databases (Gov, Dia, LCC, Salesforce, Microsoft Graph) and every AI-consuming surface in the system. Its sole responsibility is to assemble, cache, serve, and monitor context packets.

**Why it exists as a discrete component:**

Without a Context Broker, every AI surface — Copilot chat, email drafting, daily briefing, pre-call brief — builds its own ad hoc queries and assembles its own context. This creates:
- Inconsistent intelligence quality across surfaces
- Duplicate database load
- No single place to improve context quality over time
- No monitoring of what context the AI is actually receiving

The Context Broker solves all four problems by acting as a single, observable, improvable assembly layer.

**Design principles:**
- Every AI surface in LCC calls the Context Broker. No surface queries domain databases directly for AI context.
- Packets are pre-assembled where possible (nightly jobs for high-priority entities) and assembled on-demand otherwise.
- Every assembly and every cache hit is logged. Context quality is observable and measurable.
- The Context Broker is stateless — it assembles from sources, returns a packet, and caches the result. It does not maintain session state.

---

## 2. API Endpoints

Base URL: `/api/context`

All endpoints require authentication. All requests log to the `signals` table.

---

### POST `/api/context/assemble`

Assemble or retrieve a context packet for a specific entity and surface.

**Request:**

```json
{
  "packet_type": "contact | property | pursuit | deal | daily_briefing | listing_marketing | comp_analysis",
  "entity_id": "uuid",
  "entity_type": "contact | property | pursuit | deal | listing",
  "surface_hint": "copilot_chat | email_draft | pre_call | daily_briefing | report | bov_dossier",
  "force_refresh": false,
  "max_tokens": 1200
}
```

**Response:**

```json
{
  "packet_id": "uuid",
  "packet_type": "string",
  "entity_id": "uuid",
  "assembled_at": "ISO timestamp",
  "expires_at": "ISO timestamp",
  "cache_hit": true,
  "token_count": 847,
  "payload": { ... },
  "assembly_meta": {
    "sources_queried": ["gov_db", "lcc_db", "salesforce"],
    "fields_missing": [],
    "compression_applied": false,
    "duration_ms": 142
  }
}
```

**Behavior:**
1. Check `context_packets` cache for a valid, non-expired packet matching `(packet_type, entity_id)`.
2. If cache hit and `force_refresh` is false: return cached packet, log signal `packet_cache_hit`.
3. If cache miss or `force_refresh` is true: assemble fresh packet, write to cache, return packet, log signal `packet_assembled`.
4. If assembly fails: return 503 with error detail. Do not return a partial packet.

**Error responses:**

| Code | Condition |
|---|---|
| 400 | Missing required fields, invalid packet_type |
| 404 | entity_id not found in any source |
| 422 | Mandatory variables missing — packet cannot be assembled. Returns `missing_fields` list. |
| 503 | Source database unavailable |
| 504 | Assembly timeout (>5 seconds) |

---

### POST `/api/context/assemble-multi`

Assemble multiple packets in a single request. Used by the daily briefing job and complex surfaces that need several packets simultaneously.

**Request:**

```json
{
  "requests": [
    {
      "packet_type": "contact",
      "entity_id": "uuid-1",
      "surface_hint": "pre_call"
    },
    {
      "packet_type": "deal",
      "entity_id": "uuid-2",
      "surface_hint": "email_draft"
    }
  ],
  "max_total_tokens": 3000
}
```

**Response:**

```json
{
  "packets": [
    {
      "packet_type": "contact",
      "entity_id": "uuid-1",
      "token_count": 612,
      "payload": { ... }
    },
    {
      "packet_type": "deal",
      "entity_id": "uuid-2",
      "token_count": 1180,
      "payload": { ... }
    }
  ],
  "total_token_count": 1792,
  "assembly_meta": {
    "total_duration_ms": 318,
    "cache_hits": 1,
    "assemblies": 1
  }
}
```

**Token budget enforcement:** If `max_total_tokens` would be exceeded, the broker compresses lower-priority packets first (based on `surface_hint` and packet type priority order). It never truncates mandatory fields.

---

### POST `/api/context/invalidate`

Explicitly invalidate a cached packet. Called by event handlers when a relevant change occurs.

**Request:**

```json
{
  "packet_type": "contact | property | pursuit | deal | listing_marketing | comp_analysis | all",
  "entity_id": "uuid",
  "reason": "string",
  "force_rebuild": false
}
```

**Behavior:**
- Sets `invalidated = true` on matching cache entries.
- If `force_rebuild` is true, immediately queues a fresh assembly (async). Useful for deals with critical dates.
- If `packet_type` is `"all"`, invalidates every packet type for the given entity.

**Response:**

```json
{
  "invalidated_count": 2,
  "rebuild_queued": false
}
```

---

### GET `/api/context/status/:entity_id`

Returns cache status for all packet types for a given entity.

**Response:**

```json
{
  "entity_id": "uuid",
  "packets": [
    {
      "packet_type": "contact",
      "cached": true,
      "cache_hit_at": "ISO timestamp",
      "expires_at": "ISO timestamp",
      "token_count": 612,
      "invalidated": false
    },
    {
      "packet_type": "pursuit",
      "cached": false
    }
  ]
}
```

---

### GET `/api/context/health`

Returns broker health, source connectivity, and recent assembly metrics.

**Response:**

```json
{
  "status": "healthy | degraded | unavailable",
  "sources": {
    "gov_db": "connected",
    "dia_db": "connected",
    "lcc_db": "connected",
    "salesforce": "connected",
    "graph_api": "degraded"
  },
  "metrics_last_hour": {
    "assemblies": 34,
    "cache_hits": 87,
    "cache_hit_rate": 0.72,
    "avg_assembly_ms": 198,
    "errors": 0
  }
}
```

---

## 3. Assembly Logic by Packet Type

The Context Broker follows a defined query plan for each packet type. Queries run in parallel where there are no dependencies.

---

### Contact Packet Assembly

**Sources queried (parallel):**
1. `lcc_db.contacts` — base contact record, engagement score, cadence status
2. `lcc_db.touchpoints` — last 10 touchpoints, filtered to this contact
3. `salesforce` — deal history, opportunity records, CRM activities
4. `gov_db.contacts` OR `dia_db.contacts` — domain-specific deal history
5. `lcc_db.listings` — current listings that match contact's asset preferences (inventory_matches)
6. `graph_api.email_cache` — last 3 email subjects from/to this contact (for open thread detection)

**Compression rules when over token budget:**
- Drop `touchpoint_history` beyond last 3 entries
- Truncate `deal_history` to last 2 deals
- Drop `inventory_matches` below score 60
- Never drop: `relationship` block, `suggested_outreach` block, `contact` base fields

---

### Property Packet Assembly

**Sources queried (parallel):**
1. `gov_db.properties` OR `dia_db.properties` — property fundamentals, lease data
2. `gov_db.owners` OR `dia_db.owners` — ownership chain
3. `gov_db.sold_comps` OR `dia_db.sold_comps` — top 5 comparable sales by similarity score
4. `lcc_db.pursuits` — pursuit history for this property
5. `lcc_db.contacts` — linked owner contact record (if exists)
6. `dia_db.clinics` — clinic record if property is dialysis (for patient counts, trends)

**Domain-specific routing:** The broker detects domain from the property record and routes to the correct database automatically.

---

### Deal Packet Assembly

**Sources queried (parallel, with dependencies noted):**
1. `lcc_db.deals` — deal record, stage, pricing
2. `lcc_db.listings` — listing record for this deal → triggers Listing Marketing sub-assembly
3. `salesforce` — opportunity record, buyer contact, open tasks
4. `lcc_db.critical_dates` — all critical dates for this deal
5. `lcc_db.open_items` — checklist items for this deal
6. `graph_api.email_cache` — last 5 email subjects related to this deal (by deal name match)
7. Contact Packet (compressed) for seller — assembled as sub-request

---

### Daily Briefing Packet Assembly

The daily briefing is the most complex assembly. It runs as a scheduled job at 6:00 AM.

**Assembly sequence:**
1. Load all active deals for user → assemble Deal Packets (compressed to 200 tokens each)
2. Load all pursuits in engaged/proposal stage → assemble Pursuit Packets (compressed to 150 tokens each)
3. Query `contact_engagement` for contacts where `cadence_status` in ('due', 'overdue'), sorted by engagement score desc, limit 15
4. Query `lcc_db.om_downloads` where `follow_up_completed = false` and `downloaded_at > now() - 7 days`
5. Query Salesforce for open tasks due within 7 days
6. Query `lcc_db.signals` for overnight signals (om_download, ownership_change, patient_growth) from last 12 hours
7. Query pipeline_velocity for any deals flagged as stuck (days_in_stage > p75_days_in_stage)
8. Compute production_score from yesterday's signal log
9. Assemble and rank all items by strategic scoring engine
10. Write assembled packet to `context_packets` table
11. Push briefing card to Teams and Outlook digest via Power Automate webhook

**Total assembly time target:** <10 seconds.

---

## 4. Context Injection Format

When the Context Broker delivers a packet to an AI surface, the consuming layer is responsible for formatting it into the model's system prompt. The broker returns raw JSON — the surface formats it.

**Recommended injection format for email drafting:**

```
You are an expert net lease investment sales assistant for Scott Briggs at NorthMarq.

CONTACT CONTEXT:
Name: [contact.full_name] | Firm: [contact.firm] | Domain: [contact.domain]
Last touched: [relationship.last_touchpoint.days_since] days ago ([relationship.last_touchpoint.type])
Engagement score: [relationship.engagement_score]/100 | Cadence: [relationship.cadence_status]
Deal history: [deal_history summary]
Best angle: [suggested_outreach.suggested_angle]

PROPERTY CONTEXT (if applicable):
[property.name] | [property.tenant] | [property.lease_expiration]
Comp range: [valuation.implied_cap_rate_range]

ACTIVE CONTEXT:
[active_context.open_threads]
[inventory_matches — top 2]

TEMPLATE: [template_id and base structure]
TASK: Draft a [template category] email. Use the suggested angle as the opening. Reference deal history where natural. Keep it under 150 words.
```

**Recommended injection format for Copilot chat (daily briefing):**

```
You are Scott's deal intelligence assistant. Here is today's context:

STRATEGIC ITEMS ([count]):
[strategic_items — each as 1-2 sentence summary with entity name and suggested action]

IMPORTANT ITEMS ([count]):
[important_items — same format]

PRODUCTION SCORE:
BD Touchpoints: [completed]/[planned] | Calls logged: [weekly] | OM follow-ups overdue: [count]

OVERNIGHT SIGNALS:
[overnight_signals — each as 1 sentence]

When Scott asks about a specific deal, contact, or property, call /api/context/assemble to get the full packet before answering.
```

---

## 5. Error Handling and Graceful Degradation

The Context Broker must never block a user action due to a context assembly failure. The following degradation rules apply:

| Failure Scenario | Degraded Behavior |
|---|---|
| Source database unavailable | Return partial packet from available sources. Flag `degraded: true` in response. |
| Cache miss and all sources slow | Return cached packet even if expired (flag `stale: true`). Log degradation signal. |
| Mandatory fields missing from all sources | Return `422` with `missing_fields` list. Surface prompts user to complete entity record. |
| Assembly timeout (>5s) | Return whatever was assembled in 5s with `partial: true`. Never block the surface. |
| Token budget exceeded | Compress per packet-type compression rules. Never return a packet over hard cap. |

**The surface must handle `degraded`, `stale`, and `partial` flags** by displaying an unobtrusive indicator ("Using cached context from 6 hours ago") rather than silently using incomplete data.

---

## 6. Monitoring and Observability

The following metrics should be tracked and surfaced in an LCC admin panel:

| Metric | Alert Threshold |
|---|---|
| Cache hit rate | Alert if <50% over 1-hour window |
| Assembly p95 latency | Alert if >3,000ms |
| Error rate | Alert if >2% over 15-minute window |
| Source connectivity | Alert immediately on any source going unreachable |
| Missing fields rate | Alert if >15% of contact packets are missing `suggested_outreach` (means contact data is incomplete) |
| Daily briefing assembly success | Alert if any user's briefing fails to assemble by 6:30 AM |

All alerts should fire to a Teams channel and create a Salesforce task for ops review.

---

## 7. Implementation Notes

**Deployment:** Context Broker runs as a Vercel Edge Function (or Supabase Edge Function) co-located with the LCC app. Latency target for cache hits is <50ms. Assembly target is <2,000ms for all packet types except daily briefing.

**Authentication:** All requests use the LCC session token. The broker inherits the user's row-level security permissions from Supabase — it cannot return data the user doesn't have access to.

**Rate limiting:** The broker implements per-user rate limiting of 60 assembly requests per minute to protect domain database load. Cache hits do not count against this limit.

**Versioning:** The broker API is versioned (`/api/v1/context/...`). Breaking changes require a version bump. The `model_version` field in packet metadata tracks which version of the assembly logic produced each packet.
