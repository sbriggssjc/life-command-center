// dc-lanes.js — Decision Center FEDERATED lane meta + card renderers + verdict
// handlers, extracted verbatim from ops.js (W6.5 Stage 1, Prompt 87).
//
// LOADING MODEL: this is a CLASSIC (non-module) <script>, loaded in index.html
// immediately BEFORE ops.js. All symbols here share the same global lexical/
// window scope as ops.js (Railway/Express serves these files statically from the
// repo root; there is no bundler). This file therefore both USES ops.js globals
// (opsApi, esc, showToast, lccPrompt, lccConfirm, openUnifiedDetail, navTo,
// opsErrorState, _dcCurrentOpenExpr, _dcNextLaneCTA) and EXPORTS the federated
// lane surface ops.js references by name (renderFederatedLane, _DC_FED_META,
// _fedCardHTML, _DC_BULK_SAFE, dcFed, dcFed* verdict helpers) — all at call time,
// so behavior is byte-identical to the pre-split single file. _DC_FEDERATED and
// the seeded-lane renderers deliberately STAY in ops.js (they partition the DC
// lane list and are used throughout). See docs/architecture/
// w6-5-frontend-decomposition-map.md for the staged plan.

// ── Federated decision lanes (R7 Phase 2) ─────────────────────────────────
// List-federated lanes read top-N straight from a source view; a decision row
// is minted at verdict time. Same card anatomy + self-propelling advance as the
// seeded lanes; verdicts post {type, subject, verdict} to /api/decision-verdict.
let _dcFedArr = [];
let _dcFedType = null;
const _DC_FED_META = {
  intake_disposition: { title: 'Staged intake — needs review',
    intro: 'Genuine new-listing candidates (unmatched OM / flyer / brochure with extracted data), value-ranked by asking price. Create the property, re-extract (OCR), dismiss, or research. Use “Show all” to also see already-matched rows (open / promote) and market-blast noise; empty extractions are auto-retired.' },
  property_merge: { title: 'Property merges & duplicates',
    intro: 'Properties sharing a normalized address. Are they the same property? Compare & merge via the consolidate flow, mark “Not a duplicate”, or send to research.' },
  provenance_conflict: { title: 'Data conflicts & provenance',
    intro: 'Cross-table field-write conflicts (price/rent/cap fields first) + sales-price xref conflicts. Keep the current value, accept the attempted value (queued to the manual-edit path), or research.' },
  pending_update: { title: 'Pending updates (Gov)',
    intro: 'Proposed gov field updates awaiting a decision. Apply (→ approved, the gov pipeline applies it) or reject (→ rejected), or send to research.' },
  cms_link_suspect: { title: 'CMS ↔ property link suspects',
    intro: 'Clinic↔property links the un-truncation pass flagged (state mismatch worst-first). Confirm the link is correct, break it (via the cms-match unlink), or research.' },
  implausible_value: { title: 'Implausible values',
    intro: 'Sales over the per-domain magnitude soft-ceiling, retained for review. Confirm the price as real, correct it, void it (queued), or research.' },
  merge_duplicate_entities: { title: 'Duplicate entities — merge',
    intro: 'High-confidence duplicate-entity groups (same normalized name). Merge collapses the duplicates into the surviving entity (carries portfolio + identities + relationships); keep separate if they are genuinely distinct, or research.' },
  caprate_review: { title: 'Cap-rate review — suspect movers',
    intro: 'Parked cap-rate recomputes (low-confidence or out-of-band), ranked by $ impact = price × |old − recomputed cap|. Apply the recompute (bounded, reversible), keep the original, route to the bad-rent lane (the cap is wrong because the rent is), or research.' },
  bad_rent_lease: { title: 'Bad-rent leases — fix at source',
    intro: 'Cap-review rows flagged as bad RENT (implausible gross yield), ranked by $ value, with the plausible rent band + the offending lease. Fix the rent AT SOURCE (never auto-corrected) — the recompute then refreshes the caps. Mark fixed, confirm the rent is genuinely right, or research.' },
  resolve_owner_parent: { title: 'Owner → ultimate parent',
    intro: 'Sponsor clusters mined from UNRESOLVED current-owner LLC/LP shells (gov + dia), ranked by $ rent. “high” = a fund numeral varies across the shells (SPUS6/7/8…). Confirm the controlling parent (registers it + rolls the shells up to it), name the parent yourself, or mark the owner a genuine independent. Never auto-merged — you confirm.' },
  listing_event_action: { title: 'New sales → act',
    intro: 'A closed sale is the next BD action, value-ranked by sale price. Nurture the seller (past/known owner — seed a relationship cadence, never auto-send), open the new-owner relationship (the buyer is a future seller; if a registered buyer parent, use the P-BUYER path), pursue the cohort fan-out (same-owner / recent-buyer / geographic neighbors), flag a sale-leaseback advisory angle, or dismiss. Each verdict marks the event processed.' },
  resolve_ownership: { title: 'Resolve ownership & control',
    intro: 'One card per gov property, reconciling every ownership signal we hold — the recorded deed grantee, a GSA/state lessor-name change, and pending owner discrepancies — into a single decision, value-ranked by rent (fresh signals first). Each card shows the current recorded owner → the best proposed owner + the evidence that fired. Update the owner (a guard-passing deed grantee applies through the priority gate; a lessor/discrepancy proposal writes the true owner when the gov write-back is enabled), confirm a sale (you supply the price — writes a real sales row), keep the current owner (stops asking), or research. spe_vs_parent is excluded (recorded owner already equals the parent). This ONE lane replaces the old owner-vs-deed / suspected-sale / pending-ownership-discrepancy lanes.' },
  owner_source_conflict: { title: 'Owner vs deed — who took title',
    intro: 'The recorded deed grantee (legal title) disagrees with the recorded owner (gov + dia), value-ranked by rent. Accept the deed (it wins through the priority gate; true owner re-resolves), clear a broker-as-owner, keep the current owner (a legit parent-vs-SPE), or research. spe_vs_parent is excluded (default keep).' },
  suspected_sale: { title: 'Suspected unrecorded sales',
    intro: 'An ownership CHANGE we never recorded as a sale (gov), value-ranked by rent — a NEW GSA lessor with no recorded sale, or a deed grantee that disagrees with the prior owner with no recorded sale. Each is a LEAD, not a fact: confirm the sale (you supply the price — it writes a real sales row, cap rate computes), mark “not a sale” (refinance / name correction — stops asking), or send to research to find the price/date/buyer. We never fabricate a price.' },
  loan_maturity: { title: 'Loan maturities → refi or sell',
    intro: 'A property whose CURRENT debt matures within 24 months — or is already matured — (gov + dia), value-ranked by rent; a DISTRESSED loan (watchlist / special servicing / delinquent / DSCR<1) ranks first. A maturity wall forces the owner to refinance or sell — that is the BD opening. Pursue refi (advisory/refi outreach on the owner), pursue disposition (the owner may sell), mark not relevant (stops asking), or research. No domain write — this is a BD signal.' },
  contact_company_link: { title: 'Contact → company owner',
    intro: 'A person contact whose company name resolves to owner org(s) by NAME — the tiers the exact-core auto-apply worker leaves for a human (LLC names are where false positives live). exact_ambiguous = the exact name maps to >1 owner org (pick which); fuzzy = a distinctive shared name-core (e.g. Starwood Capital Group ↔ Starwood REIT). Value-ranked by the candidate owner’s rent. Link the person to the chosen owner (attaches a real contact edge), mark “not a match” (stops asking), or research.' },
  owner_reconcile: { title: 'Owner reconcile — same party?',
    intro: 'Candidate SAME-PARTY owner pairs from three sources folded into one drain: the ORE multi-signal engine (LCC — verdicts only, auto-merge is OFF), the gov owner-unification queue, and gov+dia entity-match candidates. Each card shows the two owner records plus the evidence that linked them. Approve (LCC pairs merge via lcc_merge_entity; gov/dia rows are dispositioned — the domain merge is the resolver job), reject (records them distinct), or research. Every verdict is recorded so it is not re-asked AND writes a labeled pair into entity_match_labels — the training corpus for the Wave 4 resolver.' },
  sf_link_candidate: { title: 'Salesforce link — confirm candidate',
    intro: 'The W4.3 splink batch’s best Salesforce-account match per owner (gov + dia), value-ranked by owner impact. Link attaches the SF id via the existing owner-sync semantics (never overwrites a different existing id — that renders a three-way conflict card instead); Not a match records the pair distinct. Every verdict writes a labeled pair into entity_match_labels — the hard-negative training data the W4.4 retrain needs. Work them fast; the population is homogeneous (~0.85 probability), so trust your eyes per row.' },
  junk_entity_review: { title: 'Junk entities — Ollama pre-screen',
    intro: 'W8 U1 hygiene. A deterministic filter flagged possible junk / test / gibberish / bookkeeping-stub entity rows across dia/gov/ops; the local Ollama model scored each with a verdict + a verbatim evidence quote. Ollama PROPOSES only — you decide. Confirm applies the proposal (a "dismiss" soft-retires the row reversibly; a row still referenced by child records routes to a conflict card instead of retiring — never a hard delete). Keep leaves the row untouched. Every verdict is recorded (won’t re-ask) with a reversible ledger entry.' },
  naming_hygiene_review: { title: 'Naming hygiene — rename / link',
    intro: 'W8 U5 hygiene. A deterministic filter flagged entity names that are ABBREVIATED (Prtnrs, Mgmt, Hldgs…) or an ADDRESS mis-entered as a name. Two fixes: a RENAME expands the abbreviation (deterministic dictionary expansions are unambiguous and one-click bulk-confirmable; ambiguous tokens were judged by Ollama in context), or a LINK attaches an address-named entity to its property (with a fill-blanks display name from the property owner). PROPOSES only — you decide. Confirm applies the rename (reversible ledger + provenance; a canonical-name collision routes to a conflict, never a silent clobber) or the property link; Keep leaves the row untouched. Every verdict is recorded (won’t re-ask).' },
  reachability_harvest_review: { title: 'Contact reachability — internal harvest',
    intro: 'W9.2 data-connectedness. Domain contacts (dia 71% / gov 68%) are missing an email AND a phone; this lane fills the blank from sources LCC ALREADY HOLDS. A DETERMINISTIC fill (arm=deterministic) is arithmetic — the SAME person\'s synced SF record (matched by identity key, not name-fuzz) carries the value, confidence 1.0, one-click bulk-confirmable. An LLM fill (arm=llm) was attributed from an intake snapshot naming this person, and carries a VERBATIM quote containing the value (a value not in the quote is dropped). PROPOSES only — you decide. Confirm runs the fill-blanks writer (domain contacts email/phone + provenance, reversible; a now-populated field routes to a conflict, never a clobber); Keep leaves it untouched. External acquisition (SOS/deed) is W9.1, not this lane.' },
  contact_acquisition_review: { title: 'Contact acquisition — owner outreach',
    intro: 'W9.1 data-connectedness (Stage 1, internal sources). A value-ranked owner with NO contact on file. The engine ran the sanctioned chain — cross-reference (the same person already a contact under a related owner), institution registry, the owner\'s own deed signatory, and the OM listing broker-of-record — stopping at the first hit. An ATTACH links an EXISTING person; a CREATE mints a lane-only contact from a deed signatory or a broker (a broker is typed broker-of-record, NEVER the owner\'s own contact). PROPOSES only — you decide. Confirm resolves it into the graph (associated_with edge + a value-gated cadence, reversible via the ledger); Reject keeps the owner untouched. Stage 2 (SOS-direct) is a separate lane. Every verdict is recorded (won\'t re-ask).' },
  comms_owner_attribution_review: { title: 'Correspondence → owner attribution',
    intro: 'W9.6 data-connectedness. Correspondence is stamped with the deal / party / property entity the resolver found — brokers, buyers, seller contacts — NOT the owning LLC, so an email about a property never surfaces against the owner you\'re trying to reach. This lane closes that gap. PATH A (property bridge) is arithmetic: the thread\'s entity resolves to an ASSET, and the ops graph owns-links it to a single current true_owner — one-click bulk-confirmable. PATH B (person match) attributes a thread whose correspondent is a PERSON tied to a single owner (the owner\'s active contact, or an unambiguous person→owner edge); it carries the correspondent\'s VERBATIM header name/email and a shared-token-only name bridge is rejected. PROPOSES only — you decide. Confirm attributes the thread to the owner (appends the owner ops entity to the correspondence rows\' anchors, reversible) so the owner\'s record shows its correspondence AND the reachability harvester can mint owner contacts from it; Reject keeps it untouched. Every verdict is recorded (won\'t re-ask).' },
  owner_contact_attach_review: { title: 'Owner contacts — attach or reject',
    intro: 'Prompt 114. Contacts we already hold that are BOUND to an owner in dia/gov but could not be attributed automatically. ⚠ Read the shape badge before acting — this lane holds two different things and one of them is mostly rejects. A PERSON card proposes a real human: confirm mints/links them to the owner as a related contact (never stamped onto the org record) and the owner panel immediately reads "Reach via …". An ORG card is usually the BUYER or SELLER of a transaction on the owner\'s property — a different company entirely (e.g. "NGP Capital" ← "CoreCivic, Inc.") — and should be rejected; the exception is a name VARIANT of the owner itself ("Easterly Gov Properties (REIT)" ↔ "Easterly Government Properties, Inc."), flagged "same party", where confirm fills the owner\'s own blank email/phone. Cards marked "undecidable" are yours to judge: the names overlap but one side adds distinct material. Value-ranked by owner rent; owners that became reachable some other way drop out automatically. Every verdict is reversible and recorded (won\'t re-ask).' },
  w8_u3_link_review: { title: 'Ownership links — Ollama proposals',
    intro: 'W8 U3 connection-propagation. Ollama proposed an ownership link from a real signal: a CHAIN proposal fills a missing owner→parent/developer edge for a property (source = a deed/OM/registry evidence quote), or a DIFFERENT-PEOPLE finding flags that two email-sharing person records are NOT the same person (a shared mailbox). Each card shows the proposed link + role, the confidence, and the VERBATIM evidence quote + its source. Ollama PROPOSES only — you decide. Confirm runs the deterministic edge writer (entity_relationships + provenance, recorded in w8_u3_link_apply_log so it is reversible; a same-person email proposal routes to the resolver, never auto-merged); Reject keeps the records untouched. Every verdict is recorded (won’t re-ask).' },
  agency_risk_action: { title: 'Agency risk → disposition',
    intro: 'W5.2. A gov agency risk composite (spending decline / footprint reduction / RIF signals) with tracked portfolio exposure, value-ranked. A high-risk agency on properties we track is a disposition signal — reach the owners. Pursue disposition (BD outreach on the tracked portfolio), monitor (keep watching), or dismiss (stops asking). No domain write — this is a BD signal.' },
  npi_dedup_review: { title: 'NPI duplicates → review',
    intro: 'W5.2. A dia duplicate-NPI cluster the deterministic gate flagged as a genuine data error needing human eyes. Confirm duplicate marks the cluster for the resolver/worker to collapse; Not a duplicate records them distinct. NEVER a silent auto-collapse — you decide.' },
  property_twin: { title: 'Property address twins (dia)',
    intro: 'A geocoded dia property with NO Medicare CCN sitting on top of a CMS-anchored clinic — the same building captured twice (the shadow carries the CRE/deal data; the anchor carries the census). The blank-operator husks already auto-merged; these have a competing identity (operator conflict, a distinct clinic name, or multiple anchors), so YOU decide. Merge folds the shadow into the CCN anchor via the REVERSIBLE wrapper (snapshot-before-delete, undoable). Not a twin = distinct co-located clinics (e.g. a Fresenius and a DaVita in one plaza). Research sends it out for confirmation.' },
  npi_dedup_autoapprove: { title: 'NPI duplicates → approve',
    intro: 'W5.2. A dia duplicate-NPI cluster the deterministic gate scored auto-resolvable — a proposed survivor is shown. A human APPROVES the deterministic survivor (fill-blanks / never-guess applies to destructive dedup too), or rejects it. Approval spawns the reconcile task; the actual merge stays human/worker-driven — NEVER a silent auto-collapse.' },
};

