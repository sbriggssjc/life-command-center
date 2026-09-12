# `docs/audits/` — point-in-time measurements, not current state

**An audit in this directory is not stale for being old — it is stale only if someone cites it as
current state instead of as the record of a measurement taken on a date.** (DOCMAP2, 2026-09-08)

Every file here is a dated diagnosis or a dated fix write-up: "on this date, this population read
this way, and this is what shipped." That is durable as history and NOT durable as a live number —
counts, backlog sizes, and "still open" claims in an audit file drift the moment the next producer
run or migration lands.

## The rule

- **Cite an audit for its MECHANISM (what was wrong and why), never for its live NUMBER.** A count
  quoted from an audit six weeks old should be treated as `title+skim`-grade evidence, not as a
  measurement — re-run the query.
- **Every arc's current state lives on its CANONICAL PAGE**, not in the audit trail. `CLAUDE.md`'s
  "Pointers to canonical docs" section and `docs/os/DOCUMENTATION-MAP.md` are the index; most audit
  write-ups are already cross-linked from there (e.g. `A2_...md` from the A2 section of `CLAUDE.md`,
  `B6d_...md` from the producer-health canonical page). If an audit is NOT reachable from a
  canonical page or `DOCUMENTATION-MAP.md`, that is itself a defect — file it, don't silently fix it
  by writing a new audit.
