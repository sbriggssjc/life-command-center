// ============================================================================
// Signal Writer — Shared utility for writing to the signals table
// Life Command Center — Intelligence Layer
//
// Every meaningful event in the system writes a signal row for the
// learning loop. This module provides a fire-and-forget helper.
// ============================================================================

import { opsQuery } from './ops-db.js';

/**
 * Write a signal to the signals table. Fire-and-forget — never blocks
 * the calling action and never throws.
 *
 * @param {object} params
 * @param {string} params.signal_type - e.g., 'triage_decision', 'recommendation_acted_on'
 * @param {string} params.signal_category - e.g., 'prospecting', 'deal_execution', 'intelligence'
 * @param {string} [params.entity_type] - 'contact', 'property', 'pursuit', 'deal', etc.
 * @param {string} [params.entity_id] - UUID of the related entity
 * @param {string} [params.domain] - 'government', 'dialysis', 'both', 'none'
 * @param {string} [params.user_id] - UUID of the acting user
 * @param {string} [params.session_id] - optional session UUID
 * @param {object} [params.payload] - flexible JSON payload (see signal_table_schema.sql)
 * @param {string} [params.outcome] - 'positive', 'neutral', 'negative', 'pending', 'unknown'
 * @param {string} [params.model_version] - version tag for scoring/classifier
 */
export async function writeSignal(params) {
  try {
    const row = {
      signal_type: params.signal_type,
      signal_category: params.signal_category || 'system',
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
    };
    await opsQuery('POST', 'signals', row);
  } catch (err) {
    // Signal writes are never allowed to break the calling flow
    console.error('[Signal write failed]', err?.message || err);
  }
}

/**
 * Write a triage_decision signal when an inbox item is triaged.
 *
 * @param {object} item - The inbox item being triaged
 * @param {string} newStatus - The new status (triaged, dismissed, etc.)
 * @param {object} user - The acting user
 * @param {object} [classificationData] - Optional AI classification data
 */
export async function writeTriageSignal(item, newStatus, user, classificationData = {}) {
  await writeSignal({
    signal_type: 'triage_decision',
    signal_category: 'intelligence',
    entity_type: item.entity_id ? 'inbox_item' : null,
    entity_id: item.entity_id || null,
    domain: item.domain || null,
    user_id: user.id,
    payload: {
      inbox_item_id: item.id,
      ai_classification: classificationData.ai_classification || null,
      ai_confidence: classificationData.ai_confidence || null,
      user_classification: newStatus,
      overridden: !!(classificationData.ai_classification && classificationData.ai_classification !== newStatus),
      subject_snippet: (item.title || '').substring(0, 60),
      sender_domain: item.metadata?.sender_email?.split('@')[1] || null,
      source_type: item.source_type || null,
      priority_assigned: item.priority || null,
    },
    outcome: 'pending',
  });
}

/**
 * Write a signal when an inbox item is promoted to an action.
 *
 * @param {object} inboxItem - The inbox item being promoted
 * @param {object} action - The created action item
 * @param {object} user - The acting user
 */
export async function writePromotionSignal(inboxItem, action, user) {
  await writeSignal({
    signal_type: 'recommendation_acted_on',
    signal_category: 'intelligence',
    entity_type: 'inbox_item',
    entity_id: inboxItem.entity_id || null,
    domain: inboxItem.domain || null,
    user_id: user.id,
    payload: {
      inbox_item_id: inboxItem.id,
      action_item_id: action.id,
      action_type: action.action_type || 'follow_up',
      priority_assigned: action.priority || null,
      source_type: inboxItem.source_type || null,
      subject_snippet: (inboxItem.title || '').substring(0, 60),
    },
    outcome: 'pending',
  });
}

/**
 * Write a deal_stage_change signal.
 *
 * @param {object} params
 * @param {string} params.entity_id - Deal entity ID
 * @param {string} params.domain
 * @param {string} params.user_id
 * @param {string} params.from_stage
 * @param {string} params.to_stage
 * @param {object} [params.metadata] - Additional context
 */
export async function writeDealStageSignal({ entity_id, domain, user_id, from_stage, to_stage, metadata }) {
  await writeSignal({
    signal_type: 'deal_stage_change',
    signal_category: 'deal_execution',
    entity_type: 'deal',
    entity_id,
    domain: domain || null,
    user_id,
    payload: {
      from_stage,
      to_stage,
      ...metadata,
    },
    outcome: 'pending',
  });
}

/**
 * Write a touchpoint_logged signal.
 *
 * @param {object} activity - The activity event
 * @param {object} user - The acting user
 */
/**
 * Write a listing_created signal when a new listing/asset entity is created.
 * This signal is consumed by the listing-as-BD pipeline (or a scheduled task)
 * to identify contacts for T-011 and T-012 template outreach.
 *
 * @param {object} entity - The created entity
 * @param {object} user - The creating user
 */
export async function writeListingCreatedSignal(entity, user) {
  await writeSignal({
    signal_type: 'listing_created',
    signal_category: 'prospecting',
    entity_type: 'listing',
    entity_id: entity.id || null,
    domain: entity.domain || null,
    user_id: user.id,
    payload: {
      entity_name: (entity.name || '').substring(0, 100),
      entity_type: entity.entity_type,
      state: entity.state || null,
      city: entity.city || null,
      asset_type: entity.metadata?.asset_type || entity.metadata?.property_type || null,
      listing_status: entity.metadata?.listing_status || 'new',
    },
    outcome: 'pending',
  });
}

/**
 * Write a touchpoint_logged signal.
 *
 * @param {object} activity - The activity event
 * @param {object} user - The acting user
 */
export async function writeTouchpointSignal(activity, user) {
  await writeSignal({
    signal_type: 'touchpoint_logged',
    signal_category: 'communication',
    entity_type: activity.entity_type || 'contact',
    entity_id: activity.entity_id || null,
    domain: activity.domain || null,
    user_id: user.id,
    payload: {
      activity_category: activity.category || activity.activity_category || null,
      title: (activity.title || '').substring(0, 100),
      source_type: activity.source_type || null,
    },
    outcome: 'pending',
  });
}
