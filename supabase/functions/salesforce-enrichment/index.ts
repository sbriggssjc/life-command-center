import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function getClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
  );
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface StepResult {
  step: string;
  affected: number;
  detail?: string;
}

// ─── Step 1: Bridge SF contacts → contacts table ──────────────────────────
// Creates contacts records for SF contacts that don't yet exist in the
// contacts table, linking via sf_contact_id. Also enriches with account info.
async function bridgeSFContactsToContacts(db: ReturnType<typeof getClient>): Promise<StepResult> {
  const { data } = await db.rpc("exec_sql", {
    query: `
      WITH new_contacts AS (
        INSERT INTO contacts (contact_name, contact_email, contact_phone, company, sf_contact_id, created_at, updated_at)
        SELECT
          TRIM(COALESCE(sc.first_name, '') || ' ' || COALESCE(sc.last_name, '')),
          sc.email,
          sc.phone,
          sa.name,
          sc.sf_contact_id,
          now(),
          now()
        FROM salesforce_contacts sc
        LEFT JOIN salesforce_accounts sa ON sc.sf_account_id = sa.sf_account_id
        WHERE NOT EXISTS (
          SELECT 1 FROM contacts c WHERE c.sf_contact_id = sc.sf_contact_id
        )
        AND (sc.first_name IS NOT NULL OR sc.last_name IS NOT NULL)
        RETURNING contact_id
      )
      SELECT count(*) as cnt FROM new_contacts
    `,
  }).single();
  return { step: "bridge_sf_contacts_to_contacts", affected: parseInt(data?.cnt || "0") };
}

// ─── Step 2: Sync contact fields from SF contacts → existing contacts ─────
// Updates email, phone, company on existing contacts that already have
// sf_contact_id but are missing those fields.
async function syncContactFieldsFromSF(db: ReturnType<typeof getClient>): Promise<StepResult> {
  const { data } = await db.rpc("exec_sql", {
    query: `
      WITH updated AS (
        UPDATE contacts c
        SET
          contact_email = COALESCE(c.contact_email, sc.email),
          contact_phone = COALESCE(c.contact_phone, sc.phone),
          company = COALESCE(c.company, sa.name),
          contact_name = CASE
            WHEN c.contact_name IS NULL OR c.contact_name = '' OR c.contact_name = ' '
            THEN TRIM(COALESCE(sc.first_name, '') || ' ' || COALESCE(sc.last_name, ''))
            ELSE c.contact_name
          END,
          contact_fields_synced_at = now(),
          updated_at = now()
        FROM salesforce_contacts sc
        LEFT JOIN salesforce_accounts sa ON sc.sf_account_id = sa.sf_account_id
        WHERE c.sf_contact_id = sc.sf_contact_id
          AND (
            c.contact_email IS NULL
            OR c.contact_phone IS NULL
            OR c.company IS NULL
            OR c.contact_name IS NULL OR c.contact_name = '' OR c.contact_name = ' '
          )
        RETURNING c.contact_id
      )
      SELECT count(*) as cnt FROM updated
    `,
  }).single();
  return { step: "sync_contact_fields_from_sf", affected: parseInt(data?.cnt || "0") };
}

// ─── Step 3: Link SF accounts → true_owners by name matching ──────────────
// Matches salesforce_accounts to true_owners by normalized name, then writes
// sf_company_id onto true_owners and salesforce_id for cross-referencing.
async function linkAccountsToTrueOwners(db: ReturnType<typeof getClient>): Promise<StepResult> {
  const { data } = await db.rpc("exec_sql", {
    query: `
      WITH matched AS (
        UPDATE true_owners t
        SET
          sf_company_id = sa.sf_account_id,
          salesforce_id = sa.sf_account_id,
          city = COALESCE(t.city, sa.billing_city),
          state = COALESCE(t.state, sa.billing_state),
          updated_at = now()
        FROM salesforce_accounts sa
        WHERE (t.sf_company_id IS NULL OR t.sf_company_id = '')
          AND lower(trim(t.name)) = lower(trim(sa.name))
        RETURNING t.true_owner_id
      )
      SELECT count(*) as cnt FROM matched
    `,
  }).single();
  return { step: "link_accounts_to_true_owners_by_name", affected: parseInt(data?.cnt || "0") };
}