- **Do not re-classify these 110 files individually.** DOCMAP1/DOCMAP2's per-file STALE/CANONICAL
  verdict system applies to `docs/architecture/` and similar reference pages, which assert *current*
  state. An audit's job is different — it is a dated exhibit, correctly frozen at its own date, and
  the correct fix for a wrong CONCLUSION reached in an old audit is a NEWER audit or a canonical-page
  correction (per `CLAUDE.md`'s own "re-measure a dated blocker before quoting it" doctrine), never
  an edit to the old file's numbers.

## Discoverability check (DOCMAP2, 2026-09-08)

Spot-checked: audits referenced from `CLAUDE.md`'s "Pointers to canonical docs" section and from
arc-specific canonical pages (`docs/architecture/tier0-owner-contact-system.md`,
`docs/architecture/producer-health-and-ci-enforcement.md`,
`docs/architecture/public-records-source-lane.md`, `docs/architecture/entity-identity-and-dedup.md`,
etc.) resolve correctly. **Not exhaustively verified for all 110 files** — see the DOCMAP2 response
for the reached/not-reached boundary.

---

## Index by topic (added 2026-09-12, Cowork)

**A finding aid, not a status page — the rule above governs: cite an audit for its MECHANISM, never for its live
number.** For current state use `docs/os/CURRENT-STATE.md`, `docs/os/PLANNED-BACKLOG.md`, `docs/claude-code/STATUS.md`
and the canonical pages in `docs/os/DOCUMENTATION-MAP.md`. An audit not reachable from a canonical page or the
documentation map is a defect to file, not something this index fixes by existing. 118 audits as of 2026-09-12.

## Entity identity program (ID)

- [`ID0_IDENTITY_VALUE_DOMAIN_PROBE_2026-09-11.md`](ID0_IDENTITY_VALUE_DOMAIN_PROBE_2026-09-11.md)
- [`ID1_OPERATOR_IDENTITY_AUDIT_2026-09.md`](ID1_OPERATOR_IDENTITY_AUDIT_2026-09.md)
- [`ID2b_OPERATOR_ID_CONSUMER_SWITCH_2026-09-12.md`](ID2b_OPERATOR_ID_CONSUMER_SWITCH_2026-09-12.md)
- [`ID2b_caps_RPC_QUERY_COMPS_OPERATOR_ID_2026-09-12.md`](ID2b_caps_RPC_QUERY_COMPS_OPERATOR_ID_2026-09-12.md)
- [`ID3a_GOV_AGENCY_IDENTITY_WIRING_2026-09-12.md`](ID3a_GOV_AGENCY_IDENTITY_WIRING_2026-09-12.md)
- [`ID4_IDENTITY_INTEGRITY_BASELINE_2026-09.md`](ID4_IDENTITY_INTEGRITY_BASELINE_2026-09.md)

## Ownership & owner identity

- [`A1_OWNERSHIP_LANE_SPLIT_2026-08-27.md`](A1_OWNERSHIP_LANE_SPLIT_2026-08-27.md)
- [`A2_OWNERSHIP_CHAIN_APPLY_2026-08-27.md`](A2_OWNERSHIP_CHAIN_APPLY_2026-08-27.md)
- [`A2a_AMBIGUOUS_ENTITY_MERGE_2026-08-27.md`](A2a_AMBIGUOUS_ENTITY_MERGE_2026-08-27.md)
- [`A2b_REPEAT_CONVEYANCE_COLLAPSE_2026-08-27.md`](A2b_REPEAT_CONVEYANCE_COLLAPSE_2026-08-27.md)
- [`A3_OWNERSHIP_MISMATCH_SPONSOR_FAMILY_2026-08-27.md`](A3_OWNERSHIP_MISMATCH_SPONSOR_FAMILY_2026-08-27.md)
- [`A4_OWNERSHIP_LANE_RETIRE_AND_ADJUDICATE_2026-08-27.md`](A4_OWNERSHIP_LANE_RETIRE_AND_ADJUDICATE_2026-08-27.md)
- [`A5_TRUE_OWNER_SALESFORCE_STALL_2026-08-27.md`](A5_TRUE_OWNER_SALESFORCE_STALL_2026-08-27.md)
- [`B1_CHAIN_VALUE_FLOOR_SPLIT_2026-08-28.md`](B1_CHAIN_VALUE_FLOOR_SPLIT_2026-08-28.md)
- [`B1a_AMBIGUOUS_ENTITY_MERGE_2026-08-28.md`](B1a_AMBIGUOUS_ENTITY_MERGE_2026-08-28.md)
- [`B6_OWNERSHIP_CHANGE_SIGNAL_COVERAGE_2026-08-28.md`](B6_OWNERSHIP_CHANGE_SIGNAL_COVERAGE_2026-08-28.md)
- [`C13b_OWNER_ROLE_MULTILABEL_2026-09-01.md`](C13b_OWNER_ROLE_MULTILABEL_2026-09-01.md)
- [`C13c_ONE_OFF_OWNER_CONFIDENCE_2026-09-01.md`](C13c_ONE_OFF_OWNER_CONFIDENCE_2026-09-01.md)
- [`C2g_UNRESOLVED_OWNER_ORGS_2026-08-28.md`](C2g_UNRESOLVED_OWNER_ORGS_2026-08-28.md)
- [`DIA_OWNERSHIP_LANE_COVERAGE_2026-08-29.md`](DIA_OWNERSHIP_LANE_COVERAGE_2026-08-29.md)
- [`N15b_CANONICAL_NAME_AUTHORS_2026-08-27.md`](N15b_CANONICAL_NAME_AUTHORS_2026-08-27.md)
- [`N15c_CANONICAL_NAME_SINGLE_WRITER_2026-08-27.md`](N15c_CANONICAL_NAME_SINGLE_WRITER_2026-08-27.md)
- [`N15d_N15e_PRODUCER_VERIFY_AND_HELD_RECOMPUTE_2026-08-27.md`](N15d_N15e_PRODUCER_VERIFY_AND_HELD_RECOMPUTE_2026-08-27.md)
- [`OWNERSHIP_RESEARCH_FREE_FIRST_PLAN.md`](OWNERSHIP_RESEARCH_FREE_FIRST_PLAN.md)
- [`OWN_T0_PROPERTY_OWNERSHIP_RECONCILED_2026-09-02.md`](OWN_T0_PROPERTY_OWNERSHIP_RECONCILED_2026-09-02.md)
- [`OWN_T0e_SPONSOR_FAMILY_LANE_DESIGN_2026-09-08.md`](OWN_T0e_SPONSOR_FAMILY_LANE_DESIGN_2026-09-08.md)
- [`P189_MERGE_DETECTOR_BLIND_SPOT_2026-08-26.md`](P189_MERGE_DETECTOR_BLIND_SPOT_2026-08-26.md)
- [`P195_BYTE_IDENTICAL_OWNER_MERGE_2026-08-27.md`](P195_BYTE_IDENTICAL_OWNER_MERGE_2026-08-27.md)
- [`ROLLOUT_STATUS.md`](ROLLOUT_STATUS.md)
- [`W3.3_owner_merge_audit_2026-07-30.md`](W3.3_owner_merge_audit_2026-07-30.md)
- [`W9_6_comms_owner_attribution_dryrun_2026-08-13.md`](W9_6_comms_owner_attribution_dryrun_2026-08-13.md)

## Comps, sales & capital markets

- [`N18_ATTRIBUTED_RENT_SELF_COMPARISON_2026-08-27.md`](N18_ATTRIBUTED_RENT_SELF_COMPARISON_2026-08-27.md)
- [`SALES_AND_AVAILABLE_COMPS_DEFINITION_AUDIT_2026-05-29.md`](SALES_AND_AVAILABLE_COMPS_DEFINITION_AUDIT_2026-05-29.md)
- [`SALES_COMPS_IMPLEMENTATION_2026-05-29.md`](SALES_COMPS_IMPLEMENTATION_2026-05-29.md)

## Feeds, ingestion & monitors

- [`B5_GOV_SELLER_EXIT_FEEDER_2026-08-28.md`](B5_GOV_SELLER_EXIT_FEEDER_2026-08-28.md)
- [`B6a_FOLLOWUP_FRESHNESS_MONITOR_2026-08-28.md`](B6a_FOLLOWUP_FRESHNESS_MONITOR_2026-08-28.md)
- [`B6a_SKIPPED_STEP_HEALTH_BLINDNESS_2026-08-28.md`](B6a_SKIPPED_STEP_HEALTH_BLINDNESS_2026-08-28.md)
- [`B6b_GSA_LANDLORD_CHANGE_RESTART_2026-08-28.md`](B6b_GSA_LANDLORD_CHANGE_RESTART_2026-08-28.md)
- [`B6b_lead_OWNERSHIP_LEAD_RESTART_2026-08-29.md`](B6b_lead_OWNERSHIP_LEAD_RESTART_2026-08-29.md)
- [`B6c_PROPERTY_SALE_EVENTS_2026-08-28.md`](B6c_PROPERTY_SALE_EVENTS_2026-08-28.md)
- [`B6c_dup_SALE_STORE_CANONICAL_2026-08-28.md`](B6c_dup_SALE_STORE_CANONICAL_2026-08-28.md)
- [`B6d_FEED_EXPECTATION_GRADING_2026-08-29.md`](B6d_FEED_EXPECTATION_GRADING_2026-08-29.md)
- [`B6d_assessor_marker_ASSESSOR_DRAIN_TRACE_2026-09-01.md`](B6d_assessor_marker_ASSESSOR_DRAIN_TRACE_2026-09-01.md)
- [`B6d_cms_INGESTION_REPAIR_2026-08-29.md`](B6d_cms_INGESTION_REPAIR_2026-08-29.md)
- [`B6d_cms_escalation_DIA_PRODUCER_HEALTH_2026-09-01.md`](B6d_cms_escalation_DIA_PRODUCER_HEALTH_2026-09-01.md)
- [`B6d_cms_step_ERROR_CHANNEL_2026-08-31.md`](B6d_cms_step_ERROR_CHANNEL_2026-08-31.md)
- [`B6d_pri_PUBLIC_RECORD_INGEST_REPAIR_2026-08-31.md`](B6d_pri_PUBLIC_RECORD_INGEST_REPAIR_2026-08-31.md)
- [`C2h_SPONSOR_SPE_NOT_A_FEEDER_DEFECT_2026-08-28.md`](C2h_SPONSOR_SPE_NOT_A_FEEDER_DEFECT_2026-08-28.md)
- [`W10_FULL_BODY_INGESTION_2026-08-14.md`](W10_FULL_BODY_INGESTION_2026-08-14.md)
- [`W53_AND_OLLAMA_HYGIENE_KICKOFF.md`](W53_AND_OLLAMA_HYGIENE_KICKOFF.md)
- [`W53_INTAKE_CHANNEL_PROVENANCE_2026-08-26.md`](W53_INTAKE_CHANNEL_PROVENANCE_2026-08-26.md)

## CoStar sidebar & listings

- [`PR5_LADDER_SOURCE_TRIAGE_2026-09-02.md`](PR5_LADDER_SOURCE_TRIAGE_2026-09-02.md)
- [`PR5c_INTERNAL_RUNG_VERDICTS_2026-09-02.md`](PR5c_INTERNAL_RUNG_VERDICTS_2026-09-02.md)
- [`PR5c_entities_LADDER_WIRED_2026-09-02.md`](PR5c_entities_LADDER_WIRED_2026-09-02.md)
- [`PR5c_entities_c_EMAIL_TIER_DOMAIN_SCOPE_2026-09-03.md`](PR5c_entities_c_EMAIL_TIER_DOMAIN_SCOPE_2026-09-03.md)
- [`PR5c_entities_c_review_oldest_2026-09-03.md`](PR5c_entities_c_review_oldest_2026-09-03.md)
- [`PR5d_COSTAR_CMBS_LOAN_ARM_2026-09-03.md`](PR5d_COSTAR_CMBS_LOAN_ARM_2026-09-03.md)

## Power Automate / intake pipelines

- [`W10_STAGE2_SAMPLE_DRAFTS.md`](W10_STAGE2_SAMPLE_DRAFTS.md)
- [`W10_VOICE_AND_DRAFTING_KICKOFF.md`](W10_VOICE_AND_DRAFTING_KICKOFF.md)
- [`W3.7b_listing_attachment_discovery_2026-07-30.md`](W3.7b_listing_attachment_discovery_2026-07-30.md)
- [`W3.7c_pa_collector_file_discovery_2026-07-31.md`](W3.7c_pa_collector_file_discovery_2026-07-31.md)
- [`W5_3_LOCAL_LLM_EVALUATION_2026-08-06.md`](W5_3_LOCAL_LLM_EVALUATION_2026-08-06.md)
- [`W9_1_contact_acquisition_dryrun_2026-08-12.md`](W9_1_contact_acquisition_dryrun_2026-08-12.md)
- [`W9_2_reachability_harvest_dryrun_2026-08-08.md`](W9_2_reachability_harvest_dryrun_2026-08-08.md)
- [`W9_3_sf_linkage_drain_dryrun_2026-08-08.md`](W9_3_sf_linkage_drain_dryrun_2026-08-08.md)
- [`W9_4_comms_harvest_dryrun_2026-08-12.md`](W9_4_comms_harvest_dryrun_2026-08-12.md)
- [`W9_4_display_name_capture_2026-08-12.md`](W9_4_display_name_capture_2026-08-12.md)
- [`W9_4_name_backfill_accelerator_2026-08-13.md`](W9_4_name_backfill_accelerator_2026-08-13.md)
- [`W9_CONNECTEDNESS_KICKOFF.md`](W9_CONNECTEDNESS_KICKOFF.md)

## App / UX reviews

- [`UXT0_APP_DEFECT_SWEEP_2026-09-02.md`](UXT0_APP_DEFECT_SWEEP_2026-09-02.md)
- [`UX_T1a_SELLER_QUEUE_MEASUREMENT_2026-09.md`](UX_T1a_SELLER_QUEUE_MEASUREMENT_2026-09.md)
- [`UX_T1c_DECISION_CENTER_BUCKET_AUDIT_2026-09-08.md`](UX_T1c_DECISION_CENTER_BUCKET_AUDIT_2026-09-08.md)

## Security & access

- [`SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md`](SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md)
- [`SEC1_UNIT2_RESULTS_2026-09-05.md`](SEC1_UNIT2_RESULTS_2026-09-05.md)

## Other / one-off investigations

- [`A4b_TRANSITION_CLEAN_GUARD_2026-08-27.md`](A4b_TRANSITION_CLEAN_GUARD_2026-08-27.md)
- [`A5a_AUTOCLOSE_TRUNCATION_FIX_2026-08-27.md`](A5a_AUTOCLOSE_TRUNCATION_FIX_2026-08-27.md)
- [`A5c_RESEARCH_TASK_VALUE_GATE_2026-08-27.md`](A5c_RESEARCH_TASK_VALUE_GATE_2026-08-27.md)
- [`AUDIT_REFRESH_2026-08-06.md`](AUDIT_REFRESH_2026-08-06.md)
- [`B6e_fred_GREEN_CI_DEAD_PRODUCER_2026-09-01.md`](B6e_fred_GREEN_CI_DEAD_PRODUCER_2026-09-01.md)
- [`BD_PIPELINE_FUNNEL_AUDIT_2026-08-28.md`](BD_PIPELINE_FUNNEL_AUDIT_2026-08-28.md)
- [`C10_PROSPECTING_BRIEF_COLUMN_MAPPING_2026-08-31.md`](C10_PROSPECTING_BRIEF_COLUMN_MAPPING_2026-08-31.md)
- [`C11_CALL_SHEET_CONTACT_BASIS_2026-08-31.md`](C11_CALL_SHEET_CONTACT_BASIS_2026-08-31.md)
- [`C12_C4a_DECISION_BRIEF_2026-08-31.md`](C12_C4a_DECISION_BRIEF_2026-08-31.md)
- [`C1_SALESFORCE_LANES_CONSUMER_OR_RETIRE_2026-08-27.md`](C1_SALESFORCE_LANES_CONSUMER_OR_RETIRE_2026-08-27.md)
- [`C2_CONNECTIVITY_STALL_MAP_2026-08-28.md`](C2_CONNECTIVITY_STALL_MAP_2026-08-28.md)
- [`C2a_ASSET_MINT_RENT_FLOOR_CURVE_2026-08-28.md`](C2a_ASSET_MINT_RENT_FLOOR_CURVE_2026-08-28.md)
- [`C2b_SALESFORCE_BRIDGE_SELF_HEALED_2026-08-28.md`](C2b_SALESFORCE_BRIDGE_SELF_HEALED_2026-08-28.md)
- [`C2e_ELIGIBLE_SET_ASSET_MINT_2026-08-28.md`](C2e_ELIGIBLE_SET_ASSET_MINT_2026-08-28.md)
- [`C2e_T2a_TRANCHE_TWO_STEP_ONE_MINT_2026-08-28.md`](C2e_T2a_TRANCHE_TWO_STEP_ONE_MINT_2026-08-28.md)
- [`C4_RANKING_LAYER_ROLE_GATE_2026-08-28.md`](C4_RANKING_LAYER_ROLE_GATE_2026-08-28.md)
- [`C5_CALLABLE_TODAY_AND_THE_BUYER_EXCLUSION_2026-08-28.md`](C5_CALLABLE_TODAY_AND_THE_BUYER_EXCLUSION_2026-08-28.md)
- [`C6_CURRENT_HOLDING_SELLER_BANDS_2026-08-29.md`](C6_CURRENT_HOLDING_SELLER_BANDS_2026-08-29.md)
- [`C7_BROKER_ASSIGNMENT_IS_PREMATURE_2026-08-29.md`](C7_BROKER_ASSIGNMENT_IS_PREMATURE_2026-08-29.md)
- [`C8_PROSPECTING_BRIEF_EXCLUDES_THE_BOOK_2026-08-29.md`](C8_PROSPECTING_BRIEF_EXCLUDES_THE_BOOK_2026-08-29.md)
- [`C9_MERGE_BACKLOG_REACHES_THE_OPERATOR_SURFACES_2026-08-29.md`](C9_MERGE_BACKLOG_REACHES_THE_OPERATOR_SURFACES_2026-08-29.md)
- [`D1_CROSS_DB_PROVENANCE_DIFF_2026-08-29.md`](D1_CROSS_DB_PROVENANCE_DIFF_2026-08-29.md)
- [`DATA_PROCESS_AUTOMATION_AUDIT_2026-08-26.md`](DATA_PROCESS_AUTOMATION_AUDIT_2026-08-26.md)
- [`DEAD_END_AUDIT_PLAYBOOK.md`](DEAD_END_AUDIT_PLAYBOOK.md)
- [`ENTC_JUNK80_AND_P195_UNMERGE_2026-09-03.md`](ENTC_JUNK80_AND_P195_UNMERGE_2026-09-03.md)
- [`HEALTHCARE_ASC_50_PROPERTY_CAPTURE_CHECKPOINT_2026-09-11.md`](HEALTHCARE_ASC_50_PROPERTY_CAPTURE_CHECKPOINT_2026-09-11.md)
- [`J13_TEARDOWN_PREFLIGHT_2026-09-09.md`](J13_TEARDOWN_PREFLIGHT_2026-09-09.md)
- [`LCC_Audit_Rollout_Plan.md`](LCC_Audit_Rollout_Plan.md)
- [`LCC_Data_Architecture_Audit_2026-07-29.md`](LCC_Data_Architecture_Audit_2026-07-29.md)
- [`MERGE1_PROPERTY_MERGE_COLLISION_FOLD.md`](MERGE1_PROPERTY_MERGE_COLLISION_FOLD.md)
- [`OCR1_LOCAL_OCR_BAKEOFF_2026-09-02.md`](OCR1_LOCAL_OCR_BAKEOFF_2026-09-02.md)
- [`OCR2_DEED_OCR_PROVENANCE_2026-09-02.md`](OCR2_DEED_OCR_PROVENANCE_2026-09-02.md)
- [`ON_MARKET_AVAILABILITY_IMPLEMENTATION_2026-05-29.md`](ON_MARKET_AVAILABILITY_IMPLEMENTATION_2026-05-29.md)
- [`ON_MARKET_LIFECYCLE_CATEGORIZATION_REVIEW_2026-05-29.md`](ON_MARKET_LIFECYCLE_CATEGORIZATION_REVIEW_2026-05-29.md)
- [`P140_ROLE_LABEL_GRADE_DRYRUN_2026-08-26.md`](P140_ROLE_LABEL_GRADE_DRYRUN_2026-08-26.md)
- [`P182_SILENT_DISCONNECTION_SWEEP_2026-08-26.md`](P182_SILENT_DISCONNECTION_SWEEP_2026-08-26.md)
- [`P186_TIER0_VIEW_FIX_AND_BENCH_REVIEW_2026-08-26.md`](P186_TIER0_VIEW_FIX_AND_BENCH_REVIEW_2026-08-26.md)
- [`P188_TIER0_CONFIRM_LANE_2026-08-26.md`](P188_TIER0_CONFIRM_LANE_2026-08-26.md)
- [`P194_TIER0_AUTO_ATTACH_AND_LIVING_LOOP_2026-08-26.md`](P194_TIER0_AUTO_ATTACH_AND_LIVING_LOOP_2026-08-26.md)
- [`P196_MERGE_REVERSIBILITY_AND_PARK_REASONS_2026-08-27.md`](P196_MERGE_REVERSIBILITY_AND_PARK_REASONS_2026-08-27.md)
- [`P197_TIER0_EMPLOYER_RESOLVER_2026-08-27.md`](P197_TIER0_EMPLOYER_RESOLVER_2026-08-27.md)
- [`P198_PREFIX8_ARM_IS_LOAD_BEARING_2026-08-27.md`](P198_PREFIX8_ARM_IS_LOAD_BEARING_2026-08-27.md)
- [`PR12_PROVENANCE_QUOTE_LOSS_2026-09-02.md`](PR12_PROVENANCE_QUOTE_LOSS_2026-09-02.md)
- [`V8_SPONSOR_FAMILY_REVIEW_2026-08-27.md`](V8_SPONSOR_FAMILY_REVIEW_2026-08-27.md)

## CONSOLIDATE2 (round 2, 2026-09-12) — appended, not regenerated

- **`docs/claude-code/STATUS.md` archived again.** Lines 2226–10644 (dated 2026-08-29 → 2026-09-11:
  the B6d/B6e CI-and-producer-health tail, PRI2–PRI5, BROKER1, the P18/BUY0 design opens, the
  AC-series, and a long ID-series/C13-C14 run) moved verbatim to
  [`../history/STATUS_claude-code_2026-08-29_to_2026-09-11.md`](../history/STATUS_claude-code_2026-08-29_to_2026-09-11.md).
  STATUS.md itself now carries an "Open threads" table at the top pointing to this archive and to
  the live backlog rows for each thread.
- **`docs/os/PLANNED-BACKLOG.md` shipped rows folded into `docs/os/CURRENT-STATE.md` §2a** (78 rows
  whose State column read exactly `✅`), moved verbatim, deleted from the backlog. See
  `CURRENT-STATE.md` §2a for the list.
- **Contradictions flagged, not resolved** (follow-up work, listed here per the DOCMAP2 rule of
  recording a sweep's findings even when the fix is deferred):
  - `docs/architecture/document-capture-and-ocr-status.md` header still reads a "FINAL STATE" box
    dated 2026-08-12, while `docs/architecture/document-capture-ocr-and-deeds.md` (DOC1–DOC18,
    through 2026-09-02) is the actually-current OCR/longdoc state. The two pages were not merged in
    this pass; a reader following the first alone would miss DOC17/DOC18.
  - `docs/architecture/tier0-owner-contact-system.md` is billed as the single door into P186–P198,
    but P197/P198's park-reason and prefix-8-arm corrections (2026-08-27) are not reflected in its
    own prose — the door page itself was not re-verified against its dozen rounds in this pass.
  - Several `docs/architecture/*.md` files carry "LIVE"/"SHIPPED" language dated before a later
    STATUS entry recorded a correction to the same claim (e.g. the FRED/CMS "don't build" verdict
    superseded same-day by Scott's correction, noted in STATUS but not chased into every doc that
    quoted the earlier verdict). Not chased further here — filed as a topic-coherence follow-up.
