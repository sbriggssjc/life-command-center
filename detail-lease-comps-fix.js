/* detail-lease-comps-fix.js — Round 76gn.q
 *
 * Hot-patch overrides for the lease-comps export pipeline. Loads after
 * detail.js (see index.html) and reassigns the affected functions in place.
 *
 * Round 76gn.q — addition on top of 76gn.p:
 *   - Header label "RENOVATED" abbreviated to "RENO" in the build-script
 *     template (paired commit). Excel Tables derive column names from
 *     header cell values, so the AVERAGE formula in column I now reads
 *     Comps[RENO] instead of Comps[RENOVATED]. The runtime hot-patch
 *     rewrites Comps[X] structured refs to cell ranges before download
 *     (see _UD_TABLE_COL_MAP below), so its key for column I matches the
 *     new header text. STATE and COMMENCE are also abbreviated (ST, COMM)
 *     in the build script but they aren't in the AVERAGE row, so no
 *     map change needed.
 *
 * Round 76gn.p — addition on top of 76gn.o:
 *   - Auto-fit considers HEADER text length, not just data. Columns like
 *     V (DISTANCE TO SUBJECT, 19-char header) used to be sized only by
 *     the 8-char distance values, which made the header wrap or clip when
 *     Excel rendered it. Now width = max(template, data+3, header+2).
 *   - Header rows 3 (Subject) and 7 (Comps) get explicit row height = 32
 *     and re-stamped `wrapText: true` alignment so multi-word labels wrap
 *     cleanly inside the taller bar instead of being clipped on a single
 *     24-pt line.
 *
 * Round 76gn.o — addition on top of 76gn.n:
 *   - Drop the Comps Excel Table from the output workbook and rewrite the
 *     totals-row Comps[X] structured references to plain cell ranges
 *     (Comps[CURRENT RENT] -> N8:N59, etc.). Reasoning: ExcelJS' table
 *     writer produces a structure that Excel's strict parser rejects
 *     during open, triggering a repair prompt that strips the table —
 *     which in turn breaks every Comps[X] reference in the AVERAGE row.
 *     Removing the table proactively eliminates the repair prompt and
 *     keeps the AVERAGE formulas working (since they no longer depend on
 *     the table existing). No data loss: rows 8-59 are still data,
 *     formulas now use those ranges directly.
 *   - Auto-fit column-width fix: ExcelJS exposes date cell values as raw
 *     Date objects whose toString() is ~50 chars ("Sat Dec 14 2017
 *     00:00:00 GMT-0800 (Pacific Standard Time)"), blowing the COMMENCE /
 *     EXP column widths out to ~60. Treat Date values as their formatted
 *     display length (~7 chars for "mmm-yy") so dates don't dominate
 *     auto-fit sizing.
 *
 * Round 76gn.n — addition on top of 76gn.m:
 *   - Strip <sheetPr> from the ExcelJS writeBuffer output before download.
 *     ExcelJS serializes sheetPr children in the WRONG schema order
 *     (tabColor → pageSetUpPr → outlinePr instead of the spec-mandated
 *     tabColor → outlinePr → pageSetUpPr). Excel's strict OOXML parser
 *     rejects the worksheet with "XML error. Load error. Line 2, column 0",
 *     strips the entire sheet content during repair, and shows a blank
 *     workbook. Removing the sheetPr block entirely is fine — it just
 *     holds optional tab-color and outline metadata, neither of which is
 *     critical for our export. Excel re-applies its own defaults on open.
 *
 * Round 76gn.m — addition on top of 76gn.l:
 *   - Fix ExcelJS "Cannot read properties of undefined (reading 'name')"
 *     during template LOAD (worksheet.js:920, inside Worksheet#model
 *     setter's reduce over tables). Root cause: openpyxl writes
 *     xl/worksheets/_rels/sheet1.xml.rels with absolute Target paths
 *     ("/xl/tables/table1.xml"), but ExcelJS' loader keys its
 *     options.tables dictionary by RELATIVE paths ("../tables/table1.xml"
 *     — see worksheet-xform.js line 522). The lookup misses, the loaded
 *     worksheet model gets `undefined` entries in its tables array, and
 *     the reduce at worksheet.js:920 dies reading `.name` off undefined.
 *
 *     We sanitize the template ArrayBuffer with JSZip before handing it
 *     to ExcelJS: unzip → rewrite the rels paths from absolute to
 *     relative → rezip. This is purely defensive — once the build script
 *     post-processing also lands (paired change in
 *     scripts/build_lease_comps_template.py), freshly regenerated
 *     binaries don't need the runtime fix and this no-ops.
 *
 * Round 76gn.l — addition on top of 76gn.k:
 *   - Defensive header-cell fix for the Subject Excel table. The
 *     regenerated template (Round 76gn.i) defines the Subject table
 *     over B3:W4 but leaves V3 (DISTANCE TO SUBJECT) blank — distance
 *     doesn't apply to the subject row itself. Excel tables require
 *     every header cell to contain a value; openpyxl writes the table
 *     column for V with an auto-generated name, and ExcelJS crashes
 *     during workbook serialization with "Cannot read properties of
 *     undefined (reading 'name')" when it tries to materialize the
 *     empty column's name attribute. We stamp the four expected header
 *     labels (V3, W3, V7, W7) only when they're empty, so a correctly
 *     regenerated template is left alone and a buggy one self-heals
 *     at runtime.
 *
 * Round 76gn.k: AVERAGE bar position fix — clear AND hide every row
 *   between the last comp row and the totals row so the bar slides up
 *   visually.
 * Round 76gn.j: dialysis bbox query filters to chain_canonical IS NOT NULL.
 * Round 76gn.i: operator normalization, lease_escalations fetch, PATIENTS
 * column W, USER/OWNER Yes/No, owner_occupied compute, auto column widths,
 * counter clear on unused rows, fullCalcOnLoad, left-align on tenant/op/addr.
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
    // Skip true_owner when it's an operator-flagged shell (see
    // 20260513_dia_purge_cms_operator_owner_pollution). The deed-holder
    // recorded_owner is the right name for lease-comp exports going to
    // clients — never the chain operator who's the tenant.
    const _trueOwnerOk = own.true_owner && !own.true_owner_is_operator;
    const owner = _udSanitizeOwner(
      (_trueOwnerOk ? own.true_owner : null)
      || own.recorded_owner
      || (!own.true_owner_is_operator ? own.true_owner_name : null)
      || own.recorded_owner_name
      || p.recorded_owner_name
      || ''
    );
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
      true_owner: _udSanitizeOwner(_trueOwnerOk ? (own.true_owner || own.true_owner_name || '') : ''),
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
      // Round 76gn.j: filter dialysis bbox to chain_canonical IS NOT NULL so
      // only dialysis-related properties surface as comps. Migration L+U+O
      // propagation makes chain_canonical reliable on ~99.9% of dialysis
      // properties; non-dialysis neighbors (medical offices, retail, etc.)
      // have NULL chain_canonical and are correctly excluded.
      const bboxClauses = [
        `latitude.gte.${(lat0 - dLat).toFixed(6)}`,
        `latitude.lte.${(lat0 + dLat).toFixed(6)}`,
        `longitude.gte.${(lng0 - dLng).toFixed(6)}`,
        `longitude.lte.${(lng0 + dLng).toFixed(6)}`
      ];
      if (db !== 'gov') {
        bboxClauses.push('chain_canonical.not.is.null');
      }
      const bbox = 'and=(' + bboxClauses.join(',') + ')';
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

  // Round 76gn.m: sanitize package relationships in the template
  // ArrayBuffer before handing it to ExcelJS. openpyxl writes
  // sheet1.xml.rels (and workbook.xml.rels) with ABSOLUTE Target paths
  // ("/xl/tables/table1.xml"), but ExcelJS' loader keys options.tables /
  // options.worksheets by RELATIVE paths ("../tables/table1.xml") — see
  // worksheet-xform.js line 522: `return options.tables[rel.Target];`.
  // The lookup misses, the worksheet model gets `undefined` entries in
  // its tables array, and Worksheet#model's reduce at worksheet.js:920
  // dies reading `.name` off undefined.
  //
  // Fix in-place via JSZip (already loaded globally from index.html):
  //   /xl/tables/...       → ../tables/...
  //   /xl/worksheets/...   → worksheets/...
  //   /xl/...              → ...
  //
  // Best-effort: any JSZip failure falls back to the original buffer,
  // which is no worse than the current state.
  async function _udSanitizeTemplateRels(ab) {
    if (typeof JSZip === 'undefined') return ab;
    try {
      const zip = await JSZip.loadAsync(ab);
      const targets = [
        'xl/worksheets/_rels/sheet1.xml.rels',
        'xl/worksheets/_rels/sheet2.xml.rels',
        'xl/_rels/workbook.xml.rels',
      ];
      let mutated = false;
      for (const path of targets) {
        const f = zip.file(path);
        if (!f) continue;
        const text = await f.async('string');
        const fixed = text
          .replace(/Target="\/xl\/tables\//g, 'Target="../tables/')
          .replace(/Target="\/xl\/worksheets\//g, 'Target="worksheets/')
          .replace(/Target="\/xl\//g, 'Target="');
        if (fixed !== text) {
          zip.file(path, fixed);
          mutated = true;
        }
      }
      if (!mutated) return ab;
      return await zip.generateAsync({ type: 'arraybuffer' });
    } catch (e) {
      console.warn('[lease-comps] template rels sanitize failed, using original buffer', e);
      return ab;
    }
  }
  window._udSanitizeTemplateRels = _udSanitizeTemplateRels;

  // Round 76gn.o: post-process the workbook bytes ExcelJS produces.
  // Two issues to clean up, both rooted in ExcelJS' serializer:
  //
  // 1. <sheetPr> child elements are emitted in wrong OOXML schema order
  //    (tabColor → pageSetUpPr → outlinePr instead of tabColor → outlinePr
  //    → pageSetUpPr). Excel's strict parser rejects out-of-order schema
  //    elements with "XML error. Load error. Line 2, column 0", strips
  //    the sheet during repair, and shows a blank workbook. Removing
  //    sheetPr entirely costs only optional tab-color/outline metadata.
  //
  // 2. The Comps Excel Table's metadata produces a repair prompt on open
  //    ("Removed Feature: AutoFilter / Table from .../table1.xml part"),
  //    which strips the table. The Comps[X] structured references in the
  //    AVERAGE row break once the table is gone, so the totals stay blank.
  //    Pre-emptively dropping the table AND rewriting Comps[X] to plain
  //    cell ranges (Comps[CURRENT RENT] -> N8:N59) sidesteps the prompt
  //    and keeps formulas working.
  //
  // Best-effort: any JSZip failure falls back to the unmodified buffer.
  //
  // The structured-ref keys here must exactly match the Excel Table column
  // names — which derive from the header row cell value in the template.
  // Round 76gn.q: header "RENOVATED" abbreviated to "RENO" in build_lease_
  // comps_template.py, so the map key for column I is "RENO" (was
  // "RENOVATED"). STATE and COMMENCE also abbreviated (ST, COMM) but
  // they're not in the AVERAGE row so no map entry needed.
  const _UD_TABLE_COL_MAP = {
    'LAND': 'G', 'BUILT': 'H', 'RENO': 'I', 'RBA': 'J', 'SF LEASED': 'K',
    'OCCUPANCY': 'L', 'RENT/SF': 'M', 'CURRENT RENT': 'N',
    'INITIAL TERM': 'Q', 'TERM REM': 'R',
    'DISTANCE TO SUBJECT': 'V', 'PATIENTS': 'W'
  };
  function _udEscRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  async function _udSanitizeWorkbookOutput(buf) {
    if (typeof JSZip === 'undefined') return buf;
    try {
      const zip = await JSZip.loadAsync(buf);
      const sheetPath = 'xl/worksheets/sheet1.xml';
      const sheetFile = zip.file(sheetPath);
      if (!sheetFile) return buf;
      let s = await sheetFile.async('string');

      // (1) strip sheetPr
      s = s.replace(/<sheetPr\b[\s\S]*?<\/sheetPr>/g, '')
           .replace(/<sheetPr\b[^/]*\/>/g, '');

      // (2a) rewrite Comps[X] structured refs to cell ranges
      for (const [name, letter] of Object.entries(_UD_TABLE_COL_MAP)) {
        const re = new RegExp('Comps\\[' + _udEscRegex(name) + '\\]', 'g');
        s = s.replace(re, `${letter}8:${letter}59`);
      }

      // (2b) drop the <tableParts> declaration on the sheet
      s = s.replace(/<tableParts\b[\s\S]*?<\/tableParts>/g, '');

      zip.file(sheetPath, s);

      // (2c) delete the table XML files
      const tablesToDrop = Object.keys(zip.files).filter(
        n => /^xl\/tables\/table\d+\.xml$/.test(n)
      );
      tablesToDrop.forEach(n => zip.remove(n));

      // (2d) clean up sheet1's rels (drop table relationships)
      const relsPath = 'xl/worksheets/_rels/sheet1.xml.rels';
      const relsFile = zip.file(relsPath);
      if (relsFile) {
        let r = await relsFile.async('string');
        r = r.replace(/<Relationship\b[^/]*table\d+\.xml[^/]*\/>/g, '');
        zip.file(relsPath, r);
      }

      // (2e) clean up [Content_Types].xml (drop table overrides)
      const ctPath = '[Content_Types].xml';
      const ctFile = zip.file(ctPath);
      if (ctFile) {
        let ct = await ctFile.async('string');
        ct = ct.replace(/<Override\b[^/]*\/xl\/tables\/table\d+\.xml[^/]*\/>/g, '');
        zip.file(ctPath, ct);
      }

      return await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
    } catch (e) {
      console.warn('[lease-comps] workbook output sanitize failed, using original buffer', e);
      return buf;
    }
  }
  window._udSanitizeWorkbookOutput = _udSanitizeWorkbookOutput;

  // Workbook builder override — auto column widths, clear column A counter
  // for unused rows, force fullCalcOnLoad so the AVERAGE row recomputes.
  async function _udBuildLeaseCompsWorkbook(ExcelJS, db, subject, comps) {
    const resp = await fetch(_UD_LEASE_COMPS_TEMPLATE_URL);
    if (!resp.ok) throw new Error(`Template fetch failed: HTTP ${resp.status}`);
    let ab = await resp.arrayBuffer();
    // Round 76gn.m: rewrite absolute-path rels Targets to relative before
    // ExcelJS load — see _udSanitizeTemplateRels above.
    ab = await _udSanitizeTemplateRels(ab);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(ab);
    const sheet = wb.worksheets[0];
    if (!sheet) throw new Error('Template has no worksheets');

    // Round 76gn.l: defensive header-cell fix for the Subject Excel table.
    // The regenerated Round 76gn.i template defines the Subject table over
    // B3:W4 but leaves V3 (DISTANCE TO SUBJECT) blank because distance
    // doesn't apply to the subject row itself. Excel tables require every
    // header cell to contain a value; openpyxl writes the table column for
    // V with an auto-generated name, and ExcelJS crashes during workbook
    // serialization with "Cannot read properties of undefined (reading
    // 'name')" when it tries to materialize the empty column's name.
    //
    // Stamping V3 here only affects the Subject section's header row; V4
    // (the subject data cell) stays blank as intended. Same defense is
    // applied to W3/V7/W7 in case a future template regen leaves any of
    // them empty — only cells that are already empty get stamped, so a
    // correctly-built template is left alone.
    [['V3', 'DISTANCE TO SUBJECT'], ['W3', 'PATIENTS'],
     ['V7', 'DISTANCE TO SUBJECT'], ['W7', 'PATIENTS']].forEach(([addr, label]) => {
      const cell = sheet.getCell(addr);
      if (cell.value == null || cell.value === '') cell.value = label;
    });

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

    // Round 76gn.k: collapse the gap between the last comp row and the
    // AVERAGE row by clearing AND hiding every cell in that range.
    //
    // Two problems addressed in one pass:
    //   (a) Visual gap. The template reserves rows 8-59 for comp data with
    //       the AVERAGE bar fixed at row 60. On a 25-comp export that
    //       leaves 27 visible empty rows between the last data row and the
    //       totals bar — users read it as "the average bar is off".
    //   (b) Spurious counters. Pre-Round-76gn.i cached templates carried
    //       Excel's calculated-column propagation of `=A_+1` all the way
    //       to row 59, so even after writing N<33 comps the gap rows
    //       still rendered "26, 27, ... 52" in column A.
    //
    // Clearing every cell value covers (b) defensively even on a stale
    // cached template; setting row.hidden=true makes the AVERAGE bar slide
    // up to sit immediately below the last comp row visually. SUBTOTAL(101,...)
    // in the totals row ignores hidden rows and AVERAGE(...) ignores blanks,
    // so the formulas still resolve over the visible data only.
    const TOTAL_ROW = _UD_TPL.compsTotalRow || 60;
    for (let r = lastDataRow + 1; r < TOTAL_ROW; r++) {
      const row = sheet.getRow(r);
      for (let c = 1; c <= lastCol; c++) row.getCell(c).value = null;
      row.hidden = true;
    }

    // Auto-fit column widths.
    //
    // Width = max(template min, longest data + 3, longest header + 2).
    //
    // Round 76gn.p: include the HEADER label length in the calc — without
    // this, columns like V (DISTANCE TO SUBJECT, 19-char header but data
    // values of ~8 chars) were sized too narrow, causing the header to
    // wrap-and-clip when Excel rendered it. The +2 padding accounts for the
    // small visual margin Excel adds around bold text in styled headers.
    //
    // Round 76gn.o: explicitly handle Date values. ExcelJS exposes date
    // cells as raw Date objects whose toString() is ~50 chars
    // ("Sat Dec 14 2017 00:00:00 GMT-0800 (Pacific Standard Time)"),
    // which made COMMENCE/EXP columns auto-fit to ~60 wide. The cells
    // actually display as "mmm-yy" (6-7 chars), so use a fixed length.
    const TEMPLATE_WIDTHS = {
      1: 3.5, 2: 25, 3: 22, 4: 24, 5: 14, 6: 7, 7: 10, 8: 9, 9: 11, 10: 11,
      11: 12, 12: 11, 13: 11, 14: 14, 15: 11, 16: 11, 17: 13, 18: 13, 19: 13,
      20: 14, 21: 22, 22: 16, 23: 12
    };
    const DATE_DISPLAY_LEN = 7; // "mmm-yy" plus a margin char
    const MAX_WIDTH = 60;
    const HEADER_ROWS = [3, 7]; // Subject header + Comps header
    const dataRows = [_UD_TPL.subjectDataRow]
      .concat(comps.map((_, i) => _UD_TPL.compsFirstDataRow + i));
    for (let col = 1; col <= lastCol; col++) {
      // Header text length — width must accommodate the longer of the two
      // header rows so the bold label doesn't get clipped or forced-wrap.
      let headerLen = 0;
      for (const r of HEADER_ROWS) {
        const v = sheet.getRow(r).getCell(col).value;
        if (v == null) continue;
        const s = String(v);
        if (s.length > headerLen) headerLen = s.length;
      }
      // Data text length — width must accommodate the longest data cell.
      let maxLen = 0;
      for (const r of dataRows) {
        const v = sheet.getRow(r).getCell(col).value;
        if (v == null) continue;
        let text;
        if (v instanceof Date) {
          text = ' '.repeat(DATE_DISPLAY_LEN);
        } else if (typeof v === 'object' && v && 'result' in v) {
          // Formulas store `{ formula, result }`; measure the result string.
          const display = v.result;
          text = display instanceof Date ? ' '.repeat(DATE_DISPLAY_LEN) : String(display ?? '');
        } else {
          text = String(v);
        }
        if (text.length > maxLen) maxLen = text.length;
      }
      const tplWidth = TEMPLATE_WIDTHS[col] || 12;
      const fittedWidth = Math.min(MAX_WIDTH, Math.max(tplWidth, maxLen + 3, headerLen + 2));
      sheet.getColumn(col).width = fittedWidth;
    }

    // Round 76gn.p: bump header row heights and re-stamp wrap_text so
    // multi-word labels wrap cleanly inside a taller header bar instead of
    // being clipped on a single 24-pt line. (The build-script template
    // sets row 3 and row 7 to 24; ExcelJS preserves that. Increasing here
    // to 32 gives room for two lines of wrapped header text in case any
    // column ends up at the auto-fit minimum and the label still needs
    // to wrap.)
    HEADER_ROWS.forEach(r => {
      const row = sheet.getRow(r);
      row.height = 32;
      for (let col = 1; col <= lastCol; col++) {
        const cell = row.getCell(col);
        if (cell.value == null || cell.value === '') continue;
        const cur = cell.alignment || {};
        cell.alignment = Object.assign({}, cur, {
          horizontal: cur.horizontal || 'center',
          vertical: 'middle',
          wrapText: true
        });
      }
    });

    // Generate workbook and post-process via JSZip to strip ExcelJS'
    // schema-violating sheetPr block AND drop the Comps Excel Table
    // (rewriting its Comps[X] structured refs in the totals row to plain
    // cell ranges so AVERAGE/SUBTOTAL still resolve). See
    // _udSanitizeWorkbookOutput above for the full rationale.
    let buf = await wb.xlsx.writeBuffer();
    buf = await _udSanitizeWorkbookOutput(buf);
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

  console.info('[lease-comps-fix] Round 76gn.q overrides loaded');
})();
