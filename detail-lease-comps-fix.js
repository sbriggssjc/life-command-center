/* detail-lease-comps-fix.js — Round 76gn.h
 *
 * Hot-patch overrides for the lease-comps export pipeline. PR #707 merged the
 * builder-script + a git-format-patch but neither was applied to detail.js, so
 * the deploy is still running the buggy original. This file gets loaded after
 * detail.js (see index.html) and reassigns the affected functions in place.
 *
 * Once the proper patch is applied to detail.js itself (run
 * `git apply scripts/lease-comps-detail-js.patch && python scripts/build_lease_comps_template.py`),
 * delete this file and the corresponding <script> tag from index.html.
 *
 * Functions overridden / added:
 *   _udExtractTenantOperator   — read actual v_lease_detail / properties field names
 *   _udSubjectFromCache        — same, plus subject.owner convenience field
 *   _udFetchSubjectLease (NEW) — best-effort subject lease pull on Export click
 *   _udSanitizeOwner    (NEW)  — strip ®/™, collapse whitespace
 *   _udFetchLeaseCompCandidates — bbox-stage projection now includes
 *                                tenant/operator/chain_canonical/year_built/
 *                                year_renovated; lat/lng dedupe; uses rent_psf
 *                                + lease_start + lease_expiration field names
 *   _udPopulateDataRow         — uses pre-computed term years; renders
 *                                already-expired leases as the literal string
 *                                "EXPIRED" via a guard rather than a negative
 *   _udExportLeaseComps        — adds subject lease fallback fetch
 */