function _fedMoney(n) { n = Number(n); return (isFinite(n) && n > 0) ? '$' + Math.round(n).toLocaleString() : ''; }

function _fedCardHTML(it, i, isNext) {
  const c = it.context || {};
  let body = '', actions = '';
  if (_dcFedType === 'intake_disposition') {
    const ask = _fedMoney(c.asking_price);
    const suspect = !!c.asking_price_suspect;   // implausible price (multi-property mash-up)
    const klass = c.klass || 'other';
    const loc = [c.city, c.state].filter(Boolean).join(', ');
    // openable iff the row matched a dia/gov property with a numeric id.
    const odom = (c.match_domain === 'dia' || c.match_domain === 'dialysis') ? 'dia'
      : (c.match_domain === 'gov' || c.match_domain === 'government') ? 'gov' : null;
    const opid = (c.match_property_id != null && /^\d+$/.test(String(c.match_property_id)))
      ? String(c.match_property_id) : null;
    const matchTxt = (klass === 'matched')
      ? ('matched' + (c.match_domain ? ' · ' + c.match_domain : '') + (c.match_property_id ? ' #' + esc(String(c.match_property_id)) : ''))
      : (c.match_status || 'unmatched');
    const title = c.address || c.tenant || ('Intake ' + String(c.intake_id || '').slice(0, 8));
    // Suspect price → a warning badge (needs re-extract), not a clean $750T deal.
    const priceBadge = suspect
      ? '<span class="q-badge pri-high">⚠ price looks wrong' + (ask ? ' (' + ask + ')' : '') + '</span>'
      : (ask ? '<span class="q-badge">' + ask + '</span>' : '');
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(title) + '</span>'
      + '<div class="q-item-badges">'
      + priceBadge
      + '<span class="q-badge">' + esc(c.doctype || 'unknown doctype') + '</span>'
      + (c.multi_property ? '<span class="q-badge pri-high">multi-property OM — needs split</span>' : '')
      + '<span class="q-badge' + (klass === 'matched' ? ' type' : '') + '">' + esc(matchTxt) + '</span>'
      + '</div></div>'
      + ((c.tenant && c.tenant !== title) ? '<div class="q-item-meta">Tenant: <b>' + esc(c.tenant) + '</b></div>' : '')
      + '<div class="q-item-meta">' + (loc ? esc(loc) + ' · ' : '')
      + (c.cap_rate_display ? 'cap ' + esc(c.cap_rate_display) + ' · ' : '')
      + 'source ' + esc(c.source_type || '') + '</div>';
    if (klass === 'matched') {
      // Already tied to a property — open / promote, NEVER create.
      const openBtn = (odom && opid)
        ? '<button class="q-action primary" onclick="dcFed(' + i + ',\'open_property\')">Open property →</button>' : '';
      actions = openBtn
        + '<button class="q-action' + (openBtn ? '' : ' primary') + '" onclick="dcFed(' + i + ',\'dismiss\')">Dismiss</button>'
        + '<button class="q-action" onclick="dcFed(' + i + ',\'research\')">Research</button>';
    } else if (klass === 'noise') {
      // Broker blast / comp — market intel, not a property to create.
      actions = '<button class="q-action primary" onclick="dcFed(' + i + ',\'dismiss\')">Dismiss</button>'
        + '<button class="q-action" onclick="dcFed(' + i + ',\'research\')">Research</button>';
    } else {  // create_candidate / other
      actions = '<button class="q-action primary" onclick="dcFed(' + i + ',\'create_property\')">Create property →</button>'
        + '<button class="q-action" onclick="dcFed(' + i + ',\'reextract\')">Re-extract (OCR)</button>'
        + '<button class="q-action" onclick="dcFed(' + i + ',\'dismiss\')">Dismiss</button>'
        + '<button class="q-action" onclick="dcFed(' + i + ',\'research\')">Research</button>';
    }
  } else if (_dcFedType === 'property_merge') {
    const dom = c.domain, pid = c.property_id;
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(c.address || ('Property ' + pid)) + '</span>'
      + '<div class="q-item-badges"><span class="q-badge">' + esc(dom || '') + '</span>'
      + (c.cluster_size ? '<span class="q-badge">' + c.cluster_size + ' share this address</span>' : '') + '</div></div>'
      + '<div class="q-item-meta">' + esc(c.state || '') + (c.label ? ' · ' + esc(c.label) : '')
      + ' · property ' + esc(String(pid)) + ' — same property as its address-mates, or distinct?</div>';
    // Merge is destructive (keep/drop is a BD judgment) → route to the existing
    // consolidate surface; the inline verdicts are the safe ones.
    const openDetail = (dom && pid != null && typeof openUnifiedDetail === 'function')
      ? '<button class="q-action primary" onclick="openUnifiedDetail(\'' + esc(dom) + '\', {property_id: ' + esc(String(pid)) + '}, {}, \'Overview\')">Compare &amp; merge →</button>' : '';
    actions = openDetail
      + '<button class="q-action" onclick="dcFed(' + i + ',\'not_duplicate\')">Not a duplicate</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'research\')">Research</button>';
  } else if (_dcFedType === 'property_twin') {
    // dia geospatial address twin awaiting a human verdict. keep = the CCN anchor,
    // drop = the shadow; both are derived server-side on merge (reversible).
    const dist = (c.distance_miles != null) ? (Number(c.distance_miles).toFixed(3) + ' mi apart') : '';
    const clsLabel = { review_conflict: 'operator conflict', review_name: 'clinic name differs',
      review_ambiguous: 'multiple anchors', review_blank_far: 'blank tenant, farther' };
    const clsTone = (c.classification === 'review_conflict' || c.classification === 'review_ambiguous') ? 'pri-high' : 'type';
    const title = c.anchor_address || c.shadow_address || ('Property ' + c.shadow_property_id);
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(title) + '</span>'
      + '<div class="q-item-badges"><span class="q-badge">dia</span>'
      + '<span class="q-badge ' + clsTone + '">' + esc(clsLabel[c.classification] || c.classification || '') + '</span>'
      + (dist ? '<span class="q-badge">' + esc(dist) + '</span>' : '')
      + (c.anchor_chairs != null ? '<span class="q-badge">' + esc(String(c.anchor_chairs)) + ' chairs</span>' : '')
      + '</div></div>'
      + '<div class="q-item-meta">' + esc((c.city || '') + (c.state ? ', ' + c.state : '')) + '</div>'
      + '<div class="q-item-meta">Shadow (no CCN): <b>' + esc(c.shadow_address || ('#' + c.shadow_property_id)) + '</b>'
        + (c.shadow_tenant ? ' — ' + esc(c.shadow_tenant) : ' — (blank tenant)') + '</div>'
      + '<div class="q-item-meta">Anchor (CCN ' + esc(c.anchor_medicare_id || '?') + '): <b>' + esc(c.anchor_address || ('#' + c.anchor_property_id)) + '</b>'
        + (c.anchor_tenant ? ' — ' + esc(c.anchor_tenant) : '') + '</div>'
      + '<div class="q-item-meta" style="opacity:.7">Same building, or distinct co-located clinics? Merge folds the shadow into the CCN anchor (reversible).</div>';
    // Prompt 106: the property_twin_assist annotation (deterministic pre-rank or
    // Ollama residue). Suggestion + confidence + reason + verbatim evidence. It
    // ANNOTATES only — you still decide.
    var pta = c.assist;
    if (pta && pta.verdict) {
      var sugLabel = { merge: 'likely twin — merge', not: 'likely distinct — not a twin', uncertain: 'needs judgment' };
      var sugTone = pta.verdict === 'merge' ? 'type' : (pta.verdict === 'not' ? 'pri-high' : '');
      var conf = (pta.confidence != null) ? (' · ' + Math.round(Number(pta.confidence) * 100) + '%') : '';
      var layerTxt = pta.layer === 'deterministic' ? 'deterministic' : (pta.layer === 'llm' ? 'assist' : '');
      body += '<div class="q-item-meta" style="margin-top:4px">'
        + '<span class="q-badge ' + sugTone + '">' + esc(sugLabel[pta.verdict] || pta.verdict) + conf + '</span> '
        + (layerTxt ? '<span class="q-badge">' + esc(layerTxt) + '</span> ' : '')
        + (pta.reason ? esc(pta.reason) : '') + '</div>'
        + (pta.evidence_quote ? '<div class="q-item-meta" style="opacity:.7">evidence: <i>' + esc(pta.evidence_quote) + '</i></div>' : '');
    }
    actions = '<button class="q-action primary" title="Fold the shadow into the CCN anchor via the reversible wrapper (undoable via dia_unmerge_property)." onclick="dcFed(' + i + ',\'merge\')">Merge into anchor →</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'not_twin\')">Not a twin</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'research\')">Research</button>';
  } else if (_dcFedType === 'resolve_ownership') {
    const pid = c.property_id;
    const rent = _fedMoney(c.annual_rent);
    const rec = c.recommended_action || 'confirm';
    // Human-readable signal chips from the evidence array.
    const ev = Array.isArray(c.evidence) ? c.evidence : [];
    const sigLabel = { deed_grantee: 'Deed grantee', gsa_lessor_change: 'GSA lessor changed',
      state_lessor_change: 'State lessor changed', discrepancy: 'Owner discrepancy' };
    const chips = ev.map(function (e) {
      var s = (e && e.signal) || '';
      return '<span class="q-badge">' + esc(sigLabel[s] || s) + '</span>';
    }).join('');
    const recBadge = rec === 'auto_update' ? '<span class="q-badge type">high-confidence deed</span>'
      : rec === 'enrich' ? '<span class="q-badge pri-high">no recorded owner</span>' : '';
    const recency = (c.recency_band && c.recency_band !== 'fresh')
      ? '<span class="q-badge">' + esc(c.recency_band) + '</span>' : '';
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(c.address || ('Property ' + pid)) + '</span>'
      + '<div class="q-item-badges"><span class="q-badge">gov</span>' + chips + recBadge + recency
      + (rent ? '<span class="q-badge">' + rent + '</span>' : '') + '</div></div>'
      + '<div class="q-item-meta">' + esc((c.city || '') + (c.state ? ', ' + c.state : ''))
        + (c.agency ? ' · ' + esc(c.agency) : '') + ' · property ' + esc(String(pid)) + '</div>'
      + '<div class="q-item-meta">Recorded owner: <b>' + esc(c.recorded_owner_name || '?') + '</b>'
        + ' &rarr; proposed: <b>' + esc(c.proposed_owner_name || '?') + '</b></div>'
      + (c.true_owner_name ? '<div class="q-item-meta">True owner: ' + esc(c.true_owner_name) + '</div>' : '')
      + (c.most_recent_signal_date ? '<div class="q-item-meta">Latest signal: ' + esc(String(c.most_recent_signal_date)) + '</div>' : '');
    // Update owner is the primary action; a sale-shaped change also offers "confirm sale".
    const canSale = !!(c.has_lessor_signal || c.has_deed_signal);
    actions = '<button class="q-action primary" onclick="dcFed(' + i + ',\'update_owner\')">Update owner &rarr;</button>'
      + (canSale ? '<button class="q-action" onclick="dcResolveConfirmSale(' + i + ')">Confirm sale (enter price) →</button>' : '')
      + '<button class="q-action" onclick="dcFed(' + i + ',\'keep\')">Keep current</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'research\')">Research</button>';
  } else if (_dcFedType === 'owner_source_conflict') {
    const dom = c.domain, pid = c.property_id;
    const kind = c.conflict_kind || '';
    const rent = _fedMoney(c.annual_rent);
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(c.address || ('Property ' + pid)) + '</span>'
      + '<div class="q-item-badges"><span class="q-badge">' + esc(dom || '') + '</span>'
      + '<span class="q-badge' + (kind === 'broker_as_owner' ? ' pri-high' : '') + '">' + esc(kind) + '</span>'
      + (rent ? '<span class="q-badge">' + rent + '</span>' : '') + '</div></div>'
      + '<div class="q-item-meta">' + esc((c.city || '') + (c.state ? ', ' + c.state : '')) + ' · property ' + esc(String(pid)) + '</div>'
      + '<div class="q-item-meta">Recorded owner: <b>' + esc(c.recorded_owner_name || '?') + '</b></div>'
      + '<div class="q-item-meta">Deed grantee (title): <b>' + esc(c.latest_deed_grantee || '?') + '</b>'
        + (c.latest_deed_date ? ' · ' + esc(String(c.latest_deed_date)) : '') + '</div>'
      + (c.true_owner_name ? '<div class="q-item-meta">True owner: ' + esc(c.true_owner_name) + '</div>' : '');
    const acceptLabel = (kind === 'broker_as_owner')
      ? '<button class="q-action primary" onclick="dcFed(' + i + ',\'broker_not_owner\')">Clear broker → set deed owner</button>'
      : '<button class="q-action primary" onclick="dcFed(' + i + ',\'accept_deed\')">Accept deed owner →</button>';
    actions = acceptLabel
      + '<button class="q-action" onclick="dcFed(' + i + ',\'keep_current\')">Keep current</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'research\')">Research</button>';
  } else if (_dcFedType === 'provenance_conflict') {
    if (c.kind === 'sales_price_xref') {
      body = '<div class="q-item-header"><span class="q-item-title">Sales-price xref conflict</span>'
        + '<div class="q-item-badges"><span class="q-badge">dia</span></div></div>'
        + '<div class="q-item-meta">' + esc(c.detail_1 || '') + (c.detail_2 ? ' vs ' + esc(c.detail_2) : '')
        + (c.detail_3 ? ' · ' + esc(c.detail_3) : '') + '</div>';
      actions = '<button class="q-action primary" onclick="dcFed(' + i + ',\'keep_current\')">Keep current</button>'
        + '<button class="q-action" onclick="dcFed(' + i + ',\'accept_attempted\')">Accept attempted</button>'
        + '<button class="q-action" onclick="dcFed(' + i + ',\'research\')">Research</button>';
    } else {
      body = '<div class="q-item-header"><span class="q-item-title">' + esc((c.target_table || '') + '.' + (c.field_name || '')) + '</span>'
        + '<div class="q-item-badges"><span class="q-badge">' + esc(c.target_database || '') + '</span>'
        + '<span class="q-badge">' + esc(c.enforce_mode || '') + '</span></div></div>'
        + '<div class="q-item-meta">record ' + esc(String(c.record_pk_value || '')) + '</div>'
        + '<div class="q-item-meta">Current (<b>' + esc(c.current_source || '?') + '</b>): ' + esc(JSON.stringify(c.current_value)) + '</div>'
        + '<div class="q-item-meta">Attempted (<b>' + esc(c.attempted_source || '?') + '</b>): ' + esc(JSON.stringify(c.attempted_value)) + '</div>';
      actions = '<button class="q-action primary" onclick="dcFed(' + i + ',\'keep_current\')">Keep current</button>'
        + '<button class="q-action" onclick="dcFed(' + i + ',\'accept_attempted\')">Accept attempted</button>'
        + '<button class="q-action" onclick="dcFed(' + i + ',\'skip\')">Skip</button>';
    }
  } else if (_dcFedType === 'pending_update') {
    body = '<div class="q-item-header"><span class="q-item-title">' + esc((c.table_name || '') + '.' + (c.field_name || '')) + '</span>'
      + '<div class="q-item-badges"><span class="q-badge">gov</span>'
      + (c.confidence != null ? '<span class="q-badge">conf ' + esc(String(c.confidence)) + '</span>' : '') + '</div></div>'
      + '<div class="q-item-meta">property ' + esc(String(c.property_id || '')) + (c.reason ? ' · ' + esc(c.reason) : '') + '</div>'
      + '<div class="q-item-meta">' + esc(JSON.stringify(c.old_value)) + ' → <b>' + esc(JSON.stringify(c.new_value)) + '</b></div>';
    actions = '<button class="q-action primary" onclick="dcFed(' + i + ',\'apply\')">Apply</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'reject\')">Reject</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'research\')">Research</button>';
  } else if (_dcFedType === 'cms_link_suspect') {
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(c.cms_facility_name || ('Clinic ' + c.medicare_id)) + '</span>'
      + '<div class="q-item-badges"><span class="q-badge">' + esc(c.suspect_kind || '') + '</span>'
      + (c.street_looks_unrelated ? '<span class="q-badge pri-high">street differs</span>' : '')
      + (c.zip5_matches ? '<span class="q-badge">zip matches</span>' : '') + '</div></div>'
      + '<div class="q-item-meta">CMS: ' + esc(c.cms_address || '') + ', ' + esc(c.cms_city || '') + ' ' + esc(c.cms_state || '') + '</div>'
      + '<div class="q-item-meta">Property ' + esc(String(c.property_id)) + ': ' + esc(c.property_address || '') + ', ' + esc(c.property_city || '') + ' ' + esc(c.property_state || '') + '</div>';
    actions = '<button class="q-action primary" onclick="dcFed(' + i + ',\'link_correct\')">Link is correct</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'break_link\')">Break link</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'research\')">Research</button>';
  } else if (_dcFedType === 'implausible_value') {
    body = '<div class="q-item-header"><span class="q-item-title">' + _fedMoney(c.sold_price) + '</span>'
      + '<div class="q-item-badges"><span class="q-badge">' + esc(c.domain || '') + '</span>'
      + '<span class="q-badge">ceiling ' + _fedMoney(c.ceiling) + '</span></div></div>'
      + '<div class="q-item-meta">' + esc(c.address || '') + (c.city ? ', ' + esc(c.city) : '') + (c.state ? ' ' + esc(c.state) : '')
      + (c.label ? ' · ' + esc(c.label) : '') + ' · ' + esc(String(c.sale_date || '')) + '</div>';
    actions = '<button class="q-action primary" onclick="dcFed(' + i + ',\'confirm_as_is\')">Confirm as-is</button>'
      + '<button class="q-action" onclick="dcImplausibleCorrect(' + i + ')">Correct value…</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'void\')">Void</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'research\')">Research</button>';
  } else if (_dcFedType === 'merge_duplicate_entities') {
    const loserIds = c.loser_ids || [];
    const loserNames = c.loser_names || [];
    const n = c.member_count || (loserIds.length + 1);
    const winLabel = c.winner_name || c.norm_name || 'Duplicate group';
    // Tier-4 Unit 3: flag the SF-link-inheritance bonus so the operator can
    // prioritize duplicates of an already-SF-linked entity (merge dedups AND
    // inherits the Salesforce account onto the survivor).
    const sfBadge = c.sf_inheritance
      ? '<span class="q-badge type" title="One duplicate already carries a Salesforce account — merging inherits the SF link onto the survivor.">↪ inherits SF link</span>'
      : '';
    const sfMeta = c.sf_inheritance
      ? ' One of these is already linked to a Salesforce account, so the merge also inherits that SF link.'
      : '';
    // Unit 2 — surface AND let the operator choose which member survives. The
    // view's winner is the default; any member can be picked before merging.
    let survOpts = '<option value="' + esc(String(c.winner_id || '')) + '" selected>' + esc(winLabel) + ' (default survivor)</option>';
    for (let k = 0; k < loserIds.length; k++) {
      survOpts += '<option value="' + esc(String(loserIds[k])) + '">' + esc(loserNames[k] || ('member ' + (k + 2))) + '</option>';
    }
    const survivorPick = loserIds.length
      ? '<div class="q-item-meta">Merge into: <select id="dc-mw-' + i + '" class="dc-merge-winner">' + survOpts + '</select></div>'
      : '';
    const losersList = loserNames.length
      ? '<div class="q-item-meta">Collapses: ' + loserNames.map(function (nm) { return esc(nm || '—'); }).join(', ') + '</div>'
      : '';
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(winLabel) + '</span>'
      + '<div class="q-item-badges">' + sfBadge + '<span class="q-badge">' + n + ' duplicates</span></div></div>'
      + survivorPick + losersList
      + '<div class="q-item-meta">' + loserIds.length + ' duplicate(s) collapse into the survivor (portfolio + identities + relationships carry over).' + sfMeta + '</div>';
    actions = '<button class="q-action primary" onclick="dcMergeGroup(' + i + ')">Merge duplicates →</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'keep_separate\')">Keep separate</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'research\')">Research</button>';
  } else if (_dcFedType === 'caprate_review') {
    const pct = (v) => (v != null && isFinite(Number(v))) ? (Number(v) * 100).toFixed(2) + '%' : '?';
    const openDetail = (c.domain && c.property_id != null && typeof openUnifiedDetail === 'function')
      ? '<button class="q-action" onclick="openUnifiedDetail(\'' + esc(c.domain) + '\', {property_id: ' + esc(String(c.property_id)) + '}, {}, \'Overview\')">Open property →</button>' : '';
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(c.address || c.label || ('Property ' + c.property_id)) + '</span>'
      + '<div class="q-item-badges"><span class="q-badge">' + esc(c.domain || '') + '</span>'
      + '<span class="q-badge pri-high">' + _fedMoney(c.dollar_impact) + ' impact</span>'
      + '<span class="q-badge">' + esc(c.reason || '') + '</span></div></div>'
      + '<div class="q-item-meta">' + esc(c.label || '') + (c.city ? ' · ' + esc(c.city) : '') + (c.state ? ' ' + esc(c.state) : '')
      + ' · ' + esc(c.event_type || '') + ' ' + _fedMoney(c.price) + ' · ' + esc(c.income_confidence || '') + ' conf</div>'
      + '<div class="q-item-meta">Cap <b>' + pct(c.old_cap) + '</b> → <b>' + pct(c.recomputed_cap) + '</b></div>';
    actions = '<button class="q-action primary" onclick="dcFed(' + i + ',\'apply\')">Apply recompute →</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'keep_old\')">Keep old</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'needs_rent_fix\')">Bad rent →</button>'
      + openDetail
      + '<button class="q-action" onclick="dcFed(' + i + ',\'research\')">Research</button>';
  } else if (_dcFedType === 'bad_rent_lease') {
    const yld = (c.implied_gross_yield != null && isFinite(Number(c.implied_gross_yield)))
      ? (Number(c.implied_gross_yield) * 100).toFixed(1) + '%' : '?';
    const openDetail = (c.domain && c.property_id != null && typeof openUnifiedDetail === 'function')
      ? '<button class="q-action primary" onclick="openUnifiedDetail(\'' + esc(c.domain) + '\', {property_id: ' + esc(String(c.property_id)) + '}, {}, \'Overview\')">Open property / lease →</button>' : '';
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(c.address || c.label || ('Property ' + c.property_id)) + '</span>'
      + '<div class="q-item-badges"><span class="q-badge">' + esc(c.domain || '') + '</span>'
      + '<span class="q-badge pri-high">' + yld + ' yield</span></div></div>'
      + '<div class="q-item-meta">' + esc(c.label || '') + (c.city ? ' · ' + esc(c.city) : '') + (c.state ? ' ' + esc(c.state) : '') + '</div>'
      + '<div class="q-item-meta">Rent <b>' + _fedMoney(c.rent_used) + '</b> on ' + esc(c.event_type || '') + ' ' + _fedMoney(c.price)
      + ' · plausible rent <b>' + _fedMoney(c.plausible_rent_low) + '–' + _fedMoney(c.plausible_rent_high) + '</b></div>';
    actions = openDetail
      + '<button class="q-action" onclick="dcFed(' + i + ',\'mark_fixed\')">Mark rent fixed</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'confirm_rent\')">Rent is correct</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'research\')">Research</button>';
  } else if (_dcFedType === 'resolve_owner_parent') {
    const samples = (c.sample_owner_names || []).slice(0, 4).join(' · ');
    const confBadge = c.confidence === 'high'
      ? '<span class="q-badge type" title="A fund numeral varies across these shells — almost certainly one sponsor.">↪ numeral family</span>'
      : '<span class="q-badge">review</span>';
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(c.suggested_parent_name || c.cluster_token) + '</span>'
      + '<div class="q-item-badges"><span class="q-badge">' + esc(c.domain || '') + '</span>' + confBadge
      + '<span class="q-badge">' + (c.shells || 0) + ' shells</span>'
      + '<span class="q-badge pri-high">' + _fedMoney(c.annual_rent) + ' rent</span></div></div>'
      + '<div class="q-item-meta">token <b>' + esc(c.cluster_token || '') + '</b> · ' + (c.props || 0) + ' properties</div>'
      + (samples ? '<div class="q-item-meta">' + esc(samples) + '</div>' : '');
    actions = '<button class="q-action primary" onclick="dcFed(' + i + ',\'confirm_parent\')">Confirm parent: ' + esc(c.suggested_parent_name || c.cluster_token) + ' →</button>'
      + '<button class="q-action" onclick="dcOwnerParentSet(' + i + ')">Name parent…</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'mark_independent\')">Independent</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'research\')">Research</button>';
  } else if (_dcFedType === 'listing_event_action') {
    const slb = c.is_sale_leaseback;
    const loc = (c.city ? esc(c.city) : '') + (c.state ? ' ' + esc(c.state) : '');
    const buyer = c.buyer_entity_name || c.buyer_name;
    const seller = c.seller_entity_name || c.seller_name;
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(c.address || ('Property ' + c.property_id)) + '</span>'
      + '<div class="q-item-badges"><span class="q-badge">' + esc(c.domain || '') + '</span>'
      + '<span class="q-badge pri-high">' + _fedMoney(c.sale_price) + '</span>'
      + (slb ? '<span class="q-badge type" title="Heuristic: seller &amp; buyer names share a leading core — likely an affiliate sale / sale-leaseback. Confirm.">↪ sale-leaseback?</span>' : '')
      + '</div></div>'
      + '<div class="q-item-meta">' + (loc ? loc + ' · ' : '') + 'sold ' + esc(String(c.event_date || '')) + '</div>'
      + '<div class="q-item-meta">Seller: <b>' + esc(seller || 'unresolved') + '</b>' + (c.seller_entity_id ? '' : ' <span class="q-badge">no entity</span>')
      + ' → Buyer: <b>' + esc(buyer || 'unresolved') + '</b>' + (c.buyer_entity_id ? '' : ' <span class="q-badge">no entity</span>') + '</div>';
    actions = (seller ? '<button class="q-action primary" onclick="dcFed(' + i + ',\'nurture_seller\')">Nurture seller →</button>' : '')
      + (buyer ? '<button class="q-action" onclick="dcFed(' + i + ',\'new_buyer_relationship\')">New owner relationship →</button>' : '')
      + '<button class="q-action" onclick="dcFed(' + i + ',\'pursue_cohort\')">Pursue cohort →</button>'
      + (slb ? '<button class="q-action" onclick="dcFed(' + i + ',\'flag_sale_leaseback\')">Flag sale-leaseback</button>' : '')
      + '<button class="q-action" onclick="dcFed(' + i + ',\'dismiss\')">Dismiss</button>';
  } else if (_dcFedType === 'suspected_sale') {
    const rent = _fedMoney(c.annual_rent);
    const sig = c.signal_source === 'gsa_lessor_change' ? 'GSA lessor changed'
      : c.signal_source === 'deed_conflict' ? 'deed ≠ prior owner' : (c.signal_source || '');
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(c.address || ('Property ' + c.property_id)) + '</span>'
      + '<div class="q-item-badges"><span class="q-badge">gov</span>'
      + '<span class="q-badge type">' + esc(sig) + '</span>'
      + (rent ? '<span class="q-badge pri-high">' + rent + ' rent</span>' : '') + '</div></div>'
      + '<div class="q-item-meta">' + esc((c.city || '') + (c.state ? ', ' + c.state : '')) + ' · property ' + esc(String(c.property_id)) + '</div>'
      + '<div class="q-item-meta">Was: <b>' + esc(c.suspected_grantor || '?') + '</b></div>'
      + '<div class="q-item-meta">Now: <b>' + esc(c.suspected_grantee || '?') + '</b>'
        + (c.suspected_sale_date ? ' · seen ' + esc(String(c.suspected_sale_date)) : '') + '</div>'
      + '<div class="q-item-meta" style="opacity:.7">Suspected unrecorded sale — confirm only with a real price.</div>';
    actions = '<button class="q-action primary" onclick="dcConfirmSuspectedSale(' + i + ')">Confirm sale (enter price) →</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'not_a_sale\')">Not a sale</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'research\')">Research</button>';
  } else if (_dcFedType === 'loan_maturity') {
    const rent = _fedMoney(c.annual_rent);
    const bal = _fedMoney(c.loan_balance);
    const matured = (typeof c.months_to_maturity === 'number' && c.months_to_maturity < 0);
    const matLbl = c.maturity_band === 'matured' ? 'MATURED'
      : (typeof c.months_to_maturity === 'number' ? 'matures in ' + c.months_to_maturity + 'mo' : (c.maturity_band || 'maturing'));
    const who = c.owner_name || c.true_owner_name || c.recorded_owner_name || '?';
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(c.address || ('Property ' + c.property_id)) + '</span>'
      + '<div class="q-item-badges"><span class="q-badge">' + esc(c.domain || '') + '</span>'
      + '<span class="q-badge ' + (matured ? 'pri-high' : 'type') + '">' + esc(matLbl) + '</span>'
      + (c.is_distressed ? '<span class="q-badge pri-high">⚠ ' + esc(c.distress_reason || 'distressed') + '</span>' : '')
      + (rent ? '<span class="q-badge pri-high">' + rent + ' rent</span>' : '') + '</div></div>'
      + '<div class="q-item-meta">' + esc((c.city || '') + (c.state ? ', ' + c.state : '')) + ' · property ' + esc(String(c.property_id))
      + (c.agency ? ' · ' + esc(c.agency) : '') + (c.tenant ? ' · ' + esc(c.tenant) : '') + '</div>'
      + '<div class="q-item-meta">Owner: <b>' + esc(who) + '</b></div>'
      + '<div class="q-item-meta">Debt ' + (bal ? '<b>' + bal + '</b> · ' : '') + esc(c.maturity_date ? String(c.maturity_date).slice(0, 10) : '')
        + (c.servicer ? ' · ' + esc(c.servicer) : '') + '</div>'
      + '<div class="q-item-meta" style="opacity:.7">Loan maturity = refi or sell. Reach the owner.</div>';
    actions = '<button class="q-action primary" onclick="dcFed(' + i + ',\'pursue_refi\')">Pursue refi →</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'pursue_disposition\')">Pursue disposition</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'not_relevant\')">Not relevant</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'research\')">Research</button>';
  } else if (_dcFedType === 'agency_risk_action') {
    // W5.2: a gov agency risk composite with tracked portfolio exposure.
    const score = (c.risk_score != null) ? Number(c.risk_score).toFixed(1) : '';
    const pc = (c.tracked_property_count != null) ? Number(c.tracked_property_count) : null;
    const sig = c.signals || {};
    const spend = sig.spending ? sig.spending.spending_signal : null;
    const trendPct = sig.spending ? sig.spending.spending_trend_pct : null;
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(c.agency || 'Agency') + '</span>'
      + '<div class="q-item-badges"><span class="q-badge">gov</span>'
      + '<span class="q-badge ' + (c.risk_level === 'high' ? 'pri-high' : 'type') + '">' + esc(c.risk_level || 'risk') + (score ? ' · ' + score : '') + '</span>'
      + (pc != null ? '<span class="q-badge">' + pc + ' tracked propert' + (pc === 1 ? 'y' : 'ies') + '</span>' : '') + '</div></div>'
      + (spend ? '<div class="q-item-meta">Spending: <b>' + esc(spend) + '</b>' + (trendPct != null ? ' (' + esc(String(trendPct)) + '%)' : '') + '</div>' : '')
      + '<div class="q-item-meta" style="opacity:.7">Agency risk = a disposition signal on the tracked portfolio. Reach the owners.</div>';
    actions = (pc ? '<button class="q-action primary" onclick="dcFed(' + i + ',\'pursue_disposition\')">Pursue disposition →</button>' : '')
      + '<button class="q-action" onclick="dcFed(' + i + ',\'monitor\')">Monitor</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'dismiss\')">Dismiss</button>';
  } else if (_dcFedType === 'npi_dedup_review' || _dcFedType === 'npi_dedup_autoapprove') {
    // W5.2: a dia duplicate-NPI cluster. review = human picks; autoapprove =
    // human APPROVES the deterministic survivor. NEVER a silent auto-collapse.
    const cs = (c.cluster_size != null) ? Number(c.cluster_size) : null;
    const winner = c.cluster_winner_medicare_id || null;
    const isApprove = (_dcFedType === 'npi_dedup_autoapprove');
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(c.facility_name || ('Clinic ' + c.clinic_id)) + '</span>'
      + '<div class="q-item-badges"><span class="q-badge">dia</span>'
      + '<span class="q-badge ' + (isApprove ? 'type' : 'pri-high') + '">' + esc(c.severity || 'duplicate') + '</span>'
      + (cs != null ? '<span class="q-badge">cluster ' + cs + '</span>' : '') + '</div></div>'
      + '<div class="q-item-meta">' + esc((c.city || '') + (c.state ? ', ' + c.state : '')) + (c.operator_name ? ' · ' + esc(c.operator_name) : '') + '</div>'
      + (c.npi ? '<div class="q-item-meta">NPI: <b>' + esc(String(c.npi)) + '</b></div>' : '')
      + (winner ? '<div class="q-item-meta">Proposed survivor: <b>' + esc(String(winner)) + '</b></div>' : '')
      + (c.signal_reason ? '<div class="q-item-meta" style="opacity:.7">' + esc(String(c.signal_reason)) + '</div>' : '');
    actions = isApprove
      ? '<button class="q-action primary" onclick="dcFed(' + i + ',\'approve\')">Approve survivor →</button>'
        + '<button class="q-action" onclick="dcFed(' + i + ',\'reject\')">Reject</button>'
      : '<button class="q-action primary" onclick="dcFed(' + i + ',\'confirm_duplicate\')">Confirm duplicate →</button>'
        + '<button class="q-action" onclick="dcFed(' + i + ',\'not_duplicate\')">Not a duplicate</button>';
  } else if (_dcFedType === 'contact_company_link') {
    const cands = Array.isArray(c.candidates) ? c.candidates : [];
    const isFuzzy = c.match_class === 'fuzzy';
    const kindLbl = isFuzzy ? 'fuzzy name match'
      : (Number(c.n_candidate_orgs) > 1 ? (c.n_candidate_orgs + ' owner orgs share this name') : 'exact name match');
    const rent = _fedMoney(c.rank_value);
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(c.person_name || 'Contact') + '</span>'
      + '<div class="q-item-badges"><span class="q-badge' + (isFuzzy ? '' : ' type') + '">' + esc(kindLbl) + '</span>'
      + (rent ? '<span class="q-badge">' + rent + ' rent</span>' : '') + '</div></div>'
      + '<div class="q-item-meta">Company: <b>' + esc(c.company_name || '') + '</b></div>';
    // Single candidate → show it; multi → a picker (default = highest-value owner).
    if (cands.length > 1) {
      const opts = cands.map(function (x) {
        const v = _fedMoney(x.rank_value);
        return '<option value="' + esc(String(x.owner_org_id)) + '"'
          + (String(x.owner_org_id) === String(c.owner_org_id) ? ' selected' : '') + '>'
          + esc(x.owner_org_name || String(x.owner_org_id)) + (v ? ' — ' + v : '') + '</option>';
      }).join('');
      body += '<div class="q-item-meta">Link to owner: <select id="ccl-owner-' + i + '" class="dc-merge-winner">' + opts + '</select></div>';
    } else {
      body += '<div class="q-item-meta">Link to owner: <b>' + esc(c.owner_org_name || '?') + '</b></div>';
    }
    actions = '<button class="q-action primary" onclick="cclLink(' + i + ')">Link →</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'not_a_match\')">Not a match</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'research\')">Research</button>';
  } else if (_dcFedType === 'owner_reconcile') {
    const kind = c.kind;
    const nameA = c.owner_name || c.source_name || '?';
    const nameB = c.candidate_display || c.candidate_name || c.target_name
      || (c.candidate_unified_id ? ('contact ' + String(c.candidate_unified_id).slice(0, 8)) : '?');
    const kindLbl = kind === 'ore' ? 'ORE multi-signal'
      : kind === 'owner_unification' ? 'Owner unification (gov)'
      : 'Entity match (' + (c.domain || '') + ')';
    const score = (c.weighted_score != null) ? ('score ' + Math.round(Number(c.weighted_score)))
      : (c.match_score != null) ? ('score ' + Number(c.match_score).toFixed(2))
      : (c.similarity != null) ? ('sim ' + Number(c.similarity).toFixed(2)) : '';
    let evChips = '';
    if (kind === 'ore' && Array.isArray(c.agreeing_signals)) {
      evChips = c.agreeing_signals.map(function (s) {
        var lbl = String((s && s.signal) || '').replace(/_/g, ' ');
        var w = (s && s.weight != null) ? (' ' + s.weight) : '';
        return '<span class="q-badge">' + esc(lbl + w) + '</span>';
      }).join('');
    } else if (kind === 'owner_unification') {
      // W3.6 — real comparison facts, not the bare "tier0_ambiguous" token.
      evChips = (c.match_reason_label ? '<span class="q-badge">' + esc(String(c.match_reason_label)) + '</span>'
          : (c.reason ? '<span class="q-badge">' + esc(String(c.reason)) + '</span>' : ''))
        + (c.match_tier != null ? '<span class="q-badge">tier ' + esc(String(c.match_tier)) + '</span>' : '')
        + (c.shared_state ? '<span class="q-badge type">same state ' + esc(String(c.candidate_state)) + '</span>' : '');
    } else if (kind === 'entity_match_candidate') {
      evChips = (c.match_method ? '<span class="q-badge">' + esc(String(c.match_method)) + '</span>' : '')
        + (c.source_table ? '<span class="q-badge">' + esc(String(c.source_table)) + ' &rarr; ' + esc(String(c.target_table || '')) + '</span>' : '');
    }
    const conflictBadge = c.high_authority_conflict ? '<span class="q-badge pri-high">high-authority conflict</span>' : '';
    const mergeVerb = kind === 'ore' ? 'Merge (same party) &rarr;' : 'Confirm match &rarr;';
    let cmpMeta = '';
    if (kind === 'owner_unification') {
      const contactBits = [c.candidate_company, c.candidate_email,
        [c.candidate_city, c.candidate_state].filter(Boolean).join(', ')].filter(Boolean).join(' \u00b7 ');
      const ownerLoc = [c.owner_property_address, c.owner_property_city, c.owner_property_state].filter(Boolean).join(', ');
      cmpMeta = '<div class="q-item-meta">Owner (recorded): <b>' + esc(c.owner_name || '?') + '</b>'
          + (ownerLoc ? ' \u00b7 ' + esc(ownerLoc) : '') + '</div>'
        + '<div class="q-item-meta">Contact: <b>' + esc(c.candidate_name || c.candidate_company || 'unresolved') + '</b>'
          + (contactBits ? ' \u00b7 ' + esc(contactBits) : '') + '</div>';
    }
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(nameA)
      + ' <span style="opacity:.6">&harr;</span> ' + esc(nameB) + '</span>'
      + '<div class="q-item-badges"><span class="q-badge type">' + esc(kindLbl) + '</span>'
      + (score ? '<span class="q-badge">' + esc(score) + '</span>' : '') + conflictBadge + '</div></div>'
      + (evChips ? '<div class="q-item-meta">Evidence: ' + evChips + '</div>' : '')
      + cmpMeta
      + '<div class="q-item-meta">Are these the SAME owner / party?</div>';
    actions = '<button class="q-action primary" onclick="dcFed(' + i + ',\'approve\')">' + mergeVerb + '</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'reject\')">Reject (distinct)</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'research\')">Research</button>';
  } else if (_dcFedType === 'sf_link_candidate') {
    const owner = c.owner_name || c.canonical_name || 'Owner';
    const cand = c.sf_account_name_resolved || '(unnamed account)';
    const prob = (c.score_resolved != null && isFinite(Number(c.score_resolved))) ? Number(c.score_resolved) : null;
    const existing = c.conflict_existing_id ? String(c.conflict_existing_id) : '';
    const isConflict = !!existing;
    const pc = (c.property_count != null) ? Number(c.property_count) : null;
    const badges = '<span class="q-badge">' + esc(c.domain || '') + '</span>'
      + '<span class="q-badge">' + esc(c.source_table || '') + '</span>'
      + (pc != null ? '<span class="q-badge">' + pc + ' propert' + (pc === 1 ? 'y' : 'ies') + '</span>' : '')
      + (prob != null ? '<span class="q-badge">p=' + prob.toFixed(2) + '</span>' : '')
      + (isConflict ? '<span class="q-badge pri-high">conflict — existing link</span>' : '');
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(owner)
        + ' <span style="opacity:.6">&harr;</span> ' + esc(cand) + '</span>'
        + '<div class="q-item-badges">' + badges + '</div></div>'
        + '<div class="q-item-meta">' + (c.state ? esc(c.state) + ' · ' : '')
          + 'Salesforce account: <b>' + esc(cand) + '</b>'
          + (c.sf_account_id_resolved ? ' <span style="opacity:.6">(' + esc(String(c.sf_account_id_resolved)) + ')</span>' : '') + '</div>';
    if (isConflict) {
      body += '<div class="q-item-meta">⚠ This owner is already linked to a DIFFERENT Salesforce account: <b>' + esc(existing) + '</b></div>'
        + '<div class="q-item-meta">Keep the existing link, switch to the candidate above, or research.</div>';
      actions = '<button class="q-action" onclick="dcFed(' + i + ',\'keep_existing\')">Keep existing</button>'
        + '<button class="q-action primary" onclick="dcFed(' + i + ',\'switch\')">Switch to candidate →</button>'
        + '<button class="q-action" onclick="dcFed(' + i + ',\'research\')">Research</button>';
    } else {
      body += '<div class="q-item-meta">Is this owner the SAME party as the Salesforce account?</div>';
      actions = '<button class="q-action primary" onclick="dcFed(' + i + ',\'approve\')">Link →</button>'
        + '<button class="q-action" onclick="dcFed(' + i + ',\'reject\')">Not a match</button>'
        + '<button class="q-action" onclick="dcFed(' + i + ',\'research\')">Research</button>';
    }
  } else if (_dcFedType === 'junk_entity_review') {
    // W8 U1: an Ollama junk-entity proposal. The model PROPOSED; the human
    // decides. Confirm applies the proposal (dismiss => reversible soft-retire,
    // unless FK-referenced => conflict); Keep leaves the row untouched.
    const nm = c.entity_name || '(blank name)';
    const pv = c.proposed_verdict || 'keep';
    const conf = (c.confidence != null && isFinite(Number(c.confidence))) ? Number(c.confidence) : null;
    const pvBadge = { dismiss: 'pri-high', rename: '', parse_contact: '', keep: 'type', uncertain: '' }[pv] || '';
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(nm) + '</span>'
      + '<div class="q-item-badges"><span class="q-badge">' + esc(c.domain || '') + '</span>'
      + '<span class="q-badge">' + esc(c.table_name || '') + '</span>'
      + '<span class="q-badge">' + esc(c.heuristic || '') + '</span>'
      + '<span class="q-badge ' + pvBadge + '">proposes: ' + esc(pv) + '</span>'
      + (conf != null ? '<span class="q-badge">conf ' + conf.toFixed(2) + '</span>' : '') + '</div></div>'
      + (c.evidence_quote ? '<div class="q-item-meta">Evidence: <b>' + esc(String(c.evidence_quote)) + '</b></div>' : '')
      + (c.reason ? '<div class="q-item-meta">' + esc(String(c.reason)) + '</div>' : '')
      + '<div class="q-item-meta" style="opacity:.7">Ollama proposes only — confirm to soft-retire (reversible; FK-referenced rows route to a conflict card), or keep.</div>';
    actions = '<button class="q-action primary" onclick="dcFed(' + i + ',\'confirm\')">Confirm — retire junk</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'reject\')">Keep — not junk</button>';
  } else if (_dcFedType === 'naming_hygiene_review') {
    // W8 U5: a naming-hygiene proposal. rename => expand the abbreviated display
    // name; link_property => attach the address-named entity to its property. The
    // model/deterministic-rule PROPOSED; the human decides.
    const nm = c.entity_name || '(blank name)';
    const isLink = (c.proposed_action === 'link_property');
    const det = !!c.deterministic;
    const conf = (c.confidence != null && isFinite(Number(c.confidence))) ? Number(c.confidence) : null;
    const badges = '<div class="q-item-badges"><span class="q-badge">' + esc(c.domain || '') + '</span>'
      + '<span class="q-badge">' + esc(c.table_name || '') + '</span>'
      + '<span class="q-badge">' + esc(c.hygiene_class || '') + '</span>'
      + (det ? '<span class="q-badge type">deterministic</span>' : '')
      + (conf != null && !det ? '<span class="q-badge">conf ' + conf.toFixed(2) + '</span>' : '') + '</div>';
    if (isLink) {
      const prop = c.proposed_property || {};
      body = '<div class="q-item-header"><span class="q-item-title">' + esc(nm) + '</span>' + badges + '</div>'
        + '<div class="q-item-meta">Address mis-entered as a name — attach to property <b>'
        + esc(String(prop.domain || '')) + ':' + esc(String(prop.property_id != null ? prop.property_id : '?')) + '</b>'
        + (prop.address ? ' <span style="opacity:.6">(' + esc(String(prop.address)) + ')</span>' : '') + '</div>'
        + (c.proposed_name ? '<div class="q-item-meta">Fill display name → <b>' + esc(String(c.proposed_name)) + '</b> (from property owner)</div>' : '')
        + (c.reason ? '<div class="q-item-meta" style="opacity:.7">' + esc(String(c.reason)) + '</div>' : '')
        + '<div class="q-item-meta" style="opacity:.7">Proposes only — confirm to link the entity to its property (reversible), or keep.</div>';
      actions = '<button class="q-action primary" onclick="dcFed(' + i + ',\'confirm\')">Confirm — link to property</button>'
        + '<button class="q-action" onclick="dcFed(' + i + ',\'reject\')">Keep untouched</button>';
    } else {
      body = '<div class="q-item-header"><span class="q-item-title">' + esc(nm)
        + ' <span style="opacity:.6">&rarr;</span> ' + esc(String(c.proposed_name || '?')) + '</span>' + badges + '</div>'
        + (c.evidence_quote ? '<div class="q-item-meta">Abbreviation: <b>' + esc(String(c.evidence_quote)) + '</b></div>' : '')
        + (c.reason ? '<div class="q-item-meta" style="opacity:.7">' + esc(String(c.reason)) + '</div>' : '')
        + '<div class="q-item-meta" style="opacity:.7">Proposes only — confirm to rename (reversible; a canonical collision routes to a conflict), or keep.</div>';
      actions = '<button class="q-action primary" onclick="dcFed(' + i + ',\'confirm\')">Confirm — rename</button>'
        + '<button class="q-action" onclick="dcFed(' + i + ',\'reject\')">Keep — leave name</button>';
    }
  } else if (_dcFedType === 'reachability_harvest_review' && (c.kind === 'create_contact' || c.target_kind === 'owner')) {
    // W9.4: a CREATE-CONTACT proposal — a thread participant attributable to an owner
    // with no contact on file. Confirm MINTS the contact (name + email [+ phone]);
    // Keep discards. Never auto-minted.
    const conf = (c.confidence != null && isFinite(Number(c.confidence))) ? Number(c.confidence) : null;
    const badges = '<div class="q-item-badges"><span class="q-badge">' + esc(c.domain || '') + '</span>'
      + '<span class="q-badge type">create contact</span>'
      + (c.arm === 'deterministic' ? '<span class="q-badge">header</span>' : '<span class="q-badge">signature</span>')
      + (conf != null ? '<span class="q-badge">conf ' + conf.toFixed(2) + '</span>' : '') + '</div>';
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(String(c.contact_name || '(unnamed)'))
      + ' <span style="opacity:.6">&middot;</span> ' + esc(String(c.proposed_value || '?'))
      + (c.proposed_phone ? ' <span style="opacity:.6">&middot;</span> ' + esc(String(c.proposed_phone)) : '') + '</span>' + badges + '</div>'
      + (c.owner_name ? '<div class="q-item-meta">New contact for owner: <b>' + esc(String(c.owner_name)) + '</b></div>' : '')
      + (c.evidence_quote ? '<div class="q-item-meta">Evidence: <b>' + esc(String(c.evidence_quote)) + '</b>'
          + (c.evidence_source ? ' <span style="opacity:.6">— ' + esc(String(c.evidence_source)) + '</span>' : '') + '</div>' : '')
      + (c.reason ? '<div class="q-item-meta" style="opacity:.7">' + esc(String(c.reason)) + '</div>' : '')
      + '<div class="q-item-meta" style="opacity:.7">Proposes only — confirm to CREATE this contact for the owner (reversible via the ledger), or discard.</div>';
    actions = '<button class="q-action primary" onclick="dcFed(' + i + ',\'confirm\')">Confirm — create contact</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'reject\')">Discard</button>';
  } else if (_dcFedType === 'reachability_harvest_review') {
    // W9.2: a contact-reachability fill proposal. Deterministic (arm=deterministic,
    // arithmetic exact-identity, confidence 1.0) or LLM-attributed (verbatim quote).
    // Confirm runs the fill-blanks writer; Keep leaves it untouched.
    const det = (c.arm === 'deterministic');
    const nm = c.contact_name || '(unnamed contact)';
    const conf = (c.confidence != null && isFinite(Number(c.confidence))) ? Number(c.confidence) : null;
    const badges = '<div class="q-item-badges"><span class="q-badge">' + esc(c.domain || '') + '</span>'
      + '<span class="q-badge">' + esc(c.field || '') + '</span>'
      + (det ? '<span class="q-badge type">deterministic</span>' : '<span class="q-badge">ollama</span>')
      + (conf != null ? '<span class="q-badge">conf ' + conf.toFixed(2) + '</span>' : '') + '</div>';
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(nm)
      + ' <span style="opacity:.6">&rarr;</span> ' + esc(String(c.proposed_value || '?')) + '</span>' + badges + '</div>'
      + (c.owner_name ? '<div class="q-item-meta">Owner: ' + esc(String(c.owner_name)) + '</div>' : '')
      + (det
          ? '<div class="q-item-meta">Exact-identity donor: <b>' + esc(String(c.evidence_source || '')) + '</b> (same person, arithmetic fill).</div>'
          : (c.evidence_quote ? '<div class="q-item-meta">Evidence: <b>' + esc(String(c.evidence_quote)) + '</b>'
              + (c.evidence_source ? ' <span style="opacity:.6">— ' + esc(String(c.evidence_source)) + '</span>' : '') + '</div>' : ''))
      + (c.reason ? '<div class="q-item-meta" style="opacity:.7">' + esc(String(c.reason)) + '</div>' : '')
      + '<div class="q-item-meta" style="opacity:.7">Proposes only — confirm to fill the blank ' + esc(c.field || 'field')
        + ' (reversible; a now-populated field routes to a conflict), or keep untouched.</div>';
    actions = '<button class="q-action primary" onclick="dcFed(' + i + ',\'confirm\')">Confirm — fill ' + esc(c.field || 'value') + '</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'reject\')">Keep — leave blank</button>';
  } else if (_dcFedType === 'contact_acquisition_review') {
    // W9.1: a contact-acquisition proposal for a contactless owner. ATTACH links an
    // EXISTING person already known under a related owner (cross-reference /
    // institution registry); MINT creates a lane-only contact from a deed signatory
    // or the OM listing broker-of-record (a broker is typed distinctly, NEVER the
    // owner's own contact). Confirm resolves it into the graph (reversible); Reject keeps it.
    const attach = (c.proposed_kind === 'attach');
    const isBroker = (c.stage === 'broker_of_record');
    const conf = (c.confidence != null && isFinite(Number(c.confidence))) ? Number(c.confidence) : null;
    const stageLabel = c.stage === 'crossref' ? 'cross-reference'
      : c.stage === 'institution' ? 'institution registry'
      : c.stage === 'deed_signatory' ? 'deed signatory'
      : c.stage === 'broker_of_record' ? 'broker of record' : (c.stage || '');
    const badges = '<div class="q-item-badges"><span class="q-badge">' + esc(c.domain || '') + '</span>'
      + '<span class="q-badge type">' + (attach ? 'attach' : 'create') + '</span>'
      + '<span class="q-badge">' + esc(stageLabel) + '</span>'
      + (isBroker ? '<span class="q-badge">broker of record</span>' : '')
      + (conf != null ? '<span class="q-badge">conf ' + conf.toFixed(2) + '</span>' : '') + '</div>';
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(String(c.owner_name || 'owner'))
      + ' <span style="opacity:.6">&larr;</span> ' + esc(String(c.candidate_name || '?')) + '</span>' + badges + '</div>'
      + (c.candidate_title ? '<div class="q-item-meta">' + esc(String(c.candidate_title)) + '</div>' : '')
      + (c.evidence_quote ? '<div class="q-item-meta">Evidence: <b>' + esc(String(c.evidence_quote)) + '</b>'
          + (c.evidence_source ? ' <span style="opacity:.6">— ' + esc(String(c.evidence_source)) + '</span>' : '') + '</div>'
          : (c.evidence_source ? '<div class="q-item-meta" style="opacity:.7">Source: ' + esc(String(c.evidence_source)) + '</div>' : ''))
      + (c.reason ? '<div class="q-item-meta" style="opacity:.7">' + esc(String(c.reason)) + '</div>' : '')
      + '<div class="q-item-meta" style="opacity:.7">Proposes only — confirm to '
        + (attach ? 'attach this contact to the owner' : 'create this ' + (isBroker ? 'broker-of-record' : 'contact')) + ' (reversible), or reject.</div>';
    actions = '<button class="q-action primary" onclick="dcFed(' + i + ',\'confirm\')">Confirm — ' + (attach ? 'attach' : 'create') + '</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'reject\')">Reject</button>';
  } else if (_dcFedType === 'owner_contact_attach_review') {
    // Prompt 114. The card's job is to make the SHAPE obvious, because the wrong
    // verdict here writes a real company's switchboard onto an unrelated owner
    // (org cards) or mints a REIT as a human being (person cards). Buttons are
    // built from `allowed`, which the server re-derives and enforces — a card
    // can never offer a verdict the write path would refuse.
    const shape = c.shape || 'blocked';
    const allowed = Array.isArray(c.allowed) ? c.allowed : ['reject'];
    const lean = c.lean || null;
    const hint = c.variant_hint || {};
    const chan = c.contact_email || c.contact_phone || '';
    const shapeLabel = shape === 'person' ? 'person' : (shape === 'org' ? 'organization' : 'blocked');
    const badges = '<div class="q-item-badges"><span class="q-badge">' + esc(c.domain || '') + '</span>'
      + '<span class="q-badge type">' + esc(shapeLabel) + '</span>'
      + (c.counterparty ? '<span class="q-badge">transaction ' + esc(String(c.contact_type || '').replace(/_/g, ' ')) + '</span>' : '')
      + (hint.likely ? '<span class="q-badge">same party (' + esc(String(hint.how || '')) + ')</span>' : '')
      + (hint.ambiguous ? '<span class="q-badge">undecidable</span>' : '')
      + (Number(c.rank_value) > 0 ? '<span class="q-badge">$' + Math.round(Number(c.rank_value)).toLocaleString() + '</span>' : '') + '</div>';
    // Say plainly what confirming would DO, per shape — the operator should never
    // have to infer which of two very different writes a button performs.
    const whatConfirm = lean === 'same_party'
      ? 'These read as the same party under an abbreviation/acronym, so confirming fills <b>' + esc(String(c.owner_name || 'the owner')) + '</b>’s own blank contact detail.'
      : lean === 'attach_person'
        ? 'Confirming creates/links <b>' + esc(String(c.contact_name || 'this person')) + '</b> as a contact RELATED to the owner — their detail is never stamped onto the owner record.'
        : shape === 'org'
          ? 'This looks like a DIFFERENT organization (typically the counterparty on a sale of the owner’s property). Reject unless you know it is the same party.'
          : 'This person is named on a transaction involving the owner — they may be the owner’s principal or the counterparty’s. Your call.';
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(String(c.owner_name || 'owner'))
      + ' <span style="opacity:.6">&larr;</span> ' + esc(String(c.contact_name || '?')) + '</span>' + badges + '</div>'
      + (chan ? '<div class="q-item-meta">Reachable at: <b>' + esc(String(chan)) + '</b></div>' : '')
      + (c.data_source ? '<div class="q-item-meta" style="opacity:.7">Captured by ' + esc(String(c.data_source))
          + (c.source_bound_by ? ' · bound to the ' + esc(String(c.source_bound_by).replace(/_/g, ' ')) : '') + '</div>' : '')
      + '<div class="q-item-meta" style="opacity:.85">' + whatConfirm + '</div>';
    actions = '';
    if (allowed.indexOf('same_party') >= 0) {
      actions += '<button class="q-action' + (lean === 'same_party' ? ' primary' : '') + '" onclick="dcFed(' + i + ',\'same_party\')">Same party — fill owner contact</button>';
    }
    if (allowed.indexOf('attach_person') >= 0) {
      actions += '<button class="q-action' + (lean === 'attach_person' ? ' primary' : '') + '" onclick="dcFed(' + i + ',\'attach_person\')">Attach person to owner</button>';
    }
    actions += '<button class="q-action' + (lean === 'reject' ? ' primary' : '') + '" onclick="dcFed(' + i + ',\'reject\')">Reject — not this owner’s contact</button>';
  } else if (_dcFedType === 'comms_owner_attribution_review') {
    // W9.6: a correspondence→owner attribution. Path A (property_bridge, arithmetic
    // owns-edge) or Path B (person_match, verbatim correspondent header). Confirm
    // attributes the thread to the owner; Reject keeps it untouched.
    const bridge = (c.path === 'property_bridge');
    const conf = (c.confidence != null && isFinite(Number(c.confidence))) ? Number(c.confidence) : null;
    const tieLabel = c.tie_kind === 'owns_edge' ? 'owns edge'
      : c.tie_kind === 'active_contact' ? 'active contact'
      : c.tie_kind === 'relationship' ? 'person→owner edge' : (c.tie_kind || '');
    const badges = '<div class="q-item-badges"><span class="q-badge">' + esc(c.domain || '') + '</span>'
      + '<span class="q-badge type">' + (bridge ? 'property bridge' : 'person match') + '</span>'
      + (tieLabel ? '<span class="q-badge">' + esc(tieLabel) + '</span>' : '')
      + (c.thread_count ? '<span class="q-badge">' + esc(String(c.thread_count)) + ' thread' + (Number(c.thread_count) === 1 ? '' : 's') + '</span>' : '')
      + (conf != null ? '<span class="q-badge">conf ' + conf.toFixed(2) + '</span>' : '') + '</div>';
    const src = bridge ? (c.corr_entity_name || 'this property/deal') : (c.correspondent_name || 'this correspondent');
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(String(src))
      + ' <span style="opacity:.6">&rarr;</span> ' + esc(String(c.owner_name || 'owner')) + '</span>' + badges + '</div>'
      + (c.correspondent_email ? '<div class="q-item-meta">Correspondent: ' + esc(String(c.correspondent_email)) + '</div>' : '')
      + (c.evidence_quote ? '<div class="q-item-meta">Evidence: <b>' + esc(String(c.evidence_quote)) + '</b></div>' : '')
      + (c.reason ? '<div class="q-item-meta" style="opacity:.7">' + esc(String(c.reason)) + '</div>' : '')
      + '<div class="q-item-meta" style="opacity:.7">Proposes only — confirm to attribute this correspondence to the owner (reversible), or reject.</div>';
    actions = '<button class="q-action primary" onclick="dcFed(' + i + ',\'confirm\')">Confirm — attribute to owner</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'reject\')">Reject</button>';
  } else if (_dcFedType === 'w8_u3_link_review' && c.conflict) {
    // Prompt 77: an ambiguous_entity_match conflict — the deterministic writer
    // found ≥2 existing entities sharing the proposed canonical name and refused
    // to guess. Render a pick-the-survivor card (mirrors the sf_link three-way
    // conflict card): show the proposal + each candidate entity (name/domain +
    // link & portfolio counts so the right one is obvious) + explicit "Mint new".
    const linked = c.linked_entity_name || 'linked party';
    const owner = c.current_owner_name || 'owner';
    const role = (c.role === 'developed' || c.role === 'developer') ? 'developed' : 'owns';
    const cands = Array.isArray(c.candidates) ? c.candidates : [];
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(owner)
      + ' <span style="opacity:.6">&rarr;</span> ' + esc(linked) + '</span>'
      + '<div class="q-item-badges"><span class="q-badge">' + esc(c.domain || '') + '</span>'
      + '<span class="q-badge pri-high">conflict — ambiguous match</span>'
      + '<span class="q-badge">' + cands.length + ' candidates</span></div></div>'
      + '<div class="q-item-meta">Proposed link: <b>' + esc(owner) + '</b> ' + role + ' <b>' + esc(linked) + '</b>'
        + (c.source_property_id != null ? ' <span style="opacity:.6">· property ' + esc(String(c.source_property_id)) + '</span>' : '') + '</div>'
      + (c.evidence_quote ? '<div class="q-item-meta">Evidence: <b>' + esc(String(c.evidence_quote)) + '</b>'
        + (c.evidence_source ? ' <span style="opacity:.6">— ' + esc(String(c.evidence_source)) + '</span>' : '') + '</div>' : '')
      + '<div class="q-item-meta">⚠ ' + cands.length + ' existing entities share this name — pick which one the link means, or mint a new entity.</div>';
    let picks = '';
    cands.forEach(function (e) {
      picks += '<button class="q-action" onclick="dcFedU3Pick(' + i + ',\'' + esc(String(e.entity_id)) + '\')">'
        + 'Use “' + esc(e.name || '(unnamed)') + '”'
        + ' <span style="opacity:.6">· ' + esc(String(e.domain || '')) + ' · '
        + Number(e.relationship_count || 0) + ' links · ' + Number(e.portfolio_count || 0) + ' props</span></button>';
    });
    actions = picks
      + '<button class="q-action primary" onclick="dcFedU3Pick(' + i + ',null,true)">Mint new entity</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'reject\',{resolve_conflict:true})">Reject — keep untouched</button>';
  } else if (_dcFedType === 'w8_u3_link_review') {
    // W8 U3: an Ollama connection-propagation link proposal. The model PROPOSED;
    // the human decides. Confirm runs the deterministic edge writer (chain pool)
    // or resolves distinct / routes to the resolver (person_email pool); Reject
    // keeps the records untouched. Every card carries a VERBATIM evidence quote.
    const isEmail = (c.pool === 'person_email');
    const pv = c.proposed_verdict || (isEmail ? 'different_people' : 'link_proposal');
    const isDiffPeople = (pv === 'different_people');
    const conf = (c.confidence != null && isFinite(Number(c.confidence))) ? Number(c.confidence) : null;
    const owner = c.current_owner_name || '';
    const linked = c.linked_entity_name || '';
    const role = c.role || '';
    const pvBadge = isDiffPeople ? 'pri-high' : 'type';
    const pvLabel = isDiffPeople ? 'different people' : 'link proposal';
    let title;
    if (isEmail) {
      title = isDiffPeople
        ? (esc(owner || linked || 'Person') + ' <span style="opacity:.6">vs</span> ' + esc(linked || 'other person'))
        : (esc(owner || 'Person') + ' <span style="opacity:.6">&harr;</span> ' + esc(linked || 'other person'));
    } else {
      title = esc(owner || 'Owner') + ' <span style="opacity:.6">&rarr;</span> ' + esc(linked || 'linked party');
    }
    body = '<div class="q-item-header"><span class="q-item-title">' + title + '</span>'
      + '<div class="q-item-badges"><span class="q-badge">' + esc(c.domain || '') + '</span>'
      + '<span class="q-badge">' + esc(c.pool || '') + '</span>'
      + (c.proposal_type ? '<span class="q-badge">' + esc(String(c.proposal_type)) + '</span>' : '')
      + '<span class="q-badge ' + pvBadge + '">proposes: ' + esc(pvLabel) + '</span>'
      + (conf != null ? '<span class="q-badge">conf ' + conf.toFixed(2) + '</span>' : '') + '</div></div>';
    if (isEmail) {
      body += '<div class="q-item-meta">Shared email: <b>' + esc(String(c.subject_ref || '').replace(/^[^:]*:/, '')) + '</b></div>';
      body += isDiffPeople
        ? '<div class="q-item-meta">These email-sharing records look like DIFFERENT people (a shared mailbox).</div>'
        : '<div class="q-item-meta">These email-sharing records look like the SAME person (dupes are the resolver’s job).</div>';
    } else {
      if (c.gap) body += '<div class="q-item-meta">Gap: ' + esc(String(c.gap))
        + (c.source_property_id != null ? ' · property <b>' + esc(String(c.source_property_id)) + '</b>' : '') + '</div>';
      body += '<div class="q-item-meta">Proposed link: <b>' + esc(owner || 'owner') + '</b> '
        + (role === 'developed' || role === 'developer' ? 'developed' : 'owns') + ' <b>' + esc(linked || '?') + '</b>'
        + (role ? ' <span style="opacity:.6">(' + esc(String(role)) + ')</span>' : '') + '</div>';
    }
    if (c.evidence_quote) body += '<div class="q-item-meta">Evidence: <b>' + esc(String(c.evidence_quote)) + '</b>'
      + (c.evidence_source ? ' <span style="opacity:.6">— ' + esc(String(c.evidence_source)) + '</span>' : '') + '</div>';
    if (c.reason) body += '<div class="q-item-meta" style="opacity:.7">' + esc(String(c.reason)) + '</div>';
    body += '<div class="q-item-meta" style="opacity:.7">Ollama proposes only — confirm to '
      + (isEmail ? (isDiffPeople ? 'record them distinct (reversible)' : 'route to the entity resolver') : 'write the ownership edge (reversible)')
      + ', or reject to keep untouched.</div>';
    const confirmLabel = isEmail
      ? (isDiffPeople ? 'Confirm — different people' : 'Confirm — route to resolver')
      : 'Confirm — write link';
    actions = '<button class="q-action primary" onclick="dcFed(' + i + ',\'confirm\')">' + confirmLabel + '</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'reject\')">Reject — keep untouched</button>';
  }
  return '<div class="q-item' + (isNext ? ' pq-next' : '') + '" id="dc-f' + i + '"'
    + (c.kind ? ' data-seeder="' + esc(String(c.kind)) + '"' : '') + '>' + body
    + _cleanAssistHTML(it)
    + '<div class="q-actions">' + actions + '</div></div>';
}

