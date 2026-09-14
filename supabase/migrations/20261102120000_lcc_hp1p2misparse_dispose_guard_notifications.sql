-- ============================================================================
-- HP1-P2misparse — dispose the contact guard's success notifications
-- Life Command Center — LCC Opps (xengecqvemvfknjvbvrq)
--
-- MEASURED LIVE 2026-09-12 (the backlog row said 117; it is still growing):
--   inbox_items status='new', source_type='contact_misparse_review' ... 130 rows
--   rejected contacts carried by those rows ........................... 307
--   distinct (name, reason) pairs across all of them ..................  42
--   distinct properties ............................................... ~26
--     `Equity Funds` blocked 31x | `View Less` 29x | `Marcus & Millichap` 26x
--
-- These rows are NOT work awaiting a decision. They are the contact guard
-- announcing, one Inbox row at a time, that it successfully BLOCKED something.
-- A correct block needs no broker judgment. The defect is B6a over-applied:
-- a skipped step must emit, but to a COUNTER, not to the broker's homepage.
--
-- ⚠️ THIS MIGRATION CHANGES NO GUARD DECISION. Not one contact that was
-- blocked becomes minted by this file, and not one that was minted becomes
-- blocked. It changes only whether a human is told, and how often.
--
-- TWO RULES, applied in order, both notification-only:
--
--   (1) CLASS A — page furniture. A rejected contact whose name is CoStar UI
--       chrome ("View Less", "Demographics", "Public REIT", "Equity Funds",
--       "CoStar Property Contact", ...) is counted, never notified. EXACT,
--       case-insensitive, whitespace-collapsed match only — never a substring
--       (P158a: a `contains` rule swallows real firms and real surnames). The
--       list is the single source of truth shared with
--       api/_shared/misparse-disposition.js `NON_CONTACT_CHROME`; a change
--       belongs in BOTH, in the same change.
--
--   (2) DEDUPE — one notification per (property, name, reason), keeping the
--       EARLIEST row that carried it. 307 rejections across 42 distinct pairs
--       means the same correct block was re-notified on every re-capture; that
--       alone built most of the pile without producing a single new decision.
--
-- A row is dismissed only when EVERY non-chrome rejection it carries is already
-- covered by an earlier retained row. Nothing is deleted (repo convention:
-- dispose via status). Fully reversible — see the REVERSAL RUNBOOK at the foot.
--
-- CLASSES DELIBERATELY NOT DISPOSED HERE:
--   B. firms parsed as persons ("Marcus & Millichap", "Colliers",
--      "Cushman & Wakefield", most with a real email) — blocking them AS A
--      PERSON is right; DISCARDING them is not. They belong to the firm
--      registry (BR1), which is **not built** (Dialysis_DB `broker_companies`
--      repair; zero code in this repo today). Filed as a handoff, not faked
--      (P131) — the deduped rows stay visible until BR1 has somewhere to put
--      them. Building a second firm path here is exactly what the prompt and
--      the normaliser-drift doctrine forbid.
--   C. job titles in the name slot ("Executive Vice Chairman", "Vice Chair",
--      "General Mgr | CEO") — a PARSER bug, reported not queued. The cause is
--      in the CoStar contact scraper, not here; the deduped rows stay so the
--      bug stays visible until it is fixed.
--   D. email_fanout — the JS half (api/_shared/misparse-disposition.js
--      `recoverFanoutOwner`) recovers the one name matching its email's local
--      part going forward. It is deliberately NOT replayed in SQL: minting an
--      entity is `ensureEntityLink`'s job, and a second minting path in a
--      migration is the drift this repo keeps paying for.
-- ============================================================================

BEGIN;

-- Reversible ledger: the prior status of every row this migration touches.
CREATE TABLE IF NOT EXISTS lcc_hp1p2misparse_disposition_log (
  id              bigserial PRIMARY KEY,
  inbox_item_id   uuid        NOT NULL,
  prior_status    text        NOT NULL,
  disposition     text        NOT NULL,   -- 'all_chrome' | 'all_duplicate' | 'chrome_and_duplicate'
  batch_tag       text        NOT NULL,
  rejected_count  int,
  chrome_count    int,
  disposed_at     timestamptz NOT NULL DEFAULT now()
);