// ─── Step 4: Link activities → true_owners (multi-strategy) ───────────────
// Pass A: by sf_company_id direct match
// Pass B: by company_name fuzzy match
async function linkActivitiesToTrueOwners(db: ReturnType<typeof getClient>): Promise<StepResult> {
  // Pass A: sf_company_id match
  const { data: passA } = await db.rpc("exec_sql", {
    query: `
      WITH linked AS (
        UPDATE salesforce_activities sa
        SET true_owner_id = t.true_owner_id
        FROM true_owners t
        WHERE sa.true_owner_id IS NULL
          AND sa.sf_company_id IS NOT NULL
          AND sa.sf_company_id = t.sf_company_id
        RETURNING sa.activity_id
      )
      SELECT count(*) as cnt FROM linked
    `,
  }).single();
  const countA = parseInt(passA?.cnt || "0");

  // Pass B: company_name match
  const { data: passB } = await db.rpc("exec_sql", {
    query: `
      WITH linked AS (
        UPDATE salesforce_activities sa
        SET true_owner_id = t.true_owner_id
        FROM true_owners t
        WHERE sa.true_owner_id IS NULL
          AND sa.company_name IS NOT NULL AND sa.company_name != ''
          AND lower(trim(sa.company_name)) = lower(trim(t.name))
        RETURNING sa.activity_id
      )
      SELECT count(*) as cnt FROM linked
    `,
  }).single();
  const countB = parseInt(passB?.cnt || "0");

  return {
    step: "link_activities_to_true_owners",
    affected: countA + countB,
    detail: `sf_company_id: ${countA}, name_match: ${countB}`,
  };
}

// ─── Step 5: Link activities → contacts (multi-strategy) ──────────────────
// Pass A: by sf_contact_id
// Pass B: by name match (first_name + last_name → contact_name)
async function linkActivitiesToContacts(db: ReturnType<typeof getClient>): Promise<StepResult> {
  // Pass A: sf_contact_id
  const { data: passA } = await db.rpc("exec_sql", {
    query: `
      WITH linked AS (
        UPDATE salesforce_activities sa
        SET contact_id = c.contact_id
        FROM contacts c
        WHERE sa.contact_id IS NULL
          AND sa.sf_contact_id IS NOT NULL
          AND sa.sf_contact_id = c.sf_contact_id
        RETURNING sa.activity_id
      )
      SELECT count(*) as cnt FROM linked
    `,
  }).single();
  const countA = parseInt(passA?.cnt || "0");

  // Pass B: name match
  const { data: passB } = await db.rpc("exec_sql", {
    query: `
      WITH linked AS (
        UPDATE salesforce_activities sa
        SET contact_id = c.contact_id
        FROM contacts c
        WHERE sa.contact_id IS NULL
          AND sa.first_name IS NOT NULL AND sa.last_name IS NOT NULL
          AND lower(trim(c.contact_name)) = lower(trim(sa.first_name || ' ' || sa.last_name))
        RETURNING sa.activity_id
      )
      SELECT count(*) as cnt FROM linked
    `,
  }).single();
  const countB = parseInt(passB?.cnt || "0");

  return {
    step: "link_activities_to_contacts",
    affected: countA + countB,
    detail: `sf_contact_id: ${countA}, name_match: ${countB}`,
  };
}

// ─── Step 6: Backfill sf_company_id on true_owners from linked activities ──
async function backfillSFIdsOnTrueOwners(db: ReturnType<typeof getClient>): Promise<StepResult> {
  const { data } = await db.rpc("exec_sql", {
    query: `
      WITH updated AS (
        UPDATE true_owners t
        SET
          sf_company_id = sub.sf_company_id,
          salesforce_id = sub.sf_company_id,
          updated_at = now()
        FROM (
          SELECT DISTINCT ON (sa.true_owner_id) sa.true_owner_id, sa.sf_company_id
          FROM salesforce_activities sa
          WHERE sa.sf_company_id IS NOT NULL AND sa.true_owner_id IS NOT NULL
          ORDER BY sa.true_owner_id, sa.activity_date DESC NULLS LAST
        ) sub
        WHERE t.true_owner_id = sub.true_owner_id
          AND (t.sf_company_id IS NULL OR t.sf_company_id = '')
        RETURNING t.true_owner_id
      )
      SELECT count(*) as cnt FROM updated
    `,
  }).single();
  return { step: "backfill_sf_ids_on_true_owners", affected: parseInt(data?.cnt || "0") };
}

