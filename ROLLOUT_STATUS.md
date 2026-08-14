# ROLLOUT_STATUS

Live rollout ledger for sequenced build waves. Newest wave on top. Each row: what
shipped, where it lives, and the operator switch (if any) that lights it up.

---

## Prompt 106 — property_twin lane: deterministic pre-rank + Ollama assist (annotation-only)

| Unit | State | Summary |
|---|---|---|
| **P106** property_twin lane assist | **BUILT — flag off** (`PROPERTY_TWIN_ASSIST`) | Speeds up (never removes) the human on the dia property "address twin" review lane (`dia_property_twin_review`, ~1,245 pending: review_name 792 / review_conflict 274 / review_ambiguous 95 / review_blank_far 84). **Two layers, deterministic-first** (mirrors W9.3 sf-link-assist). **Layer 1 (NO LLM)** `api/_shared/property-twin-assist-planner.js::classifyTwinDeterministic` decides the bulk from the row's OWN `detail`: same operator + near-identical name-core (reuses `dup-pair-planner.nameSimilarity`, floor 0.88) → **merge** (bulk-confirmable); different operator + `same_norm_address:false` + single anchor → **not_twin** (co-located distinct); everything else (same-address operator change, `n_anchors>1`, same-op name divergence, blank shadow) → **uncertain** → Layer 2. It NEVER deterministically not_twins a same-address operator change (that's the human/LLM call). **Layer 2 (Ollama, annotation-only)** scores the residue same_facility/distinct_colocated/uncertain with a **VERBATIM evidence quote** validated against the supplied structured evidence (`quoteVerbatimInEvidence`; a fabricated quote drops the decisive verdict to uncertain — the precision floor); the co-located-plaza footgun is few-shot explicitly. **Store:** the existing `lcc_clean_assist_proposals` (source `property_twin_assist`, keyed `twin:dia:<review_id>`) — no new table; migration `20260814130000` (applied live) widens the source CHECK, registers the flag, adds the U4 self-measure table/RPC/view (`v_lcc_property_twin_assist_accuracy`), and schedules cron `property-twin-assist-tick` 05:45 UTC (no-op while off). **Tick** `GET/POST /api/property-twin-assist-tick` (`?score=1&n=` dry-run sample; POST flag-gated apply; bounded/cursored over the pending slice; per-class + per-suggest + honest bulk-confirmable counts; loud `scan_errors`; budget floor). **Lane** (`admin.js` producer + `dc-lanes.js` card) shows the suggestion + confidence + evidence, sorts easy-first (`twinAssistSortKey`), and adds a bulk-confirm for the **deterministic merges only** — each still a HUMAN verdict through `dia_merge_property_reversible` (reversible). **The tick NEVER calls a merge RPC and never PATCHes the review row** (annotation-never-verdict, guarded structurally in `test/property-twin-assist.test.mjs`, 31 pass). Each human verdict self-measures agree/disagree into the accuracy view. **Live steps:** redeploy → `GET /api/property-twin-assist-tick?score=1` review → Cowork flips `PROPERTY_TWIN_ASSIST` → the lane fills with sorted, pre-ranked twins so Scott clears the 792 same-operator merges fast and spends judgment on the conflict/ambiguous residue. |

---

## Wave 10 — Voice & Drafting (Scott's authored corpus → grounded drafts)
Kickoff: `docs/audits/W10_VOICE_AND_DRAFTING_KICKOFF.md`