async function renderFederatedLane(type, view) {
  const el = document.getElementById('reviewConsoleContent');
  if (!el) return;
  el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  const meta = _DC_FED_META[type] || { title: type, intro: '' };
  // intake_disposition: 'create' (default, the workable candidates) ↔ 'all'.
  const intakeView = (type === 'intake_disposition' && view === 'all') ? 'all' : null;
  const res = await opsApi('/api/decisions?type=' + encodeURIComponent(type) + '&limit=50'
    + (intakeView ? '&intake_view=all' : ''));
  if (!res.ok) { el.innerHTML = opsErrorState(res, "renderFederatedLane('" + type + "')", 'Could not load this lane'); return; }
  const items = (res.data && Array.isArray(res.data.items)) ? res.data.items : [];
  const total = res.data ? res.data.total : null;
  _dcCurrentOpenExpr = "renderFederatedLane('" + type + "'" + (intakeView ? ", 'all'" : "") + ")";
  let html = '<div class="ops-header"><h2>' + esc(meta.title) + '</h2>'
    + '<button class="q-action" onclick="renderReviewConsolePage()">← Back to Decision Center</button></div>';
  html += '<div class="rc-intro">' + esc(meta.intro) + '</div>';
  if (type === 'intake_disposition') {
    html += '<div class="triage-bar" style="margin:6px 0"><div class="triage-actions">'
      + (intakeView
          ? '<button class="q-action" onclick="renderFederatedLane(\'intake_disposition\')">← Create-candidates only</button>'
          : '<button class="q-action" onclick="renderFederatedLane(\'intake_disposition\', \'all\')">Show all (matched · noise) →</button>')
      + '</div></div>';
  }
  // W8: owner_reconcile folds 5 seeders into one drain, so the 38 w8_u2_ollama_pair
  // cards were undiscoverable inside the ~5.3k lane. Backend now sorts them first +
  // returns per-seeder sub-counts (res.data.parts); render one-click seeder chips so
  // the Ollama pairs are immediately reachable. Filtering is client-side on the
  // shown cards (via each card's data-seeder attribute).
  if (type === 'owner_reconcile') {
    const parts = (res.data && res.data.parts) || {};
    const shownByKind = {};
    items.forEach(function (it) { var k = (it.context && it.context.kind) || 'other'; shownByKind[k] = (shownByKind[k] || 0) + 1; });
    const SEEDER_LABELS = {
      w8_u2_ollama_pair: 'Ollama pairs', ore: 'ORE multi-signal',
      owner_unification: 'Owner unification (gov)', entity_match_candidate: 'Entity match (gov+dia)',
    };
    // Order: Ollama pairs first (the discoverability fix), then the rest by sub-count.
    const chipKeys = Object.keys(SEEDER_LABELS).filter(function (k) { return (parts[k] || shownByKind[k]); });
    chipKeys.sort(function (a, b) {
      if (a === 'w8_u2_ollama_pair') return -1; if (b === 'w8_u2_ollama_pair') return 1;
      return (parts[b] || 0) - (parts[a] || 0);
    });
    if (chipKeys.length > 1) {
      const totalCount = (total != null) ? total : items.length;
      html += '<div class="pq-chips" id="ownRecSeederChips" style="margin:6px 0">';
      html += '<button class="pq-chip active" data-seeder-chip="" onclick="dcFedSeederFilter(\'\')">All <b>' + esc(String(totalCount.toLocaleString())) + '</b></button>';
      chipKeys.forEach(function (k) {
        const n = (parts[k] != null) ? parts[k] : (shownByKind[k] || 0);
        html += '<button class="pq-chip" data-seeder-chip="' + esc(k) + '" onclick="dcFedSeederFilter(\'' + esc(k) + '\')">'
          + esc(SEEDER_LABELS[k]) + ' <b>' + esc(String(Number(n).toLocaleString())) + '</b></button>';
      });
      html += '</div>';
    }
  }
  if (!items.length) { html += '<div class="ops-empty">Nothing to decide here. ✓' + _dcNextLaneCTA(_dcCurrentOpenExpr) + '</div>'; el.innerHTML = html; return; }
  html += '<div class="rc-progress"><span id="dcRemaining">' + items.length + '</span> shown'
    + (total != null ? ' · ' + total.toLocaleString() + ' workable in this lane' : '') + '</div>';
  // R59 Unit 3 — bulk-handle the SAFE (record-only / non-destructive) verdict
  // across all shown items, so an oversized lane is workable, not 999 clicks.
  // Destructive verdicts (merge/apply/break-link/correct/confirm_sale) are NEVER
  // bulked — they keep their per-card gate.
  var bulk = _DC_BULK_SAFE[type];
  if (bulk) {
    html += '<div class="triage-bar" style="margin:6px 0"><span class="q-item-meta">Bulk action (safe only)</span>'
      + '<div class="triage-actions"><button class="q-action" onclick="dcFedBulkSafe()">' + esc(bulk.label) + '</button></div></div>';
  }
  // W8 U5 (Prompt 79): bulk-confirm the UNAMBIGUOUS deterministic dictionary
  // renames only (they're mechanical — one click per page, not per card). Never
  // bulks the LLM-judged or address-link cards (they keep their per-card gate).
  if (type === 'naming_hygiene_review') {
    var detN = items.filter(function (it) { var c = it.context || {}; return c.deterministic === true && c.proposed_action === 'rename'; }).length;
    if (detN > 0) {
      html += '<div class="triage-bar" style="margin:6px 0"><span class="q-item-meta">Deterministic dictionary renames (unambiguous)</span>'
        + '<div class="triage-actions"><button class="q-action primary" onclick="dcFedBulkHygieneRenames()">Confirm all ' + detN + ' deterministic rename' + (detN === 1 ? '' : 's') + '</button></div></div>';
    }
  }
  // W9.2 (Prompt 88): bulk-confirm the DETERMINISTIC (arm=deterministic, arithmetic
  // exact-identity, confidence 1.0) reachability fills only — never the LLM cards.
  if (type === 'reachability_harvest_review') {
    var detFills = items.filter(function (it) { var c = it.context || {}; return c.arm === 'deterministic' && c.target_kind !== 'owner'; }).length;
    if (detFills > 0) {
      html += '<div class="triage-bar" style="margin:6px 0"><span class="q-item-meta">Deterministic exact-identity fills (arithmetic)</span>'
        + '<div class="triage-actions"><button class="q-action primary" onclick="dcFedBulkReachabilityFills()">Confirm all ' + detFills + ' deterministic fill' + (detFills === 1 ? '' : 's') + '</button></div></div>';
    }
  }
  // W9.1 (Prompt 98): bulk-confirm the cheap deterministic ATTACH proposals
  // (cross-reference / institution — link an existing known person). Mints stay per-card.
  if (type === 'contact_acquisition_review') {
    var attachN = items.filter(function (it) { var c = it.context || {}; return c.proposed_kind === 'attach'; }).length;
    if (attachN > 0) {
      html += '<div class="triage-bar" style="margin:6px 0"><span class="q-item-meta">Deterministic attaches (existing known contact)</span>'
        + '<div class="triage-actions"><button class="q-action primary" onclick="dcFedBulkContactAttach()">Confirm all ' + attachN + ' attach' + (attachN === 1 ? '' : 'es') + '</button></div></div>';
    }
  }
  // Prompt 106: bulk-confirm the DETERMINISTIC MERGE suggestions only (same
  // operator + near-identical name — the safest, mechanical twins). Never bulks
  // the LLM/uncertain cards (they keep their per-card gate). Each confirm still
  // routes through the HUMAN verdict path (reversible dia_merge_property_reversible).
  if (type === 'property_twin') {
    var detMerges = items.filter(function (it) {
      var a = (it.context || {}).assist; return a && a.verdict === 'merge' && a.layer === 'deterministic';
    }).length;
    if (detMerges > 0) {
      html += '<div class="triage-bar" style="margin:6px 0"><span class="q-item-meta">Deterministic merges (same operator, near-identical name)</span>'
        + '<div class="triage-actions"><button class="q-action primary" onclick="dcFedBulkTwinMerges()">Confirm all ' + detMerges + ' deterministic merge' + (detMerges === 1 ? '' : 's') + '</button></div></div>';
    }
  }
  _dcFedType = type;
  _dcFedArr = items.slice();
  items.forEach(function (it, ix) { html += _fedCardHTML(it, ix, ix === 0); });
  el.innerHTML = html;
}
window.renderFederatedLane = renderFederatedLane;

