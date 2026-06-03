-- QA#3 — Priority Queue band counts must not truncate at PostgREST's 1000-row cap.
--
-- handlePriorityQueueList previously tallied chip counts in JS from
-- v_priority_queue_enriched?select=priority_band&limit=5000. PostgREST caps
-- the response at 1000 rows, so the chips summed to exactly 1000 and the P8
-- band (~89) was dropped entirely (P7 also undercounted).
--
-- This pre-aggregated view collapses the queue to <=10 rows so the count read
-- is never truncated. Idempotent (CREATE OR REPLACE).

CREATE OR REPLACE VIEW public.v_priority_queue_band_counts AS
SELECT priority_band, count(*)::int AS n
FROM public.v_priority_queue_enriched
GROUP BY priority_band;