// ─── Step 7: Backfill sf_contact_id on contacts from linked activities ─────
async function backfillSFIdsOnContacts(db: ReturnType<typeof getClient>): Promise<StepResult> {
  const { data } = await db.rpc("exec_sql", {
    query: `
      WITH updated AS (
        UPDATE contacts c
        SET
          sf_contact_id = sub.sf_contact_id,
          contact_fields_synced_at = now(),
          updated_at = now()
        FROM (
          SELECT DISTINCT ON (sa.contact_id) sa.contact_id, sa.sf_contact_id
          FROM salesforce_activities sa
          WHERE sa.sf_contact_id IS NOT NULL AND sa.contact_id IS NOT NULL
          ORDER BY sa.contact_id, sa.activity_date DESC NULLS LAST
        ) sub
        WHERE c.contact_id = sub.contact_id
          AND c.sf_contact_id IS NULL
        RETURNING c.contact_id
      )
      SELECT count(*) as cnt FROM updated
    `,
  }).single();
  return { step: "backfill_sf_ids_on_contacts", affected: parseInt(data?.cnt || "0") };
}

// ─── Step 8: Link contacts ↔ true_owners bidirectionally ──────────────────
// Uses SF account linkage: contacts.sf_contact_id → sf_contacts.sf_account_id
// → true_owners.sf_company_id to connect contacts to their true_owner.
async function linkContactsToTrueOwners(db: ReturnType<typeof getClient>): Promise<StepResult> {
  // Pass A: Via SF account chain
  const { data: passA } = await db.rpc("exec_sql", {
    query: `
      WITH linked AS (
        UPDATE contacts c
        SET
          true_owner_id = t.true_owner_id,
          entity_type = COALESCE(c.entity_type, 'true_owner'),
          entity_id = t.true_owner_id,
          updated_at = now()
        FROM salesforce_contacts sc
        JOIN true_owners t ON t.sf_company_id = sc.sf_account_id
        WHERE c.sf_contact_id = sc.sf_contact_id
          AND c.true_owner_id IS NULL
          AND sc.sf_account_id IS NOT NULL
        RETURNING c.contact_id
      )
      SELECT count(*) as cnt FROM linked
    `,
  }).single();
  const countA = parseInt(passA?.cnt || "0");

  // Pass B: Via company name match
  const { data: passB } = await db.rpc("exec_sql", {
    query: `
      WITH linked AS (
        UPDATE contacts c
        SET
          true_owner_id = t.true_owner_id,
          entity_type = COALESCE(c.entity_type, 'true_owner'),
          entity_id = t.true_owner_id,
          updated_at = now()
        FROM true_owners t
        WHERE c.true_owner_id IS NULL
          AND c.company IS NOT NULL AND c.company != ''
          AND lower(trim(c.company)) = lower(trim(t.name))
        RETURNING c.contact_id
      )
      SELECT count(*) as cnt FROM linked
    `,
  }).single();
  const countB = parseInt(passB?.cnt || "0");

  return {
    step: "link_contacts_to_true_owners",
    affected: countA + countB,
    detail: `sf_account_chain: ${countA}, company_name: ${countB}`,
  };
}