// W9.1 contact_acquisition_review lane. Bulk-confirm the deterministic ATTACH cards
// (an existing known person linked to the owner) — reversible via the ledger. MINT
// cards (deed signatory / broker) keep their per-card gate.
async function dcFedBulkContactAttach() {
  if (_dcFedType !== 'contact_acquisition_review') return;
  var pending = (_dcFedArr || []).map(function (it, ix) { return { it: it, ix: ix }; })
    .filter(function (p) {
      var c = p.it.context || {};
      if (c.proposed_kind !== 'attach') return false;
      var r = document.getElementById('dc-f' + p.ix); return r && !r.classList.contains('resolved');
    });
  if (!pending.length) { showToast('No attach proposals to confirm', 'info'); return; }
  var ok = (typeof lccConfirm === 'function')
    ? await lccConfirm('Confirm ' + pending.length + ' contact attach' + (pending.length === 1 ? '' : 'es') + '?\n\nEach links an EXISTING known person to the contactless owner. Reversible via the ledger.')
    : (typeof confirm === 'function' ? confirm('Confirm ' + pending.length + ' attaches?') : true);
  if (!ok) return;
  var done = 0, failed = 0;
  for (var k = 0; k < pending.length; k++) {
    var p = pending[k];
    var res = await opsApi('/api/decision-verdict', {
      method: 'POST', body: JSON.stringify({ type: 'contact_acquisition_review', subject: p.it, verdict: 'confirm', payload: {} }),
    });
    var row = document.getElementById('dc-f' + p.ix);
    if (res.ok && res.data && res.data.ok) { done++; if (row) { row.classList.add('resolved'); row.style.opacity = '0'; } }
    else { failed++; }
  }
  document.querySelectorAll('#reviewConsoleContent .q-item.resolved[id^="dc-f"]').forEach(function (n) { if (n.parentNode) n.remove(); });
  _dcAdvanceFed();
  showToast('Attached: ' + done + (failed ? ' · ' + failed + ' failed' : ''), failed ? 'error' : 'success');
}
window.dcFedBulkContactAttach = dcFedBulkContactAttach;

