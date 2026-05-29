// ============================================================================
// api/_shared/ingest-contract.js
// ----------------------------------------------------------------------------
// C9 (2026-05-27) — Standard intake contract for curated table writers.
//
// Purpose: define a single set of DTO shapes + validators that every writer
// (sidebar capture, OM extractor, RCM/LoopNet ingest, deed parser, county
// scrapers, manual UI edits) routes through before hitting the database.
//
// What this module gives you today (Phase 1):
//   - JSDoc typedefs declaring the contract for sale / owner / deed records
//   - validateSaleIngest / validateOwnerIngest / validateDeedIngest functions
//     that return { ok: boolean, errors: string[] }
//   - Re-exports of the canonical junk-name + federal-anti-pattern filters
//   - Deterministic helpers: buildDeedDataHash, buildSaleDedupKey
//
// What's deferred to future rounds (Phase 2+):
//   - commitSale / commitOwner / commitDeed orchestrators that run validate
//     → resolve canonical entity (C4) → compute dedup key (C1) → write row
//     → record field_provenance (F3) → return resolved IDs.
//     The orchestrators need careful transactional design; building them
//     before existing writers are migrated risks divergent behavior between
//     "old writer" and "contract path" for the same record type.
//   - Migration of sidebar-pipeline.js, intake-promoter.js, sync.js writers
//     to use the orchestrators. Migrate one writer per round, verify field
//     provenance + completeness scores stay stable, then move to the next.
//
// Why this matters:
//   The plan's symptom-3 ("ownership history not in unison") and the
//   symptom that drove A4b (synthetic deed_records + sale-event stubs)
//   would both have been caught at the writer boundary by a contract
//   like this. Every new writer added without a contract is a new shape
//   to remediate later.
// ============================================================================

import { isJunkContactName, isFederalOwnerAntiPattern } from '../_handlers/sidebar-pipeline.js';

export { isJunkContactName, isFederalOwnerAntiPattern };

// ── Type declarations (JSDoc) ──────────────────────────────────────────────

/**
 * @typedef {Object} SaleIngestDTO
 * @property {'dialysis'|'government'} domain
 * @property {number|string}           property_id        Required. Numeric for dia, uuid for gov.
 * @property {string}                  sale_date          Required ISO date 'YYYY-MM-DD' (NOT NULL on dia per 2026-04-27 CHECK).
 * @property {number|null}             sold_price         Recommended; some writers leave null when it's an ownership stub.
 * @property {string=}                 buyer
 * @property {string=}                 seller
 * @property {string=}                 buyer_name         Alias accepted on dia (writer column name).
 * @property {string=}                 seller_name
 * @property {string=}                 document_number
 * @property {string=}                 deed_type
 * @property {string=}                 transaction_type   e.g. 'Investment' | 'Owner-User' | 'Foreclosure' | 'Land Sale' | 'Portfolio' | '1031 Exchange' | 'Build-to-Suit' | 'Nominal Transfer'
 * @property {string=}                 lender_name
 * @property {string=}                 financing_type     'cmbs' | 'conventional' | (deed-type leak — should not appear)
 * @property {string=}                 notes
 * @property {string=}                 data_source        e.g. 'costar_sidebar' | 'om_extraction' | 'county_records' | 'manual'
 * @property {number=}                 confidence         0..1 (default 0.6 for aggregator quality)
 * @property {Object=}                 raw_payload        Original source object, preserved for audit.
 */

/**
 * @typedef {Object} OwnerIngestDTO
 * @property {'dialysis'|'government'} domain
 * @property {string}                  name               Required. >= 3 chars, must not be junk-name or federal-anti-pattern (unless override flag set).
 * @property {string=}                 normalized_name    Optional; if absent, the canonical resolver will compute it.
 * @property {string=}                 canonical_name     Optional; same as above (gov uses canonical_name, dia uses normalized_name).
 * @property {'recorded_owner'|'true_owner'} kind          Which table this writes to.
 * @property {string=}                 state              2-letter US state code (recommended; helps SF link).
 * @property {boolean=}                allow_federal      Override: write a federal-anti-pattern name (only set when the property genuinely belongs to a federal entity).
 * @property {string=}                 data_source
 * @property {Object=}                 raw_payload
 */

/**
 * @typedef {Object} DeedIngestDTO
 * @property {'dialysis'|'government'} domain
 * @property {number|string=}          property_id        Required on dia (per upsertDialysisDeedRecords guard). Optional on gov.
 * @property {string=}                 parcel_id          Optional on gov; sometimes absent at capture time.
 * @property {string}                  document_number    Required.
 * @property {string}                  state              dia column name.
 * @property {string=}                 state_code         gov column name (preferred for gov).
 * @property {string=}                 county
 * @property {string}                  recording_date     Required ISO date.
 * @property {string=}                 deed_type
 * @property {string=}                 grantor
 * @property {string=}                 grantee
 * @property {number=}                 consideration
 * @property {string=}                 data_hash          If absent, validator computes via buildDeedDataHash().
 * @property {Object=}                 raw_payload
 * @property {string=}                 data_source
 */

