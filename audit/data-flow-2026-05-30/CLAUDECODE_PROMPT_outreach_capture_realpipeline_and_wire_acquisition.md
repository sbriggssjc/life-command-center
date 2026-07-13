# Claude Code (life-command-center) — make outreach track Scott's REAL pipeline + wire the high-value worklist to the acquisition workers

## Why (grounded live on LCC Opps `xengecqvemvfknjvbvrq` 2026-07-13)

The outreach MACHINERY is healthy (reachability solved — 292/312 active cadences
have a contact; the SF-activity→cadence bridge advances — 27 cadences advanced in
30d; template_sends now records — 13). **But the system tracks a different
population than Scott actually works, and the highest-value targets can't enter
the pipeline at all:**

- Scott intensively works **~65 entities** (475 email/call/meeting events in 30d,
  ~7 each). **Only 24 of those 65 overlap the app's 312 cadences.** The other 254
  outreach-ready cadences are captured-owner *guesses*, sitting un-worked (only 38
  cadences have EVER been touched). **41 of the entities he actually contacts
  aren't tracked at all** — 24 assets (property-page activity) + 17 people (8
  SF-linked real contacts).
- The high-value owner worklist (`v_owner_contact_worklist`) has **353 owners at
  $1M+ ($1.17B), all contactless — and 352 have `enrichment_action=(none)`.** The
  worklist is a surface with **no worker draining it**: `owner-contact-enrich`
  only processes `owner_contact_pivot` rows, and the R16 SF-acquisition worker
  only processes contactless *cadences* — neither reaches these pre-cadence
  worklist owners. **37 of the 353 have an SF Account identity** — a cheap contact
  path (via `getSalesforceContactsByAccount`) that's currently unused.

Scott's decision (2026-07-13): **do both, sequenced** — Phase 1 capture his real
pipeline (fast, high-signal), then Phase 2 wire high-value acquisition.

## Phase 1 — capture Scott's real pipeline (grow cadences from actual outreach)

**Doctrine: repeated human outreach IS the BD signal.** A person Scott emails or
calls — especially repeatedly — is a real relationship regardless of portfolio
value; the app should track it (reminder, next-touch, measurement), not ignore it
because it fails a portfolio-value gate.

1. **Ground why R63 Unit 3 "grow-from-outreach" isn't firing** for the 65 worked
   entities. It exists (`sf-activity-ingest.js` grows a cadence when a real
   outreach event has BD signal and no cadence resolves) but only 24/65 overlap.
   Likely causes to confirm: (a) `entityHasBdSignal` (R63) rejects a bare person
   contact (no portfolio/opp/value) even when it's a real, repeatedly-worked SF
   contact; (b) for asset-resolved activity the owner-hop finds no owner cadence
   and doesn't grow one; (c) the grow path only fires on a fresh insert / specific
   category.
2. **Loosen the grow gate** so Scott's real work is captured:
   - An entity with a **Salesforce identity** OR **≥2 real outreach events** (a
     genuinely-worked relationship) qualifies to grow a cadence, even without
     portfolio value. (Keep the junk/implausible-name guards — don't grow on
     garbage; a real SF-linked person or a multiply-contacted entity is not junk.)
   - For **asset-resolved** outreach (24 of the 65): hop to the owner (the R10
     Unit 2 `owns` hop) and grow the OWNER's cadence if none exists, so
     property-page activity becomes owner cadence tracking.
   - The person Scott is emailing IS the contact — stamp the grown cadence's
     `contact_id` from the event's person entity so it's immediately
     outreach-ready (no re-acquisition).
3. **Result:** within a tick or two of Scott's normal SF outreach, the ~41
   untracked worked entities become tracked cadences on his real pipeline, and the
   cadence dashboard / focus session start reflecting what he actually does. The
   254 un-worked guess-cadences remain value-ranked below his real, actively-
   touched ones (they already sort by value; a touched cadence surfaces as
   engaged).
4. Reuse the single advance owner (`advanceCadence`) + `maybeSeedValuableCadence`
   / `getCadenceState` (idempotent, no dup). No double-advance (the grow path and
   the SQL trigger already coordinate via `skip_cadence_advance`). LCC-Opps only.