// Prompt 106 property_twin lane. Bulk-confirm the DETERMINISTIC MERGE cards only
// (same operator + near-identical name — the assist's safest suggestion). Each
// merge rides the reversible wrapper (dia_merge_property_reversible; undoable via
// dia_unmerge_property). LLM/uncertain cards are NEVER bulked — they keep their
// per-card gate. This is a HUMAN one-click confirm, not an auto-merge.
async function dcFedBulkTwinMerges() {
  if (_dcFedType !== 'property_twin') return;
  var pending = (_dcFedArr || []).map(function (it, ix) { return { it: it, ix: ix }; })
    .filter(function (p) {
      var a = (p.it.context || {}).assist;
      if (!(a && a.verdict === 'merge' && a.layer === 'deterministic')) return false;
      var r = document.getElementById('dc-f' + p.ix); return r && !r.classList.contains('resolved');
    });
  if (!pending.length) { showToast('No deterministic merges to confirm', 'info'); return; }
  var ok = (typeof lccConfirm === 'function')
    ? await lccConfirm('Merge ' + pending.length + ' deterministic twin' + (pending.length === 1 ? '' : 's') + '?\n\nEach is a same-operator, near-identical-name pair — the same building captured twice. The shadow folds into the CCN anchor. Reversible per-row via dia_unmerge_property.')
    : (typeof confirm === 'function' ? confirm('Merge ' + pending.length + ' deterministic twins?') : true);
  if (!ok) return;
  var done = 0, failed = 0;
  for (var k = 0; k < pending.length; k++) {
    var p = pending[k];
    var res = await opsApi('/api/decision-verdict', {
      method: 'POST', body: JSON.stringify({ type: 'property_twin', subject: p.it, verdict: 'merge', payload: {} }),
    });
    var row = document.getElementById('dc-f' + p.ix);
    if (res.ok && res.data && res.data.ok) { done++; if (row) { row.classList.add('resolved'); row.style.opacity = '0'; } }
    else { failed++; }
  }
  document.querySelectorAll('#reviewConsoleContent .q-item.resolved[id^="dc-f"]').forEach(function (n) { if (n.parentNode) n.remove(); });
  _dcAdvanceFed();
  showToast('Merged: ' + done + (failed ? ' · ' + failed + ' failed' : ''), failed ? 'error' : 'success');
}
window.dcFedBulkTwinMerges = dcFedBulkTwinMerges;

