-- ============================================================================
-- EB1 — Executive Briefs foundation (LCC Opps).
--
-- Scott, 2026-09-11: swimlane market briefs (MB) + a CTO/CDO build brief (XB)
-- + one operator-note funnel (OC), BUILT INTO THE LCC — not a Cowork task that
-- goes stale. Spec: docs/architecture/EXEC-BRIEFS-SPEC.md (v0.2).
--
-- DESIGN PRINCIPLE (spec §1): a living brief, not a generated document. The
-- unit of storage is the FACT, not the brief — one row per sourced, dated
-- claim, carrying its own staleness TTL (`stale_after`). A brief is a RENDER
-- over live facts; an issue (daily short / weekly long) FREEZES the fact ids
-- it used, exactly the way `cm_report_snapshots` freezes quarterly figures —
-- reproducible, citable, diffable ("what changed since yesterday" = a
-- fact-set diff, never an LLM guess).
--
-- WHAT THIS MIGRATION DOES AND DOES NOT DO (EB1 prompt §5):
--   * Five tables + two views. Nothing renders. Nothing sends email. No
--     producer tick calls this schema yet — that is MB-a/MB-c/OC-a/XB-a,
--     later prompts. Every later step ships flag-gated OFF (spec §7).
--   * No RLS-guarded browser write path is opened here — every table is
--     server-mediated (service_role), matching the RLS-lockdown pattern in
--     20260522140000_lcc_rls_lockdown_new_backend_tables.sql: RLS ON,
--     `service_role` gets FOR ALL, `authenticated` gets FOR SELECT only
--     (dashboards read these tables directly; nothing browser-side writes).
--
-- PRODUCER LIFECYCLE (P123/P133 pattern, mirrored from
-- lcc_ownership_chain_draft_run_log — do not re-derive a new one). A run row
-- is OPENED at request entry (`status='started'`) and closed on the way out
-- (`completed`/`failed`/`skipped`), so a handler that dies mid-flight leaves a
-- STALLED row instead of nothing (P123's whole point). `skipped` exists
-- because a producer that no-ops on a flag-off, a missing key, or a rate
-- limit must say so LOUDLY (`skip_reason`) rather than merge into "0 facts
-- written today" — the spec's own degradation rule (§2): "if
-- ANTHROPIC_API_KEY is missing/out of credit, P-WEB records
-- producer_run.status='skipped', facts age visibly, and XB flags it."
--
-- STALENESS MODEL. `stale_after` is a TIMESTAMPTZ (fetched_at + the section's
-- TTL, computed by the WRITER at insert time — never a bare interval column,
-- so `v_market_brief_staleness` can compare directly against now() with no
-- per-section CASE duplicated between the writer and the view). A fact past
-- `stale_after` does NOT flip `status` on its own — that would be a second,
-- silently-drifting definition of staleness inside one row. `status` records
-- a LIFECYCLE decision (a producer replaced it → superseded; a sweep decided
-- it can never be reconfirmed → expired; two sources disagree → conflict);
-- `stale_after` records a CLOCK fact. The views compute "is this fact
-- currently stale" from the clock fact, live, every time — never cached onto
-- the row, so nothing needs a nightly sweep just to keep staleness honest.
--
-- REVERSAL RUNBOOK (drop in reverse order; nothing here has a downstream
-- consumer yet, so this is safe at any point before MB-a/OC-a ship):
--   drop view if exists public.v_market_brief_staleness;
--   drop view if exists public.v_market_brief_live;
--   drop table if exists public.producer_runs;
--   drop table if exists public.operator_notes;
--   drop table if exists public.build_brief_snapshots;
--   drop table if exists public.market_brief_issues;
--   drop table if exists public.market_brief_facts;
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. market_brief_facts — one row per sourced, dated claim.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.market_brief_facts (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid,                 -- NULL = global (facts are shared across the team; see spec §4 "Audience")

  lane              text        NOT NULL,
  section           text        NOT NULL,

  claim_text        text        NOT NULL,
  value             numeric,
  unit              text,

  source_url        text,
  source_title      text,
  source_date       date,
  fetched_at        timestamptz NOT NULL DEFAULT now(),

  origin            text        NOT NULL,
  fact_kind         text        NOT NULL DEFAULT 'reported',

  -- The instant past which this fact is stale. Computed by the writer as
  -- fetched_at + the section's TTL (spec §3): rates/on-market 2d, sector
  -- news 7d, our comps/cap bands 30d, operator results 100d, CMS PPS 45d,
  -- GSA policy 30d, broker surveys 100d. NULL means "never goes stale on its
  -- own" (reserved for a fact a human explicitly pinned; no writer sets this
  -- today).
  stale_after       timestamptz,

  supersedes_id     uuid        REFERENCES public.market_brief_facts(id),
  confidence        numeric(4,3),

  status            text        NOT NULL DEFAULT 'live',

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_mbf_lane CHECK (lane IN ('dialysis', 'government', 'net_lease', 'broad_net_lease')),
  CONSTRAINT chk_mbf_section CHECK (section IN ('operators', 'policy', 'capital_markets', 'implications', 'trades')),
  CONSTRAINT chk_mbf_origin CHECK (origin IN ('onbox_sql', 'rss', 'web_research', 'operator_note')),
  CONSTRAINT chk_mbf_fact_kind CHECK (fact_kind IN ('reported', 'opinion', 'derived')),
  CONSTRAINT chk_mbf_status CHECK (status IN ('live', 'superseded', 'expired', 'conflict')),
  CONSTRAINT chk_mbf_confidence CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  -- A fact cannot supersede itself (the P153 self-cycle class, one table over).
  CONSTRAINT chk_mbf_no_self_supersede CHECK (supersedes_id IS NULL OR supersedes_id <> id)
);