// ── Validators ─────────────────────────────────────────────────────────────

/**
 * Validate a SaleIngestDTO. Returns {ok, errors}. Idempotent — safe to call
 * multiple times. Run before any database write.
 *
 * @param {SaleIngestDTO} dto
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateSaleIngest(dto) {
  const errors = [];
  if (!dto || typeof dto !== 'object') {
    return { ok: false, errors: ['DTO is not an object'] };
  }

  if (dto.domain !== 'dialysis' && dto.domain !== 'government') {
    errors.push(`domain must be 'dialysis' or 'government' (got ${JSON.stringify(dto.domain)})`);
  }

  if (dto.property_id == null || dto.property_id === '') {
    errors.push('property_id is required');
  }

  // sale_date is NOT NULL on dia per the 2026-04-27 CHECK constraint.
  if (!dto.sale_date) {
    errors.push('sale_date is required (NOT NULL on dia.sales_transactions)');
  } else if (!_isValidIsoDate(dto.sale_date)) {
    errors.push(`sale_date must be ISO 'YYYY-MM-DD' (got ${JSON.stringify(dto.sale_date)})`);
  } else if (_isFarFuture(dto.sale_date, 90)) {
    // Allow up to 90 days in the future for pre-recorded deeds; further out is almost certainly bad data.
    errors.push(`sale_date is more than 90 days in the future (got ${dto.sale_date}) — likely bad source data`);
  }

  // financing_type should be one of the canonical values, not a deed-type leak.
  // C2 Part A intentionally writes 'cmbs' / 'conventional'. The audit found
  // some legacy rows have 'Quit Claim Deed' etc. in this column — flag.
  if (dto.financing_type != null) {
    const allowed = ['cmbs', 'conventional', 'all_cash', 'seller_financing', 'sba'];
    if (!allowed.includes(String(dto.financing_type).toLowerCase())) {
      errors.push(
        `financing_type ${JSON.stringify(dto.financing_type)} is not one of ` +
        `${JSON.stringify(allowed)} — looks like a deed_type leak (use deed_type column instead)`
      );
    }
  }

  // Buyer/seller names — if present, must not be junk or federal anti-pattern.
  for (const field of ['buyer', 'seller', 'buyer_name', 'seller_name']) {
    const v = dto[field];
    if (v != null && typeof v === 'string' && v.trim()) {
      if (isJunkContactName(v)) {
        errors.push(`${field} is a junk-name pattern: ${JSON.stringify(v)}`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Validate an OwnerIngestDTO.
 * @param {OwnerIngestDTO} dto
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateOwnerIngest(dto) {
  const errors = [];
  if (!dto || typeof dto !== 'object') {
    return { ok: false, errors: ['DTO is not an object'] };
  }

  if (dto.domain !== 'dialysis' && dto.domain !== 'government') {
    errors.push(`domain must be 'dialysis' or 'government'`);
  }

  if (dto.kind !== 'recorded_owner' && dto.kind !== 'true_owner') {
    errors.push(`kind must be 'recorded_owner' or 'true_owner'`);
  }

  if (!dto.name || typeof dto.name !== 'string' || dto.name.trim().length < 3) {
    errors.push('name is required and must be >= 3 chars');
  } else {
    const trimmed = dto.name.trim();
    if (trimmed.length > 200) {
      errors.push(`name is > 200 chars (got ${trimmed.length})`);
    }
    // Junk-name check applies to person-shaped contact names; LLC names with
    // suffixes like "LLC" / "Inc" SHOULD pass through (they're entities, not
    // person-name junk). isJunkContactName has an LLC-suffix filter, so we
    // only apply it when this is a person-likely true_owner without suffix.
    // For simplicity in v1, we skip the isJunkContactName check on owners —
    // applying it would false-positive every LLC. Federal-anti-pattern still
    // applies unless allow_federal is true.
    if (!dto.allow_federal && isFederalOwnerAntiPattern(trimmed)) {
      errors.push(
        `name matches federal-anti-pattern: ${JSON.stringify(trimmed)} — ` +
        `set allow_federal=true only if this property is genuinely federal-owned ` +
        `(per Round 76ek.i, CoStar's personal-property bleed-through often surfaces ` +
        `these on private-LLC properties)`
      );
    }
  }

  if (dto.state != null) {
    const s = String(dto.state).trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(s)) {
      errors.push(`state must be a 2-letter US code (got ${JSON.stringify(dto.state)})`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Validate a DeedIngestDTO.
 * @param {DeedIngestDTO} dto
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateDeedIngest(dto) {
  const errors = [];
  if (!dto || typeof dto !== 'object') {
    return { ok: false, errors: ['DTO is not an object'] };
  }

  if (dto.domain !== 'dialysis' && dto.domain !== 'government') {
    errors.push(`domain must be 'dialysis' or 'government'`);
  }

  if (!dto.document_number || typeof dto.document_number !== 'string') {
    errors.push('document_number is required');
  }

  const stateRaw = dto.domain === 'government' ? (dto.state_code || dto.state) : dto.state;
  if (!stateRaw || !/^[A-Z]{2}$/i.test(String(stateRaw).trim())) {
    errors.push(`state${dto.domain === 'government' ? '_code' : ''} must be a 2-letter US code`);
  }

  if (!dto.recording_date) {
    errors.push('recording_date is required');
  } else if (!_isValidIsoDate(dto.recording_date)) {
    errors.push(`recording_date must be ISO 'YYYY-MM-DD'`);
  }

  // dia requires property_id (per upsertDialysisDeedRecords guard, Round 76ae).
  if (dto.domain === 'dialysis') {
    if (dto.property_id == null || dto.property_id === '') {
      errors.push(
        'dialysis deed_records writes require property_id ' +
        '(per upsertDialysisDeedRecords guard Round 76ae 2026-04-28). ' +
        'If no property_id is available, drop the deed rather than writing an orphan.'
      );
    }
  }

  // Per A4b 2026-05-27 CHECK constraint: dia.deed_records.data_hash must be
  // >= 24 chars. The real writers produce 28-48 char base64 hashes; only
  // synthetic scaffolding produced 16-hex-char hashes. If no data_hash is
  // present, the writer should call buildDeedDataHash() — surface that here.
  if (dto.domain === 'dialysis' && dto.data_hash != null) {
    if (typeof dto.data_hash !== 'string' || dto.data_hash.length < 24) {
      errors.push(
        `dia.deed_records.data_hash must be >= 24 chars per A4b CHECK constraint ` +
        `(got len=${dto.data_hash?.length ?? 'null'}). Use buildDeedDataHash() to compute the canonical hash.`
      );
    }
  }

  // Grantor/grantee shape check
  for (const field of ['grantor', 'grantee']) {
    const v = dto[field];
    if (v != null && typeof v === 'string' && v.trim()) {
      if (isFederalOwnerAntiPattern(v)) {
        errors.push(
          `${field}=${JSON.stringify(v)} matches federal anti-pattern. ` +
          `Likely CoStar personal-property bleed-through — verify this is a real federal deed before ingesting.`
        );
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

// ── Deterministic helpers ──────────────────────────────────────────────────

/**
 * Build the canonical dia/gov deed_records.data_hash matching the existing
 * upsertDialysisDeedRecords / upsertGovernmentDeedRecords writer pattern:
 *
 *   base64(`${document_number}|${state}|${recording_date}`)
 *
 * Length is always >= 24 for any realistic input, satisfying the
 * dia.deed_records.chk_deed_records_data_hash_min_len CHECK (A4b 2026-05-27).
 *
 * @param {string} documentNumber
 * @param {string} state
 * @param {string} recordingDate ISO 'YYYY-MM-DD'
 * @returns {string}
 */
export function buildDeedDataHash(documentNumber, state, recordingDate) {
  const raw = `${documentNumber || ''}|${state || ''}|${recordingDate || ''}`;
  return Buffer.from(raw).toString('base64');
}

/**
 * Build a deterministic sale-row dedup key matching C1's existing pattern:
 *
 *   sha-shape: property_id|date|round-cent-price
 *
 * Used by C1's 409-recovery path in upsertDomainSales. Centralized here so
 * future writers (and tests) compute the same key.
 *
 * @param {number|string} propertyId
 * @param {string} saleDate ISO date
 * @param {number|null} soldPrice
 * @returns {string}
 */
export function buildSaleDedupKey(propertyId, saleDate, soldPrice) {
  const price = soldPrice == null ? '' : Math.round(Number(soldPrice));
  return `${propertyId}|${saleDate}|${price}`;
}

// ── Internal helpers ───────────────────────────────────────────────────────

function _isValidIsoDate(s) {
  if (typeof s !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime());
}

function _isFarFuture(isoDate, allowedDaysAhead) {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return false;
  const horizon = Date.now() + allowedDaysAhead * 24 * 60 * 60 * 1000;
  return d.getTime() > horizon;
}