// W8 owner_reconcile seeder chip: filter the shown cards to a single seeder
// (client-side, by each card's data-seeder attribute). Empty kind = show all.
function dcFedSeederFilter(kind) {
  const el = document.getElementById('reviewConsoleContent');
  if (!el) return;
  el.querySelectorAll('.q-item[id^="dc-f"]').forEach(function (card) {
    const k = card.getAttribute('data-seeder') || '';
    card.style.display = (!kind || k === kind) ? '' : 'none';
  });
  const chips = document.getElementById('ownRecSeederChips');
  if (chips) chips.querySelectorAll('.pq-chip').forEach(function (b) {
    b.classList.toggle('active', (b.getAttribute('data-seeder-chip') || '') === (kind || ''));
  });
}
window.dcFedSeederFilter = dcFedSeederFilter;

// R59 Unit 3 — per-lane SAFE bulk verdict (record-only / non-destructive only).
var _DC_BULK_SAFE = {
  // intake_disposition intentionally omitted — the default lane is create-
  // candidates (real listings), so a "dismiss all" bulk would be a footgun.
  property_merge: { verdict: 'not_duplicate', label: 'Mark all "not a duplicate"' },
  resolve_ownership: { verdict: 'keep', label: 'Keep current owner on all' },
  owner_source_conflict: { verdict: 'keep_current', label: 'Keep current owner on all' },
  provenance_conflict: { verdict: 'keep_current', label: 'Keep current on all' },
  cms_link_suspect: { verdict: 'link_correct', label: 'Confirm all links correct' },
  implausible_value: { verdict: 'confirm_as_is', label: 'Confirm all as-is' },
  merge_duplicate_entities: { verdict: 'keep_separate', label: 'Keep all separate' },
};