CREATE INDEX IF NOT EXISTS idx_mbf_lane_section_status
  ON public.market_brief_facts (lane, section, status);

CREATE INDEX IF NOT EXISTS idx_mbf_stale_after
  ON public.market_brief_facts (stale_after)
  WHERE stale_after IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mbf_supersedes
  ON public.market_brief_facts (supersedes_id)
  WHERE supersedes_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mbf_workspace
  ON public.market_brief_facts (workspace_id);

-- Idempotency for a producer re-run against the SAME source claim on the
-- SAME day: a fact identified by (lane, section, source_url, source_date,
-- claim_text) that already exists should not duplicate. NULLs (a fact with
-- no source_url, e.g. an on-box SQL derivation) fall outside this index by
-- design — those dedupe on the producer's own natural key instead (P-SQL
-- writers key on their own derivation identity, not this table).
CREATE UNIQUE INDEX IF NOT EXISTS uq_mbf_source_identity
  ON public.market_brief_facts (lane, section, source_url, source_date, claim_text)
  WHERE source_url IS NOT NULL AND source_date IS NOT NULL;

DROP TRIGGER IF EXISTS trg_mbf_set_updated ON public.market_brief_facts;
CREATE OR REPLACE FUNCTION public._market_brief_facts_set_updated()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_mbf_set_updated
  BEFORE UPDATE ON public.market_brief_facts
  FOR EACH ROW EXECUTE FUNCTION public._market_brief_facts_set_updated();

COMMENT ON TABLE public.market_brief_facts IS
  'EB1 — one row per sourced, dated market-brief claim. The unit of storage for '
  'the living-brief design (spec §1): a brief is a render over live facts, never '
  'a generated document. See stale_after / status for the staleness model.';