// ─── Step 9: Set contact_id on true_owners (primary contact) ──────────────
// Picks the most-enriched contact linked to each true_owner as primary.
async function setTrueOwnerPrimaryContact(db: ReturnType<typeof getClient>): Promise<StepResult> {
  const { data } = await db.rpc("exec_sql", {
    query: `
      WITH best AS (
        SELECT DISTINCT ON (c.true_owner_id) c.true_owner_id, c.contact_id
        FROM contacts c
        WHERE c.true_owner_id IS NOT NULL
        ORDER BY c.true_owner_id,
          (CASE WHEN c.contact_email IS NOT NULL THEN 1 ELSE 0 END
           + CASE WHEN c.contact_phone IS NOT NULL THEN 1 ELSE 0 END
           + CASE WHEN c.contact_name IS NOT NULL AND c.contact_name != '' THEN 1 ELSE 0 END) DESC,
          c.created_at ASC
      ),
      updated AS (
        UPDATE true_owners t
        SET contact_id = best.contact_id, updated_at = now()
        FROM best
        WHERE t.true_owner_id = best.true_owner_id
          AND t.contact_id IS NULL
        RETURNING t.true_owner_id
      )
      SELECT count(*) as cnt FROM updated
    `,
  }).single();
  return { step: "set_true_owner_primary_contact", affected: parseInt(data?.cnt || "0") };
}

// ─── Step 10: Populate contact_links junction table ───────────────────────
// Creates contact_links rows for every contact↔true_owner relationship,
// enabling the many-to-many relationship tracking.
async function populateContactLinks(db: ReturnType<typeof getClient>): Promise<StepResult> {
  const { data } = await db.rpc("exec_sql", {
    query: `
      WITH new_links AS (
        INSERT INTO contact_links (contact_id, entity_type, entity_id, role, created_at)
        SELECT c.contact_id, 'true_owner', c.true_owner_id, c.role, now()
        FROM contacts c
        WHERE c.true_owner_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM contact_links cl
            WHERE cl.contact_id = c.contact_id
              AND cl.entity_type = 'true_owner'
              AND cl.entity_id = c.true_owner_id
          )
        RETURNING id
      )
      SELECT count(*) as cnt FROM new_links
    `,
  }).single();
  return { step: "populate_contact_links", affected: parseInt(data?.cnt || "0") };
}

// ─── Step 11: Propagate prospect flags from activities ────────────────────
// Marks true_owners and contacts as prospects when they have recent
// opportunity-type activities in Salesforce.
async function propagateProspectFlags(db: ReturnType<typeof getClient>): Promise<StepResult> {
  const { data: ownerData } = await db.rpc("exec_sql", {
    query: `
      WITH prospects AS (
        UPDATE true_owners t
        SET
          is_prospect = true,
          latest_note_summary = sub.latest_note,
          updated_at = now()
        FROM (
          SELECT DISTINCT ON (sa.true_owner_id)
            sa.true_owner_id,
            sa.nm_notes as latest_note
          FROM salesforce_activities sa
          WHERE sa.true_owner_id IS NOT NULL
            AND sa.nm_type IN ('Opportunity', 'Prospect', 'Lead')
          ORDER BY sa.true_owner_id, sa.activity_date DESC NULLS LAST
        ) sub
        WHERE t.true_owner_id = sub.true_owner_id
          AND (t.is_prospect IS NULL OR t.is_prospect = false)
        RETURNING t.true_owner_id
      )
      SELECT count(*) as cnt FROM prospects
    `,
  }).single();
  const ownerCount = parseInt(ownerData?.cnt || "0");

  // Mirror prospect flag onto contacts linked to those owners
  const { data: contactData } = await db.rpc("exec_sql", {
    query: `
      WITH updated AS (
        UPDATE contacts c
        SET is_prospect = true, updated_at = now()
        FROM true_owners t
        WHERE c.true_owner_id = t.true_owner_id
          AND t.is_prospect = true
          AND (c.is_prospect IS NULL OR c.is_prospect = false)
        RETURNING c.contact_id
      )
      SELECT count(*) as cnt FROM updated
    `,
  }).single();
  const contactCount = parseInt(contactData?.cnt || "0");

  return {
    step: "propagate_prospect_flags",
    affected: ownerCount + contactCount,
    detail: `owners: ${ownerCount}, contacts: ${contactCount}`,
  };
}

