-- ============================================================================
-- HP1-P2misparse — where a human asks "what is the contact guard blocking?"
-- Life Command Center — LCC Opps (xengecqvemvfknjvbvrq)
--
-- HP1-P2misparse stops the guard notifying the broker's homepage about every
-- successful block. B6a says a skipped step must EMIT — so it emits to
-- `producer_runs` (producer='sidebar_contact_guard', lane='misparse_block'),
-- the ledger HP1-P1d already made live, rather than to a second ledger nobody
-- would think to read.
--
-- This view is the read side. Suppressed is NOT unobserved: a block that never
-- reaches the Inbox is still counted here, by reason, by day.
--
-- ⚠️ IT WILL READ ZERO UNTIL THE RAILWAY DEPLOY LANDS **AND** A SIDEBAR
-- CAPTURE RUNS. The counter is written by api/_handlers/sidebar-pipeline.js at
-- capture time; the migration ships instantly and the JS does not (CLAUDE.md,
-- "merged is not running"). A zero here on 2026-09-12 is the deploy gap, not a
-- quiet guard — check `runs` before reading any of the other columns, and
-- P180: zero runs means NOT MEASURED, never "nothing blocked".
--
-- Read it:
--   select * from v_lcc_contact_guard_blocks order by day desc limit 14;
-- ============================================================================

CREATE OR REPLACE VIEW v_lcc_contact_guard_blocks AS
  SELECT
    date_trunc('day', r.started_at)::date                                   AS day,
    count(*)                                                                AS runs,
    -- What the guard blocked, in total and by reason. These are the guard's
    -- own decisions and are unaffected by the notification change.
    coalesce(sum((r.detail->>'blocked_total')::int), 0)                      AS blocked_total,
    coalesce(sum((r.detail->'by_reason'->>'person_junk_name')::int), 0)      AS blocked_person_junk_name,
    coalesce(sum((r.detail->'by_reason'->>'misparse_name')::int), 0)         AS blocked_misparse_name,
    coalesce(sum((r.detail->'by_reason'->>'email_fanout')::int), 0)          AS blocked_email_fanout,
    -- How those blocks were DISPOSED. notified + silent_chrome + duplicate
    -- partitions blocked_total exactly.
    coalesce(sum(r.facts_written), 0)                                       AS notified,
    coalesce(sum((r.detail->>'silent_chrome')::int), 0)                      AS silent_chrome,
    coalesce(sum((r.detail->>'duplicate')::int), 0)                          AS duplicate,
    count(DISTINCT r.detail->>'property_entity_id')                         AS properties
  FROM producer_runs r
  WHERE r.producer = 'sidebar_contact_guard'
    AND r.lane = 'misparse_block'
  GROUP BY 1;

COMMENT ON VIEW v_lcc_contact_guard_blocks IS
  'HP1-P2misparse: the contact guard''s blocks by day and reason, and how each '
  'was disposed (notified / silent page-chrome / duplicate). Suppressing a '
  'notification is not the same as not observing the block — this is where the '
  'suppressed ones are counted. 0 runs = not measured (P180), never "nothing blocked".';

GRANT SELECT ON v_lcc_contact_guard_blocks TO anon, authenticated, service_role;
