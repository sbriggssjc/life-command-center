/* ============================================================================
 * DRAFT — NOT YET APPLIED TO api/operations.js
 * ----------------------------------------------------------------------------
 * Two new POST sub-routes for the Property Intelligence Flow, Phase 8
 * (Prospecting Convergence):
 *
 *   action=create_lead       — turn a property + resolved owner into a tracked
 *                               lead, seed/attach a canonical entity, and open
 *                               a bd_opportunity.
 *   action=initiate_cadence  — place an owner entity into the BD cadence at the
 *                               onboarding phase (the existing cadence /
 *                               advance_cadence actions only read/advance an
 *                               EXISTING cadence; creation from the property
 *                               flow was the missing piece).
 *
 * Conventions matched against the existing bridge handlers in operations.js
 * (bridgeSaveOwnership, bridgeLogCall, bridgeCompleteResearch) and the shared
 * helpers as they exist on 2026-05-30:
 *   - opsQuery(method, path, body, opts)            ./_shared/ops-db.js
 *   - ensureEntityLink({...}) -> { ok, entityId, entity, createdEntity }
 *                                                    ./_shared/entity-link.js
 *   - getCadenceState(ids, propertyInfo)            ./_shared/cadence-engine.js
 *   - pgFilterVal, sendTeamsAlert already imported in operations.js
 *
 * Vercel function-count note: these are SUB-ROUTES on the existing
 * operations.js function — NO new file ships to /api. This draft file lives in
 * /audit and is for review only.
 * ========================================================================== */

/* ----------------------------------------------------------------------------
 * STEP 1 — Dispatch wiring
 * Add these two cases to the POST switch in the main handler (operations.js
 * ~line 249, alongside the other bridge actions), and extend the default-case
 * error string so the route list stays accurate.
 * -------------------------------------------------------------------------- */
//
//      case 'create_lead':        return await bridgeCreateLead(req, res, user, workspaceId);
//      case 'initiate_cadence':   return await bridgeInitiateCadence(req, res, user, workspaceId);
//
// And in the default branch error message, append:
//   "create_lead, initiate_cadence" to the Bridge list.


/* ----------------------------------------------------------------------------
 * STEP 2 — Small shared helper: write a row to a domain DB (gov/dia).
 *
 * LCC writes its own tables through opsQuery(), but prospect_leads (gov) and
 * marketing_leads (dia) live on the DOMAIN databases, which other handlers
 * reach by a direct PostgREST fetch (see operations.js fetchPortfolioStats /
 * fetchOpsContext for the same GOV_URL/DIA_URL + key pattern). Both tables are
 * already in _shared/allowlist.js, so this is a sanctioned write surface.
 *
 * diaSupabaseKey / govSupabaseKey are already imported at the top of
 * operations.js (line 79).
 * -------------------------------------------------------------------------- */