(function () {
  'use strict';

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

  // Tenant / operator resolver — actual v_lease_detail + properties names.
  function _udExtractTenantOperator(db, rec, fb, lease) {
    rec = rec || {}; fb = fb || {}; lease = lease || {};
    if (db === 'gov') {
      const tenant = rec.agency_short || rec.agency || fb.tenant_agency
                  || fb.agency || lease.tenant || lease.tenant_name || '';
      const operator = rec.agency_full || rec.agency || fb.agency_full
                    || lease.operator || tenant || '';
      return { tenant, operator };
    }
    // Dialysis: chain vs local operator. v_lease_detail is authoritative;
    // fall back to the properties row's tenant/operator/chain_canonical
    // (which the bbox stage now projects).
    const chain = lease.tenant || rec.chain_canonical || rec.tenant
               || fb.chain_organization || fb.chain_canonical || '';
    const local = lease.operator || rec.operator || fb.operator_name
               || fb.facility_name || '';
    return {
      tenant: chain || local || '',
      operator: local || chain || ''
    };
  }
  window._udExtractTenantOperator = _udExtractTenantOperator;

  // Subject builder — picks up the convenience `owner` field and uses the
  // sanitizer / pre-computed lease term years from v_lease_detail.
  function _udSubjectFromCache(db) {
    const c = (typeof _udCache !== 'undefined' && _udCache) ? _udCache : {};
    const p = c.property || {};
    const fb = c.fallback || {};
    const own = c.ownership || {};
    const lease = (c.leases && c.leases[0]) || {};
    const buildingSf = _udNumOrNull(p.building_sf || p.building_size || p.rba || fb.building_sf);
    const leasedArea = _udNumOrNull(lease.leased_area || p.leased_area) || buildingSf;
    const { tenant, operator } = _udExtractTenantOperator(db || c.db, p, fb, lease);
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
      recorded_owner: _udSanitizeOwner(own.recorded_owner || own.recorded_owner_name || p.recorded_owner_name || ''),
      true_owner: _udSanitizeOwner(own.true_owner || own.true_owner_name || ''),
      owner: _udSanitizeOwner(own.true_owner || own.recorded_owner || own.true_owner_name || own.recorded_owner_name || p.recorded_owner_name || ''),
      owner_occupied: false
    };
  }
  window._udSubjectFromCache = _udSubjectFromCache;

  // Subject lease fallback — pulls v_lease_detail directly when the cache
  // doesn't have it. Best-effort: any failure returns null and the export
  // proceeds without the lease fields populated.
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

  // Comp candidate fetcher — bbox-stage projection now carries
  // tenant/operator/chain_canonical/year_built/year_renovated. Lat/lng dedupe
  // collapses suite-number duplicates. Comp record builder uses correct
  // v_lease_detail field names.
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
        : 'property_id,latitude,longitude,tenant,operator,chain_canonical,year_built,year_renovated';
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

    // Distance-rank, drop subject, dedupe by ~1 m lat/lng, slice.
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

    const [propRes, leaseRes, ownRes] = await Promise.allSettled([
      qFn('v_property_detail', '*', { filter: `property_id=in.(${inList})`, limit: ids.length }),
      qFn('v_lease_detail', '*',     { filter: `property_id=in.(${inList})`, limit: ids.length * 5 }),
      qFn('v_ownership_current', '*',{ filter: `property_id=in.(${inList})`, limit: ids.length * 2 })
    ]);
    const propDetails = propRes.status === 'fulfilled'
      ? (Array.isArray(propRes.value) ? propRes.value : (propRes.value?.data || []))
      : [];
    const leases = leaseRes.status === 'fulfilled'
      ? (Array.isArray(leaseRes.value) ? leaseRes.value : (leaseRes.value?.data || []))
      : [];
    const owners = ownRes.status === 'fulfilled'
      ? (Array.isArray(ownRes.value) ? ownRes.value : (ownRes.value?.data || []))
      : [];

    const propByPid = new Map();
    for (const row of propDetails) {
      if (row?.property_id && !propByPid.has(row.property_id)) propByPid.set(row.property_id, row);
    }

    // Index leases per pid, preferring the active term (or latest expiration).
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
        lease_bump_pct: null,
        lease_bump_interval_mo: null
      };
    });
  }
  window._udFetchLeaseCompCandidates = _udFetchLeaseCompCandidates;

  // Populate row — uses pre-computed term years; renders already-expired
  // leases as the literal "EXPIRED" string. The deployed XLSX template still
  // uses `0.0" Years"` (not the new conditional format), so we render EXPIRED
  // explicitly here as a string write rather than relying on number-format
  // sections.
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

    // EXPIRED rendering — write the string "EXPIRED" rather than a negative
    // number when the lease has already expired. The deployed template's
    // R-column number format is plain `0.0" Years"` (no conditional EXPIRED
    // section), so we have to handle this on the JS side. Strings override
    // the column's number format, which is what we want.
    let termRem = rec.term_remaining_years != null
      ? Number(rec.term_remaining_years)
      : _udYearsBetweenDates(new Date(), endDate);
    if (termRem != null && termRem < 0) {
      _udSetCell(sheet, rowIdx, c.termRem, 'EXPIRED');
    } else {
      _udSetCell(sheet, rowIdx, c.termRem, termRem);
    }

    _udSetCell(sheet, rowIdx, c.expenses, rec.expense_structure || '');
    _udSetCell(sheet, rowIdx, c.bumps, _udFmtBumps(rec.lease_bump_pct, rec.lease_bump_interval_mo));

    // USER/OWNER on subject + comps; DISTANCE only on comps.
    const userOwnerLabel = rec.owner_occupied
      ? (rec.owner ? `User (${rec.owner})` : 'User')
      : _udSanitizeOwner(rec.owner || '');
    _udSetCell(sheet, rowIdx, c.userOwner, userOwnerLabel);
    if (!isSubject) {
      _udSetCell(sheet, rowIdx, c.distance, rec.distance_miles != null ? rec.distance_miles : null);
    }
  }
  window._udPopulateDataRow = _udPopulateDataRow;

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
        const res = await qFn('properties', 'property_id,latitude,longitude', {
          filter: `property_id=eq.${propertyId}`,
          limit: 1
        });
        const row = (Array.isArray(res) ? res : (res?.data || []))[0] || null;
        if (row) {
          subject.latitude = _udNumOrNull(row.latitude);
          subject.longitude = _udNumOrNull(row.longitude);
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

    // Subject lease fallback.
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

  console.info('[lease-comps-fix] Round 76gn.h overrides loaded');
})();