// ─── Step 12: Update CRM opportunity counts ───────────────────────────────
// Counts distinct SF activities per true_owner and writes to crm_opportunity_count.
async function updateCRMOpportunityCounts(db: ReturnType<typeof getClient>): Promise<StepResult> {
  const { data } = await db.rpc("exec_sql", {
    query: `
      WITH counts AS (
        SELECT sa.true_owner_id, count(DISTINCT sa.activity_id) as opp_count
        FROM salesforce_activities sa
        WHERE sa.true_owner_id IS NOT NULL
          AND sa.nm_type IN ('Opportunity', 'Prospect', 'Lead')
        GROUP BY sa.true_owner_id
      ),
      updated AS (
        UPDATE true_owners t
        SET crm_opportunity_count = counts.opp_count, updated_at = now()
        FROM counts
        WHERE t.true_owner_id = counts.true_owner_id
          AND COALESCE(t.crm_opportunity_count, 0) != counts.opp_count
        RETURNING t.true_owner_id
      )
      SELECT count(*) as cnt FROM updated
    `,
  }).single();
  return { step: "update_crm_opportunity_counts", affected: parseInt(data?.cnt || "0") };
}

// ─── Step 13: Populate touchpoint_schedule from activity history ──────────
// Creates touchpoint_schedule rows for true_owner/contact pairs that have
// activity history but no scheduled touchpoints yet.
async function populateTouchpointSchedule(db: ReturnType<typeof getClient>): Promise<StepResult> {
  const { data } = await db.rpc("exec_sql", {
    query: `
      WITH activity_stats AS (
        SELECT
          sa.true_owner_id,
          sa.contact_id,
          MAX(sa.activity_date) as last_touch,
          COUNT(*) FILTER (WHERE sa.activity_date >= CURRENT_DATE - INTERVAL '6 months') as cnt_6mo,
          COUNT(*) FILTER (WHERE sa.activity_date >= CURRENT_DATE - INTERVAL '12 months') as cnt_12mo
        FROM salesforce_activities sa
        WHERE sa.true_owner_id IS NOT NULL
          AND sa.contact_id IS NOT NULL
          AND sa.activity_date IS NOT NULL
        GROUP BY sa.true_owner_id, sa.contact_id
      ),
      new_touchpoints AS (
        INSERT INTO touchpoint_schedule (
          true_owner_id, contact_id, last_touch_date, next_touch_due,
          priority_level, touch_count_6mo, touch_count_12mo,
          recommended_interval_days
        )
        SELECT
          a.true_owner_id,
          a.contact_id,
          a.last_touch,
          a.last_touch + INTERVAL '90 days',
          CASE
            WHEN t.is_prospect = true THEN 'high'
            WHEN a.cnt_12mo >= 4 THEN 'high'
            WHEN a.cnt_12mo >= 2 THEN 'med'
            ELSE 'low'
          END,
          a.cnt_6mo,
          a.cnt_12mo,
          CASE
            WHEN t.is_prospect = true THEN 30
            WHEN a.cnt_12mo >= 4 THEN 45
            WHEN a.cnt_12mo >= 2 THEN 60
            ELSE 90
          END
        FROM activity_stats a
        JOIN true_owners t ON t.true_owner_id = a.true_owner_id
        WHERE NOT EXISTS (
          SELECT 1 FROM touchpoint_schedule ts
          WHERE ts.true_owner_id = a.true_owner_id
            AND ts.contact_id = a.contact_id
        )
        RETURNING true_owner_id
      )
      SELECT count(*) as cnt FROM new_touchpoints
    `,
  }).single();
  return { step: "populate_touchpoint_schedule", affected: parseInt(data?.cnt || "0") };
}