-- ----------------------------------------------------------------------------
-- 2. market_brief_issues — a frozen render (daily short / weekly long).
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.market_brief_issues (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid,

  lane            text        NOT NULL,
  issue_type      text        NOT NULL,       -- 'daily' | 'weekly'
  issue_date      date        NOT NULL,

  -- The frozen fact set this issue was rendered from — reproducible and
  -- diffable against the next issue's set, exactly the cm_report_snapshots
  -- pattern the spec cites. Never re-derived by re-querying live facts after
  -- the fact; an issue is immutable once written.
  fact_ids        uuid[]      NOT NULL DEFAULT '{}',

  summary         text,
  rendered_md     text,
  rendered_html   text,

  generated_by    text,                       -- 'synthesizer_onbox' | 'synthesizer_cloud' | 'manual'
  metadata        jsonb       NOT NULL DEFAULT '{}'::jsonb,

  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_mbi_lane CHECK (lane IN ('dialysis', 'government', 'net_lease', 'broad_net_lease')),
  CONSTRAINT chk_mbi_issue_type CHECK (issue_type IN ('daily', 'weekly'))
);

-- One issue per (lane, issue_type, issue_date) — a re-render on the same day
-- replaces, it does not duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mbi_lane_type_date
  ON public.market_brief_issues (lane, issue_type, issue_date);

CREATE INDEX IF NOT EXISTS idx_mbi_lane_date
  ON public.market_brief_issues (lane, issue_date DESC);

COMMENT ON TABLE public.market_brief_issues IS
  'EB1 — a frozen render of market_brief_facts (daily short-form / weekly '
  'long-form). fact_ids is the immutable fact set the render used; diffing two '
  'issues'' fact_ids is "what changed" — never an LLM guess.';