async function dcFedBulkSafe() {
  var bulk = _DC_BULK_SAFE[_dcFedType];
  if (!bulk) return;
  var pending = (_dcFedArr || []).map(function (it, ix) { return { it: it, ix: ix }; })
    .filter(function (p) { var r = document.getElementById('dc-f' + p.ix); return r && !r.classList.contains('resolved'); });
  if (!pending.length) { showToast('Nothing to bulk-handle', 'info'); return; }
  var ok = (typeof lccConfirm === 'function')
    ? await lccConfirm('Apply "' + bulk.label + '" to ' + pending.length + ' shown item' + (pending.length === 1 ? '' : 's') + '?\n\nThis is a safe, record-only verdict (no merges / no domain writes).')
    : (typeof confirm === 'function' ? confirm(bulk.label + ' — ' + pending.length + ' items?') : true);
  if (!ok) return;
  var done = 0, failed = 0;
  for (var k = 0; k < pending.length; k++) {
    var p = pending[k];
    var res = await opsApi('/api/decision-verdict', {
      method: 'POST', body: JSON.stringify({ type: _dcFedType, subject: p.it, verdict: bulk.verdict, payload: {} }),
    });
    var row = document.getElementById('dc-f' + p.ix);
    if (res.ok && res.data && res.data.ok) {
      done++;
      if (row) { row.classList.add('resolved'); row.style.opacity = '0'; }
    } else { failed++; }
  }
  document.querySelectorAll('#reviewConsoleContent .q-item.resolved[id^="dc-f"]').forEach(function (n) { if (n.parentNode) n.remove(); });
  _dcAdvanceFed();
  showToast('Bulk: ' + done + ' handled' + (failed ? ' · ' + failed + ' failed' : ''), failed ? 'error' : 'success');
}
window.dcFedBulkSafe = dcFedBulkSafe;

// W8 U5 (Prompt 79): bulk-confirm the deterministic dictionary renames shown in
// the naming_hygiene_review lane. Unlike dcFedBulkSafe (record-only), each confirm
// WRITES the expanded name — but only for UNAMBIGUOUS deterministic renames
// (ambiguous/LLM + address-link cards are filtered out and keep their per-card
// gate). Every write is reversible (naming_hygiene_batch ledger).
async function dcFedBulkHygieneRenames() {
  if (_dcFedType !== 'naming_hygiene_review') return;
  var pending = (_dcFedArr || []).map(function (it, ix) { return { it: it, ix: ix }; })
    .filter(function (p) {
      var c = p.it.context || {};
      if (!(c.deterministic === true && c.proposed_action === 'rename')) return false;
      var r = document.getElementById('dc-f' + p.ix); return r && !r.classList.contains('resolved');
    });
  if (!pending.length) { showToast('No deterministic renames to confirm', 'info'); return; }
  var ok = (typeof lccConfirm === 'function')
    ? await lccConfirm('Confirm ' + pending.length + ' deterministic dictionary rename' + (pending.length === 1 ? '' : 's') + '?\n\nEach expands an unambiguous abbreviation (e.g. Prtnrs→Partners). Reversible via the ledger.')
    : (typeof confirm === 'function' ? confirm('Confirm ' + pending.length + ' renames?') : true);
  if (!ok) return;
  var done = 0, failed = 0;
  for (var k = 0; k < pending.length; k++) {
    var p = pending[k];
    var res = await opsApi('/api/decision-verdict', {
      method: 'POST', body: JSON.stringify({ type: 'naming_hygiene_review', subject: p.it, verdict: 'confirm', payload: {} }),
    });
    var row = document.getElementById('dc-f' + p.ix);
    if (res.ok && res.data && res.data.ok) { done++; if (row) { row.classList.add('resolved'); row.style.opacity = '0'; } }
    else { failed++; }
  }
  document.querySelectorAll('#reviewConsoleContent .q-item.resolved[id^="dc-f"]').forEach(function (n) { if (n.parentNode) n.remove(); });
  _dcAdvanceFed();
  showToast('Renamed: ' + done + (failed ? ' · ' + failed + ' failed' : ''), failed ? 'error' : 'success');
}
window.dcFedBulkHygieneRenames = dcFedBulkHygieneRenames;