// ─── Step 14: Update touchpoint_schedule with latest activity data ────────
async function refreshTouchpointSchedule(db: ReturnType<typeof getClient>): Promise<StepResult> {
  const { data } = await db.rpc("exec_sql", {
    query: `
      WITH activity_stats AS (
        SELECT
          sa.true_owner_id,
          sa.contact_id,
          MAX(sa.activity_date) as last_touch,
          COUNT(*) FILTER (WHERE sa.activity_date >= CURRENT_DATE - INTERVAL '6 months') as cnt_6mo,
          COUNT(*) FILTER (WHERE sa.activity_date >= CURRENT_DATE - INTERVAL '12 months') as cnt_12mo
        FROM salesforce_activities sa
        WHERE sa.true_owner_id IS NOT NULL
          AND sa.contact_id IS NOT NULL
          AND sa.activity_date IS NOT NULL
        GROUP BY sa.true_owner_id, sa.contact_id
      ),
      updated AS (
        UPDATE touchpoint_schedule ts
        SET
          last_touch_date = a.last_touch,
          next_touch_due = a.last_touch + (ts.recommended_interval_days || ' days')::interval,
          touch_count_6mo = a.cnt_6mo,
          touch_count_12mo = a.cnt_12mo
        FROM activity_stats a
        WHERE ts.true_owner_id = a.true_owner_id
          AND ts.contact_id = a.contact_id
          AND ts.last_touch_date IS DISTINCT FROM a.last_touch
        RETURNING ts.true_owner_id
      )
      SELECT count(*) as cnt FROM updated
    `,
  }).single();
  return { step: "refresh_touchpoint_schedule", affected: parseInt(data?.cnt || "0") };
}

// ─── Step 15: Enrich true_owners contact_1/2_name from contacts ───────────
async function enrichOwnerContactNames(db: ReturnType<typeof getClient>): Promise<StepResult> {
  const { data } = await db.rpc("exec_sql", {
    query: `
      WITH ranked AS (
        SELECT
          c.true_owner_id,
          c.contact_name,
          ROW_NUMBER() OVER (
            PARTITION BY c.true_owner_id
            ORDER BY
              (CASE WHEN c.contact_email IS NOT NULL THEN 1 ELSE 0 END
               + CASE WHEN c.contact_phone IS NOT NULL THEN 1 ELSE 0 END) DESC,
              c.created_at ASC
          ) as rn
        FROM contacts c
        WHERE c.true_owner_id IS NOT NULL
          AND c.contact_name IS NOT NULL AND c.contact_name != '' AND c.contact_name != ' '
      ),
      pivoted AS (
        SELECT
          true_owner_id,
          MAX(CASE WHEN rn = 1 THEN contact_name END) as c1,
          MAX(CASE WHEN rn = 2 THEN contact_name END) as c2
        FROM ranked
        WHERE rn <= 2
        GROUP BY true_owner_id
      ),
      updated AS (
        UPDATE true_owners t
        SET
          contact_1_name = COALESCE(t.contact_1_name, p.c1),
          contact_2_name = COALESCE(t.contact_2_name, p.c2),
          updated_at = now()
        FROM pivoted p
        WHERE t.true_owner_id = p.true_owner_id
          AND (t.contact_1_name IS NULL OR t.contact_2_name IS NULL)
        RETURNING t.true_owner_id
      )
      SELECT count(*) as cnt FROM updated
    `,
  }).single();
  return { step: "enrich_owner_contact_names", affected: parseInt(data?.cnt || "0") };
}

// ─── Step 16: Log enrichment run ──────────────────────────────────────────
async function logEnrichmentRun(
  db: ReturnType<typeof getClient>,
  results: StepResult[]
): Promise<void> {
  await db.from("crm_enrichment_logs").insert({
    record_id: "enrichment_run_" + new Date().toISOString(),
    source_type: "salesforce_enrichment_function",
    enrichment_fields: {
      version: 1,
      steps: results,
      total_affected: results.reduce((sum, r) => sum + r.affected, 0),
      timestamp: new Date().toISOString(),
    },
  });
}

