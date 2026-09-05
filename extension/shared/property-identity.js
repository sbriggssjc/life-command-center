// Shared, deterministic record-boundary helpers for every extension surface.
// No ESM exports: content scripts and the side panel load this as a classic
// script; the MV3 module service worker imports it for its global side effect.
(function installLccPropertyIdentity(root) {
  'use strict';

  function propertyIdentityKey(url) {
    if (!url || typeof url !== 'string') return null;
    try {
      const u = new URL(url);
      const segments = u.pathname.split('/').filter(Boolean);
      const idSegments = segments.filter((segment) => /\d/.test(segment) || segment.length > 20);
      const idQueryParts = [];
      for (const [key, value] of u.searchParams) {
        if (!value || !/(^[Ii]d$|_id$|[a-z]Id$)/.test(key)) continue;
        if (!/^[\w-]+$/.test(value)) continue;
        if (!/\d/.test(value) && value.length < 20) continue;
        idQueryParts.push(`${key.toLowerCase()}=${value.toLowerCase()}`);
      }
      idQueryParts.sort();
      const hashIdSegments = [];
      if (u.hash && u.hash.length > 1) {
        const hashPath = u.hash.replace(/^#\/?/, '').split(/[?#]/)[0];
        hashPath.split('/').filter(Boolean).forEach((segment) => {
          if (/\d/.test(segment) || segment.length > 20) hashIdSegments.push(segment);
        });
      }
      const allIds = [...idSegments, ...hashIdSegments];
      if (allIds.length === 0 && idQueryParts.length === 0) {
        return (u.host + u.pathname).toLowerCase().replace(/\/+$/, '');
      }
      const pathPart = allIds.length ? '/' + allIds.join('/') : '';
      const queryPart = idQueryParts.length ? '?' + idQueryParts.join('&') : '';
      return (u.host + pathPart + queryPart).toLowerCase();
    } catch {
      return null;
    }
  }

  function costarPropertyId(url) {
    if (!url || typeof url !== 'string') return null;
    try {
      const u = new URL(url);
      if (!/(^|\.)costar\.com$/i.test(u.hostname)) return null;
      const match = u.pathname.match(/\/detail\/(?:lookup|all-properties)\/(\d+)(?:\/|$)/i)
        || u.pathname.match(/\/comp\/(\d+)(?:\/|$)/i);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  function provenancePropertyKeys(context) {
    if (!context || typeof context !== 'object') return [];
    const provenance = context._source_field_provenance;
    if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) return [];
    return [...new Set(Object.values(provenance).filter(Boolean).map(String))];
  }

  function contextIntegrity(context, activeUrl) {
    const contextKey = propertyIdentityKey(context && context.page_url);
    const declaredKey = context && context.source_property_key || null;
    const activeKey = propertyIdentityKey(activeUrl);
    const provenanceKeys = provenancePropertyKeys(context);
    const reasons = [];
    if (!contextKey) reasons.push('missing_context_property_identity');
    if (!declaredKey) reasons.push('missing_declared_property_identity');
    if (contextKey && declaredKey && contextKey !== declaredKey) reasons.push('declared_identity_mismatch');
    if (activeKey && contextKey && activeKey !== contextKey) reasons.push('active_tab_identity_mismatch');
    if (provenanceKeys.length === 0) reasons.push('missing_source_field_provenance');
    if (declaredKey && provenanceKeys.some((key) => key !== declaredKey)) reasons.push('mixed_source_field_provenance');
    return {
      ok: reasons.length === 0,
      reasons,
      contextKey,
      declaredKey,
      activeKey,
      provenanceKeys,
      costarPropertyId: costarPropertyId(context && context.page_url),
      activeCostarPropertyId: costarPropertyId(activeUrl),
    };
  }

  function mergeFreshTenantRoster(context, fresh, activeUrl) {
    const baseIntegrity = contextIntegrity(context, activeUrl);
    const contextKey = propertyIdentityKey(context && context.page_url);
    const freshKey = propertyIdentityKey(fresh && fresh.page_url);
    const activeKey = propertyIdentityKey(activeUrl);
    const tenants = Array.isArray(fresh && fresh.tenants)
      ? fresh.tenants.filter((tenant) => tenant && typeof tenant.name === 'string' && tenant.name.trim())
      : [];
    const reasons = [...baseIntegrity.reasons];
    if (!freshKey) reasons.push('missing_fresh_tenant_property_identity');
    if (contextKey && freshKey && contextKey !== freshKey) reasons.push('fresh_tenant_identity_mismatch');
    if (activeKey && freshKey && activeKey !== freshKey) reasons.push('fresh_tenant_active_tab_mismatch');
    if (!fresh || fresh.source_property_key !== freshKey) reasons.push('fresh_tenant_declared_identity_mismatch');
    if (!fresh || fresh.tenant_provenance_key !== freshKey) reasons.push('fresh_tenant_provenance_mismatch');
    if (tenants.length === 0) reasons.push('fresh_tenant_roster_empty');
    const uniqueReasons = [...new Set(reasons)];
    if (uniqueReasons.length > 0) return { ok: false, reasons: uniqueReasons, context };
    return {
      ok: true,
      reasons: [],
      context: {
        ...context,
        tenants,
        _source_field_provenance: {
          ...(context && context._source_field_provenance || {}),
          tenants: freshKey,
        },
      },
    };
  }

  function freshTenantFrameTarget(context, activeTabId) {
    if (!Number.isInteger(activeTabId) || activeTabId < 0) {
      return { ok: false, reasons: ['missing_active_costar_tab'] };
    }
    if (context?._source_tab_id != null && context._source_tab_id !== activeTabId) {
      return { ok: false, reasons: ['fresh_tenant_tab_identity_mismatch'] };
    }
    const frameId = Number.isInteger(context?._tenant_source_frame_id)
      && context._tenant_source_frame_id >= 0
      ? context._tenant_source_frame_id
      : 0;
    return { ok: true, tabId: activeTabId, frameId };
  }

  root.LccPropertyIdentity = Object.freeze({
    propertyIdentityKey,
    costarPropertyId,
    provenancePropertyKeys,
    contextIntegrity,
    mergeFreshTenantRoster,
    freshTenantFrameTarget,
  });
})(globalThis);
