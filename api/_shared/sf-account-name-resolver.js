// api/_shared/sf-account-name-resolver.js
// ============================================================================
// RECON3 (2026-09-22) — never write a raw Salesforce record id into a name
// field (buyer_name / seller_name / recorded_owners.name / entities.name /
// canonical_name / …). Found on property_id 27266 (175 Righter Rd, Succasunna
// NJ, DaVita): a Salesforce Account ID ("001…", 18 chars) had been stored as
// the owner/buyer NAME instead of the Account's Name field, because a caller
// somewhere on the SF-sourced write path read the id where it meant the
// resolved name.
//
// This is the SINGLE reusable guard/resolver for that class of bug — every
// write path that might receive an SF-sourced "name" (sidebar-pipeline.js
// sale ingestion, intake-promoter.js OM staging, entity-link.js's
// ensureEntityLink choke point, and RECON2's forthcoming reconcile_property())
// imports from here rather than inlining its own regex. Mirrors the existing
// house pattern of a narrow, named guard function (isJunkEntityName,
// isPlaceholderEntityName, isJunkContactName / tm-misparse.js) rather than a
// blanket string filter.
//
// Resolution policy (never fabricate): this module NEVER calls the live
// Salesforce API. It resolves a raw id to a name ONLY from what LCC already
// holds — the external_identities(source_system='salesforce') -> entities
// join, the same bounded-query technique api/_handlers/sf-account-import.js
// already uses (resolveAccountNamesByIds). When LCC has never seen the
// Account/Contact, the id cannot be resolved here; the caller must either
// leave the name blank (fill-blanks doctrine) or route the row to a review
// lane — never write the opaque id as if it were a display name.
// ============================================================================

import { opsQuery, pgFilterVal } from './ops-db.js';
import { sf15, toSf18, classifySfId } from './sf-id.js';

/**
 * True when `value` is shaped like a raw Salesforce record id (15 or 18
 * chars, a recognized key prefix — Account/Contact/Lead/Opportunity/User).
 * This is a SHAPE check, not a liveness check — it flags "this looks like an
 * id, not a name" regardless of whether LCC can resolve it.
 */
export function looksLikeRawSalesforceId(value) {
  if (value === null || value === undefined) return false;
  const s = String(value).trim();
  if (!s) return false;
  return classifySfId(s).kind !== 'invalid';
}

/** Convenience: specifically an Account (001…) id — the shape RECON3 found. */
export function looksLikeRawSalesforceAccountId(value) {
  if (value === null || value === undefined) return false;
  const s = String(value).trim();
  if (!s) return false;
  return classifySfId(s).kind === 'Account';
}

/**
 * Resolve a raw Salesforce record id to the ORG NAME LCC already holds for
 * it, via external_identities(source_system='salesforce') -> entities.name.
 * Returns null when unresolved (never fabricated) or when `id` isn't a
 * plausible SF id shape. `deps.query` is opsQuery-shaped and injectable for
 * tests; defaults to the real opsQuery.
 *
 * Bounded: one 18/15-form GET (mirrors resolveAccountNamesByIds's technique),
 * never an N+1 loop.
 */
export async function resolveSfIdToLccName(id, deps = {}) {
  const query = deps.query || opsQuery;
  const enc = deps.enc || pgFilterVal;
  const key = sf15(id);
  if (!key) return null;
  if (typeof query !== 'function') return null;

  const s18 = toSf18(key);
  const forms = Array.from(new Set([s18, key].filter(Boolean)));
  if (!forms.length) return null;

  const inList = forms.map(enc).join(',');
  const idRes = await query('GET',
    'external_identities?source_system=eq.salesforce'
      + `&external_id=in.(${inList})&select=entity_id&limit=5`);
  const entityIds = (idRes && idRes.ok && Array.isArray(idRes.data))
    ? idRes.data.map((r) => r.entity_id).filter(Boolean)
    : [];
  if (!entityIds.length) return null;

  const entList = entityIds.map(enc).join(',');
  const entRes = await query('GET',
    `entities?id=in.(${entList})&select=id,name&merged_into_entity_id=is.null&limit=5`);
  const rows = (entRes && entRes.ok && Array.isArray(entRes.data)) ? entRes.data : [];
  const named = rows.find((r) => r.name && !looksLikeRawSalesforceId(r.name));
  return named ? named.name : null;
}

/**
 * The write-time guard: given a candidate value destined for a NAME field
 * (buyer_name, seller_name, recorded_owners.name, canonical_name, entities.name,
 * …), return the safe value to write.
 *
 * - Not SF-id-shaped -> passed through unchanged (`raw: false`).
 * - SF-id-shaped and resolvable from LCC's own store -> the resolved name
 *   (`raw: true, resolved: true`).
 * - SF-id-shaped and unresolvable -> null (`raw: true, resolved: false`) so
 *   the caller leaves the field blank / routes to review rather than
 *   persisting the opaque id as a name.
 *
 * Async because resolution is a (bounded) DB round-trip; callers on a hot
 * synchronous path should call `looksLikeRawSalesforceId` first and only pay
 * for `guardNameField` when it returns true.
 */
export async function guardNameField(value, deps = {}) {
  if (value === null || value === undefined) return { value, raw: false, resolved: false };
  const s = String(value).trim();
  if (!s || !looksLikeRawSalesforceId(s)) return { value, raw: false, resolved: false };

  const resolved = await resolveSfIdToLccName(s, deps);
  if (resolved) return { value: resolved, raw: true, resolved: true, rawId: s };
  return { value: null, raw: true, resolved: false, rawId: s };
}
