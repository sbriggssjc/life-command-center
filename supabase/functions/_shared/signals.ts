// ============================================================================
// Signal Writer — Shared utility for writing to the signals table
// Life Command Center — Infrastructure Migration Phase 0
//
// Fire-and-forget signal writer for Edge Functions.
// Mirrors api/_shared/signals.js for consistency.
// ============================================================================

import { opsQuery } from "./supabase-client.ts";

// ── Types ───────────────────────────────────────────────────────────────────

export interface SignalParams {
  signal_type: string;
  signal_category: string;
  entity_type?: string | null;
  entity_id?: string | null;
  domain?: string | null;
  user_id?: string | null;
  session_id?: string | null;
  payload?: Record<string, unknown>;
  outcome?: string | null;
  model_version?: string | null;
  scoring_version?: string | null;
  classifier_version?: string | null;
}

// ── Core Signal Writer ──────────────────────────────────────────────────────

/**
 * Write a signal to the signals table. Fire-and-forget — never blocks
 * the calling action and never throws.
 */
export async function writeSignal(params: SignalParams): Promise<void> {
  try {
    await opsQuery("POST", "signals", {
      signal_type: params.signal_type,
      signal_category: params.signal_category || "system",
      entity_type: params.entity_type || null,
      entity_id: params.entity_id || null,
      domain: params.domain || null,
      user_id: params.user_id || null,
      session_id: params.session_id || null,
      payload: params.payload || {},
      outcome: params.outcome || null,
      model_version: params.model_version || null,
      scoring_version: params.scoring_version || null,
      classifier_version: params.classifier_version || null,
    });
  } catch (err) {
    // Signal writes are never allowed to break the calling flow
    console.error("[signal write failed]", (err as Error)?.message || err);
  }
}

// ── Typed Signal Helpers ────────────────────────────────────────────────────

/**
 * Write a triage_decision signal when an inbox item is triaged.
 */
export async function writeTriageSignal(
  item: { id?: string; entity_id?: string; domain?: string },
  newStatus: string,
  userId: string,
  classificationData: Record<string, unknown> = {}
): Promise<void> {
  await writeSignal({
    signal_type: "triage_decision",
    signal_category: "prospecting",
    entity_type: "inbox_item",
    entity_id: item.entity_id || item.id || null,
    domain: item.domain || null,
    user_id: userId,
    payload: {
      inbox_item_id: item.id || null,
      new_status: newStatus,
      ...classificationData,
    },
    outcome: "pending",
  });
}

/**
 * Write a promotion signal when an inbox item is promoted to an action.
 */
export async function writePromotionSignal(
  inboxItemId: string,
  actionItemId: string,
  userId: string,
  entityId?: string | null
): Promise<void> {
  await writeSignal({
    signal_type: "recommendation_acted_on",
    signal_category: "prospecting",
    entity_type: "action_item",
    entity_id: entityId || null,
    user_id: userId,
    payload: {
      inbox_item_id: inboxItemId,
      action_item_id: actionItemId,
      action: "promote",
    },
    outcome: "positive",
  });
}

/**
 * Write a packet_assembled signal when context is built.
 */
export async function writePacketSignal(
  packetType: string,
  entityId: string | null,
  entityType: string | null,
  userId: string | null,
  meta: {
    token_count: number;
    surface_hint?: string;
    sources_queried: string[];
    duration_ms: number;
    quality_score?: number;
    cache_hit?: boolean;
  }
): Promise<void> {
  await writeSignal({
    signal_type: meta.cache_hit ? "packet_cache_hit" : "packet_assembled",
    signal_category: "intelligence",
    entity_id: entityId,
    entity_type: entityType,
    user_id: userId,
    payload: {
      packet_type: packetType,
      token_count: meta.token_count,
      surface_hint: meta.surface_hint || null,
      sources_queried: meta.sources_queried,
      duration_ms: meta.duration_ms,
      quality_score: meta.quality_score || null,
    },
  });
}

/**
 * Write a touchpoint_logged signal.
 */
export async function writeTouchpointSignal(
  entityId: string,
  userId: string,
  details: {
    activity_category: string;
    title?: string;
    channel?: string;
  }
): Promise<void> {
  await writeSignal({
    signal_type: "touchpoint_logged",
    signal_category: "prospecting",
    entity_type: "contact",
    entity_id: entityId,
    user_id: userId,
    payload: details,
    outcome: "pending",
  });
}
