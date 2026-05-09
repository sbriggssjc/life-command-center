/* detail-lease-comps-fix.js — Round 76gn.i
 *
 * Hot-patch overrides for the lease-comps export pipeline. Loads after
 * detail.js (see index.html) and reassigns the affected functions in place.
 *
 * Round 76gn.i — additions on top of 76gn.h (data-quality + presentation):
 *   - Operator name normalization (DaVita / Fresenius / Satellite / etc.)
 *   - lease_escalations fetch wired into comps + subject (BUMPS column populated)
 *   - latest_patient_count fetched and written to PATIENTS column (column W)
 *   - USER/OWNER column writes "Yes"/"No" instead of owner-name labels
 *   - Subject owner_occupied is now computed (was hardcoded false)
 *   - _udBuildLeaseCompsWorkbook override:
 *       * Auto-fit column widths to actual data length (capped at 60)
 *       * Clear column A counter for unused pre-styled rows
 *       * fullCalcOnLoad=true so Excel recomputes the AVERAGE row on open
 *       * Re-stamp left-alignment on TENANT / OPERATOR / ADDRESS cells
 *
 * NOTE: PATIENTS column requires the regenerated template
 * (`python scripts/build_lease_comps_template.py` produces a 23-column layout
 * A..W with W=PATIENTS). If the deployed template still has 22 columns
 * (V=DISTANCE last), the patient_count write is silently skipped.
 *
 * Once detail.js itself is patched (`git apply scripts/lease-comps-detail-js.patch`)
 * delete this file and the corresponding <script> tag in index.html.
 */