// W9.2 (Prompt 88): bulk-confirm the DETERMINISTIC reachability fills shown in the
// reachability_harvest_review lane. Each confirm fill-blanks the domain contact's
// email/phone from an exact-identity donor (arithmetic, confidence 1.0) — reversible
// (reachability_harvest_apply_log). LLM cards are filtered out (per-card gate).
async function dcFedBulkReachabilityFills() {
  if (_dcFedType !== 'reachability_harvest_review') return;
  var pending = (_dcFedArr || []).map(function (it, ix) { return { it: it, ix: ix }; })
    .filter(function (p) {
      var c = p.it.context || {};
      // deterministic FILLS only — never a create-contact (target_kind='owner'),
      // which is a mint, always a per-card human decision.
      if (c.arm !== 'deterministic' || c.target_kind === 'owner') return false;
      var r = document.getElementById('dc-f' + p.ix); return r && !r.classList.contains('resolved');
    });
  if (!pending.length) { showToast('No deterministic fills to confirm', 'info'); return; }
  var ok = (typeof lccConfirm === 'function')
    ? await lccConfirm('Confirm ' + pending.length + ' deterministic reachability fill' + (pending.length === 1 ? '' : 's') + '?\n\nEach copies an email/phone from the SAME person\'s synced record (exact identity match). Fill-blanks only; reversible via the ledger.')
    : (typeof confirm === 'function' ? confirm('Confirm ' + pending.length + ' fills?') : true);
  if (!ok) return;
  var done = 0, failed = 0;
  for (var k = 0; k < pending.length; k++) {
    var p = pending[k];
    var res = await opsApi('/api/decision-verdict', {
      method: 'POST', body: JSON.stringify({ type: 'reachability_harvest_review', subject: p.it, verdict: 'confirm', payload: {} }),
    });
    var row = document.getElementById('dc-f' + p.ix);
    if (res.ok && res.data && res.data.ok) { done++; if (row) { row.classList.add('resolved'); row.style.opacity = '0'; } }
    else { failed++; }
  }
  document.querySelectorAll('#reviewConsoleContent .q-item.resolved[id^="dc-f"]').forEach(function (n) { if (n.parentNode) n.remove(); });
  _dcAdvanceFed();
  showToast('Filled: ' + done + (failed ? ' · ' + failed + ' failed' : ''), failed ? 'error' : 'success');
}
window.dcFedBulkReachabilityFills = dcFedBulkReachabilityFills;

async function dcImplausibleCorrect(i) {
  const it = _dcFedArr[i]; if (!it) return;
  const c = it.context || {};
  const curStr = (isFinite(Number(c.sold_price)) && Number(c.sold_price) > 0)
    ? '$' + Math.round(Number(c.sold_price)).toLocaleString() : '(none)';
  const ceil = (isFinite(Number(c.ceiling)) && Number(c.ceiling) > 0)
    ? '$' + Math.round(Number(c.ceiling)).toLocaleString() : '';
  const ctx = (c.address ? c.address + (c.state ? ' ' + c.state : '') + ' — ' : '')
    + 'recorded ' + curStr + (ceil ? ' (over the ' + ceil + ' ceiling)' : '');
  const v = typeof lccPrompt === 'function'
    ? await lccPrompt('Correct this sale price.\n\n' + ctx + '\n\nEnter the corrected price (numbers only):', '')
    : (typeof prompt === 'function' ? prompt('Corrected sale price (number):') : '');
  if (v == null) return;
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  if (!isFinite(n) || n <= 0) { if (typeof showToast === 'function') showToast('Enter a valid price', 'error'); return; }
  dcFed(i, 'correct', { corrected_price: n });
}
window.dcImplausibleCorrect = dcImplausibleCorrect;

// R47: name the controlling parent for an owner cluster, then register it.
async function dcOwnerParentSet(i) {
  const it = _dcFedArr[i]; if (!it) return;
  const c = it.context || {};
  const samples = (c.sample_owner_names || []).slice(0, 4).join('\n  ');
  const def = c.suggested_parent_name || '';
  const msg = 'Name the controlling parent for these shells (token "' + (c.cluster_token || '') + '"):'
    + (samples ? '\n\n  ' + samples : '') + '\n\nParent account name:';
  const v = typeof lccPrompt === 'function' ? await lccPrompt(msg, def)
    : (typeof prompt === 'function' ? prompt(msg, def) : '');
  if (v == null) return;
  const name = String(v).trim();
  if (!name) { if (typeof showToast === 'function') showToast('Enter a parent name', 'error'); return; }
  dcFed(i, 'set_parent', { parent_name: name });
}
window.dcOwnerParentSet = dcOwnerParentSet;

// R53: confirm a suspected sale → a REAL sales row. The operator MUST supply a
// price (we never fabricate); the date defaults to when the change was seen.
async function dcConfirmSuspectedSale(i) {
  const it = _dcFedArr[i]; if (!it) return;
  const c = it.context || {};
  const ctx = (c.address ? c.address + (c.state ? ' ' + c.state : '') + ' — ' : '')
    + '"' + (c.suspected_grantor || '?') + '" → "' + (c.suspected_grantee || '?') + '"';
  const pv = typeof lccPrompt === 'function'
    ? await lccPrompt('Confirm this sale.\n\n' + ctx + '\n\nEnter the SALE PRICE (numbers only — we never guess):', '')
    : (typeof prompt === 'function' ? prompt('Sale price (number):') : '');
  if (pv == null) return;
  const price = Number(String(pv).replace(/[^0-9.]/g, ''));
  if (!isFinite(price) || price < 50000) { if (typeof showToast === 'function') showToast('Enter a real price (≥ $50k)', 'error'); return; }
  const defDate = c.suspected_sale_date ? String(c.suspected_sale_date).slice(0, 10) : '';
  const dv = typeof lccPrompt === 'function'
    ? await lccPrompt('Sale date (YYYY-MM-DD):', defDate)
    : (typeof prompt === 'function' ? prompt('Sale date (YYYY-MM-DD):', defDate) : defDate);
  if (dv == null) return;
  const saleDate = String(dv).trim() || defDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(saleDate)) { if (typeof showToast === 'function') showToast('Enter a valid date (YYYY-MM-DD)', 'error'); return; }
  dcFed(i, 'confirm_sale', {
    sold_price: price, sale_date: saleDate,
    buyer: c.suspected_grantee || null, seller: c.suspected_grantor || null,
  });
}
window.dcConfirmSuspectedSale = dcConfirmSuspectedSale;

// Ownership consolidation: confirm a resolve_ownership card AS a sale (the change
// was an unrecorded transfer). Reuses the R53 price/date prompt; the operator MUST
// supply a price (never fabricated). Dispatches the resolve_ownership confirm_sale
// verdict (dcFed posts _dcFedType, which is resolve_ownership on this lane).
async function dcResolveConfirmSale(i) {
  const it = _dcFedArr[i]; if (!it) return;
  const c = it.context || {};
  const ctx = (c.address ? c.address + (c.state ? ' ' + c.state : '') + ' — ' : '')
    + '"' + (c.recorded_owner_name || '?') + '" → "' + (c.proposed_owner_name || '?') + '"';
  const pv = typeof lccPrompt === 'function'
    ? await lccPrompt('Confirm this ownership change as a SALE.\n\n' + ctx + '\n\nEnter the SALE PRICE (numbers only — we never guess):', '')
    : (typeof prompt === 'function' ? prompt('Sale price (number):') : '');
  if (pv == null) return;
  const price = Number(String(pv).replace(/[^0-9.]/g, ''));
  if (!isFinite(price) || price < 50000) { if (typeof showToast === 'function') showToast('Enter a real price (≥ $50k)', 'error'); return; }
  const defDate = (c.suspected_sale_date || c.latest_deed_date || c.most_recent_signal_date)
    ? String(c.suspected_sale_date || c.latest_deed_date || c.most_recent_signal_date).slice(0, 10) : '';
  const dv = typeof lccPrompt === 'function'
    ? await lccPrompt('Sale date (YYYY-MM-DD):', defDate)
    : (typeof prompt === 'function' ? prompt('Sale date (YYYY-MM-DD):', defDate) : defDate);
  if (dv == null) return;
  const saleDate = String(dv).trim() || defDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(saleDate)) { if (typeof showToast === 'function') showToast('Enter a valid date (YYYY-MM-DD)', 'error'); return; }
  dcFed(i, 'confirm_sale', {
    sold_price: price, sale_date: saleDate,
    buyer: c.proposed_owner_name || null, seller: c.recorded_owner_name || null,
  });
}
window.dcResolveConfirmSale = dcResolveConfirmSale;

async function dcFed(i, verdict, payload) {
  const it = _dcFedArr[i]; if (!it) return;
  const res = await opsApi('/api/decision-verdict', {
    method: 'POST', body: JSON.stringify({ type: _dcFedType, subject: it, verdict: verdict, payload: payload || {} }),
  });
  const row = document.getElementById('dc-f' + i);
  if (res.ok && res.data && res.data.ok) {
    let fwd = '';
    const nx = res.data.next;
    if (nx && nx.action === 'cms_unlink') {
      fwd = ' <button class="q-action primary" onclick="dcCmsUnlink(' + esc(String(nx.property_id)) + ')">Break link in cms-match →</button>';
    } else if (nx && (nx.action === 'intake_create_property' || nx.action === 'intake_reextract')) {
      fwd = ' <button class="q-action primary" onclick="navTo(\'pageInbox\')">Finish in Inbox →</button>';
    } else if (nx && nx.action === 'intake_open_property' && nx.domain && nx.property_id != null && typeof openUnifiedDetail === 'function') {
      fwd = ' <button class="q-action primary" onclick="openUnifiedDetail(\'' + esc(nx.domain) + '\', {property_id: ' + esc(String(nx.property_id)) + '}, {}, \'Overview\')">Open property →</button>';
    } else if (nx && nx.action === 'bad_rent_lane') {
      fwd = ' <button class="q-action primary" onclick="renderFederatedLane(\'bad_rent_lease\')">Open bad-rent lane →</button>';
    }
    if (typeof showToast === 'function') showToast('Recorded', 'success');
    if (row) {
      row.classList.add('resolved');
      row.innerHTML = '<div class="dc-collapsed">✓ ' + esc(res.data.verdict || verdict) + fwd + '</div>';
      if (fwd) {
        _dcAdvanceFed();                    // keep the collapsed row (has a CTA)
      } else {
        row.style.transition = 'opacity .4s ease';
        row.style.opacity = '0';
        setTimeout(function () { if (row.parentNode) row.remove(); _dcAdvanceFed(); }, 420);
      }
    } else {
      _dcAdvanceFed();
    }
  } else if (_dcFedType === 'sf_link_candidate' && res.data && res.data.conflict) {
    // A DIFFERENT Salesforce id landed since W4.3 — the Link button never
    // overwrites; re-render THIS card as the three-way conflict variant so the
    // operator can keep the existing link, switch, or research.
    it.context = it.context || {};
    it.context.conflict_existing_id = res.data.existing_sf_id || it.context.conflict_existing_id;
    const wasNext = row && row.classList.contains('pq-next');
    if (row) row.outerHTML = _fedCardHTML(it, i, wasNext);
    if (typeof showToast === 'function') showToast('A different Salesforce link now exists — confirm which to keep', 'info');
  } else {
    const err = (res.data && (res.data.error || res.data.message)) || res.error || 'unknown';
    if (typeof showToast === 'function') showToast('Action failed: ' + err, 'error');
  }
}
window.dcFed = dcFed;

// Prompt 77: resolve a w8_u3 ambiguous_entity_match conflict by picking the
// survivor entity (entityId) or minting a new one (mintNew). Rides the same
// dcFed verdict path with resolve_conflict set, so the writer bypasses the
// ambiguity guard and lands the edge end-to-end.
async function dcFedU3Pick(i, entityId, mintNew) {
  const payload = { resolve_conflict: true };
  if (mintNew) payload.mint_new = true; else payload.chosen_entity_id = entityId;
  return dcFed(i, 'link', payload);
}
window.dcFedU3Pick = dcFedU3Pick;

// Unit 2 — merge with an operator-chosen survivor. Reads the survivor dropdown
// (default = the view winner) and only sends winner_id on a real override, so
// admin.js's override flag + the chosen survivor are accurate.
function dcMergeGroup(i) {
  const it = _dcFedArr[i]; if (!it) return;
  const c = it.context || {};
  const sel = document.getElementById('dc-mw-' + i);
  const def = String(c.winner_id || '');
  const w = sel ? String(sel.value || '') : def;
  dcFed(i, 'merge', (w && w !== def) ? { winner_id: w } : {});
}
window.dcMergeGroup = dcMergeGroup;

// Phase 1b — link a contact to the chosen owner org. Reads the picker (default =
// the highest-value candidate) and only sends owner_entity_id on a real override
// (single-candidate cards send nothing → admin.js uses the best candidate).
function cclLink(i) {
  const it = _dcFedArr[i]; if (!it) return;
  const c = it.context || {};
  const sel = document.getElementById('ccl-owner-' + i);
  const def = String(c.owner_org_id || '');
  const w = sel ? String(sel.value || '') : def;
  dcFed(i, 'link', (w && w !== def) ? { owner_entity_id: w } : undefined);
}
window.cclLink = cclLink;

// cms break-link hands off to the existing cms-match DELETE route (Scott's call).
async function dcCmsUnlink(propertyId) {
  const res = await opsApi('/api/cms-match?action=link&property_id=' + encodeURIComponent(propertyId), { method: 'DELETE' });
  if (res.ok) { if (typeof showToast === 'function') showToast('CMS link broken', 'success'); }
  else { if (typeof showToast === 'function') showToast('Unlink failed: ' + (res.error || 'unknown'), 'error'); }
}
window.dcCmsUnlink = dcCmsUnlink;

function _dcAdvanceFed() {
  const scope = document.getElementById('reviewConsoleContent');
  if (!scope) return;
  const pending = scope.querySelectorAll('.q-item[id^="dc-f"]:not(.resolved)');
  const rem = document.getElementById('dcRemaining');
  if (rem) rem.textContent = pending.length;
  scope.querySelectorAll('.q-item.pq-next').forEach(function (n) { n.classList.remove('pq-next'); });
  if (pending.length) {
    pending[0].classList.add('pq-next');
    pending[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else {
    const prog = scope.querySelector('.rc-progress');
    if (prog) prog.innerHTML = 'All decided in this lane ✓' + _dcNextLaneCTA(_dcCurrentOpenExpr);
    if (typeof showToast === 'function') showToast('Lane cleared ✓', 'success');
  }
}