-- ----------------------------------------------------------------------------
-- 3. build_brief_snapshots — the XB (CTO/CDO build brief) collector output.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.build_brief_snapshots (
  id                bigserial   PRIMARY KEY,
  generated_at      timestamptz NOT NULL DEFAULT now(),

  commit_sha        text,

  -- The deterministic collector's raw parse (spec §5): STATUS.md, PLANNED-
  -- BACKLOG.md, CURRENT-STATE.md, prompts/ + responses/, git log, CI results,
  -- pipeline/queue health, Railway deploy state. One jsonb blob rather than a
  -- column per source, because the collector's source set will grow and a
  -- wide table would need a migration every time it does.
  payload           jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- Deterministic audit rules (spec §5): doc contradictions, dated blockers
  -- past re-measure age, uncommitted/branch drift, orphaned prompts, GENERATED
  -- file hand edits, stale market-brief facts, producers not running, flags ON
  -- with no consumer. One row per flag: {rule, severity, detail}.
  audit_flags       jsonb       NOT NULL DEFAULT '[]'::jsonb,

  -- On-box Ollama synthesis (XB-b, later): exec narrative + ranked next-best-
  -- effort. NULL until that prompt ships — the collector (XB-a) writes a row
  -- with narrative NULL, never a placeholder string.
  narrative         text,
  decisions_needed  jsonb       NOT NULL DEFAULT '[]'::jsonb,

  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bbs_generated_at
  ON public.build_brief_snapshots (generated_at DESC);

COMMENT ON TABLE public.build_brief_snapshots IS
  'EB1 — XB (CTO/CDO build brief) collector output. Scott-only surface (spec §5); '
  'one row per collector run (push to main + nightly).';

-- ----------------------------------------------------------------------------
-- 4. operator_notes — one funnel, every channel (spec §6).
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.operator_notes (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid,

  channel           text        NOT NULL,
  raw_text          text        NOT NULL,
  attachments       jsonb       NOT NULL DEFAULT '[]'::jsonb,

  -- Auto-captured context at intake time (spec §6): route, entity id, recent
  -- console/API errors, an optional screenshot ref. Channel-shaped, so jsonb
  -- rather than named columns — an in-app Note carries route/entity/errors, a
  -- Teams message carries none of that.
  context           jsonb       NOT NULL DEFAULT '{}'::jsonb,

  received_from     text,                     -- email address / user id / bot id, channel-dependent
  received_at       timestamptz NOT NULL DEFAULT now(),

  -- Triage output (OC2, later prompt) — nullable until the triage tick runs.
  note_type         text,                     -- 'bug' | 'data-gap' | 'not-connecting' | 'idea' | 'ux' | 'question'
  lane              text,                     -- domain/lane this note concerns, if any (NOT the market-brief lane CHECK — a note can be about anything)
  severity          text,

  dedupe_of         uuid        REFERENCES public.operator_notes(id),
  routed_to         text,                     -- owner thread (app/briefing, automation, data-coherence, surfaces/canon, comps, buyer-engagement, ...)

  -- Loop closure (spec §6, OC4): each note carries its disposition and the
  -- next XB issue reports it back.
  disposition       text        NOT NULL DEFAULT 'open',
  disposition_detail text,                    -- e.g. "row PDR14b", "PR #2210", "refuted by measurement: ..."
  disposed_at       timestamptz,

  triaged_at        timestamptz,
  metadata          jsonb       NOT NULL DEFAULT '{}'::jsonb,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_on_channel CHECK (channel IN (
    'outlook_reply', 'outlook_tagged', 'in_app_note', 'teams', 'mcp', 'cowork', 'other'
  )),
  CONSTRAINT chk_on_note_type CHECK (note_type IS NULL OR note_type IN (
    'bug', 'data-gap', 'not-connecting', 'idea', 'ux', 'question'
  )),
  CONSTRAINT chk_on_disposition CHECK (disposition IN (
    'open', 'routed', 'in_progress', 'closed', 'superseded', 'refuted'
  )),
  -- A note cannot be its own duplicate (mirrors chk_mbf_no_self_supersede).
  CONSTRAINT chk_on_no_self_dedupe CHECK (dedupe_of IS NULL OR dedupe_of <> id)
);

CREATE INDEX IF NOT EXISTS idx_on_disposition
  ON public.operator_notes (disposition, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_on_channel
  ON public.operator_notes (channel, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_on_routed_to
  ON public.operator_notes (routed_to)
  WHERE routed_to IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_on_dedupe_of
  ON public.operator_notes (dedupe_of)
  WHERE dedupe_of IS NOT NULL;

DROP TRIGGER IF EXISTS trg_on_set_updated ON public.operator_notes;
CREATE OR REPLACE FUNCTION public._operator_notes_set_updated()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_on_set_updated
  BEFORE UPDATE ON public.operator_notes
  FOR EACH ROW EXECUTE FUNCTION public._operator_notes_set_updated();

COMMENT ON TABLE public.operator_notes IS
  'EB1/OC — one funnel for every channel (in-app Note, tagged Outlook reply, '
  'Teams, MCP log_operator_note, Cowork/Claude Code). Triaged by OC2 (later '
  'prompt); this migration only lays the table. disposition/disposition_detail '
  'close the loop back to the next XB issue.';

-- ----------------------------------------------------------------------------
-- 5. producer_runs — the P123/P133 lifecycle, generalised across producers.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.producer_runs (
  run_id              bigserial   PRIMARY KEY,

  -- Which producer, per spec §2's table: 'p_sql' | 'p_rss' | 'p_web' |
  -- 'synthesizer' | 'xb_collector' | 'oc_triage' — an open text column
  -- (never a CHECK enum) because a producer is a code identity, not a fixed
  -- vocabulary, and MB-a/MB-c/OC-a/XB-a each add one without a migration.
  producer            text        NOT NULL,
  lane                text,                   -- NULL for a producer that is not lane-scoped (XB collector, OC triage)

  started_at          timestamptz NOT NULL DEFAULT now(),
  finished_at         timestamptz,
  duration_ms         integer,

  -- P123 lifecycle: OPENED at request entry with 'started', closed on the
  -- way out. A row still reading 'started' after its expected runtime means
  -- the handler never came back (pg_net timeout, restart, crash) — never
  -- silently indistinguishable from "did not run" (P123's whole point).
  status              text        NOT NULL DEFAULT 'started',
  skip_reason         text,                   -- REQUIRED context when status='skipped' (spec §2 degradation rule)

  trigger_source      text,                   -- 'cron' | 'manual' | 'api' | 'ingest'

  -- The state delta (never the producer's own tally — P159a doctrine).
  facts_written       integer     NOT NULL DEFAULT 0,
  facts_superseded    integer     NOT NULL DEFAULT 0,
  facts_expired       integer     NOT NULL DEFAULT 0,

  cost_usd            numeric(10, 4),
  error_count         integer     NOT NULL DEFAULT 0,
  detail              jsonb       NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT chk_pr_status CHECK (status IN ('started', 'completed', 'failed', 'skipped')),
  -- A skip must name a reason — an unlabelled skip is indistinguishable from
  -- "forgot to set skip_reason" (CLAUDE.md's Class-21 skipped-step blindness,
  -- one table over: a SKIPPED step is not a FAILED step and is not NO ROW).
  CONSTRAINT chk_pr_skip_has_reason CHECK (status <> 'skipped' OR skip_reason IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_pr_producer_started
  ON public.producer_runs (producer, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_pr_lane_started
  ON public.producer_runs (lane, started_at DESC)
  WHERE lane IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pr_status
  ON public.producer_runs (status)
  WHERE status = 'started';   -- fast "what is stalled right now" scan

COMMENT ON TABLE public.producer_runs IS
  'EB1 — the P123/P133 producer-run lifecycle (open-before-work, close-on-exit), '
  'generalised across every MB/XB/OC producer. A row stuck at status=started '
  'means the handler died mid-flight, never "did not run". skip_reason is '
  'required whenever status=skipped so a flag-off/no-credit/rate-limited '
  'producer reads as a named decision, never a silent zero.';

-- ----------------------------------------------------------------------------
-- 6. RLS — service_role read/write, authenticated read-only (P123/lockdown
--    pattern: 20260522140000_lcc_rls_lockdown_new_backend_tables.sql).
--    Every write path is server-mediated; nothing here is written directly
--    from the browser.
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  t text;
  tbls text[] := ARRAY[
    'market_brief_facts', 'market_brief_issues', 'build_brief_snapshots',
    'operator_notes', 'producer_runs'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_service_role_all', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t || '_service_role_all', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_authenticated_read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)', t || '_authenticated_read', t);
  END LOOP;
END $$;

-- build_brief_snapshots is Scott-only per spec §5 ("Surfaces: dashboard
-- #/exec (Scott-only...)"). Row-level scoping to Scott alone is an app-layer
-- decision (the #/exec route gate), not an RLS policy keyed on a role Postgres
-- doesn't have — `authenticated` still gets SELECT here like every other
-- table, matching the neighbouring-table convention; the app is what hides it
-- from everyone but Scott, the same way `lcc_users`/`auth.users` gate the
-- Metrics roster (UX-T0) rather than a second Postgres role per person.

-- ----------------------------------------------------------------------------
-- 7. v_market_brief_live — live, non-expired facts per lane/section.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_market_brief_live AS
SELECT
  f.id,
  f.workspace_id,
  f.lane,
  f.section,
  f.claim_text,
  f.value,
  f.unit,
  f.source_url,
  f.source_title,
  f.source_date,
  f.fetched_at,
  f.origin,
  f.fact_kind,
  f.stale_after,
  f.confidence,
  f.status,
  -- Computed live, never cached on the row (see the staleness-model note
  -- above) — this is what "as of <date>" rendering reads to decide whether
  -- to show a fact plainly or with an age caveat.
  (f.stale_after IS NOT NULL AND f.stale_after <= now()) AS is_stale,
  f.created_at,
  f.updated_at
FROM public.market_brief_facts f
WHERE f.status = 'live';

COMMENT ON VIEW public.v_market_brief_live IS
  'EB1 — every fact whose lifecycle status is live (not superseded/expired/'
  'conflict), per lane/section. Carries is_stale (computed from stale_after vs '
  'now(), never a stored flag) so a renderer can show "as of <date>" instead of '
  'silently re-asserting a stale number — the standing never-fabricate rule.';

-- ----------------------------------------------------------------------------
-- 8. v_market_brief_staleness — per lane/section: live / stale / missing
--    counts + last producer run. The instrument the XB audit (spec §5) reads
--    to report decay.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_market_brief_staleness AS
WITH lanes AS (
  SELECT unnest(ARRAY['dialysis', 'government', 'net_lease', 'broad_net_lease']) AS lane
),
sections AS (
  SELECT unnest(ARRAY['operators', 'policy', 'capital_markets', 'implications', 'trades']) AS section
),
-- Every (lane, section) cell, so a section with ZERO facts reads as a named
-- "missing" row instead of being invisible to a GROUP BY (the Class-20
-- lesson: "a lane that has never emitted has no row to GROUP BY" — cross the
-- dimensions FIRST, then LEFT JOIN the facts).
cells AS (
  SELECT l.lane, s.section
  FROM lanes l
  CROSS JOIN sections s
),
fact_agg AS (
  SELECT
    f.lane,
    f.section,
    count(*) FILTER (WHERE f.status = 'live' AND (f.stale_after IS NULL OR f.stale_after > now())) AS live_count,
    count(*) FILTER (WHERE f.status = 'live' AND f.stale_after IS NOT NULL AND f.stale_after <= now()) AS stale_count,
    count(*) FILTER (WHERE f.status = 'superseded') AS superseded_count,
    count(*) FILTER (WHERE f.status = 'expired') AS expired_count,
    count(*) FILTER (WHERE f.status = 'conflict') AS conflict_count,
    max(f.fetched_at) FILTER (WHERE f.status = 'live') AS newest_live_fetched_at
  FROM public.market_brief_facts f
  GROUP BY f.lane, f.section
),
-- Latest producer run per lane, regardless of which section it touched — a
-- producer_run is not section-scoped (spec §2: P-SQL/P-RSS/P-WEB run per
-- lane, writing facts into whichever sections their pass covers).
last_run AS (
  SELECT DISTINCT ON (pr.lane)
    pr.lane,
    pr.producer          AS last_producer,
    pr.started_at         AS last_run_started_at,
    pr.finished_at         AS last_run_finished_at,
    pr.status             AS last_run_status,
    pr.skip_reason        AS last_run_skip_reason
  FROM public.producer_runs pr
  WHERE pr.lane IS NOT NULL
  ORDER BY pr.lane, pr.started_at DESC
)
SELECT
  c.lane,
  c.section,
  COALESCE(fa.live_count, 0)       AS live_count,
  COALESCE(fa.stale_count, 0)      AS stale_count,
  COALESCE(fa.superseded_count, 0) AS superseded_count,
  COALESCE(fa.expired_count, 0)    AS expired_count,
  COALESCE(fa.conflict_count, 0)   AS conflict_count,
  -- "missing" = this cell has NEVER had a live fact, ever (not "currently
  -- zero after everything expired" — that is stale/expired territory, a
  -- different, worse fact worth distinguishing on the audited surface).
  (COALESCE(fa.live_count, 0) = 0 AND COALESCE(fa.stale_count, 0) = 0
     AND COALESCE(fa.superseded_count, 0) = 0 AND COALESCE(fa.expired_count, 0) = 0
     AND COALESCE(fa.conflict_count, 0) = 0) AS is_missing,
  fa.newest_live_fetched_at,
  lr.last_producer,
  lr.last_run_started_at,
  lr.last_run_finished_at,
  lr.last_run_status,
  lr.last_run_skip_reason
FROM cells c
LEFT JOIN fact_agg fa ON fa.lane = c.lane AND fa.section = c.section
LEFT JOIN last_run lr ON lr.lane = c.lane;

COMMENT ON VIEW public.v_market_brief_staleness IS
  'EB1 — per (lane, section): live/stale/superseded/expired/conflict counts, '
  'whether the cell has NEVER had a fact (is_missing), and the last producer '
  'run for that lane. This is the instrument the XB audit (spec §5) reads to '
  'report decay: "producers that have not run, sections with no live facts." '
  'CROSS JOINs every (lane, section) combination FIRST so a section that has '
  'never produced a fact is a visible row, not an absent one (Class 20).';

GRANT SELECT ON public.v_market_brief_live TO service_role, authenticated;
GRANT SELECT ON public.v_market_brief_staleness TO service_role, authenticated;
