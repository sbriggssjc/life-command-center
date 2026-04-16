// ============================================================================
// Template Draft Engine — Shared utility for generating email drafts
// Life Command Center — Wave 1: Outreach Engine
//
// Takes a template_id + context packet payload → populated email draft
// with Handlebars-style variable substitution. Tracks each send via
// the template_sends table for performance measurement.
// ============================================================================

import { opsQuery, pgFilterVal } from './ops-db.js';
import { writeSignal } from './signals.js';

// ============================================================================
// VARIABLE RESOLUTION
// ============================================================================

/**
 * Resolve a dot-path variable (e.g., 'contact.full_name') against a
 * context payload object. Supports nested objects and array indices.
 *
 * @param {string} path - Dot-separated path like 'contact.full_name'
 * @param {object} context - The assembled context payload (merged packets)
 * @returns {*} The resolved value or undefined
 */
function resolvePath(path, context) {
  const parts = path.split('.');
  let current = context;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

/**
 * Check whether a value is meaningfully present (not null, undefined, or empty string).
 */
function isPresent(value) {
  if (value == null) return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  return true;
}

// ============================================================================
// HANDLEBARS-STYLE TEMPLATE RENDERING
// ============================================================================

/**
 * Render a template string with simple Handlebars-style substitution.
 *
 * Supported syntax:
 *   {{variable.path}}           — replaced with resolved value or ''
 *   {{#if variable.path}}...{{/if}}  — conditional block (included only if variable is present)
 *   {{#if variable.path}}...{{else}}...{{/if}} — conditional with else
 *
 * This is intentionally a lightweight renderer — no helpers, no partials,
 * no loops. Complex formatting is handled by the AI layer before variable
 * injection, not by the template engine itself.
 *
 * @param {string} template - The template string
 * @param {object} context - The merged context payload
 * @returns {string} The rendered string
 */
function renderTemplate(template, context) {
  if (!template) return '';

  // Recursive resolver that handles nested {{#if}}...{{else}}...{{/if}} blocks
  // by finding balanced tag pairs (not using simple regex which breaks on nesting).
  function resolveConditionals(text) {
    let result = '';
    let i = 0;

    while (i < text.length) {
      const ifStart = text.indexOf('{{#if ', i);
      if (ifStart === -1) {
        result += text.slice(i);
        break;
      }

      // Append everything before this {{#if}}
      result += text.slice(i, ifStart);

      // Extract the variable path
      const pathEnd = text.indexOf('}}', ifStart);
      if (pathEnd === -1) { result += text.slice(ifStart); break; }
      const path = text.slice(ifStart + 6, pathEnd).trim();
      const bodyStart = pathEnd + 2;

      // Find the matching {{/if}} by counting nesting depth
      let depth = 1;
      let pos = bodyStart;
      let elsePos = -1; // position of the matching {{else}}

      while (pos < text.length && depth > 0) {
        const nextIf = text.indexOf('{{#if ', pos);
        const nextEndIf = text.indexOf('{{/if}}', pos);
        const nextElse = text.indexOf('{{else}}', pos);

        // Find earliest tag
        const candidates = [];
        if (nextIf !== -1) candidates.push({ type: 'if', pos: nextIf });
        if (nextEndIf !== -1) candidates.push({ type: 'endif', pos: nextEndIf });
        if (nextElse !== -1 && depth === 1) candidates.push({ type: 'else', pos: nextElse });
        if (candidates.length === 0) break;

        candidates.sort((a, b) => a.pos - b.pos);
        const next = candidates[0];

        if (next.type === 'if') {
          depth++;
          pos = next.pos + 6;
        } else if (next.type === 'endif') {
          depth--;
          if (depth === 0) {
            // Found the matching {{/if}}
            const value = resolvePath(path, context);
            const innerContent = text.slice(bodyStart, next.pos);

            if (elsePos !== -1) {
              const ifBlock = text.slice(bodyStart, elsePos);
              const elseBlock = text.slice(elsePos + 8, next.pos);
              result += isPresent(value)
                ? resolveConditionals(ifBlock)
                : resolveConditionals(elseBlock);
            } else {
              result += isPresent(value) ? resolveConditionals(innerContent) : '';
            }

            pos = next.pos + 7; // skip past {{/if}}
          } else {
            pos = next.pos + 7;
          }
        } else if (next.type === 'else') {
          elsePos = next.pos;
          pos = next.pos + 8;
        }
      }

      i = pos;
    }

    return result;
  }

  let output = resolveConditionals(template);

  // Replace {{variable.path}} with resolved values
  output = output.replace(
    /\{\{([\w.]+)\}\}/g,
    (_, path) => {
      const value = resolvePath(path, context);
      if (value == null) return '';
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
    }
  );

  // Clean up any double blank lines left from removed conditional blocks
  output = output.replace(/\n{3,}/g, '\n\n');

  return output.trim();
}

// ============================================================================
// TEMPLATE LOADING
// ============================================================================

/**
 * Load the latest active version of a template from the database.
 *
 * @param {string} templateId - e.g., 'T-001'
 * @returns {object|null} The template definition row, or null if not found
 */
export async function loadTemplate(templateId) {
  const result = await opsQuery('GET',
    `template_definitions?template_id=eq.${pgFilterVal(templateId)}&deprecated=eq.false&order=template_version.desc&limit=1`
  );
  if (!result.ok || !result.data?.length) return null;
  return result.data[0];
}

/**
 * Load all active (non-deprecated) templates.
 *
 * @returns {object[]} Array of template definition rows
 */
export async function listActiveTemplates() {
  const result = await opsQuery('GET',
    'template_definitions?deprecated=eq.false&order=template_id.asc,template_version.desc'
  );
  return result.ok ? (result.data || []) : [];
}

// ============================================================================
// DRAFT GENERATION
// ============================================================================

/**
 * Validate that all mandatory variables for a template can be resolved
 * from the provided context payload.
 *
 * @param {object} template - The template definition row
 * @param {object} context - The merged context payload
 * @returns {{ valid: boolean, missing: string[] }}
 */
export function validateVariables(template, context) {
  const missing = [];
  for (const varPath of (template.mandatory_variables || [])) {
    const value = resolvePath(varPath, context);
    if (!isPresent(value)) {
      missing.push(varPath);
    }
  }
  return { valid: missing.length === 0, missing };
}

/**
 * Generate an email draft from a template and context payload.
 *
 * This is the main entry point. It:
 * 1. Loads the template from the database
 * 2. Validates mandatory variables against the context
 * 3. Renders subject and body with variable substitution
 * 4. Returns the draft + metadata for review
 *
 * @param {string} templateId - e.g., 'T-001'
 * @param {object} context - Merged context payload from one or more packets
 *   Expected shape: { contact: {...}, property: {...}, listing: {...}, ... }
 * @param {object} [options]
 * @param {boolean} [options.strict=false] - If true, fail when mandatory vars are missing
 * @param {boolean} [options.includeMetadata=true] - Include template metadata in response
 * @returns {{ ok: boolean, draft?: object, error?: string, missing?: string[] }}
 */
export async function generateDraft(templateId, context, options = {}) {
  const { strict = false, includeMetadata = true } = options;

  // 1. Load template
  const template = await loadTemplate(templateId);
  if (!template) {
    return { ok: false, error: `Template "${templateId}" not found or deprecated` };
  }

  // 2. Validate mandatory variables
  const validation = validateVariables(template, context);
  if (!validation.valid && strict) {
    return {
      ok: false,
      error: `Missing mandatory variables: ${validation.missing.join(', ')}`,
      missing: validation.missing,
      template_id: templateId,
      template_name: template.name
    };
  }

  // 3. Render subject and body
  const subject = renderTemplate(template.subject_template, context);
  const body = renderTemplate(template.body_template, context);

  // 4. Build the draft response
  const draft = {
    template_id: template.template_id,
    template_version: template.template_version,
    template_name: template.name,
    category: template.category,
    subject,
    body,
    resolved_variables: {},
    unresolved_variables: validation.missing || []
  };

  // Build resolved variable map for transparency
  const allVars = [...(template.mandatory_variables || []), ...(template.optional_variables || [])];
  for (const varPath of allVars) {
    const value = resolvePath(varPath, context);
    draft.resolved_variables[varPath] = isPresent(value) ? 'resolved' : 'missing';
  }

  const response = { ok: true, draft };

  if (includeMetadata) {
    response.metadata = {
      packet_bindings: template.packet_bindings,
      tone_notes: template.tone_notes,
      performance_targets: template.performance_targets,
      domain: template.domain
    };
  }

  return response;
}

// ============================================================================
// SEND TRACKING
// ============================================================================

/**
 * Record a template send for performance tracking.
 * Called after the broker reviews, edits, and sends an email.
 *
 * @param {object} params
 * @param {string} params.template_id - e.g., 'T-001'
 * @param {number} params.template_version
 * @param {string} params.user_id
 * @param {string} [params.entity_id] - The contact/entity being emailed
 * @param {string} [params.domain]
 * @param {string} [params.context_packet_id] - UUID of the cached packet used
 * @param {string} params.rendered_subject - The subject after variable substitution
 * @param {string} params.rendered_body - The body after variable substitution
 * @param {string} [params.final_subject] - The subject after broker edits
 * @param {string} [params.final_body] - The body after broker edits
 * @param {number} [params.edit_distance_pct] - How much the broker changed (0-100)
 * @returns {{ ok: boolean, send?: object, error?: string }}
 */
export async function recordTemplateSend(params) {
  const row = {
    template_id: params.template_id,
    template_version: params.template_version || 1,
    user_id: params.user_id,
    entity_id: params.entity_id || null,
    domain: params.domain || null,
    context_packet_id: params.context_packet_id || null,
    rendered_subject: params.rendered_subject || null,
    rendered_body: params.rendered_body || null,
    final_subject: params.final_subject || null,
    final_body: params.final_body || null,
    edit_distance_pct: params.edit_distance_pct ?? null,
    opened: false,
    replied: false,
    deal_advanced: false,
    sent_at: new Date().toISOString()
  };

  const result = await opsQuery('POST', 'template_sends', row);
  if (!result.ok) {
    return { ok: false, error: 'Failed to record template send', detail: result.data };
  }

  const send = Array.isArray(result.data) ? result.data[0] : result.data;

  // Fire-and-forget signal
  writeSignal({
    signal_type: 'template_sent',
    signal_category: 'communication',
    entity_type: 'contact',
    entity_id: params.entity_id || null,
    domain: params.domain || null,
    user_id: params.user_id,
    payload: {
      template_id: params.template_id,
      template_version: params.template_version || 1,
      edit_distance_pct: params.edit_distance_pct ?? null,
      send_id: send?.id || null
    },
    outcome: 'pending'
  });

  return { ok: true, send };
}

/**
 * Compute a simple edit distance percentage between two strings.
 * Uses character-level Levenshtein ratio. Returns 0-100 where
 * 0 = identical, 100 = completely different.
 *
 * For performance, this uses a simplified approach for long strings:
 * compare by lines rather than characters.
 *
 * @param {string} original - The rendered template draft
 * @param {string} final_ - The broker's edited version
 * @returns {number} Edit distance percentage (0-100)
 */
export function computeEditDistance(original, final_) {
  if (!original || !final_) return 100;
  if (original === final_) return 0;

  // For long strings, compare line-by-line for performance
  const origLines = original.split('\n');
  const finalLines = final_.split('\n');

  const maxLen = Math.max(origLines.length, finalLines.length);
  if (maxLen === 0) return 0;

  let matchingLines = 0;
  const minLen = Math.min(origLines.length, finalLines.length);

  for (let i = 0; i < minLen; i++) {
    if (origLines[i].trim() === finalLines[i].trim()) {
      matchingLines++;
    }
  }

  const similarity = matchingLines / maxLen;
  return Math.round((1 - similarity) * 100);
}

// ============================================================================
// BATCH DRAFT GENERATION (for listing blasts, market updates, etc.)
// ============================================================================

/**
 * Generate drafts for multiple contacts using the same template.
 * Each contact gets its own context merged with shared listing/property context.
 *
 * @param {string} templateId
 * @param {object[]} contacts - Array of contact context objects
 * @param {object} sharedContext - Shared context (listing, property, etc.)
 * @param {object} [options]
 * @returns {{ ok: boolean, drafts: object[], errors: object[] }}
 */
export async function generateBatchDrafts(templateId, contacts, sharedContext = {}, options = {}) {
  const drafts = [];
  const errors = [];

  for (const contactCtx of contacts) {
    const mergedContext = { ...sharedContext, contact: contactCtx };
    const result = await generateDraft(templateId, mergedContext, options);
    if (result.ok) {
      drafts.push({ contact: contactCtx, ...result.draft });
    } else {
      errors.push({ contact: contactCtx, error: result.error, missing: result.missing });
    }
  }

  return { ok: errors.length === 0, drafts, errors };
}
