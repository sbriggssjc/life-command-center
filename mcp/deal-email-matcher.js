// ============================================================================
// deal-email-matcher.js — Deal-Email Matcher (Spine #3), v2.2: core-tenant + city, precise + bounded.
// Place in mcp/deal-email-matcher.js (engine deploy context).
//
//   import { makeDealEmailMatcherRoute } from './deal-email-matcher.js';
//   const matcher = makeDealEmailMatcherRoute({ opsQuery, enc, WORKSPACE_ID: PRIMARY_WORKSPACE_ID });
//   app.post('/api/pipeline/match-deal-emails', authenticate, matcher.match);
//
// TB deals have no structured SF party roster (see deal-party-roster-source.md), so this attributes
// Outlook emails (which resolve to PERSON entities) to DEALS by STRONG SIGNAL: the deal's tenant AND city.
//
// HISTORY. v2 tried a "tenant-alone when distinctive" recall mode; the dry-run refuted it — same-operator,
// different-property mail (Innovative Renal Care *Arvada CO* vs the Milwaukee deal; DaVita-Anchored *SF/CT* vs
// Springfield IL; Action Behavior *Fort Worth* vs Duncanville) was mis-attributed. **City is load-bearing** —
// dropping it breaks precision. So v2.1 keeps city REQUIRED and instead banks the two safe wins the dry-run
// surfaced (see matcher-recall-design.md):
//   1. CORE TENANT — strip generic descriptors (MOB/Dialysis/Center/Care/…) so "DaVita in Queens" matches the
//      "DaVita Dialysis - Queens" deal (v1 required "DaVita Dialysis" verbatim and missed it). City still required.
//   2. WORD-BOUNDARY match — "Essentia" no longer matches "Essential"; substring FPs gone.
//   3. DIGEST EXCLUSION — the weekly pipeline email lists every deal, so it self-attributed; skip LCC-generated
//      cadence mail (body marker "LCC cadence engine").
//   * ?dry_run=1 (query or body) reports per-deal {core_tenant, would_attribute, sample_titles} and WRITES NOTHING.
//
// On a live match it (unchanged): (1) writes a deal-attributed activity_events row on the ASSET, idempotent by
// (entity_id, external_id); (2) writes the email's person as an 'email_derived' deal_party edge.
// Scope = in-scope open Team Briggs deals (owned OR partnership OR explicit include).
//
// v2.2 (P123, 2026-08-21) — MATCHING LOGIC UNCHANGED; the run is now bounded and honest.
// v2.1 held the hourly cron at ~75-90 s against `lcc_cron_post`'s 60 s pg_net window, so EVERY call
// recorded `no_response` while Railway quietly finished and logged ok=true. The cost was not the DB
// (~100 ms per deal): it was ~680 SEQUENTIAL PostgREST round trips per run — one idempotency GET and
// one roster-edge GET per matched email — spent rediscovering that all 341 matches were already
// attributed. Four changes, none of which touch what counts as a match:
//   1. BULK PRE-FETCH of the attributed-key set and the existing deal_party edge set (two paged reads);
//      the per-email checks become in-memory Set hits. Fails CLOSED — a failed prefetch aborts the run
//      rather than re-POSTing hundreds of rows and reporting a fake delta.
//   2. CANDIDATE QUERY carries BOTH core tenant AND city to the DB. Substring ⊇ the word-boundary test
//      applied in memory, so no match can be lost; the candidate set (and the payload of full email
//      bodies) collapses, and the per-deal cap stops binding.
//   3. EVERY multi-row read PAGES AT 1000 — PostgREST caps a response at 1000 rows regardless of
//      `limit=`, so the old `limit=1200` silently returned 1000 and dropped real matches. Truncation is
//      now counted (`candidates_truncated`), never silent.
//   4. WORK BUDGET — `deadline_ms` (default 40 s, inside the 60 s window) + `max_writes` + a deal
//      `cursor`. A run stops on a deal BOUNDARY and hands the next run `cursor_end`, so a backlog can
//      never push one invocation past the response window. `budget_stopped` says so out loud.
// A failed candidate READ is now an ERROR, not "this deal has no mail" — that swallow is exactly how a
// broken read looks identical to a quiet inbox.
// ============================================================================