async function domainInsert(domain, table, row) {
  const isGov = domain === 'gov' || domain === 'government';
  const baseUrl = isGov ? process.env.GOV_SUPABASE_URL : process.env.DIA_SUPABASE_URL;
  const key = isGov ? govSupabaseKey() : diaSupabaseKey();
  if (!baseUrl || !key) {
    return { ok: false, status: 503, error: `${isGov ? 'GOV' : 'DIA'} database not configured` };
  }
  try {
    const resp = await fetch(`${baseUrl}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(8000),
    });
    const text = await resp.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!resp.ok) return { ok: false, status: resp.status, error: 'Domain insert failed', detail: data };
    return { ok: true, data: Array.isArray(data) ? data[0] : data };
  } catch (err) {
    return { ok: false, status: 500, error: 'Domain insert threw', detail: err.message };
  }
}


/* ----------------------------------------------------------------------------
 * STEP 3 — Handler: create_lead
 *
 * Request body:
 *   {
 *     domain:        'gov' | 'dia'                (required)
 *     property_id:   number | string             (required — the domain PK)
 *     entity_id?:    uuid                         (LCC entity if already resolved)
 *     owner_name?:   string                       (recorded or true owner display)
 *     true_owner_name?: string
 *     owner_role?:   string                       ('developer' | 'reit' | ...)
 *     label?:        string                       (property address for display)
 *     property_address?: string
 *     contact_id?:   uuid                         (if a person is already known)
 *     source?:       string                       (defaults 'property_flow')
 *     notes?:        string
 *   }
 *
 * Response: { ok, lead_id, entity_id, bd_opportunity_id, created_entity }
 *
 * Behavior:
 *   1. Resolve/create the canonical LCC entity for the owner (ensureEntityLink),
 *      using the domain property as the external identity so the lead is
 *      anchored to the asset that produced it.
 *   2. Insert a row into the domain lead table (prospect_leads on gov,
 *      marketing_leads on dia) with matched_property_id set.
 *   3. Open a bd_opportunity on LCC for the entity (omit is_open — it is a
 *      GENERATED column; see CLAUDE.md gotcha).
 *   4. Log a canonical activity_event so the lead shows in the timeline.
 *   5. Best-effort Teams alert; never fail the caller on alert error.
 * -------------------------------------------------------------------------- */

async function bridgeCreateLead(req, res, user, workspaceId) {
  const {
    domain, property_id, entity_id, owner_name, true_owner_name,
    owner_role, label, property_address, contact_id,
    source, notes,
  } = req.body || {};

  if (!domain || (domain !== 'gov' && domain !== 'dia' && domain !== 'government' && domain !== 'dialysis')) {
    return res.status(400).json({ error: "domain is required ('gov' or 'dia')" });
  }
  if (!property_id) {
    return res.status(400).json({ error: 'property_id is required' });
  }

  const normDomain = (domain === 'government') ? 'gov' : (domain === 'dialysis') ? 'dia' : domain;
  const leadSource = source || 'property_flow';
  const ownerDisplay = true_owner_name || owner_name || label || `Property ${property_id}`;

  // --- 1. Resolve/create the canonical owner entity, anchored to the asset ---
  let resolvedEntityId = entity_id || null;
  let createdEntity = false;
  if (!resolvedEntityId) {
    const link = await ensureEntityLink({
      workspaceId, userId: user.id,
      sourceSystem: normDomain,                 // 'gov' | 'dia'
      sourceType: 'asset',
      externalId: String(property_id),
      domain: normDomain,
      seedFields: {
        name: ownerDisplay,
        org_type: 'owner',
        owner_role: owner_role || null,
        address: property_address || null,
      },
    });
    if (!link.ok) {
      return res.status(link.status || 500).json({ error: link.error || 'Entity link failed', detail: link.detail });
    }
    resolvedEntityId = link.entityId;
    createdEntity = !!link.createdEntity;
  }

  // --- 2. Insert the domain lead row -----------------------------------------
  // prospect_leads (gov) and marketing_leads (dia) have different shapes; build
  // the row per domain. Only columns confirmed present in the live schema sweep
  // are written; everything else is left to defaults.
  let leadRow, leadTable;
  if (normDomain === 'gov') {
    leadTable = 'prospect_leads';
    leadRow = {
      lead_source: leadSource,
      matched_property_id: property_id,
      address: property_address || label || null,
      recorded_owner: owner_name || null,
      true_owner: true_owner_name || null,
      owner_type: owner_role || null,
      pipeline_status: 'new',
      research_status: 'pending',
      research_notes: notes || null,
    };
  } else {
    leadTable = 'marketing_leads';
    leadRow = {
      source: leadSource,
      lead_name: ownerDisplay,
      lead_company: owner_name || true_owner_name || null,   // confirmed col name (NOT `company`)
      property_address: property_address || label || null,
      status: 'new',
      priority: 'normal',                                    // table convention/default (no CHECK)
      notes: notes || null,
    };
    // lead_id auto-generates (gen_random_uuid default) — do NOT supply.
  }
  const leadResult = await domainInsert(normDomain, leadTable, leadRow);
  if (!leadResult.ok) {
    return res.status(leadResult.status || 500).json({ error: leadResult.error, detail: leadResult.detail });
  }
  const leadId = leadResult.data?.lead_id || leadResult.data?.id || null;

  // --- 3. Open a BD opportunity on LCC (is_open is GENERATED — omit it) -------
  let bdOpportunityId = null;
  const oppResult = await opsQuery('POST', 'bd_opportunities', {
    workspace_id: workspaceId,
    entity_id: resolvedEntityId,
    type: 'prospect',
    stage: 'identified',
    vertical: normDomain,
    owner_user_id: user.id,
    opened_at: new Date().toISOString(),
    metadata: {
      origin: 'property_flow',
      source_domain: normDomain,
      source_property_id: String(property_id),
      lead_id: leadId,
    },
  });
  if (oppResult.ok) {
    const opp = Array.isArray(oppResult.data) ? oppResult.data[0] : oppResult.data;
    bdOpportunityId = opp?.id || null;
  } else {
    // Non-fatal: lead is created; opportunity can be opened later. Log and continue.
    console.warn('[create_lead] bd_opportunity insert failed (non-fatal):', oppResult.data);
  }

  // --- 4. Canonical activity for the timeline --------------------------------
  await opsQuery('POST', 'activity_events', {
    workspace_id: workspaceId, actor_id: user.id,
    category: 'status_change',
    title: `Lead created from property: ${ownerDisplay}`,
    body: notes || null,
    entity_id: resolvedEntityId,
    source_type: 'system', domain: normDomain,
    visibility: 'shared',
    metadata: {
      bridge_source: 'create_lead',
      lead_id: leadId,
      bd_opportunity_id: bdOpportunityId,
      source_property_id: String(property_id),
    },
    occurred_at: new Date().toISOString(),
  });

  // --- 5. Best-effort Teams alert --------------------------------------------
  sendTeamsAlert({
    title: 'New BD Lead Created',
    summary: ownerDisplay,
    severity: 'success',
    facts: [
      ['Owner', ownerDisplay],
      ['Property', property_address || label || String(property_id)],
      ['Vertical', normDomain],
      ['Next action', 'Add to cadence / begin outreach'],
    ],
    actions: [{ label: 'View in LCC', url: `${process.env.LCC_BASE_URL || ''}/${normDomain}` }],
  }).catch(() => {});

  return res.status(201).json({
    ok: true,
    lead_id: leadId,
    entity_id: resolvedEntityId,
    bd_opportunity_id: bdOpportunityId,
    created_entity: createdEntity,
  });
}


/* ----------------------------------------------------------------------------
 * STEP 4 — Handler: initiate_cadence
 *
 * Request body:
 *   {
 *     entity_id?:        uuid        (preferred handle)
 *     contact_id?:       uuid
 *     sf_contact_id?:    string
 *     property_id?:      number|string
 *     property_address?: string
 *     domain?:           'gov' | 'dia'
 *     phase?:            string      (defaults 'onboarding')
 *     priority_tier?:    'A'|'B'|'C' (defaults 'B')
 *   }
 *   At least one of entity_id / contact_id / sf_contact_id is required.
 *
 * Response: { ok, cadence_id, next_touch_due, is_new }
 *
 * Behavior:
 *   getCadenceState() already creates a touchpoint_cadence row when none
 *   exists (phase 'prospecting'). This handler is a thin, intentional wrapper:
 *   it guarantees a cadence exists for the entity and, when the caller asks for
 *   the onboarding phase, patches phase/priority on the freshly-created row so
 *   the BD onboarding cadence (lcc_seed_onboarding_cadence, per CLAUDE.md) is
 *   the starting point rather than the generic prospecting default.
 * -------------------------------------------------------------------------- */

async function bridgeInitiateCadence(req, res, user, workspaceId) {
  const {
    entity_id, contact_id, sf_contact_id,
    property_id, property_address, domain,
    phase, priority_tier,
  } = req.body || {};

  if (!entity_id && !contact_id && !sf_contact_id) {
    return res.status(400).json({ error: 'At least one of entity_id, contact_id, sf_contact_id is required' });
  }

  // getCadenceState creates the row if it doesn't exist yet.
  const state = await getCadenceState(
    { entity_id, contact_id, sf_contact_id },
    { property_id, property_address, domain }
  );
  if (!state.ok) {
    return res.status(state.status || 500).json({ error: state.error || 'Failed to initialize cadence', detail: state.detail });
  }

  const cadence = state.cadence;
  const wantPhase = phase || 'onboarding';
  const wantTier = priority_tier || cadence.priority_tier || 'B';

  // If newly created (or phase/tier differ), patch the row to the requested
  // onboarding posture. Non-fatal if the patch fails — the cadence still exists.
  if (state.is_new || cadence.phase !== wantPhase || cadence.priority_tier !== wantTier) {
    const patch = await opsQuery(
      'PATCH',
      `touchpoint_cadence?id=eq.${pgFilterVal(cadence.id)}`,
      { phase: wantPhase, priority_tier: wantTier }
    );
    if (patch.ok && Array.isArray(patch.data) && patch.data[0]) {
      Object.assign(cadence, patch.data[0]);
    } else {
      console.warn('[initiate_cadence] phase/tier patch failed (non-fatal):', patch.data);
    }
  }

  // Timeline activity so the cadence start is visible.
  await opsQuery('POST', 'activity_events', {
    workspace_id: workspaceId, actor_id: user.id,
    category: 'status_change',
    title: `Added to ${wantPhase} cadence`,
    entity_id: entity_id || cadence.entity_id || null,
    source_type: 'system', domain: domain || cadence.domain || null,
    visibility: 'shared',
    metadata: {
      bridge_source: 'initiate_cadence',
      cadence_id: cadence.id,
      phase: wantPhase,
      priority_tier: wantTier,
      source_property_id: property_id ? String(property_id) : null,
    },
    occurred_at: new Date().toISOString(),
  });

  return res.status(201).json({
    ok: true,
    cadence_id: cadence.id,
    next_touch_due: cadence.next_touch_due || null,
    is_new: !!state.is_new,
  });
}


/* ----------------------------------------------------------------------------
 * REVIEW NOTES / OPEN QUESTIONS for whoever applies this
 * ----------------------------------------------------------------------------
 * 1. SCHEMA — CONFIRMED against the live DBs on 2026-05-30 (read-only sweep):
 *    - prospect_leads (gov): only NOT-NULL-no-default column is `lead_source`;
 *      lead_id auto-generates (uuid_generate_v4). matched_property_id is
 *      BIGINT (pass the numeric property_id, not a uuid). No CHECK on
 *      pipeline_status / research_status, so 'new'/'pending' are accepted.
 *      -> create_lead gov row is VALID as written.
 *    - marketing_leads (dia): the owner-company column is `lead_company`,
 *      NOT `company` (FIXED above — `company` would have errored). lead_id
 *      auto-generates (gen_random_uuid) — do NOT supply. priority default is
 *      'normal' (no CHECK); changed 'medium' -> 'normal' to match convention.
 *      No mandatory columns. -> dia row is VALID as written.
 *
 * 2. bd_opportunities (LCC) — CONFIRMED: id auto-generates; `is_open` is the
 *    only GENERATED column (= closed_at IS NULL) — never INSERT it (we don't).
 *    The ONLY CHECK is on `type` IN ('prospect','buyer','other'); 'prospect'
 *    passes. `stage` is UNCONSTRAINED and the table is currently empty, so
 *    'identified' is accepted but sets the convention — fine, or swap to a
 *    preferred label. No NOT-NULL-no-default columns. -> VALID as written.
 *
 * 2b. touchpoint_cadence (LCC) — CONFIRMED: phase CHECK allows
 *    {prospecting, onboarding, steady_state, maintenance, paused, dormant,
 *    converted, unsubscribed} and priority_tier CHECK allows {A,B,C,D}. So
 *    initiate_cadence's phase:'onboarding' + priority_tier:'B' are VALID.
 *
 * 3. DEAD WORKER dependency: create_lead/initiate_cadence make resolved owners
 *    actionable, but the llc-research-tick worker that drains llc_research_queue
 *    is currently dead (1,968 rows, 0 completed, 8+ days). Restart it (or the
 *    free SOS-direct scraper) so the upstream "resolve owner" step actually
 *    completes -- otherwise these handlers create leads for owners that never
 *    get de-anonymized. Tracked in the Phase 4+8 component spec, section 2.4.
 *
 * 4. AUTH: both handlers run inside the existing POST branch, which already
 *    enforces requireRole(user, 'operator', workspaceId) at line 227.
 *
 * 5. IDEMPOTENCY: create_lead does not dedupe -- calling twice for the same
 *    property creates two leads. Consider a pre-check or upsert on
 *    (matched_property_id, lead_source) for prospect_leads if double-submit
 *    from the UI is a concern.
 *
 * 6. vercel.json: no rewrite change needed -- /api/operations already routes
 *    here; the new behavior is selected by ?action=create_lead /
 *    ?action=initiate_cadence on the existing function.
 * -------------------------------------------------------------------------- */

export { bridgeCreateLead, bridgeInitiateCadence, domainInsert };