WITH chrome(n) AS (VALUES
  ('view less'), ('view more'), ('demographics'), ('public reit'),
  ('equity fund'), ('equity funds'), ('costar property contact'), ('per sf'),
  ('fund name'), ('owner name'), ('listing broker'), ('buyer broker'), ('seller broker')
),
rc AS (
  SELECT i.id, i.entity_id, i.received_at,
         lower(regexp_replace(btrim(c->>'name'), '\s+', ' ', 'g')) AS nm,
         c->>'reason' AS rs
  FROM inbox_items i,
       LATERAL jsonb_array_elements(i.metadata->'rejected_contacts') c
  WHERE i.source_type = 'contact_misparse_review' AND i.status = 'new'
),
kept AS (  -- rule (1): drop class-A chrome from consideration entirely
  SELECT * FROM rc WHERE nm NOT IN (SELECT n FROM chrome)
),
firstseen AS (  -- rule (2): the earliest row that carried each triple
  SELECT entity_id, nm, rs, min(received_at) AS mr FROM kept GROUP BY 1, 2, 3
),
retain AS (  -- rows that carry at least one FIRST sighting -> keep notifying
  SELECT DISTINCT k.id
  FROM kept k
  JOIN firstseen f
    ON f.entity_id IS NOT DISTINCT FROM k.entity_id
   AND f.nm = k.nm AND f.rs = k.rs AND f.mr = k.received_at
),
per_row AS (
  SELECT id,
         count(*)                                                       AS rejected_count,
         count(*) FILTER (WHERE nm IN (SELECT n FROM chrome))            AS chrome_count,
         count(*) FILTER (WHERE nm NOT IN (SELECT n FROM chrome))        AS noncrome_count
  FROM rc GROUP BY id
),
target AS (
  SELECT p.*,
         CASE WHEN p.noncrome_count = 0 THEN 'all_chrome'
              WHEN p.chrome_count > 0   THEN 'chrome_and_duplicate'
              ELSE 'all_duplicate' END AS disposition
  FROM per_row p
  WHERE p.id NOT IN (SELECT id FROM retain)
),
logged AS (
  INSERT INTO lcc_hp1p2misparse_disposition_log
    (inbox_item_id, prior_status, disposition, batch_tag, rejected_count, chrome_count)
  SELECT t.id, i.status::text, t.disposition, 'hp1p2misparse_20260912',
         t.rejected_count, t.chrome_count
  FROM target t JOIN inbox_items i ON i.id = t.id
  RETURNING inbox_item_id
)
UPDATE inbox_items i
   SET status = 'dismissed'
  FROM logged l
 WHERE i.id = l.inbox_item_id;

COMMIT;

-- ── VERIFY ──────────────────────────────────────────────────────────────────
--   select count(*) from inbox_items
--    where source_type='contact_misparse_review' and status='new';
--   -- expected 25 (from 130), measured 2026-09-12
--
--   select disposition, count(*) from lcc_hp1p2misparse_disposition_log
--    where batch_tag='hp1p2misparse_20260912' group by 1;
--
-- The guard-decision invariant (must hold — this migration cannot move it):
--   select count(*) from entities where created_at > now() - interval '1 hour';
--
-- ── REVERSAL RUNBOOK ────────────────────────────────────────────────────────
--   UPDATE inbox_items i SET status = l.prior_status::inbox_item_status
--     FROM lcc_hp1p2misparse_disposition_log l
--    WHERE l.inbox_item_id = i.id
--      AND l.batch_tag = 'hp1p2misparse_20260912';
--   DELETE FROM lcc_hp1p2misparse_disposition_log
--    WHERE batch_tag = 'hp1p2misparse_20260912';
-- ============================================================================