const SYSTEM_ACTOR = 'b0000000-0000-0000-0000-000000000001';
const REL = 'deal_party';
const CAND_LIMIT = 1200;   // per-deal candidate cap (core+city substring hits)
// PostgREST caps EVERY response at 1000 rows regardless of `limit=`, so a bare
// `limit=1200` silently returns 1000 and drops the rest. Every multi-row read
// here pages at exactly 1000 (see fetchAllPages) and reports truncation.
const PAGE = 1000;
// P123 work budget. lcc_cron_post posts with timeout_milliseconds := 60000, so a
// run MUST come back inside that window or pg_net records `no_response` and the
// run looks dropped even when it succeeded. These are the structural guarantee.
const DEFAULT_DEADLINE_MS = 40000;
const DEFAULT_MAX_WRITES = 400;
const DIGEST_MARKER = 'lcc cadence engine';   // footer of the engine-composed pipeline digest — never a real deal email
// The weekly pipeline digest lists every in-scope deal, so it self-attributes. Its stored body often lacks the
// footer marker, but its SUBJECT is reliably "<scope> pipeline — N overdue, M due soon". Exclude on that shape.
function isDigestEmail(titleL, hayL) {
  if (hayL.includes(DIGEST_MARKER)) return true;
  return /\bpipeline\b/.test(titleL) && /\b(overdue|due soon)\b/.test(titleL);
}

function tenantSegment(name) {
  return String(name || '').split(/\s+-\s+/)[0].replace(/\(.*\)/g, '').trim();
}
function cityBaseOf(city) {
  return String(city || '').replace(/\(.*\)/g, '').trim();
}
const GENERIC = new Set([
  'mob', 'dialysis', 'clinic', 'clinics', 'center', 'centers', 'health', 'group', 'urgent',
  'care', 'medical', 'portfolio', 'anchored', 'inc', 'llc', 'the', 'ii', 'iii', 'iv', 'i',
  'trust', 'company', 'co', 'corp', 'lp', 'ltd', 'associates', 'partners',
]);
function coreTenantOf(tenantSeg) {
  const words = String(tenantSeg || '').replace(/[&/]/g, ' ').split(/\s+/).filter(Boolean);
  const kept = words.filter(w => {
    const bare = w.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!bare) return false;
    if (GENERIC.has(bare)) return false;
    if (/^\d+$/.test(bare)) return false;
    return true;
  });
  const core = kept.join(' ').trim();
  return core.length >= 4 ? core : tenantSeg;   // fall back rather than strip to noise
}
const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Whole-word (bounded) presence test, case-insensitive. Fixes "Essentia" ⊂ "Essential".
function hasWord(text, term) {
  const t = String(term || '').trim();
  if (!t) return false;
  try { return new RegExp('\\b' + reEsc(t.toLowerCase()) + '\\b').test(text); }
  catch { return text.includes(t.toLowerCase()); }
}

