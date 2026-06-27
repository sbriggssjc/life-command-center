-- T9e — repair 413 dangling property_sale_events -> sales_transactions pointers
--       + prevent recurrence.  dia (zqzrriwuavgrquhisnoa).  Applied live 2026-06-27.
--
-- CONTEXT
--   413 property_sale_events.sales_transaction_id values pointed at sales_transactions
--   rows that were deleted by the prior ~350-row sale cleanup (which did not null its
--   referencers) — the fn_listing_close_if_sold landmine's cousin. Each event carries
--   its OWN price/date/parties (independent data); only the pointer is broken.
--
--   Grounded split (live):
--     224  no-date orphans      (event.sale_date IS NULL; referenced sale gone)
--      86  unique re-linkable    (exactly one sales_transactions row on the property
--                                 within +/-31d of the event date)
--     103  ambiguous             (>=2 candidate sales within +/-31d)
--
-- DOCTRINE: pointer hygiene only. NO sales_transactions / available_listings rows are
--   altered or deleted. Every event row + its data is retained. Reversible via
--   t9e_pse_pointer_backup. Idempotent. Conservative — surface ambiguity, never guess.
--
-- KEY GROUNDING FINDING (refined the task's premise):
--   The naive +/-2% price guard is the WRONG instrument here. Of the 86 unique
--   candidates, 51 "mismatch" on price but 49 are EXACT-date matches with zero buyer
--   contradictions — i.e. the SAME sale, where the event simply stores an
--   independently-sourced price (e.g. net vs gross). A literal price guard would dump
--   ~49 obviously-correct re-links into manual review. So Unit 1 uses a
--   CORROBORATION-AWARE guard: re-link a single candidate when price agrees within 2%
--   OR (exact-date / buyer-name corroboration with no buyer contradiction); skip+flag
--   only true price-mismatches lacking corroboration.
--
-- OUTCOME (verified live):
--   relink_unique    84   (Unit 1: 86 single-candidate, 2 skipped -> null+flag)
--   relink_confident 88   (Unit 2: 103 ambiguous, 15 -> null+flag)
--   null_ambiguous   17   (= 2 unique-fail + 15 ambiguous-fail; pointer nulled, flagged)
--   null_no_date    224   (Unit 3: referenced sale purged; pointer nulled, flagged)
--   ------------------------------------------------------------------
--   re-linked       172   nulled+flagged 241   total 413   dangling-after 0
--
-- ============================================================================
-- Unit 0 — reversible backup + computed decision for every dangling pointer.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.t9e_pse_pointer_backup (
  sale_event_id              bigint PRIMARY KEY,
  property_id                integer,
  old_sales_transaction_id   bigint,
  new_sales_transaction_id   bigint,
  old_notes                  text,
  change_kind                text NOT NULL,  -- relink_unique | relink_confident | null_ambiguous | null_no_date | null_no_match
  reason                     text,
  applied                    boolean NOT NULL DEFAULT false,
  created_at                 timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.t9e_pse_pointer_backup
  (sale_event_id, property_id, old_sales_transaction_id, old_notes, new_sales_transaction_id, change_kind, reason)
WITH d AS (
  SELECT pse.sale_event_id, pse.property_id, pse.sale_date AS ev_date, pse.price AS ev_price,
         pse.buyer_name AS ev_buyer, pse.notes AS old_notes, pse.sales_transaction_id AS old_txn
  FROM public.property_sale_events pse
  WHERE pse.sales_transaction_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.sales_transactions st WHERE st.sale_id = pse.sales_transaction_id)
),
cand AS (
  SELECT d.sale_event_id, st.sale_id,
         abs(st.sale_date - d.ev_date) AS date_gap,
         (st.sale_date = d.ev_date) AS exact_date,
         (d.ev_price IS NULL OR st.sold_price IS NULL OR abs(d.ev_price - st.sold_price) <= 0.02*st.sold_price) AS price_ok,
         (d.ev_buyer IS NOT NULL AND st.buyer_name IS NOT NULL
            AND (lower(d.ev_buyer)=lower(st.buyer_name) OR position(lower(split_part(d.ev_buyer,' ',1)) in lower(st.buyer_name))>0)) AS buyer_agrees,
         (d.ev_buyer IS NOT NULL AND st.buyer_name IS NOT NULL
            AND lower(d.ev_buyer)<>lower(st.buyer_name)
            AND position(lower(split_part(d.ev_buyer,' ',1)) in lower(st.buyer_name))=0) AS buyer_contradicts
  FROM d
  JOIN public.sales_transactions st
    ON st.property_id = d.property_id AND st.sale_date IS NOT NULL AND abs(st.sale_date - d.ev_date) <= 31
  WHERE d.ev_date IS NOT NULL
),
cand_scored AS (
  SELECT *, (8*exact_date::int + 8*buyer_agrees::int + 3*price_ok::int - 10*buyer_contradicts::int) AS score FROM cand
),
ncand AS (SELECT sale_event_id, count(*) AS n FROM cand GROUP BY sale_event_id),
uniq AS (  -- Unit 1: single candidate
  SELECT c.sale_event_id, c.sale_id, c.price_ok, c.exact_date, c.buyer_agrees, c.buyer_contradicts
  FROM cand_scored c JOIN ncand n USING(sale_event_id) WHERE n.n = 1
),
amb_rank AS (  -- Unit 2: rank candidates by corroboration score, ties broken by closest date
  SELECT c.sale_event_id, c.sale_id, c.score, c.buyer_contradicts,
         rank() OVER (PARTITION BY c.sale_event_id ORDER BY c.score DESC, c.date_gap ASC) AS rnk
  FROM cand_scored c JOIN ncand n USING(sale_event_id) WHERE n.n >= 2
),
amb_top AS (
  SELECT sale_event_id,
         count(*) FILTER (WHERE rnk=1) AS n_top,            -- confident only if a UNIQUE rank-1 winner
         max(sale_id) FILTER (WHERE rnk=1) AS winner_sale_id,
         bool_or(buyer_contradicts) FILTER (WHERE rnk=1) AS top_contradicts,
         max(score) FILTER (WHERE rnk=1) AS top_score
  FROM amb_rank GROUP BY sale_event_id
),
decided AS (
  SELECT d.sale_event_id, d.property_id, d.old_txn, d.old_notes,
    CASE
      WHEN d.ev_date IS NULL THEN NULL
      WHEN u.sale_event_id IS NOT NULL
           AND (u.price_ok OR ((u.exact_date OR u.buyer_agrees) AND NOT u.buyer_contradicts)) THEN u.sale_id
      WHEN a.sale_event_id IS NOT NULL AND a.n_top=1 AND a.top_score>0 AND NOT a.top_contradicts THEN a.winner_sale_id
      ELSE NULL
    END AS new_txn,
    CASE
      WHEN d.ev_date IS NULL THEN 'null_no_date'
      WHEN u.sale_event_id IS NOT NULL
           AND (u.price_ok OR ((u.exact_date OR u.buyer_agrees) AND NOT u.buyer_contradicts)) THEN 'relink_unique'
      WHEN u.sale_event_id IS NOT NULL THEN 'null_ambiguous'
      WHEN a.sale_event_id IS NOT NULL AND a.n_top=1 AND a.top_score>0 AND NOT a.top_contradicts THEN 'relink_confident'
      WHEN a.sale_event_id IS NOT NULL THEN 'null_ambiguous'
      ELSE 'null_no_match'
    END AS change_kind
  FROM d
  LEFT JOIN uniq u USING(sale_event_id)
  LEFT JOIN amb_top a USING(sale_event_id)
)
SELECT sale_event_id, property_id, old_txn, old_notes, new_txn, change_kind,
  CASE change_kind
    WHEN 'relink_unique'    THEN 'relinked to sale '||new_txn||' (single candidate within 31d, corroborated by price/date/buyer)'
    WHEN 'relink_confident' THEN 'relinked to sale '||new_txn||' (confident winner among multiple candidates by date+buyer+price)'
    WHEN 'null_no_date'     THEN 'sales_transaction '||old_txn||' purged; event has no sale_date and referenced sale is gone (pointer nulled, event retained)'
    WHEN 'null_no_match'    THEN 'sales_transaction '||old_txn||' purged; no candidate sale within 31d (pointer nulled, flagged for review)'
    ELSE 'sales_transaction '||old_txn||' purged; candidate sale(s) present but no confident match (pointer nulled, flagged for review)'
  END
FROM decided
ON CONFLICT (sale_event_id) DO NOTHING;

-- ============================================================================
-- Units 1-3 — apply the repair from the validated decision table.
--   Guards (sales_transaction_id = old id) make every UPDATE idempotent: a re-run
--   touches 0 rows because re-linked rows now carry the new id and nulled rows are NULL.
-- ============================================================================
UPDATE public.property_sale_events p
SET sales_transaction_id = b.new_sales_transaction_id, updated_at = now()
FROM public.t9e_pse_pointer_backup b
WHERE p.sale_event_id = b.sale_event_id
  AND b.change_kind IN ('relink_unique','relink_confident')
  AND p.sales_transaction_id = b.old_sales_transaction_id;

UPDATE public.property_sale_events p
SET sales_transaction_id = NULL,
    notes = COALESCE(NULLIF(p.notes,'') || E'\n', '') || '[T9E ' || CURRENT_DATE || '] ' || b.reason,
    updated_at = now()
FROM public.t9e_pse_pointer_backup b
WHERE p.sale_event_id = b.sale_event_id
  AND b.change_kind IN ('null_ambiguous','null_no_date','null_no_match')
  AND p.sales_transaction_id = b.old_sales_transaction_id;

UPDATE public.t9e_pse_pointer_backup SET applied = true;

-- ============================================================================
-- Unit 4 — forward guard. The FK was NEVER present (that gap let the prior sale
--   cleanup orphan 413 events). Add it now that dangling = 0, ON DELETE SET NULL so a
--   future sales_transactions delete nulls the referencing pointer instead of
--   re-orphaning. NOT VALID then VALIDATE to minimize lock on the (small) table.
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_pse_sales_transaction_id') THEN
    ALTER TABLE public.property_sale_events
      ADD CONSTRAINT fk_pse_sales_transaction_id
      FOREIGN KEY (sales_transaction_id) REFERENCES public.sales_transactions (sale_id)
      ON DELETE SET NULL NOT VALID;
    ALTER TABLE public.property_sale_events VALIDATE CONSTRAINT fk_pse_sales_transaction_id;
  END IF;
END $$;

-- ============================================================================
-- Unit 5 — verify fn_listing_close_if_sold tolerates a dangling/NULL pointer.
--   The function already contains the guard
--     IF v_sale_txn IS NOT NULL AND NOT EXISTS (...) THEN v_sale_txn := NULL; END IF;
--   so NO function change is needed. Post-FK a true dangling pointer is structurally
--   impossible; the live remaining case is a NULL pointer (the 241 nulled events).
--   Verified live 2026-06-27 via a self-rolling-back DO block (RAISE at end discards
--   all synthetic rows + trigger side-effects -> 0 residue), which proved:
--     A_fk_on_delete_set_null = PASS  (deleting the referenced sale nulled the event
--                                      pointer instead of orphaning it)
--     B_fn_tolerates_null_ptr = PASS  (a listing insert matched the NULL-pointer event,
--                                      auto-closed status='sold' with sale_transaction_id
--                                      left NULL — no error)
--   Repro (does not commit; ends with RAISE):
--     DO $$ DECLARE v_prop int:=990000777; v_sale int; v_evt bigint; v_ptr bigint;
--                   v_lid bigint; v_lsale int; BEGIN
--       INSERT INTO properties(property_id) VALUES(v_prop);
--       INSERT INTO sales_transactions(property_id,sale_date,sold_price)
--         VALUES(v_prop,CURRENT_DATE-10,1000000) RETURNING sale_id INTO v_sale;
--       INSERT INTO property_sale_events(property_id,sale_date,price,sales_transaction_id,source)
--         VALUES(v_prop,CURRENT_DATE-10,1000000,v_sale,'t9e_test') RETURNING sale_event_id INTO v_evt;
--       DELETE FROM sales_transactions WHERE sale_id=v_sale;            -- FK -> SET NULL
--       SELECT sales_transaction_id INTO v_ptr FROM property_sale_events WHERE sale_event_id=v_evt;
--       INSERT INTO available_listings(property_id,on_market_date,listing_date,is_active,status)
--         VALUES(v_prop,CURRENT_DATE-60,CURRENT_DATE-60,TRUE,'Active')
--         RETURNING listing_id,sale_transaction_id INTO v_lid,v_lsale;  -- trigger tolerates NULL
--       RAISE EXCEPTION 'ptr=% lsale=% (rolled back)', v_ptr, v_lsale;
--     END $$;
--
-- ============================================================================
-- REVERSAL (full, reversible):
--   UPDATE public.property_sale_events p
--     SET sales_transaction_id = b.old_sales_transaction_id,
--         notes = b.old_notes, updated_at = now()
--     FROM public.t9e_pse_pointer_backup b WHERE p.sale_event_id = b.sale_event_id;
--   ALTER TABLE public.property_sale_events DROP CONSTRAINT fk_pse_sales_transaction_id;
--   -- (then, if desired) DROP TABLE public.t9e_pse_pointer_backup;
-- ============================================================================