| Unit | State | Summary |
|---|---|---|
| **W10.3** Full-body email ingestion (past the ~255-char `bodyPreview` cap) | **CODE SHIPPED (consumers) — flow change is Scott's forward-only step; backfill is a future unit (Prompt 110, 2026-08-14)** | The shared enabler for long-form drafting + the voice profile's sign-off/long-form fidelity + the harvest signature arm. **The intake endpoint was ALREADY ready** — `api/intake.js` accepts `body_text`/`body_html`, clamps them (100K/200K), and prefers them over `bodyPreview`; the bridge writer already fills `email_bodies.body_text/body_html`. The fields are empty only because the PA flows post `bodyPreview` only. **Part A (Scott's step, documented):** a forward-only PA "Get email (V3)" flow change on the flagged-inbound / Sent-Items / bridge flows adds `body_html` (full body) to the POST — no LCC redeploy needed for the endpoint. **Part B (code, this PR):** new shared `pickBestBody`/`htmlToText` in `api/_shared/voice-corpus-clean.js` (full `body_text` → tag-stripped `body_html` → capped preview → `''`, on-prem regex only); draft-assist `loadCorpus` selects + prefers full bodies; the harvest signature arm reads the full body from metadata. Forward-compatible — falls back to the preview cleanly while bodies are empty. Tests: `voice-corpus-clean.test.mjs` (+9), `draft-assist.test.mjs` (29), harvest planner (50) green. **Part C (scoped, NOT built):** a bounded/resumable PA "Get email (V3) by message-id" backfill loop keyed on `internet_message_id` for the ~23K historical rows — recommended, forward-only-first, its own future unit. Doc: `docs/audits/W10_FULL_BODY_INGESTION_2026-08-14.md`. |
| **W10.2** Retrieval-grounded drafting `/api/draft-assist` | **LIVE — `DRAFT_ASSIST` flipped on 2026-08-14; flag now honors the registry (Prompt 109)** | Stage 2: a Scott-voiced DRAFT generator (RAG over the cleaned sent corpus + deal-spine facts + the voice profile, generated ON-PREM via Ollama, fail-closed). GET dry-run always on; POST saves to Outlook Drafts (save-not-send), gated on `DRAFT_ASSIST`. **Prompt 109 (2026-08-14): flag-gate consistency + fact-validator precision.** The POST-save gate read `process.env.DRAFT_ASSIST` ONLY (no registry fallback), so Cowork's registry flip to `on` did NOT enable saves — fixed to the house **env-OR-registry** pattern via the new shared resolver `api/_shared/feature-flag.js` (`flagEnabled`/`fetchFeatureFlag`); an explicit env var still wins as an ops override. **So `DRAFT_ASSIST`=on in the registry now enables saves on redeploy — no Railway env var needed.** Also tightened `validateDraftFacts` so benign Title-Case subjects ("Quick Check-In", "Following Up") no longer false-flag as ungrounded proper names (a `NAME_STOPWORDS` set; multi-word runs of common capitalized words are skipped, real names like "Kingsbarn"/"Boyd Watterson" still flagged, ungrounded numbers/dates still STRIPPED). Tests `test/draft-assist.test.mjs` (29 pass). Files: `api/draft-assist.js`, `api/_shared/draft-assist-core.js`, `api/_shared/feature-flag.js`, migration `20260901120000_lcc_w10_2_draft_assist_flag.sql`. |
| **W10.1** Voice PROFILE from the sent corpus (no training) | **BUILT — profile shipped, awaiting Scott's read** | Stage 1 of Wave 10: a prompt-injectable `BRIGGS-WRITING-VOICE.md` distilled from Scott's authored *sent* mail — no fine-tune, reversible (it's a versioned doc). **Corpus located live (LCC Opps 2026-08-13):** ~**926 distinct** Scott-authored sent emails (`activity_events` outlook/outlook_sent + `email_bodies`, dedup by internet-message-id, from `sabriggs@/teambriggs@northmarq.com` + the Stan-Johnson-era addresses; family `hbriggs/ellentbriggs` excluded), Nov 2022→Aug 2026. **⚠️ Honest cap finding:** the store keeps Graph's `bodyPreview` (~255-char cap) — `body_text/body_html` are empty — so the signal is Scott's email *openings* (~31 words each), great for greeting/opening voice, weak for sign-offs/long-form (marked LOW-confidence in the doc). **Context mix (493 distinct from activity_events):** internal reply 219 · external reply 180 · internal new 75 · **cold BD outreach just 14 (THIN — flagged, not faked)** — 81% replies. **Cleaning module** `api/_shared/voice-corpus-clean.js` (pure, no-LLM): strips reply chains (`____ From: … / On … wrote:`), the inline Briggs sig block, disclaimers, forwarded headers, mobile sigs; drops recall-notice/URL boilerplate; deterministic `classifyDraftType` bucketing. Tests `test/voice-corpus-clean.test.mjs` (19, green). **On-prem distiller** `scripts/voice-distill.mjs` calls **ollama DIRECTLY** (REFUSES to run if `OLLAMA_URL` unset) so the decade of client mail never egresses to a cloud model — writes `docs/os/voice/briggs-voice-attributes.json`. **Stage-1 v1 profile was authored from deterministic SQL analysis + a small anonymized opening sample (no LLM read the prose)**; the ollama script deepens it on the box. Profile carries the overall voice + per-context variants (each evidenced with anonymized excerpts) + the U4 draft-vs-sent edit-distance hook for Stage 2. **NO drafting surface changed** (Stage 1 only). **Live step (Scott):** read `BRIGGS-WRITING-VOICE.md` — does it sound like you? — then it installs as the `my-writing-style` / Cowork voice source. Stages 2 (RAG drafting) / 3 (templates) / 4 (optional LoRA) are later prompts. |

---

## Wave 9 — Contact acquisition & the no-contact gap

| Unit | State | Summary |
|---|---|---|
| **W9.6** Correspondence → owner-LLC attribution | **LIVE — 22/22 worked; provenance fixed (Prompt 108)** (`W9_6_COMMS_OWNER_ATTRIBUTION` on) | **Prompt 108 (2026-08-14): the confirm writer's provenance stamp was failing silently** — swallowed `catch` + a double-encoded `p_value` (`JSON.stringify` on the jsonb param) meant 0 `comms_owner_bridge` rows landed even though all 22 bridges confirmed. Fixed: loud log on failure, RAW `p_value` via the single builder `buildOwnerBridgeProvenanceArgs`, `p_target_database='lcc_opps'`; **backfilled all 22 historical bridges** (migration `20260814140000`, applied live, idempotent/reversible). Live: `field_provenance` `comms_owner_bridge` = 22, all in `v_field_provenance_current`, unranked drift +0. Regression test guards the `p_value` shape. — Closes the last major INTERNAL linkage gap (W9.5 baseline correspondence→owner-LLC = 2.5%, 6/241): correspondence is stamped with the deal/party/property entity the resolver found (brokers, buyers, sellers) — NOT the owning LLC. Two deterministic-first paths: **Path A property_bridge** (a correspondence entity that resolves to an ASSET → its single current true_owner via the ops `owns` edge; arithmetic, confidence 1.0, value-ranked) and **Path B person_match** (a correspondence PERSON tied to a single owner via `owner_contact_pivot` active contact or an unambiguous person→owner edge; carries the correspondent's VERBATIM header name/email; a shared-token-only name bridge is rejected). SQL joins `lcc_w9_6_path_a_candidates`/`lcc_w9_6_path_b_candidates`; tick `GET/POST /api/comms-owner-attribution-tick` (`?score=1&n=` dry-run sample; POST flag-gated; cron `comms-owner-attribution-tick` 05:05 UTC, no-op while off). Proposals → the new Decision Center lane `comms_owner_attribution_review` (fully 75-wired). **Confirm** = a deterministic writer that appends the owner ops entity to the correspondence rows' `metadata.linked_entity_ids` (dedup, reversible `comms_owner_attribution_apply_log`) + stamps `field_provenance` (`comms_owner_bridge`@45, fsp registered, drift 0). One anchor feeds BOTH consumers: the owner-record correspondence history AND the W9.2/W9.4 reachability create-contact arm (the arms compound). The W9.5 `correspondence_entity_owner_llc` metric is extended to count owner attribution via `linked_entity_ids`, so the headline pct rises as attributions confirm. Migration `20260829120000` (applied live). **Grounded dry-run:** Path A 3 candidates, Path B 40 unambiguous (16 active-contact / 24 relationship); high-value real owners lead (Boyd Watterson rank 1175, Kingsbarn) with some pre-existing brokerage-as-owner noise ranked last for the human to reject. Tests `test/comms-owner-attribution.test.mjs` (14) + lane-wiring/partition guards green. Dry-run: `docs/audits/W9_6_comms_owner_attribution_dryrun_2026-08-13.md`. **Live steps:** review `?score=1` sample → Cowork flips `W9_6_COMMS_OWNER_ATTRIBUTION`. |
| **W9.1 Stage 2** SOS-direct via residential fetch proxy | **BUILT — flag off** (`W9_1_SOS_DIRECT`) | The residential-egress lever the SOS handlers have needed since 2026-07-22 (FL Cloudflare / CA Incapsula 403 to datacenter IPs). `government-lease/sos-proxy/` — a locked-down zero-dep Node fetch proxy for public SOS/registry hosts (host allowlist, GET/JSON-POST, ~2MB cap, timeout, human-like min-interval + per-host daily cap, JSONL log, `/health`), exposed only via the cloudflared tunnel + a **NEW** CF Access Service Auth policy/token (never the ollama token), localhost bind, 16 node --test cases. Transport option `SOS_PROXY_URL` (+ dedicated `SOS_PROXY_CF_ACCESS_CLIENT_ID/SECRET`) in the gov Python fetcher (`ProxyHttpClient`) AND the LCC engine's SOS webhook seam — unset ⇒ direct + honest-blocked as today; a proxy decline/unreachable ⇒ HostBlocked (never silent success). SOS stage (`STAGE_SOS`) appended to the contact-acquisition runner when the flag is on (weekly cadence, capped `CONTACT_ACQ_SOS_MAX`), **proposal-only into `contact_acquisition_review` — confirm never auto**. Migration `20260812140000` (flag row + `sos_registry` field_source_priority ladder). Install + tunnel + CF Access + rollout gate: `government-lease/docs/RUNBOOK_sos_proxy_garybuilt.md`. **Live steps (Scott):** install the proxy, re-verify FL/CA adapters through it (side-by-side vs Railway-direct 403), sample-sheet review, then Cowork flips `W9_1_SOS_DIRECT`. Rotate BOTH the new sos-proxy token AND the ollama `lcc-railway` token while in the Zero Trust dashboard. |

---

## Wave 7 — Comms-driven context propagation
Plan: `docs/architecture/WAVE7_COMMS_CONTEXT_PROPAGATION_PLAN.md`

| Unit | State | Summary |
|---|---|---|
| **W7.1** Correspondence attribution goes LIVE | **BUILT — awaiting flag flip** | Matcher on an hourly cron (flag-gated), deal-mapping at ingest via the authoritative roster, historical backfill plumbing drop-in. |
| **W7.2** The propagation tick | **BUILT — awaiting flag flip** | Hourly consumer on deal-stamped correspondence → summary / milestone / next-step / dossier + packet refresh. Own ledger seam; LLM summarizes/proposes only. |
| **W7.3** Call notes + Microsoft-side capture | **BUILT — awaiting flag flip / connector** | Three capture paths, one spine shape: in-app quick-log (`/api/intake-log-call`), Copilot actions (`log_call_note` + `tag_comm_to_deal`), Outlook category tagging (`/api/intake-tagged-comm`, flag `TAGGED_COMM_INTAKE`). All land as deal-stamped `activity_events` → W7.2 propagates them with zero new propagation code. |
| W7.4 Role evolution + open-issues | **BUILT — flag off** (`W74_ROLE_ISSUES`) | Evidence-validated role-evolution + open-issues propagation pass. |
| **W7.5** Outbound loop closure + per-action summaries | **BUILT — flag off for Part C** (`W75_ACTION_SUMMARY`) | (A) tagged outbound sends advance to-dos; (B) untagged Sent-Items sweep feeds `handleOutlookSent` + cross-path de-dupe; (C) flag-gated per-action Ollama narration. Parts A/B live once merged (extend the live engine). |
| **W7.6** Mailbox Mirror (Outlook folders reflect open work) | **BUILT — flag off** (`MAILBOX_MIRROR`) | PULL model: LCC publishes a deterministic (no-LLM) worklist of intake-captured flagged emails whose loop closed (all to-dos terminal, OR a later in-thread reply, OR the inbox_item triaged); a PA "mover" flow moves each from "Intake Staged, Not Complete" → Processed via Graph and acks back. Move-only, never delete. Own ledger `lcc_mailbox_reconcile_ledger` (idempotent, 1h backoff, park+alert after 5 fails). Endpoints `GET /api/mailbox-reconcile-worklist` + `POST /api/mailbox-reconcile-ack`. Migration `20260824120000`; PA spec `docs/setup/OUTLOOK_MAILBOX_MIRROR_FLOW.md`. |

### W7.6 — session log (2026-08-06)
Branch `claude/clever-maxwell-xlc52x`.

**Mailbox Mirror — Outlook folders reflect open LCC work.** The W7.5 out-of-scope
mailbox write-back, built as a PULL model (LCC never touches the mailbox).
- **Migration `20260824120000_lcc_w7_6_mailbox_mirror.sql`** (applied live to LCC
  Opps `xengecqvemvfknjvbvrq`, mirror-from-applied-SQL): the ledger
  `lcc_mailbox_reconcile_ledger` (unique on `internet_message_id`), the
  deterministic worklist view `v_lcc_mailbox_reconcile_worklist`, the ack RPC
  `lcc_mailbox_reconcile_ack`, and the `feature_flags_registry` row for
  `MAILBOX_MIRROR` (off).
- **Gate (pure SQL, no LLM):** a flagged-email `inbox_item` is CLOSED when ANY of
  (a) every to-do generated from it (`action_items.inbox_item_id` lineage) is
  terminal, (b) a later outbound comm exists in the same `conversation_id`
  (`outlook_sent`/`outlook_tagged`), (c) the `inbox_item` was triaged
  `dismissed`/`archived`. Withheld while the deal has an open `offer_review`;
  excludes ledger-moved/parked/backoff messages.
- **Endpoints** (`api/_handlers/mailbox-reconcile.js`, wired in `intake.js` +
  `server.js`): `GET /api/mailbox-reconcile-worklist` (up to N, default 25,
  FIFO by `closed_at`) + `POST /api/mailbox-reconcile-ack`
  (`{internet_message_id, moved, reason?, error?}`). Flag off → `{skipped:'flag_off'}`.
  Failed moves back off 1h and park after 5 tries with an `lcc_health_alerts`
  (`mailbox_mirror_parked`) row.
- **PA spec** `docs/setup/OUTLOOK_MAILBOX_MIRROR_FLOW.md` (Graph resolve-by-
  internetMessageId → move → PATCH flag/isRead → ack; 36y fx/`?['value']` pitfalls).
- **Verified:** live worklist = 3,908 closed-loop flagged emails (all via the
  triage arm — historical inbound predates W7.1 `conversation_id`, so the
  thread-reply arm is wired-but-inert until forward mail carries it). Ack RPC
  round-trip (5 fails → park + alert → success) and all 8 gate invariants proven by
  self-rolling-back synthetic fixtures (0 residue). JS tests
  `test/mailbox-reconcile.test.mjs` (11) incl. the no-LLM-import assertion.

### W7.1 — session log (2026-08-06)
Branch `claude/deal-correspondence-attribution-live-s8ta63`.

**A. Matcher on a cadence.**
- Full-corpus **dry-run report** produced (deterministic SQL replication of the v2.1 engine):
  37 in-scope open deals, 16 would attribute (~306 candidate attributions), 21 zero-match
  (recall gap, not precision). Precision held — no same-operator/different-city bleed. Report:
  `docs/architecture/W7_1_deal_email_match_dryrun_2026-08-06.md` (Scott's approval gate).
- **Cron wrapper** `api/_handlers/deal-email-match-cron.js` runs the SAME matcher engine
  (no logic fork), writes one `lcc_deal_match_run_log` row/run (observable stats line),
  and opens a **deduped `lcc_health_alerts` (cron_failure / deal_email_matcher)** only on
  two consecutive failed runs (loud-failure like other crons).
- Route `POST /api/pipeline/match-deal-emails-cron` (X-LCC-Key), mounted in `server.js`.
- pg_cron `lcc-deal-email-match` (hourly, `17 * * * *`) → `lcc_cron_post` → the route. **Inert**
  until `DEAL_EMAIL_MATCH_ENABLED` is set in Railway (feature flag `DEAL_EMAIL_MATCH_CRON`).
  `?force=1` runs once regardless; `?dry_run=1` reports and writes nothing.
- **Operator switch:** approve the dry-run → set `DEAL_EMAIL_MATCH_ENABLED=1` in Railway,
  flip the `feature_flags_registry.DEAL_EMAIL_MATCH_CRON` row to `on`.

**B. Ongoing-capture tightening (deal mapping at INGEST).**
- `lcc_resolve_contact` (migration `20260806120000`) now maps a counterparty → the DEAL via
  the **authoritative `deal_party` roster** (`email_derived` + `sf_opp_team` edges) and
  `metadata.primary_contact`, not only via a prior body-mention. Both `handleOutlookSent` and
  `logInboundCorrespondenceDualAnchor` read `primary_deal`, so a known deal party self-stamps
  `deal_entity_id` at ingest. Verified live: an `email_derived` party resolves to its deal.
- **Conversation-thread continuity:** a reply on a thread whose prior message is deal-stamped
  inherits that deal stamp (`metadata.conversation_id`), on both the inbound
  (`intake-correspondence.js`) and sent (`intake.js`) paths.
- Verified both live-mail handlers (`handleOutlookMessage` inbound flag path,
  `handleOutlookSent`) route through the dual-anchor loggers.

**C. Historical backfill plumbing (connector-ready).**
- `lcc_deal_correspondents(deal)` + the backfill receiver already exist
  (`/api/deal-correspondence-backfill`); added the design-named alias
  **`POST /api/intake-deal-backfill`** (same handler/contract) so the connector work is drop-in.
- Flow spec documented for the operator: `docs/setup/power-automate-deal-thread-search.md`.

**Doctrine held:** matcher precision unchanged (city required, word-boundary, digest excluded);
no LLM in attribution; idempotent by `(entity_id, external_id)` / `internet_message_id`; all DB
work additive + reversible.

### W7.2 — session log (2026-08-06)
Branch `claude/deal-comms-propagation-tick-eiaaxn`. Migration
`20260806140000_lcc_w7_2_deal_comms_propagate.sql` (applied live to LCC Opps
`xengecqvemvfknjvbvrq`). One tick, four propagations over the deal-stamped comm backlog.

**The tick** — `GET|POST /api/deal-comms-propagate-tick`
(`api/_handlers/deal-comms-propagate-tick.js`), mounted in `server.js` (X-LCC-Key). pg_cron
`lcc-deal-comms-propagate` (`32 * * * *`, ~15min after the W7.1 matcher at `:17`) → `lcc_cron_post`.
**Inert** until `DEAL_COMMS_PROPAGATE_ENABLED` (flag `DEAL_COMMS_PROPAGATE_CRON`); `?force=1` runs one
live tick, `?dry_run=1` reports only. Bounded to `DEAL_COMMS_PROPAGATE_MAX_DEALS` (default 10),
oldest-backlog first — the ledger makes catch-up automatic.

- **Seam = its own ledger** `lcc_deal_comm_propagated (activity_event_id pk)` — a consumed comm never
  reprocesses; re-runs no-op. Batch read: `lcc_deal_comms_unpropagated()` returns the deals with new
  (un-ledgered) comms, each carrying its full comm corpus + per-comm `is_new`/`is_inbound`/`is_recent`,
  reconciling direction/sender/subject/body across both stamp shapes (`lcc:deal_match` join to
  `email_bodies`, ingest dual-anchor via `metadata`). Run-log `lcc_deal_comms_propagation_run_log`
  (mirrors W7.1).
- **1. Correspondence summary** — regenerated via `invokeExtractionAI` (Ollama/GaryBuilt primary) from
  the deal's full comm corpus (inbound AND Team Briggs sent), no-fabrication contract, older threads
  compressed. **is_current versioned** (demote prior, insert new; never update-in-place). AI down/empty
  ⇒ keep the prior row, count `summary_skipped`, move on.
- **2. Milestones** — DETERMINISTIC cues (`api/_shared/deal-milestone-cues.js`, word-boundary LOI/PSA/
  escrow/EMD/DD/financing/marketing/close) write `lcc_deal_milestone` directly via idempotent
  `lcc_deal_record_milestone` (`source='comms_tick'`, `detail_ref`=activity id). An LLM-only candidate
  with **no** cue opens a `milestone_confirm` Decision-Center lane (subject_ref `mstone:<entity>:<key>:<date>`);
  approve writes the milestone (`source='comms_tick_confirmed'`). **No LLM verdict writes a milestone directly.**
- **3. Next-step to-dos** — reuses the Phase-1 `deriveNextStep` → `lcc_advance_todos` path (NOT forked)
  for recent (≤7d) INBOUND matcher-backfill comms only; ingest dual-anchor rows already ran it. The
  existence-guard dedupes (counted).
- **4. Dossier + packets** — `buildDealPacket` already includes the correspondence summary, so the
  refreshed summary changes `source_hash`; for deals with a stored deal dossier the tick regenerates
  on-changed-hash (reuse-if-fresh makes it cheap). `context_packets` for the deal are invalidated (TTL
  generate-on-demand — the existing context-broker path rebuilds on next fetch; no new generator).

- **Operator switch:** set `DEAL_COMMS_PROPAGATE_ENABLED=1` in Railway, flip
  `feature_flags_registry.DEAL_COMMS_PROPAGATE_CRON` to `on`. Verify: dry-run first, then a live tick
  over the 312-comm backlog (15 deals get is_current summaries citing real activity ids; Woodland Hills
  is the gold standard); a fresh test email → next tick refreshes that deal's summary + Phase-1 to-do +
  dossier regen on the changed hash.
- **Grounded live:** batch reader returns 20+ deals oldest-first with correct is_new/inbound/recent
  flags; `lcc_deal_record_milestone` verified idempotent (first insert `t`, re-emit `f`); the
  `milestone_confirm` lane opens as a seeded decision — all via a self-rolled-back synthetic gate (0 residue).
- **Tests:** `test/deal-milestone-cues.test.mjs` (19), `test/deal-comms-summary.test.mjs` (7),
  `test/deal-comms-propagate-tick.test.mjs` (10, fetch-level mocks per the W7.1 posture) — idempotency,
  summary versioning flip, deterministic cue write w/ detail_ref, LLM-candidate → confirm lane (no write),
  recent-inbound-only to-dos + dedupe, AI-failure keeps prior summary + counts skip, dry-run/flag-off.

**Doctrine held:** LLM summarizes/proposes only — every auditable write (milestones from cues, to-dos via
the Phase-1 guard, ledger rows) is deterministic; own seam only; additive + reversible + idempotent + dry-run.

### W7.2c — propagation refinements (2026-08-06)
Migration `20260806150000_lcc_w7_2c_propagation_refinements.sql` (applied live to LCC Opps
`xengecqvemvfknjvbvrq`). Four refinements from W7.2's first live batch; all backward-safe against the running
tick (`DEAL_COMMS_PROPAGATE_CRON` on) — ledger/run-log changes are additive, the collapse is per-deal
advisory-locked with the live writer.

1. **Milestone same-key collapse (the Banning finding).** `lcc_deal_record_milestone` now returns
   `{outcome:inserted|rolled_up|new_round|noop,id}`. Per `(entity_id, milestone_key)` the FIRST occurrence is
   THE row; a re-occurrence rolls up into `metadata.{occurrence_count,first_on,last_seen_on,last_detail_ref,
   occurrences[≤20]}` — no new row — UNLESS the prior same-key row is >90d stale AND the deal stage regressed
   (deal's max `lcc_milestone_stage_rank` > this key's rank), which opens a genuinely new round. Same-evidence
   re-feed = noop (idempotent). The rule is the canonical spec in `api/_shared/deal-milestone-collapse.js`; the
   SQL writer + the one-shot collapse mirror it. **Collapse ran live: `lcc_deal_milestone` 41→21 rows, 20 backed
   up to `_lcc_milestone_collapse_20260806_backup` (reversible), 6 rows now carry an occurrence roll-up.**
   Banning's 6+ `loi` rows became 3 genuine LOI rounds (first 2024-12-13 ×9 last 2025-02-20; a new round
   2025-09-30 ×4; a new round 2026-03-31 ×1) — the repetition IS the signal. The dossier milestones panel now
   renders "LOI — first …, discussed ×N, last …" (`dossier-generator.js`; `lcc_deal_spine` surfaces the
   occurrence metadata).
2. **Briefing "what changed on your deals" delta.** New deterministic (NO LLM) section — `fetchDealPropagationDelta(24)`
   (`briefing-data.js`) aggregates the propagation ledger (`lcc_deal_comm_propagated.actions`) + the two
   deal-level writes it drove (comms_tick summary refresh, w7.2_tick dossier regen) into one deep-linked line
   per deal touched in 24h (new comms / summary refreshed / milestones written+rolled-up by key / to-dos /
   dossier). Rendered HTML+text (`renderDealPropagationDelta`), omitted entirely when empty.
3. **Incremental summary compression.** The summary row's `metadata` now persists `compressed_block` +
   `compressed_through_at`/`compressed_through_activity_id`. Next regeneration feeds the compressed history +
   only comms newer than the watermark (`buildIncrementalSummaryPrompt`), producing the new summary AND an
   updated compressed_block — no-fabrication extended to the compression (restate prior only). First run per
   deal (no watermark) = full-corpus as before. Input sizes logged (`slice=N/corpus`).
4. **Reply-SLA to-dos (deterministic, highest-ROI).** `lcc_deal_reply_sla_candidates(days,limit)` returns open
   in-scope deals (open bd_opportunity, not paused/on_hold) whose latest deal-stamped comm is INBOUND with
   >`DEAL_COMMS_REPLY_SLA_DAYS` (default 3) business days elapsed and no outbound since. The tick generates one
   guarded `reply_overdue` to-do per deal via a new `reply_sla` branch on `lcc_advance_todos` (existence-guard =
   one open per deal; an outbound reply auto-clears it). **Live dry-count: 1 deal currently trips the SLA**
   (Scott sanity-checks before enabling more broadly).

- Run-log: additive `milestones_rolled_up`, `reply_overdue_generated`.
- **Tests:** `deal-milestone-collapse.test.mjs` (8 — rank order, insert/roll-up/new-round incl. stale+regressed,
  idempotent noop, boundary cases), `deal-comms-incremental-summary.test.mjs` (3 — prompt slice + compressed_block
  round-trip), `deal-propagation-briefing-delta.test.mjs` (2 — ledger aggregation + empty-omit), and the extended
  `deal-comms-propagate-tick.test.mjs` (reply-SLA generate/dedupe/dry-count, rolled_up counting).
- **Reversal:** runbook in the migration header (`_lcc_milestone_collapse_20260806_backup` restore + revert the
  three functions).

### W7.3 — session log (call notes + Microsoft-side capture)
Branch `claude/call-notes-microsoft-capture-0eg1yp`. Migration
`20260821120000_lcc_w7_3_call_notes_capture.sql` (additive — feature_flags_registry row only; no new tables).

Three capture paths, ONE spine shape. Everything lands as `activity_events` (category `call`/`email`)
deal-stamped where known, through the EXISTING dual-anchor spine (`appendActivityEvent`) — so the LIVE
W7.2 tick propagates it with **zero new propagation code** (the tick keys on `metadata.deal_entity_id`).
The W7.2 tick was NOT touched.

- **A. Quick-log call (in-app).** New shared logger `logManualCallNote` (`api/_shared/intake-correspondence.js`)
  reuses the spine writer + Phase-1 `deriveNextStep`→`lcc_advance_todos` (a note that states a commitment
  produces that to-do). Route `POST /api/intake-log-call` (`intake.js::handleLogCall`). Frontend: a deal-surface
  **Log call** button in the entity slide-over header (`detail.js`, self-contained modal → `openCallNote`/
  `submitCallNote`), distinct from the existing Salesforce-task `openLogCall`. Ollama structuring
  (`structureCallNotes`) is PROPOSAL-ONLY + gated on `OLLAMA_URL`; any AI failure logs the raw notes unchanged.
- **B. Copilot actions.** `log_call_note` + `tag_comm_to_deal` (`operations.js`, registered in
  `ACTION_REGISTRY` + `ACTION_SCHEMAS` + both registry docs). Deal resolution NEVER guesses — ambiguous →
  candidates + writes nothing (`resolveDealByQuery`, no LLM in the gate). `tag_comm_to_deal` is the manual
  override for the 21 zero-match deals / matcher misses; idempotent, REFUSES a cross-deal re-stamp
  (`decideCommTagOutcome` → conflict surfaced).
- **C. Outlook category tagging (zero-UI, works at send time).** Receiver `POST /api/intake-tagged-comm`
  (`api/_handlers/intake-tagged-comm.js`, X-PA-Webhook-Secret auth, flag `TAGGED_COMM_INTAKE`). Resolves the
  deal by `LCC:<hint>` → sender (`lcc_resolve_contact`) → conversation continuity → else PARKS a
  `research_tasks` `tag_unresolved` row (idempotent) rather than guessing. Logs deal-stamped, idempotent on
  `internet_message_id`. PA flow spec: `docs/setup/OUTLOOK_CATEGORY_TAGGING_FLOW.md`.

- **Tests:** `test/manual-call-note.test.mjs` (14 — dual-anchor stamp, empty-notes skip, deterministic dedup,
  AI-fail→raw-text, no-anchor no-todo, structuring gated on OLLAMA_URL, resolver ambiguity/exact/none, tag
  outcome, category-hint parse) + `test/tagged-comm-receiver.test.mjs` (5 — hint/sender/conversation/unresolved
  resolution + idempotent parking). All pass; boot check + subroute-dispatch guard green.
- **Awaiting (env/connector, not code):** flip `TAGGED_COMM_INTAKE_ENABLED` + set `PA_WEBHOOK_SECRET` and build
  the PA flow (path C); `OLLAMA_URL` already live (Aug 4) so structuring is active. Paths A + B are live on
  redeploy. **Verify (Scott):** (1) quick-log a call on an open deal → next tick updates its summary + any
  commitment to-do; (2) from Copilot run `log_call_note` + `tag_comm_to_deal` on a real email; (3) categorize a
  sent email `LCC:<deal>` → receiver logs it deal-stamped. All three visible in the deal's next summary regen.

### W7.5 — session log (outbound loop closure + per-action summaries, 2026-08-06)
Branch `claude/outbound-loop-closure-xbsem3`.

The gap: `handleOutlookSent` (the outbound completion engine) was complete but **UNFED**, and the
tagged-comm receiver advanced to-dos for INBOUND mail only — so **sending** the email a to-do asked for
did not close the to-do. Three parts, one PR:

- **A. Outbound advance in the tagged path** (`api/_handlers/intake-tagged-comm.js`). When a tagged message
  is `outbound` and resolves a deal, the receiver now calls `lcc_advance_todos` (`p_channel='email',
  p_direction='outbound'`) + `lcc_reconcile_deal_todo` (non-destructive) — mirroring the inbound branch,
  same best-effort/never-block pattern. The existing 5-min tagged sweep then closes to-dos for tagged sends
  with zero new infra. The `advance` result is surfaced in the receiver response (dry-run observable).
- **B. Untagged sent-mail feed + cross-path de-dupe.** PA spec `docs/setup/OUTLOOK_SENT_SWEEP_FLOW.md` (5-min
  Graph sweep of Sent Items → `POST /api/intake-outlook-sent`, the existing engine; friendly alias added in
  `server.js`). Server-side cross-path de-dupe (`api/_shared/outbound-advance.js::findCrossPathDuplicate`):
  the same `internet_message_id` arriving via BOTH `outlook_tagged` and `outlook_sent` is caught (different
  `source_type`s dodge the per-path unique index) — the second path skips both the insert and the advance,
  so a to-do never advances twice for one send.
- **C. Per-action Ollama summary** (`api/_shared/action-summary.js`, flag `W75_ACTION_SUMMARY` default off,
  migration `20260823120000` — flag registered in `feature_flags_registry`, closing the W7.3 flag-row gap).
  After an advance, a one-line "action taken" narration is generated via `invokeExtractionAI` (Ollama),
  **validated** (only references to-dos actually touched — a fabricated label drops the whole summary), and
  stored in `activity_events.metadata.action_summary`, surfaced in the dossier correspondence section
  (`dossier-generator.js` + `entities-handler.js::buildDealPacket`). Failure = no summary, never an error.

- **Doctrine:** non-destructive on `deal_next_step` (reuses `lcc_reconcile_deal_todo`); reversible/metadata-
  stamped completions (reuses `lcc_advance_todos`, no new writer); idempotent on `internet_message_id` across
  both paths; flag-gated (Part C); flag registered in the migration.
- **Out of scope (need Scott decisions):** mailbox write-back (unflag/move/mark-read — needs Graph write
  scopes + a doctrine call on LCC mutating the mailbox), filing email bodies as deal-folder artifacts, SF
  parity for calls (generic "Call logged" Task).
- **Tests:** `test/outbound-loop-closure.test.mjs` (advance helper calls outbound + reconcile; cross-path
  de-dupe finds the other path; action-summary validator drops a fabricated to-do label; flag off → null;
  `touchedActionLabels` mapping) + park-lane regression retained in `test/tagged-comm-receiver.test.mjs`.
- **Awaiting (env/connector, not code):** Part A is live on redeploy (given `TAGGED_COMM_INTAKE_ENABLED`);
  Part B needs the Sent-Items PA flow; Part C needs `W75_ACTION_SUMMARY=true` (`OLLAMA_URL` already live).
  **Dry-run note:** with A merged + flag off, a tagged **outbound** send in prod shows `advance` results in
  the receiver response with **no** summary writes.