export function makeDealEmailMatcherRoute({ opsQuery, enc, WORKSPACE_ID }) {
  // PostgREST returns at most 1000 rows per response no matter what `limit=` says,
  // so anything that can exceed 1000 MUST be strided at exactly 1000 or it silently
  // loses rows. Returns { ok, rows, truncated } — `truncated` is an honest flag, not
  // a silent cap.
  async function fetchAllPages(basePath, cap) {
    const rows = [];
    let offset = 0;
    // offset paging over an UNORDERED result set can skip or duplicate rows, so impose a
    // stable order here rather than trusting every caller to remember one.
    const ordered = /(^|[?&])order=/.test(basePath) ? basePath : `${basePath}${basePath.includes('?') ? '&' : '?'}order=id.asc`;
    for (;;) {
      const sep = ordered.includes('?') ? '&' : '?';
      const r = await opsQuery('GET', `${ordered}${sep}limit=${PAGE}&offset=${offset}`);
      if (r && r.ok === false) return { ok: false, status: r.status, data: r.data, rows, truncated: false };
      const page = Array.isArray(r && r.data) ? r.data : [];
      rows.push(...page);
      if (page.length < PAGE) return { ok: true, rows, truncated: false };
      if (cap && rows.length >= cap) return { ok: true, rows: rows.slice(0, cap), truncated: true };
      offset += PAGE;
    }
  }

  return {
    match: async (req, res) => {
      const startedAt = Date.now();
      try {
        const q = { ...(req.query || {}), ...(req.body || {}) };
        const dryRun = q.dry_run === 1 || q.dry_run === '1' || q.dry_run === true || q.dry_run === 'true';
        const num = (v, dflt) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : dflt);
        const deadlineMs = num(q.deadline_ms, DEFAULT_DEADLINE_MS);
        const maxWrites = num(q.max_writes, DEFAULT_MAX_WRITES);
        const deadlineAt = startedAt + deadlineMs;
        const outOfTime = () => Date.now() >= deadlineAt;

        // 1. In-scope open deals (same scope rule as cadence-scan).
        const [tbRes, oppRes, edgeRes] = await Promise.all([
          opsQuery('GET', 'lcc_users?select=lcc_user_id&active=eq.true'),
          opsQuery('GET',
            `bd_opportunities?workspace_id=eq.${enc(WORKSPACE_ID)}&sf_opp_id=not.is.null&is_open=eq.true` +
            `&select=entity_id,sf_opp_id,owner_user_id,metadata`),
          opsQuery('GET',
            `entity_relationships?workspace_id=eq.${enc(WORKSPACE_ID)}&relationship_type=eq.deal_party` +
            `&metadata->>source=eq.sf_opp_team&select=from_entity_id`),
        ]);
        const tbUsers = new Set((tbRes.data || []).map(r => r.lcc_user_id));
        const tbTeamAssets = new Set((edgeRes.data || []).map(r => r.from_entity_id));
        const inScope = (oppRes.data || []).filter(d =>
          (d.owner_user_id && tbUsers.has(d.owner_user_id)) ||
          tbTeamAssets.has(d.entity_id) ||
          d.metadata?.team_briggs_include === true);

        // 2. Entity name/city for each in-scope deal.
        const ids = [...new Set(inScope.map(d => d.entity_id).filter(Boolean))];
        const nameById = new Map();
        if (ids.length) {
          const er = await opsQuery('GET',
            `entities?id=in.(${ids.map(x => enc(x)).join(',')})&select=id,name,city,state`);
          for (const e of (er.data || [])) nameById.set(e.id, e);
        }

        const summary = {
          version: 'v2.2', dry_run: dryRun,
          deals_scanned: 0, deals_with_matches: 0, emails_attributed: 0,
          already_attributed: 0, roster_edges: 0, skipped_thin_tokens: 0,
          digest_excluded: 0, errors: [],
          // P123 budget/observability
          deals_total: 0, cursor_start: 0, cursor_end: 0, budget_stopped: false,
          candidates_truncated: 0, candidate_filter_fallback: 0, duration_ms: 0,
        };
        const dryDeals = [];

        // 3. ELIGIBILITY (pure, no I/O) — computed over EVERY in-scope deal so
        //    skipped_thin_tokens stays a whole-population count even when the
        //    cursor only works a slice this run.
        const eligible = [];
        for (const d of inScope) {
          const e = nameById.get(d.entity_id);
          if (!e) { summary.skipped_thin_tokens++; continue; }
          const core = coreTenantOf(tenantSegment(e.name));
          const cityBase = cityBaseOf(e.city);
          const coreL = core.toLowerCase();
          const cl = cityBase.toLowerCase();
          // Precision guard: need a distinctive core and a city, and the core must not just be the city.
          if (core.length < 4 || cityBase.length < 3 || coreL === cl) {
            summary.skipped_thin_tokens++; continue;
          }
          eligible.push({ d, e, core, cityBase, coreL, cl });
        }
        summary.deals_total = eligible.length;

        // 4. BULK PRE-FETCH — the P123 fix. v2.1 issued ONE idempotency GET and ONE
        //    roster-edge GET *per matched email*: 341 matches ⇒ ~680 sequential
        //    PostgREST round trips per run, ~75-90 s, every one of them only to
        //    rediscover work already done (emails_attributed stayed 0 while
        //    already_attributed sat at 341, hour after hour). Two paged reads
        //    replace all of it, and the checks become in-memory Set lookups.
        //    Fails CLOSED: if a prefetch read fails we do not fall back to
        //    "assume nothing is attributed" — that would re-POST hundreds of rows
        //    against the unique index and report a fake delta.
        const attributedKeys = new Set();
        const edgeKeys = new Set();
        const edgeKey = (from, to) => `${from}|${to}`;
        if (!dryRun) {
          const att = await fetchAllPages(
            `activity_events?workspace_id=eq.${enc(WORKSPACE_ID)}` +
            `&source_type=eq.${enc('lcc:deal_match')}&select=external_id&order=id.asc`);
          if (!att.ok) {
            summary.errors.push({ stage: 'prefetch_attributed', status: att.status, detail: att.data });
            summary.duration_ms = Date.now() - startedAt;
            return res.status(200).json({ ok: false, ...summary });
          }
          for (const r of att.rows) if (r.external_id != null) attributedKeys.add(String(r.external_id));

          if (eligible.length) {
            const dealIds = [...new Set(eligible.map(x => x.d.entity_id))];
            const edg = await fetchAllPages(
              `entity_relationships?workspace_id=eq.${enc(WORKSPACE_ID)}` +
              `&relationship_type=eq.${enc(REL)}` +
              `&from_entity_id=in.(${dealIds.map(x => enc(x)).join(',')})` +
              `&select=from_entity_id,to_entity_id&order=id.asc`);
            if (!edg.ok) {
              summary.errors.push({ stage: 'prefetch_edges', status: edg.status, detail: edg.data });
              summary.duration_ms = Date.now() - startedAt;
              return res.status(200).json({ ok: false, ...summary });
            }
            for (const r of edg.rows) edgeKeys.add(edgeKey(r.from_entity_id, r.to_entity_id));
          }
        }

        // 5. CURSOR — a bounded slice per invocation. A dry run is a report, so it
        //    always starts at 0 and walks the whole list (still deadline-bound).
        const total = eligible.length;
        const rawCursor = Number(q.cursor);
        const startIdx = (!dryRun && Number.isInteger(rawCursor) && rawCursor >= 0 && total)
          ? rawCursor % total : 0;
        summary.cursor_start = startIdx;
        summary.cursor_end = startIdx;
        let writes = 0;

        for (let n = 0; n < total; n++) {
          const idx = (startIdx + n) % total;
          // Stop BEFORE starting a deal we cannot finish, and hand the next run the
          // deal we did not get to — never mid-deal, so no partial-deal state.
          if (!dryRun && (outOfTime() || writes >= maxWrites)) {
            summary.budget_stopped = true;
            summary.cursor_end = idx;
            break;
          }
          if (dryRun && outOfTime()) { summary.budget_stopped = true; summary.cursor_end = idx; break; }

          const { d, e, core, cityBase, coreL, cl } = eligible[idx];
          summary.deals_scanned++;
          summary.cursor_end = (idx + 1) % total;

          // Candidate emails. v2.1 asked only for the CORE tenant and filtered city
          // in memory, so a common core ("DaVita", "Physicians") pulled the whole
          // 1000-row PostgREST page of full email BODIES and truncated real matches
          // past the cap. Both terms now go to the DB (substring ⊇ the word-boundary
          // test applied below, so this cannot lose a match the in-memory filter
          // would have kept) — the candidate set collapses and the cap stops binding.
          const coreLike = enc('*' + core + '*');
          const cityLike = enc('*' + cityBase + '*');
          const selectCols = '&select=id,entity_id,title,body,occurred_at,external_id,domain';
          let cand = await fetchAllPages(
            `activity_events?source_type=eq.outlook` +
            `&and=(or(title.ilike.${coreLike},body.ilike.${coreLike}),` +
            `or(title.ilike.${cityLike},body.ilike.${cityLike}))` + selectCols, CAND_LIMIT);
          if (!cand.ok) {
            // Loud, not silent: if the nested logic tree is ever rejected we fall back
            // to v2.1's core-only shape so matching keeps working, but the run records
            // the failure and reports not-ok so the cron alert fires.
            summary.candidate_filter_fallback++;
            summary.errors.push({ sf_opp_id: d.sf_opp_id, stage: 'candidate_filter', status: cand.status, detail: cand.data });
            cand = await fetchAllPages(
              `activity_events?source_type=eq.outlook` +
              `&or=(title.ilike.${coreLike},body.ilike.${coreLike})` + selectCols, CAND_LIMIT);
            if (!cand.ok) {
              summary.errors.push({ sf_opp_id: d.sf_opp_id, stage: 'candidate_fallback', status: cand.status, detail: cand.data });
              continue;   // a failed READ is an error, never "this deal has no mail"
            }
          }
          if (cand.truncated) summary.candidates_truncated++;

          const matches = [];
          for (const m of cand.rows) {
            const titleL = String(m.title || '').toLowerCase();
            const hay = `${m.title || ''} ${m.body || ''}`.toLowerCase();
            if (isDigestEmail(titleL, hay)) { summary.digest_excluded++; continue; }    // self-referential digest
            if (hasWord(hay, coreL) && hasWord(hay, cl)) matches.push(m);               // tenant (word) AND city
          }
          if (matches.length) summary.deals_with_matches++;

          if (dryRun) {
            dryDeals.push({
              sf_opp_id: d.sf_opp_id, deal: e.name, core_tenant: core, city: cityBase,
              would_attribute: matches.length,
              sample_titles: matches.slice(0, 5).map(m => (m.title || '').slice(0, 90)),
            });
            continue;   // never write in dry-run
          }

          for (const m of matches) {
            // The deal-boundary check above cannot bound a SINGLE deal carrying hundreds of
            // NEW matches (each one up to two sequential POSTs). Re-entering the same deal
            // next run is safe and cheap — both writes are guarded by the prefetched Sets and
            // by the DB unique index — so we stop mid-deal and point the cursor AT this deal.
            if (outOfTime() || writes >= maxWrites) {
              summary.budget_stopped = true;
              summary.cursor_end = idx;
              break;
            }
            const key = String(m.external_id || m.id);   // idempotency key for the deal-attributed row
            try {
              // Idempotency aligned to the DB unique constraint (workspace_id, source_type, external_id):
              // an email can be a deal-match activity ONCE. If it's already attributed (to ANY deal), skip the
              // insert — prevents the 23505 collision when a blast/thread names two deals. The roster edge
              // below still runs, so the person is added to this deal's roster regardless. This is now a Set
              // hit against the bulk prefetch, not a per-email HTTP round trip.
              if (attributedKeys.has(key)) {
                summary.already_attributed++;
              } else {
                const ins = await opsQuery('POST', 'activity_events', {
                  workspace_id: WORKSPACE_ID, actor_id: SYSTEM_ACTOR, entity_id: d.entity_id,
                  category: 'email', title: m.title || null, body: m.body || null,
                  occurred_at: m.occurred_at || null, external_id: key,
                  source_type: 'lcc:deal_match', domain: m.domain || null,
                  metadata: { matched_by: 'core_tenant+city', core_tenant: core, city: cityBase,
                              source_email_id: m.id, source_entity_id: m.entity_id },
                });
                writes++;
                if (ins.ok === false) {
                  if (summary.errors.length < 50) summary.errors.push({ sf_opp_id: d.sf_opp_id, detail: ins.data });
                } else {
                  attributedKeys.add(key);
                  summary.emails_attributed++;
                }
              }
              // Email-derived roster edge (deal -> the email's person).
              if (m.entity_id && m.entity_id !== d.entity_id
                  && !edgeKeys.has(edgeKey(d.entity_id, m.entity_id))) {
                const insr = await opsQuery('POST', 'entity_relationships', {
                  workspace_id: WORKSPACE_ID, from_entity_id: d.entity_id, to_entity_id: m.entity_id,
                  relationship_type: REL, metadata: { role: 'correspondent', source: 'email_derived' },
                });
                writes++;
                edgeKeys.add(edgeKey(d.entity_id, m.entity_id));   // don't retry within this run either
                if (insr.ok !== false) summary.roster_edges++;
              }
            } catch (inner) {
              if (summary.errors.length < 50) summary.errors.push({ sf_opp_id: d.sf_opp_id, error: String(inner?.message || inner) });
            }
          }
          if (summary.budget_stopped) break;
        }

        summary.duration_ms = Date.now() - startedAt;
        const ok = summary.errors.length === 0;
        if (dryRun) {
          dryDeals.sort((a, b) => (b.would_attribute || 0) - (a.would_attribute || 0));
          return res.status(200).json({ ok, ...summary, deals: dryDeals });
        }
        return res.status(200).json({ ok, ...summary });
      } catch (e) {
        return res.status(500).json({ ok: false, error: String(e?.message || e), duration_ms: Date.now() - startedAt });
      }
    },
  };
}
