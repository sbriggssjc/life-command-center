# Claude Code prompt — UW#6c: finish the press-release→other doctype backfill

> Small cleanup from the UW#6 live gate. Fix 5 (doctype re-validation) added the forward-fix +
> re-typed 4 rows, but the backfill is incomplete. Receipts-first; bounded; reversible.

## Receipt (live, gov, 2026-06-21)
After Fix 5: **41 docs whose file_name ILIKE '%press release%' are still `document_type='lease'`**
(only 4 were re-typed). No other non-doc types leaked into the underwriting doctypes (0 8-K /
investor / 10-K mis-typed into lease/deed/om/master/dd/bov). So the residue is bounded to these 41.

## The ask
Complete the backfill on BOTH domains: re-type every `property_documents` row whose `file_name`
matches a non-document pattern (press release, 8-K, investor presentation, annual report) but is
typed as an underwriting doctype (`lease`/`deed`/`om`/`master`/`dd`/`bov`) → `document_type='other'`.
Use the SAME `normalizeNotifyDoctype` / word-boundary non-doctype reject list Fix 5 introduced, run
over the existing rows (not just new captures). Expected: ~41 gov rows (+ any dia). Reversible
(record prior type in a note/metadata or a small log). Idempotent (re-run = 0).

## Gate
`SELECT count(*) FROM property_documents WHERE document_type='lease' AND file_name ILIKE '%press
release%'` returns **0** on both domains after; legitimate leases/deeds untouched; the lease
deep-parse no longer picks up press releases.