## Phase 2 — wire the high-value worklist to the acquisition workers

The 353 $1M+ contactless owners are the highest-value BD targets and nothing is
working them. Connect the surface to the workers:

1. **Proactively ensure a pivot + enrichment_action for every worklist owner**
   (not just on a button click). The Phase-5b `lcc_ensure_owner_pivot` already
   falls back to a `manual_research` pivot for a valued contactless worklist owner
   with no signals — run it across the worklist (a bounded sweep / fold into the
   `lcc-owner-contact-pivot-refresh` cron) so all 353 get a resolved
   `enrichment_action` instead of `(none)`. Then `owner-contact-enrich` can see
   them.
2. **Cheap win first — the 37 with an SF Account.** Wire the R16 SF-acquisition
   path (`getSalesforceContactsByAccount`) to run on worklist owners that carry a
   Salesforce Account identity (today it only runs on contactless *cadences*).
   Pull their SF contacts, attach via the shared `contact-attach` helper — no paid
   enrichment needed. That's 37 high-value owners reachable right now.
3. **The remaining ~315 need real acquisition.** These route to the enrichment
   adapters (`owner-contact-enrich` steps: attach-named-person / manager-drill /
   sos / address / web-search). The named-person + manager-drill classes resolve
   with no external config; sos/address/web-search are feature-flagged and
   currently unconfigured (`OWNER_ENRICH_WEBSEARCH_URL` / `_SOS_URL` /
   `_ADDRESS_URL`). Surface (in the run report / worklist) how many resolve for
   free vs how many need a configured adapter, so Scott can make the
   paid-web-search / walled-SOS cost call with real numbers — OR work them as a
   manual acquisition worklist (the Phase-5b "Run lookup" / manual path).
4. **Closes the loop into Phase 1:** once a contact attaches to a $1M+ owner, the
   already-built `maybeSeedValuableCadence` wire seeds a value-gated cadence → it
   enters Phase 1's captured pipeline and surfaces at the TOP of the value-ranked
   focus session. So Phase 2 feeds Phase 1, and the highest-value owners finally
   become workable outreach.

## Boundaries / verify

- life-command-center (`sf-activity-ingest.js` / `cadence-engine.js` grow-gate;
  `owner-contact-enrich.js` + the pivot-ensure sweep; the R16 SF path wired to the
  worklist; `contact-attach.js` reuse); LCC-Opps only, no dia/gov writes; reuse
  the single advance owner + the shared attach/seed helpers; no new api/*.js
  (stays 12); additive migrations only (pivot-ensure sweep / cron). Reversible.
- **Verify (live):** after Phase 1, a fresh outreach event on an untracked
  SF-linked person or a twice-worked entity grows a tracked cadence with the
  contact stamped (the 41 untracked → tracked; distinct-entities-with-cadence
  climbs from 24 toward 65). After Phase 2, all 353 worklist owners carry a real
  `enrichment_action` (0 `(none)`), the 37 SF-account owners acquire contacts +
  seed cadences, and the run report quantifies free-resolve vs needs-adapter for
  the rest.
- `node --check`; suite green; tests: the loosened grow-gate grows on an SF-linked
  person / a ≥2-event entity but NOT on junk / a single low-value stranger; the
  worklist SF-account path attaches a contact + seeds a cadence.

## Documentation

Update CLAUDE.md: cadence grow-from-outreach now captures Scott's real pipeline
(SF-linked or ≥2-event entities grow a tracked cadence, asset activity hops to the
owner); the high-value owner worklist is wired to the acquisition workers
(proactive pivot-ensure, SF-account contact pull for the cheap subset, adapters
for the rest) and feeds the cadence seed on attach. The system now tracks what
Scott actually works and can build the $1M+ list.

## Bottom line

The outreach loop closes mechanically but tracks the wrong population: Scott works
65 real entities the app mostly doesn't know about, while 254 guessed cadences sit
un-worked and 353 $1M+ owners can't enter the pipeline. Phase 1 captures his real
outreach as tracked cadences; Phase 2 wires the high-value worklist to the workers
(37 free via SF now, the rest quantified for the acquisition-cost call) and feeds
them back into the cadence — so the app finally supports the work he's really
doing AND builds toward the highest-value targets.