// ─── Diagnostics endpoint ─────────────────────────────────────────────────
async function handleDiagnostics(): Promise<Response> {
  const db = getClient();
  const { data } = await db.rpc("exec_sql", {
    query: `
      SELECT json_build_object(
        'salesforce_accounts', (SELECT count(*) FROM salesforce_accounts),
        'salesforce_contacts', (SELECT count(*) FROM salesforce_contacts),
        'salesforce_activities', (SELECT count(*) FROM salesforce_activities),
        'contacts', (SELECT count(*) FROM contacts),
        'true_owners', (SELECT count(*) FROM true_owners),
        'contact_links', (SELECT count(*) FROM contact_links),
        'touchpoint_schedule', (SELECT count(*) FROM touchpoint_schedule),
        'gaps', json_build_object(
          'activities_missing_contact_id', (SELECT count(*) FROM salesforce_activities WHERE contact_id IS NULL AND sf_contact_id IS NOT NULL),
          'activities_missing_true_owner_id', (SELECT count(*) FROM salesforce_activities WHERE true_owner_id IS NULL AND (sf_company_id IS NOT NULL OR (company_name IS NOT NULL AND company_name != ''))),
          'contacts_missing_sf_contact_id', (SELECT count(*) FROM contacts WHERE sf_contact_id IS NULL),
          'contacts_missing_true_owner_id', (SELECT count(*) FROM contacts WHERE true_owner_id IS NULL),
          'true_owners_missing_sf_company_id', (SELECT count(*) FROM true_owners WHERE sf_company_id IS NULL OR sf_company_id = ''),
          'true_owners_missing_contact_id', (SELECT count(*) FROM true_owners WHERE contact_id IS NULL),
          'sf_contacts_without_contact_row', (SELECT count(*) FROM salesforce_contacts sc WHERE NOT EXISTS (SELECT 1 FROM contacts c WHERE c.sf_contact_id = sc.sf_contact_id)),
          'touchpoint_schedule_rows', (SELECT count(*) FROM touchpoint_schedule),
          'prospect_owners', (SELECT count(*) FROM true_owners WHERE is_prospect = true),
          'prospect_contacts', (SELECT count(*) FROM contacts WHERE is_prospect = true)
        )
      ) as diagnostics
    `,
  }).single();
  return jsonResponse({ diagnostics: data?.diagnostics, timestamp: new Date().toISOString() });
}

// ─── Main enrichment handler ──────────────────────────────────────────────
async function handleEnrichment(dryRun: boolean): Promise<Response> {
  const db = getClient();
  const results: StepResult[] = [];
  const startTime = Date.now();

  const steps = [
    bridgeSFContactsToContacts,
    syncContactFieldsFromSF,
    linkAccountsToTrueOwners,
    linkActivitiesToTrueOwners,
    linkActivitiesToContacts,
    backfillSFIdsOnTrueOwners,
    backfillSFIdsOnContacts,
    linkContactsToTrueOwners,
    setTrueOwnerPrimaryContact,
    populateContactLinks,
    propagateProspectFlags,
    updateCRMOpportunityCounts,
    populateTouchpointSchedule,
    refreshTouchpointSchedule,
    enrichOwnerContactNames,
  ];

  if (dryRun) {
    return jsonResponse({
      mode: "dry_run",
      steps: steps.map((fn) => fn.name),
      note: "POST without ?dry_run=true to execute",
    });
  }

  for (const stepFn of steps) {
    try {
      const result = await stepFn(db);
      results.push(result);
    } catch (e) {
      results.push({
        step: stepFn.name,
        affected: 0,
        detail: `ERROR: ${(e as Error).message}`,
      });
    }
  }

  await logEnrichmentRun(db, results);

  return jsonResponse({
    success: true,
    duration_ms: Date.now() - startTime,
    total_affected: results.reduce((sum, r) => sum + r.affected, 0),
    steps: results,
    version: 1,
  });
}

// ─── Router ───────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/salesforce-enrichment/, "");

  try {
    if (path === "/diagnostics" || path === "/diagnostics/") {
      return await handleDiagnostics();
    }

    if (req.method === "POST" && (path === "" || path === "/" || path === "/run" || path === "/run/")) {
      const dryRun = url.searchParams.get("dry_run") === "true";
      return await handleEnrichment(dryRun);
    }

    return jsonResponse(
      {
        error: "Not found",
        path,
        available_endpoints: {
          "GET /diagnostics": "View current linkage gaps and counts",
          "POST /run?dry_run=true": "Preview enrichment steps without executing",
          "POST /run": "Execute full enrichment pipeline",
          "POST /": "Execute full enrichment pipeline",
        },
      },
      404
    );
  } catch (e) {
    return jsonResponse(
      { error: "Internal server error", details: (e as Error).message },
      500
    );
  }
});
