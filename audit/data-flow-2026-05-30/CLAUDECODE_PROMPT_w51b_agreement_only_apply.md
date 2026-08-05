# Claude Code Prompt — W5.1b: agreement-only writes + prefilter/dedup, then gov `--apply`

## Context (read first)
- `docs/audits/ROLLOUT_STATUS.md` — session-35 log entry (2026-08-05) + W5.1 row.
- The 100-row sample ran 2026-08-05 (60 dia / 40 gov, zero writes, 100/100
  `ai_final_provider=ollama`). Scott holds the review sheet
  (`W51_sample_review_sheet.csv`) and findings (`W51_SAMPLE_FINDINGS.md`).
- Measured verdict: the **agreement lane** (`party_extract_agree`, both channels'
  normalized cores match) was ~93% entity-correct; the **A-only lane**
  (`gliner_extract`, GLiNER present / LLM abstained) was **~80% wrong** — it
  produced every serious error: tenant-as-seller ×6, buyer-as-seller ×8
  (CoreCivic portfolio fan-out), buyer-as-listing-broker ×4 (SVEA),
  buyer-as-procuring ×1. The disagreement gate (conflict / B-only → no write)
  worked exactly as designed.

## Changes (all in `api/_handlers/party-extract.js` + `scripts/party-extract-backlog.mjs`)

1. **Demote the A-only lane to log-only.** In `adjudicateField`, the
   `a && !b` branch becomes `decision: 'skip', disagreementKind: 'a_only'` —
   logged to `party_extract_disagreements` like the other non-writes. Agreement
   is the ONLY write path. Keep `SOURCE_GLINER`/`CONF_GLINER` exported (the
   `field_source_priority` row stays registered; it just gains no producers).
   Update the module header comment and the 18 adjudication tests accordingly;
   add a test asserting the a_only branch never returns `decision:'write'`.

2. **Agreement surface rule: prefer channel B's surface.** In the agree branch,
   `value = b` (fall back to `a` only if `b` is empty after trim). Sample
   evidence: longer-wins chose `"Philip Blvd. American Realty Capital
   Healthcare"` (span bled into the address) over B's clean surface. Test with
   that exact pair.

3. **Note-quality prefilter** in the runner's candidate selection: skip notes
   matching bookkeeping patterns before invoking either channel —
   `^master_xlsx_backfill`, `^historical_csv_import`, `^Office - Sub`
   tenant stubs, and anything under 40 chars (already enforced). Count and
   report skips per pattern. (54/60 dia sample notes were bookkeeping; each
   wasted ~35s of GLiNER.)

4. **Portfolio-note dedup:** hash the trimmed note; run extraction once per
   unique hash and fan the adjudicated result out to all member rows. The
   sample's CoreCivic error repeated ×8 and SVEA ×4 from one bad extraction —
   dedup contains error blast-radius AND cuts GLiNER cost ~30% on gov.

5. **Re-target the first `--apply` at gov.** Under agreement-only, dia yielded
   ZERO writes in 60 sample rows (its `notes` column is mostly bookkeeping);
   gov yielded 26 write-rows in 40. Default the runner's apply docs/examples to
   `--domain gov`; dia remains runnable but is expected near-empty until a
   richer dia note source exists.

## Do NOT change
- The disagreement gate (conflict / B-only / now a_only → log, never write).
- Fill-blanks-only + field-priority-guard write path, ledger, resumability.
- The ollama gate on `--apply` (`W51_ALLOW_CLOUD` override stays).
- Migration `20260731120000` / registered priorities — no schema change needed.

## After merge
Run a small re-sample (`--sample 30`, gov-weighted) to confirm agreement-only
behavior, deliver the sheet for Scott's approval, then `--apply --domain gov`.
Report per-domain before/after missing-field rates in ROLLOUT_STATUS.
Reminder for Scott (independent of this PR): rotate the CF Access service
token used for the 2026-08-05 container run (Zero Trust → Access → Service
Auth → rotate), then update Railway `CF_ACCESS_CLIENT_ID/SECRET`.