(function () {
  'use strict';

  // Register the new PATIENTS column on the existing template column map so
  // _udPopulateDataRow can write to it. Once detail.js itself is patched to
  // add `patientCount: 23, distance: 22` (already there) this becomes a
  // no-op. Until then, the override populates from JS.
  if (typeof _UD_TPL !== 'undefined' && _UD_TPL && _UD_TPL.cols && !_UD_TPL.cols.patientCount) {
    _UD_TPL.cols.patientCount = 23;
  }

  // ── Operator name normalization ─────────────────────────────────────
  // Normalizes the dozen DaVita / Fresenius / Satellite / etc. variants
  // that come back from properties.tenant / properties.operator / leases.tenant
  // / leases.operator — different ingestion sources cased and abbreviated
  // differently. We only normalize when the canonical form is unambiguous;
  // sub-brand variants like "DaVita at Home" stay distinct.
  const _UD_OPERATOR_NORMALIZATION = [
    [/^\s*davita\s+kidney\s+care.*$/i,                 'DaVita Kidney Care'],
    [/^\s*davita\s+at\s+home\s*$/i,                    'DaVita at Home'],
    [/^\s*davita\s+dialysis.*$/i,                      'DaVita'],
    [/^\s*davita\s+inc\.?\s*$/i,                       'DaVita'],
    [/^\s*davita\s*$/i,                                'DaVita'],
    [/^\s*da\s*vita\b.*$/i,                            'DaVita'],
    [/^\s*fresenius\s+kidney\s+care.*$/i,              'Fresenius Medical Care'],
    [/^\s*fresenius\s+medical\s+care.*$/i,             'Fresenius Medical Care'],
    [/^\s*fresenius\s+dialysis.*$/i,                   'Fresenius Medical Care'],
    [/^\s*fresenius\s*$/i,                             'Fresenius Medical Care'],
    [/^\s*fmc\b.*$/i,                                  'Fresenius Medical Care'],
    [/^\s*fkc\b.*$/i,                                  'Fresenius Medical Care'],
    [/^\s*rai\b.*$/i,                                  'Fresenius Medical Care'],
    [/^\s*satellite\s+wellbound.*$/i,                  'Satellite Healthcare'],
    [/^\s*satellite\s+healthcare.*$/i,                 'Satellite Healthcare'],
    [/^\s*satellite\s+dialysis.*$/i,                   'Satellite Dialysis'],
    [/^\s*shc\b.*$/i,                                  'Satellite Healthcare'],
    [/^\s*us\s*renal\s+care.*$/i,                      'US Renal Care'],
    [/^\s*usrc\b.*$/i,                                 'US Renal Care'],
    [/^\s*american\s+renal\s+associates.*$/i,          'American Renal Associates'],
    [/^\s*innovative\s+renal\s+care.*$/i,              'American Renal Associates'],
    [/^\s*ara\b.*$/i,                                  'American Renal Associates'],
    [/^\s*dialysis\s+clinic.*$/i,                      'Dialysis Clinic, Inc.'],
    [/^\s*dci\b.*$/i,                                  'Dialysis Clinic, Inc.'],
  ];

  function _udNormalizeOperator(s) {
    if (!s) return '';
    const trimmed = String(s).replace(/\s+/g, ' ').trim();
    for (const [pat, canon] of _UD_OPERATOR_NORMALIZATION) {
      if (pat.test(trimmed)) return canon;
    }
    return trimmed;
  }
  window._udNormalizeOperator = _udNormalizeOperator;

  // Sanitize owner strings from CoStar / public records: strip ®, ™, collapse
  // whitespace, trim leading/trailing punctuation. "Svn®" -> "Svn".
  function _udSanitizeOwner(s) {
    if (!s) return '';
    return String(s)
      .replace(/[®™]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/[\s,]+$/, '')
      .replace(/^[\s,]+/, '')
      .trim();
  }
  window._udSanitizeOwner = _udSanitizeOwner;

  // Tenant / operator resolver — applies normalization before returning.
  function _udExtractTenantOperator(db, rec, fb, lease) {
    rec = rec || {}; fb = fb || {}; lease = lease || {};
    if (db === 'gov') {
      const tenant = rec.agency_short || rec.agency || fb.tenant_agency
                  || fb.agency || lease.tenant || lease.tenant_name || '';
      const operator = rec.agency_full || rec.agency || fb.agency_full
                    || lease.operator || tenant || '';
      return { tenant, operator };
    }
    const chain = lease.tenant || rec.chain_canonical || rec.tenant
               || fb.chain_organization || fb.chain_canonical || '';
    const local = lease.operator || rec.operator || fb.operator_name
               || fb.facility_name || '';
    return {
      tenant: _udNormalizeOperator(chain || local || ''),
      operator: _udNormalizeOperator(local || chain || '')
    };
  }
  window._udExtractTenantOperator = _udExtractTenantOperator;

  // Subject builder — fixes owner_occupied (was hardcoded false), adds
  // patient_count for the new PATIENTS column.
  function _udSubjectFromCache(db) {
    const c = (typeof _udCache !== 'undefined' && _udCache) ? _udCache : {};
    const p = c.property || {};
    const fb = c.fallback || {};
    const own = c.ownership || {};
    const lease = (c.leases && c.leases[0]) || {};
    const buildingSf = _udNumOrNull(p.building_sf || p.building_size || p.rba || fb.building_sf);
    const leasedArea = _udNumOrNull(lease.leased_area || p.leased_area) || buildingSf;
    const { tenant, operator } = _udExtractTenantOperator(db || c.db, p, fb, lease);
    const owner = _udSanitizeOwner(own.true_owner || own.recorded_owner || own.true_owner_name || own.recorded_owner_name || p.recorded_owner_name || '');
    return {
      property_id: c.ids?.property_id || p.property_id || null,
      lease_number: p.lease_number || c.ids?.lease_number || null,
      db: c.db || null,
      tenant,
      operator,
      address: p.address || fb.address || '',
      city: p.city || fb.city || '',
      state: p.state || fb.state || '',
      zip: p.zip_code || fb.zip || '',
      latitude: _udNumOrNull(p.latitude || fb.latitude),
      longitude: _udNumOrNull(p.longitude || fb.longitude),
      building_sf: buildingSf,
      leased_area: leasedArea,
      occupancy: (buildingSf && leasedArea) ? Math.min(1, leasedArea / buildingSf) : null,
      land_acres: _udLandAcres({ land_acres: p.land_acres, land_area: p.land_area, lot_sf: p.lot_sf }),
      year_built: _udNumOrNull(p.year_built || fb.year_built),
      year_renovated: _udNumOrNull(p.year_renovated || fb.year_renovated),
      lease_start: lease.lease_start || fb.lease_start || null,
      lease_expiration: lease.lease_expiration || fb.lease_end || null,
      initial_term_years: _udNumOrNull(lease.initial_term_years),
      term_remaining_years: _udNumOrNull(lease.term_remaining_years),
      annual_rent: _udNumOrNull(lease.annual_rent || lease.base_annual_rent || fb.annual_rent),
      rent_per_sf: _udNumOrNull(lease.rent_psf || fb.rent_per_sf),
      expense_structure: lease.expense_structure || '',
      lease_bump_pct: null,
      lease_bump_interval_mo: null,
      patient_count: _udNumOrNull(p.latest_patient_count || p.total_patients),
      recorded_owner: _udSanitizeOwner(own.recorded_owner || own.recorded_owner_name || p.recorded_owner_name || ''),
      true_owner: _udSanitizeOwner(own.true_owner || own.true_owner_name || ''),
      owner,
      owner_occupied: _udIsOwnerOccupied(tenant, owner) || _udIsOwnerOccupied(operator, owner)
    };
  }
  window._udSubjectFromCache = _udSubjectFromCache;

  // Subject lease fallback — pulls v_lease_detail directly when the cache
  // doesn't have it. Best-effort: any failure returns null.
  async function _udFetchSubjectLease(db, propertyId) {
    if (!propertyId) return null;
    const qFn = db === 'gov' ? govQuery : diaQuery;
    try {
      const res = await qFn('v_lease_detail', '*', {
        filter: `property_id=eq.${propertyId}`,
        order: 'lease_start.desc.nullslast',
        limit: 5
      });
      const rows = Array.isArray(res) ? res : (res?.data || []);
      if (!rows.length) return null;
      const active = rows.find(r => r.is_active === true || r.is_active === 'true');
      return active || rows[0];
    } catch (e) {
      console.warn('subject lease fetch failed', e);
      return null;
    }
  }
  window._udFetchSubjectLease = _udFetchSubjectLease;

  // Fetch lease_escalations rows for a set of property_ids and return a
  // Map<property_id, { pct, intervalMo, raw }> using the most recent row per
  // property. annualized_escalation_percent is preferred; falls back to
  // escalation_value when escalation_unit indicates percentage.
  async function _udFetchEscalations(db, propertyIds) {
    if (!propertyIds || !propertyIds.length) return new Map();
    if (db === 'gov') return new Map();
    const qFn = diaQuery;
    const inList = propertyIds.map(id => encodeURIComponent(id)).join(',');
    try {
      const res = await qFn('lease_escalations',
        'property_id,escalation_value,escalation_unit,escalation_frequency_years,annualized_escalation_percent,raw_escalation_text,effective_date,start_date',
        { filter: `property_id=in.(${inList})`, limit: propertyIds.length * 5 });
      const rows = Array.isArray(res) ? res : (res?.data || []);
      // Most recent row wins per property_id (effective_date desc, then start_date desc).
      const out = new Map();
      const sorted = rows.slice().sort((a, b) => {
        const ea = new Date(a.effective_date || a.start_date || 0).getTime();
        const eb = new Date(b.effective_date || b.start_date || 0).getTime();
        return eb - ea;
      });
      for (const r of sorted) {
        if (!r.property_id || out.has(r.property_id)) continue;
        const annual = _udNumOrNull(r.annualized_escalation_percent);
        const raw = _udNumOrNull(r.escalation_value);
        const pct = (annual != null) ? annual
                  : (raw != null && /[%]|pct|percent/i.test(r.escalation_unit || '')) ? raw
                  : null;
        const freqY = _udNumOrNull(r.escalation_frequency_years);
        const intervalMo = freqY != null ? Math.round(freqY * 12) : null;
        out.set(r.property_id, { pct, intervalMo, raw: r.raw_escalation_text || '' });
      }
      return out;
    } catch (e) {
      console.warn('lease_escalations fetch failed', e);
      return new Map();
    }
  }
  window._udFetchEscalations = _udFetchEscalations;

  // Comp candidate fetcher — projects tenant/operator/chain_canonical/year_built
  // /year_renovated/latest_patient_count from properties, dedupes by lat/lng,
  // joins v_property_detail / v_lease_detail / v_ownership_current /
  // lease_escalations.
  async function _udFetchLeaseCompCandidates(db, subject, count) {
    const qFn = db === 'gov' ? govQuery : diaQuery;

    const RADII_MI = [150, 500, 2000];
    const lat0 = Number(subject.latitude);
    const lng0 = Number(subject.longitude);
    const cosLat = Math.cos(lat0 * Math.PI / 180);
    let props = [];
    let radiusUsed = null;
    for (const radius of RADII_MI) {
      const dLat = radius / 69.0;
      const dLng = radius / Math.max(0.01, 69.0 * Math.abs(cosLat));
      const bbox = 'and=(' + [
        `latitude.gte.${(lat0 - dLat).toFixed(6)}`,
        `latitude.lte.${(lat0 + dLat).toFixed(6)}`,
        `longitude.gte.${(lng0 - dLng).toFixed(6)}`,
        `longitude.lte.${(lng0 + dLng).toFixed(6)}`
      ].join(',') + ')';
      const projection = db === 'gov'
        ? 'property_id,latitude,longitude,year_built,year_renovated'
        : 'property_id,latitude,longitude,tenant,operator,chain_canonical,year_built,year_renovated,latest_patient_count';
      const propsRes = await qFn('properties', projection, {
        filter: bbox,
        limit: 5000
      });
      props = Array.isArray(propsRes) ? propsRes : (propsRes?.data || []);
      radiusUsed = radius;
      if (props.length >= count + 1) break;
    }

    window._udLastGeocodeUniverseSize = props.length;
    window._udLastGeocodeRadiusMi = radiusUsed;

    const seenCoord = new Set();
    const ranked = props
      .filter(p => p.property_id && p.property_id !== subject.property_id)
      .map(p => {
        const d = _udHaversineMiles(subject.latitude, subject.longitude, p.latitude, p.longitude);
        return d == null ? null : Object.assign({}, p, { distance_miles: d });
      })
      .filter(Boolean)
      .sort((a, b) => a.distance_miles - b.distance_miles)
      .filter(p => {
        const key = `${Number(p.latitude).toFixed(5)},${Number(p.longitude).toFixed(5)}`;
        if (seenCoord.has(key)) return false;
        seenCoord.add(key);
        return true;
      })
      .slice(0, count);

    if (ranked.length === 0 && props.length > 0) {
      console.warn('[lease-comps] universe>0 but ranked=0', { universe: props.length, radius_mi: radiusUsed });
    } else if (props.length === 0) {
      console.warn(`[lease-comps] PostgREST returned no rows within ${radiusUsed} mi`);
    } else {
      console.info(`[lease-comps] universe=${props.length} radius=${radiusUsed}mi ranked=${ranked.length} nearestMi=${ranked[0]?.distance_miles?.toFixed(2)}`);
    }

    if (ranked.length === 0) return [];

    const ids = ranked.map(r => r.property_id);
    const inList = ids.map(id => encodeURIComponent(id)).join(',');

    const [propRes, leaseRes, ownRes, escMap] = await Promise.all([
      qFn('v_property_detail', '*', { filter: `property_id=in.(${inList})`, limit: ids.length }).catch(() => []),
      qFn('v_lease_detail', '*',     { filter: `property_id=in.(${inList})`, limit: ids.length * 5 }).catch(() => []),
      qFn('v_ownership_current', '*',{ filter: `property_id=in.(${inList})`, limit: ids.length * 2 }).catch(() => []),
      _udFetchEscalations(db, ids)
    ]);
    const propDetails = Array.isArray(propRes) ? propRes : (propRes?.data || []);
    const leases = Array.isArray(leaseRes) ? leaseRes : (leaseRes?.data || []);
    const owners = Array.isArray(ownRes) ? ownRes : (ownRes?.data || []);

    const propByPid = new Map();
    for (const row of propDetails) {
      if (row?.property_id && !propByPid.has(row.property_id)) propByPid.set(row.property_id, row);
    }

    const leaseByProp = new Map();
    for (const l of leases) {
      const pid = l.property_id;
      if (!pid) continue;
      const cur = leaseByProp.get(pid);
      if (!cur) { leaseByProp.set(pid, l); continue; }
      const isActive = (x) => x && (x.is_active === true || x.is_active === 'true');
      if (isActive(l) && !isActive(cur)) { leaseByProp.set(pid, l); continue; }
      const expA = new Date(l.lease_expiration || 0).getTime();
      const expB = new Date(cur.lease_expiration || 0).getTime();
      if (expA > expB) leaseByProp.set(pid, l);
    }

    const ownerByProp = new Map();
    for (const o of owners) {
      if (o.property_id && !ownerByProp.has(o.property_id)) ownerByProp.set(o.property_id, o);
    }

    return ranked.map(rk => {
      const det = propByPid.get(rk.property_id) || {};
      const p = Object.assign({}, det, rk);
      const l = leaseByProp.get(p.property_id) || {};
      const o = ownerByProp.get(p.property_id) || {};
      const e = escMap.get(p.property_id) || {};
      const { tenant, operator } = _udExtractTenantOperator(db, p, {}, l);
      const owner = _udSanitizeOwner(o.true_owner || o.recorded_owner || p.recorded_owner_name || '');
      const buildingSf = _udNumOrNull(p.building_sf || p.building_size || p.rba);
      const leasedArea = _udNumOrNull(l.leased_area || p.leased_area) || buildingSf;
      return {
        property_id: p.property_id,
        lease_number: p.lease_number || l.lease_number || '',
        tenant,
        operator,
        owner,
        owner_occupied: _udIsOwnerOccupied(tenant, owner) || _udIsOwnerOccupied(operator, owner),
        address: p.address || '',
        city: p.city || '',
        state: p.state || '',
        zip: p.zip_code || '',
        latitude: p.latitude,
        longitude: p.longitude,
        distance_miles: p.distance_miles,
        building_sf: buildingSf,
        leased_area: leasedArea,
        occupancy: (buildingSf && leasedArea) ? Math.min(1, leasedArea / buildingSf) : null,
        land_acres: _udLandAcres({ land_acres: p.land_acres, land_area: p.land_area, lot_sf: p.lot_sf }),
        year_built: _udNumOrNull(p.year_built),
        year_renovated: _udNumOrNull(p.year_renovated),
        lease_start: l.lease_start || null,
        lease_expiration: l.lease_expiration || null,
        initial_term_years: _udNumOrNull(l.initial_term_years),
        term_remaining_years: _udNumOrNull(l.term_remaining_years),
        annual_rent: _udNumOrNull(l.annual_rent || l.base_annual_rent),
        rent_per_sf: _udNumOrNull(l.rent_psf),
        expense_structure: l.expense_structure || '',
        lease_bump_pct: e.pct != null ? e.pct : null,
        lease_bump_interval_mo: e.intervalMo != null ? e.intervalMo : null,
        bumps_raw: e.raw || '',
        patient_count: _udNumOrNull(p.latest_patient_count || p.total_patients)
      };
    });
  }
  window._udFetchLeaseCompCandidates = _udFetchLeaseCompCandidates;

  // Populate row — Yes/No for USER/OWNER, falls back to raw text on bumps.
  function _udPopulateDataRow(sheet, db, rowIdx, rec, opts) {
    const c = _UD_TPL.cols;
    const isSubject = !!opts?.subject;

    _udSetCell(sheet, rowIdx, c.tenant, rec.tenant || '');
    _udSetCell(sheet, rowIdx, c.operator, rec.operator || '');
    _udSetCell(sheet, rowIdx, c.address, rec.address || '');
    _udSetCell(sheet, rowIdx, c.city, rec.city || '');
    _udSetCell(sheet, rowIdx, c.state, rec.state || '');
    _udSetCell(sheet, rowIdx, c.land, rec.land_acres != null ? rec.land_acres : null);
    _udSetCell(sheet, rowIdx, c.built, rec.year_built != null ? rec.year_built : null);
    _udSetCell(sheet, rowIdx, c.renovated, rec.year_renovated != null ? rec.year_renovated : null);
    _udSetCell(sheet, rowIdx, c.rba, rec.building_sf != null ? rec.building_sf : null);
    _udSetCell(sheet, rowIdx, c.sfLeased, rec.leased_area != null ? rec.leased_area : null);
    _udSetCell(sheet, rowIdx, c.occupancy, rec.occupancy != null ? rec.occupancy : null);
    _udSetCell(sheet, rowIdx, c.rentPsf, rec.rent_per_sf != null ? rec.rent_per_sf : null);
    _udSetCell(sheet, rowIdx, c.currentRent, rec.annual_rent != null ? rec.annual_rent : null);

    const startDate = _udToDateOrNull(rec.lease_start);
    const endDate = _udToDateOrNull(rec.lease_expiration);
    _udSetCell(sheet, rowIdx, c.commence, startDate);
    _udSetCell(sheet, rowIdx, c.exp, endDate);

    const initialTerm = rec.initial_term_years != null
      ? Number(rec.initial_term_years)
      : _udYearsBetweenDates(startDate, endDate);
    _udSetCell(sheet, rowIdx, c.initialTerm, initialTerm);

    let termRem = rec.term_remaining_years != null
      ? Number(rec.term_remaining_years)
      : _udYearsBetweenDates(new Date(), endDate);
    if (termRem != null && termRem < 0) {
      _udSetCell(sheet, rowIdx, c.termRem, 'EXPIRED');
    } else {
      _udSetCell(sheet, rowIdx, c.termRem, termRem);
    }

    _udSetCell(sheet, rowIdx, c.expenses, rec.expense_structure || '');
    // Prefer structured pct/interval when available; fall back to raw text.
    const bumpsLabel = (rec.lease_bump_pct != null || rec.lease_bump_interval_mo != null)
      ? _udFmtBumps(rec.lease_bump_pct, rec.lease_bump_interval_mo)
      : (rec.bumps_raw || '');
    _udSetCell(sheet, rowIdx, c.bumps, bumpsLabel);

    // USER/OWNER: Yes/No based on owner_occupied. Applied to subject AND
    // comps. Subject's owner_occupied is now computed (was hardcoded false
    // in the prior round, which is why U4 leaked the recorded_owner string).
    _udSetCell(sheet, rowIdx, c.userOwner, rec.owner_occupied ? 'Yes' : 'No');

    // PATIENTS column: only write if the regenerated template extended the
    // column map to include `patientCount` (W). The pre-Round-76gn.i
    // template stops at V=DISTANCE.
    if (c.patientCount && rec.patient_count != null) {
      _udSetCell(sheet, rowIdx, c.patientCount, rec.patient_count);
    }

    if (!isSubject) {
      _udSetCell(sheet, rowIdx, c.distance, rec.distance_miles != null ? rec.distance_miles : null);
    }

    // Force left-alignment on TENANT / OPERATOR / ADDRESS — even though the
    // template writes left-aligned, ExcelJS load+save round-trip can flatten
    // alignment to default-center on some clients. Re-stamp explicitly.
    const row = sheet.getRow(rowIdx);
    [c.tenant, c.operator, c.address].forEach(col => {
      const cell = row.getCell(col);
      const cur = cell.alignment || {};
      cell.alignment = Object.assign({}, cur, {
        horizontal: 'left',
        vertical: 'middle',
        indent: 1,
        wrapText: false
      });
    });
  }
  window._udPopulateDataRow = _udPopulateDataRow;

  // Workbook builder override — auto column widths, clear column A counter
  // for unused rows, force fullCalcOnLoad so the AVERAGE row recomputes.
  async function _udBuildLeaseCompsWorkbook(ExcelJS, db, subject, comps) {
    const resp = await fetch(_UD_LEASE_COMPS_TEMPLATE_URL);
    if (!resp.ok) throw new Error(`Template fetch failed: HTTP ${resp.status}`);
    const ab = await resp.arrayBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(ab);
    const sheet = wb.worksheets[0];
    if (!sheet) throw new Error('Template has no worksheets');

    // Force a full recalculation on workbook open so Excel re-evaluates the
    // =IFERROR(AVERAGE(Comps[X])) formulas in the totals row regardless of
    // ExcelJS' cached results.
    if (!wb.calcProperties) wb.calcProperties = {};
    wb.calcProperties.fullCalcOnLoad = true;

    // Subject row.
    _udPopulateDataRow(sheet, db, _UD_TPL.subjectDataRow, subject, { subject: true });

    // Comp rows. Clone styles for rows beyond the templated range.
    const lastDataRow = _UD_TPL.compsFirstDataRow + comps.length - 1;
    const lastTpl = _UD_TPL.compsLastTemplatedRow;
    const lastCol = _UD_TPL.cols.patientCount || _UD_TPL.cols.distance;
    if (lastDataRow > lastTpl) {
      for (let r = lastTpl + 1; r <= lastDataRow; r++) {
        _udCloneRowStyles(sheet, _UD_TPL.compsFirstDataRow, r, lastCol);
        sheet.getRow(r).getCell(_UD_TPL.cols.counter).value = { formula: `A${r - 1}+1` };
      }
    }

    comps.forEach((c, i) => {
      const rowIdx = _UD_TPL.compsFirstDataRow + i;
      _udPopulateDataRow(sheet, db, rowIdx, c, { subject: false });
    });

    // Clear unused pre-styled rows: counter (col A) AND data cells (B..lastCol).
    // The 76gn.h round only blanked B..V, leaving column A's counter formula
    // running up to row 40 (= 33 even when only 25 comps were exported).
    if (comps.length < (lastTpl - _UD_TPL.compsFirstDataRow + 1)) {
      for (let r = _UD_TPL.compsFirstDataRow + comps.length; r <= lastTpl; r++) {
        const row = sheet.getRow(r);
        row.getCell(_UD_TPL.cols.counter).value = null;
        for (let c = _UD_TPL.cols.tenant; c <= lastCol; c++) {
          row.getCell(c).value = null;
        }
      }
    }

    // Auto-fit column widths based on actual data length. Clamps to a sane
    // max so a 70-char operator name doesn't blow out the layout. Preserves
    // a minimum of the template width.
    const TEMPLATE_WIDTHS = {
      1: 3.5, 2: 25, 3: 22, 4: 24, 5: 14, 6: 7, 7: 10, 8: 9, 9: 11, 10: 11,
      11: 12, 12: 11, 13: 11, 14: 14, 15: 11, 16: 11, 17: 13, 18: 13, 19: 13,
      20: 14, 21: 22, 22: 16, 23: 12
    };
    const MAX_WIDTH = 60;
    const dataRows = [_UD_TPL.subjectDataRow]
      .concat(comps.map((_, i) => _UD_TPL.compsFirstDataRow + i));
    for (let col = 1; col <= lastCol; col++) {
      let maxLen = 0;
      for (const r of dataRows) {
        const v = sheet.getRow(r).getCell(col).value;
        if (v == null) continue;
        // Formulas store `{ formula, result }`; measure the result string.
        const display = (typeof v === 'object' && v && 'result' in v) ? v.result : v;
        const text = String(display ?? '');
        if (text.length > maxLen) maxLen = text.length;
      }
      const tplWidth = TEMPLATE_WIDTHS[col] || 12;
      const fittedWidth = Math.min(MAX_WIDTH, Math.max(tplWidth, maxLen + 3));
      sheet.getColumn(col).width = fittedWidth;
    }

    // Generate workbook and trigger browser download.
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const today = new Date().toISOString().slice(0, 10);
    const slug = String(subject.address || subject.property_id || 'subject')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'subject';
    const fname = `LCC_LeaseComps_${db === 'gov' ? 'GOV' : 'DIA'}_${slug}_${today}.xlsx`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  window._udBuildLeaseCompsWorkbook = _udBuildLeaseCompsWorkbook;

  // Export entry point — adds the subject lease fallback fetch.
  async function _udExportLeaseComps(db, propertyId, btn) {
    if (!propertyId) {
      propertyId = _udCache?.property?.property_id || _udCache?.ids?.property_id || null;
    }
    if (!propertyId) {
      showToast('Open a property with a property_id to export lease comps', 'error');
      return;
    }
    const sel = document.getElementById('udLeaseCompsCount');
    const count = Math.max(1, parseInt(sel?.value || String(_UD_LEASE_COMPS_DEFAULT), 10) || _UD_LEASE_COMPS_DEFAULT);

    const subject = _udSubjectFromCache(db);
    if (subject.latitude == null || subject.longitude == null) {
      const qFn = db === 'gov' ? govQuery : diaQuery;
      try {
        const res = await qFn('properties', 'property_id,latitude,longitude,latest_patient_count,total_patients', {
          filter: `property_id=eq.${propertyId}`,
          limit: 1
        });
        const row = (Array.isArray(res) ? res : (res?.data || []))[0] || null;
        if (row) {
          subject.latitude = _udNumOrNull(row.latitude);
          subject.longitude = _udNumOrNull(row.longitude);
          if (subject.patient_count == null) {
            subject.patient_count = _udNumOrNull(row.latest_patient_count || row.total_patients);
          }
        }
      } catch (e) { console.warn('subject coord fetch failed', e); }
    }
    if ((subject.latitude == null || subject.longitude == null) && subject.address) {
      if (btn) btn.textContent = '🌍 Geocoding...';
      const geo = await _udGeocodeSubject(db, subject, propertyId);
      if (geo) {
        subject.latitude = geo.lat;
        subject.longitude = geo.lng;
        showToast('Geocoded subject from address — coords saved to property record', 'success');
      }
    }
    if (subject.latitude == null || subject.longitude == null) {
      showToast(
        'Subject property has no coordinates on file and could not be geocoded from the address — set lat/lng manually before exporting',
        'error'
      );
      return;
    }

    if (subject.lease_expiration == null && subject.annual_rent == null && subject.rent_per_sf == null) {
      const l = await _udFetchSubjectLease(db, propertyId);
      if (l) {
        subject.lease_start = subject.lease_start || l.lease_start || null;
        subject.lease_expiration = subject.lease_expiration || l.lease_expiration || null;
        subject.initial_term_years = subject.initial_term_years || _udNumOrNull(l.initial_term_years);
        subject.term_remaining_years = subject.term_remaining_years || _udNumOrNull(l.term_remaining_years);
        subject.annual_rent = subject.annual_rent || _udNumOrNull(l.annual_rent || l.base_annual_rent);
        subject.rent_per_sf = subject.rent_per_sf || _udNumOrNull(l.rent_psf);
        subject.expense_structure = subject.expense_structure || l.expense_structure || '';
        if (!subject.tenant) {
          const t = _udExtractTenantOperator(db, {}, {}, l);
          if (t.tenant) subject.tenant = t.tenant;
          if (t.operator) subject.operator = t.operator;
        }
      }
    }

    // Pull subject's escalation row so its BUMPS cell renders too.
    if (subject.lease_bump_pct == null && subject.lease_bump_interval_mo == null) {
      const escMap = await _udFetchEscalations(db, [propertyId]);
      const e = escMap.get(propertyId);
      if (e) {
        subject.lease_bump_pct = e.pct;
        subject.lease_bump_interval_mo = e.intervalMo;
        subject.bumps_raw = e.raw || '';
      }
    }

    const origText = btn ? btn.textContent : null;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Building...'; }

    try {
      const [ExcelJS, comps] = await Promise.all([
        _udLoadExcelJs(),
        _udFetchLeaseCompCandidates(db, subject, count)
      ]);
      if (!comps.length) {
        const universe = Number(window._udLastGeocodeUniverseSize || 0);
        const radius = Number(window._udLastGeocodeRadiusMi || 0);
        const msg = universe === 0
          ? `No geocoded properties found within ${radius} mi of the subject — coverage may be too sparse in this area for distance-ranked comps.`
          : 'No comparable properties with coordinates found nearby';
        showToast(msg, 'error');
        return;
      }
      await _udBuildLeaseCompsWorkbook(ExcelJS, db, subject, comps);
      showToast(`Exported ${comps.length} lease comp${comps.length === 1 ? '' : 's'} to Excel`, 'success');
    } catch (err) {
      console.error('Lease comps export error:', err);
      showToast('Lease comps export failed: ' + (err?.message || 'unknown error'), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = origText; }
    }
  }
  window._udExportLeaseComps = _udExportLeaseComps;

  console.info('[lease-comps-fix] Round 76gn.i overrides loaded');
})();
