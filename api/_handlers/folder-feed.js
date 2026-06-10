// ============================================================================
// Folder-Feed Worker — SharePoint folder tree → intake pipeline (Phase 2, Slice 1)
// Life Command Center
//
// Turns the EXISTING Team Briggs Documents tree into an ingestion channel that
// flows through the SAME extract → match → promote pipeline as the email-OM
// channel. Read the tree as-is; never reorganize it; never write into it.
//
//   GET  /api/folder-feed-tick   — dry-run: list + classify + report, NO writes
//   POST /api/folder-feed-tick   — drain: stage new/changed OMs, record in
//                                  folder_feed_seen, sweep vanished paths to stale
//
// Reuse-not-rebuild (the Phase-2 efficiency lesson): folder-feed files already
// live in SharePoint, so there is NOTHING to upload. The artifact row just
// points at the existing server-relative path (storage_backend='sharepoint_pa',
// storage_ref=<path>, inline_data=NULL); the extractor reads the bytes back via
// the Phase-1 "Get file content" PA flow (SHAREPOINT_FETCH_URL). The only NEW
// PA dependency is a "List folder" flow (SHAREPOINT_LIST_URL).
//
// Feature-flagged: with SHAREPOINT_LIST_URL unset the worker no-ops cleanly
// (the find_contacts_by_account / storage-adapter rollout pattern), so the cron
// + endpoint can ship before the PA flow exists.
//
// House rules honored: no new api/*.js (sub-route of intake.js); idempotent on
// (path, content_hash); emit to stageOmIntake (never domain tables); DB-only
// footprint; time-budgeted + bounded folders/tick (the artifact-offload lesson).
// ============================================================================

import { createHash } from 'crypto';
import { authenticate } from '../_shared/auth.js';
import { opsQuery, pgFilterVal, fetchWithTimeout } from '../_shared/ops-db.js';
import { stageOmIntake } from '../_shared/intake-om-pipeline.js';
import { classifyFile, parseSubjectHintFromPath } from '../_shared/folder-feed-classify.js';

// Default roots to walk when neither ?folders= nor FOLDER_FEED_ROOTS is set.
// Full SERVER-RELATIVE paths in the canonical identity form (SINGLE apostrophes —
// toServerRelative() doubles them for the OData literal at request time).
//
// DEFENSE-IN-DEPTH (Slice 1d): scope the FALLBACK to the two "On Market" ingest
// folders only. With read-back now working, a cleared/missing FOLDER_FEED_ROOTS
// env must NOT silently re-expose the entire tree to the cron and auto-promote
// from PROPERTIES (there is no enrich-mode yet). FOLDER_FEED_ROOTS still
// overrides this; PROPERTIES re-enters only via the deliberate Slice-2 enrich
// path. The walk recurses subfolders, so per-bucket subfolders are reached
// automatically.
const DEFAULT_ROOTS = [
  "/sites/TeamBriggs20/Shared Documents/Gv't Leased Research/On Market",
  '/sites/TeamBriggs20/Shared Documents/Dialysis Research/Comps/On Market',
];

// Site document-library prefix the REST GetFolderByServerRelativeUrl needs in
// front of a bare folder name. Configurable for a different site/library.
const SP_DOC_PREFIX = (process.env.SHAREPOINT_DOC_PREFIX || '/sites/TeamBriggs20/Shared Documents').replace(/\/+$/, '');

// Canonical real server-relative path (SINGLE apostrophes) — the queue +
// folder_feed_seen identity form, and the prefix used for the stale sweep. Bare
// names get the site/library prefix; an already-server-relative path is left
// as-is. Pre-doubled apostrophes are collapsed so identity stays single
// regardless of how a root was configured.
function realServerRelative(root) {
  let p = String(root || '').replace(/\\/g, '/').trim();
  if (!p) return '';
  p = p.replace(/''/g, "'");
  if (!p.startsWith('/')) p = `${SP_DOC_PREFIX}/${p.replace(/^\/+/, '')}`;
  return p.replace(/\/+$/, '');
}

// OData string-literal form for the PA flow body: full server-relative with
// apostrophes DOUBLED. The flow inlines folder_path into
// GetFolderByServerRelativeUrl('<folder_path>'), so a single apostrophe would
// break the literal — `Storage OM's` → `Storage OM''s`. Idempotent.
export function toServerRelative(root) {
  return realServerRelative(root).replace(/'/g, "''");
}

// Strip the site/library prefix so the path→subject_hint anchor logic
// (PROPERTIES/<bucket>/<brand>[/<City, ST>]) is unchanged on full
// server-relative paths.
function stripSitePrefix(p) {
  const s = String(p || '').replace(/\\/g, '/');
  if (s.toLowerCase().startsWith(SP_DOC_PREFIX.toLowerCase())) {
    return s.slice(SP_DOC_PREFIX.length).replace(/^\/+/, '');
  }
  return s.replace(/^\/+/, '');
}

// Coerce a SharePoint size field to a finite int, else null. The REST `Length`
// arrives as a STRING ("208384"); folders carry no Length.
function parseSize(it) {
  if (it.Length != null) {
    const n = parseInt(it.Length, 10);
    return Number.isFinite(n) ? n : null;
  }
  return it.size ?? it.size_bytes ?? it.length ?? null;
}

// Change-signature hash: with no bytes in hand the cloud worker keys idempotency
// on the SharePoint etag (changes when the file content changes), falling back
// to size+modified when the flow can't supply an etag.
function changeHash(item) {
  const sig = item.etag
    ? `etag:${item.etag}`
    : `sm:${item.size ?? ''}|${item.modified ?? ''}`;
  return createHash('sha1').update(`${item.path}|${sig}`).digest('hex');
}

// Parse the PA "Send an HTTP request to SharePoint" REST response (verified live
// 2026-06-10). The OData *verbose* envelope nests the arrays under
// sp.d.Files.results / sp.d.Folders.results; stay tolerant of a future
// nometadata switch (sp.Files / sp.Folders) and the legacy flat shapes
// (json.items / json.value). REST fields are PascalCase; lowercase fallbacks
// keep the mapper tolerant. Folder rows are tagged is_folder:true so the walk
// enqueues them to recurse and the classifier never sees them as files.
export function parseListFolderResponse(json) {
  const sp = json?.sp?.d ?? json?.sp ?? json ?? {};
  const rawFiles   = sp.Files?.results   ?? sp.Files   ?? json?.items ?? json?.value ?? [];
  const rawFolders = sp.Folders?.results ?? sp.Folders ?? [];
  const map = (it, isFolder) => ({
    path:      it.ServerRelativeUrl || it.serverRelativeUrl || it.server_relative_url || it.path || it.full_path || null,
    name:      it.Name || it.name || it.file_name || it.fileName || null,
    size:      parseSize(it),
    modified:  it.TimeLastModified || it.modified || it.modified_at || it.last_modified || it.lastModified || null,
    etag:      it.ETag || it.UniqueId || it.etag || it.e_tag || it.eTag || null,
    is_folder: !!isFolder,
  });
  const files   = (Array.isArray(rawFiles)   ? rawFiles   : []).map(it => map(it, false));
  const folders = (Array.isArray(rawFolders) ? rawFolders : []).map(it => map(it, true));
  return [...files, ...folders].filter(it => it.path);
}

// POST the PA "Send an HTTP request to SharePoint" (REST) list flow for one
// folder. Returns { ok, items:[{path,name,size,modified,etag,is_folder}], status, detail }.
async function listFolder(folderPath) {
  const listUrl = process.env.SHAREPOINT_LIST_URL;
  if (!listUrl) return { ok: false, status: 0, detail: 'SHAREPOINT_LIST_URL unset', items: [] };
  try {
    const res = await fetchWithTimeout(listUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder_path: toServerRelative(folderPath) }),
    }, 25000);
    const text = await res.text().catch(() => '');
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* keep text */ }
    if (!res.ok || !json?.ok) {
      return { ok: false, status: res.status, detail: String(json?.error || text || 'pa_list_failed').slice(0, 200), items: [] };
    }
    return { ok: true, status: res.status, items: parseListFolderResponse(json) };
  } catch (err) {
    return { ok: false, status: 0, detail: err?.message?.slice(0, 200) || 'pa_list_error', items: [] };
  }
}

function isoOrNull(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ============================================================================
// Main handler
// ============================================================================
export async function handleFolderFeedTick(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET (dry-run) or POST (drain) only' });
  }

  const user = await authenticate(req, res);
  if (!user) return;

  // Feature flag — no-op cleanly until the PA List flow is configured.
  if (!process.env.SHAREPOINT_LIST_URL) {
    return res.status(200).json({
      ok: true,
      skipped: 'not_configured',
      detail: 'SHAREPOINT_LIST_URL is unset — folder-feed is a no-op until the PA "List folder" flow is wired.',
    });
  }

  const workspaceId = req.headers['x-lcc-workspace']
    || user.memberships?.[0]?.workspace_id
    || process.env.LCC_DEFAULT_WORKSPACE_ID
    || null;

  const dryRun = req.method === 'GET';

  // Folder root list: ?folders=a,b  >  FOLDER_FEED_ROOTS env  >  DEFAULT_ROOTS.
  // Normalized to canonical real server-relative paths (single apostrophes); the
  // queue + folder_feed_seen identity use this form, toServerRelative() doubles
  // apostrophes only at request time.
  const rootsParam = String(req.query.folders || process.env.FOLDER_FEED_ROOTS || '').trim();
  const roots = (rootsParam ? rootsParam.split(',') : DEFAULT_ROOTS)
    .map(realServerRelative).filter(Boolean);

  const limitFolders = Math.min(20, Math.max(1, parseInt(req.query.limit_folders || '8', 10)));

  // Per-tick stage cap (POST/drain only — GET never stages). Absent → Infinity
  // (unbounded, current behavior). 0 is allowed and means "stage nothing this
  // tick" — every OM-eligible file is recorded 'seen' (known-but-deferred) for a
  // later uncapped tick to pick up. `stagedThisTick` is a running count across
  // the WHOLE walk (all folders this tick), not per-folder.
  const maxStage = req.query.max_stage != null
    ? Math.max(0, parseInt(req.query.max_stage, 10) || 0)
    : Infinity;
  let stagedThisTick = 0;
  // Walk breadth-first from the roots, bounded by limitFolders per tick.
  // Subfolders discovered in a listing are enqueued to recurse; a within-tick
  // guard prevents revisiting. (Cross-tick progress is by design re-listed —
  // the folder_feed_seen (path,hash) dedup makes re-walking seen files cheap.)
  const queue = roots.slice();
  const walkedFolders = new Set();

  const callerEmail = user.email || process.env.LCC_FOLDER_FEED_EMAIL || null;
  const callerName  = user.display_name || 'Folder Feed';

  const startedAt = Date.now();
  // Leave headroom under the 25s race / function cap. Overridable (FOLDER_FEED_
  // TIME_BUDGET_MS) so a test can deterministically trip the per-file budget
  // break and prove the stale sweep no longer mass-stales the un-processed tail.
  const TIME_BUDGET_MS = Math.max(0, parseInt(process.env.FOLDER_FEED_TIME_BUDGET_MS, 10) || 22000);

  const report = {
    ok: true,
    mode: dryRun ? 'dry_run' : 'drain',
    folders_requested: roots.length,
    folders_walked: 0,
    files_seen: 0,
    files_new: 0,
    files_staged: 0,
    files_deferred: 0,     // OM-eligible but skipped this tick (max_stage cap) → 'seen'
    files_skipped: 0,
    files_stale: 0,
    files_error: 0,
    files_unresolved: 0,   // staged but the matcher could not resolve a property
    max_stage: Number.isFinite(maxStage) ? maxStage : null,  // effective cap; null = unbounded
    by_type: {},
    folders: [],
  };

  while (queue.length && report.folders_walked < limitFolders) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break;
    const folder = queue.shift();
    if (!folder || walkedFolders.has(folder)) continue;
    walkedFolders.add(folder);
    report.folders_walked++;

    const folderRep = { folder, listed: 0, new: 0, staged: 0, deferred: 0, skipped: 0, stale: 0, error: 0, subfolders: 0 };
    const listing = await listFolder(folder);
    if (!listing.ok) {
      folderRep.error_detail = listing.detail || `status ${listing.status}`;
      report.folders.push(folderRep);
      continue;
    }

    // Split files from subfolders. Subfolders are enqueued to recurse (bounded
    // by limitFolders across the tick); the classifier only ever sees files.
    const fileItems = listing.items.filter(it => !it.is_folder);
    for (const sub of listing.items) {
      if (!sub.is_folder) continue;
      if (!walkedFolders.has(sub.path) && !queue.includes(sub.path)) {
        queue.push(sub.path);
        folderRep.subfolders++;
      }
    }

    folderRep.listed = fileItems.length;
    report.files_seen += fileItems.length;

    // Every file in the listing is "live" — independent of whether the per-file
    // loop reaches it this tick. The loop may break early on the time budget, so
    // building livePaths from the full listing (not incrementally) is what keeps
    // the stale sweep from mass-staling the un-processed tail.
    const livePaths = new Set(fileItems.map(it => it.path));

    for (const item of fileItems) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) break;

      const hash = changeHash(item);
      const cls = classifyFile(item.name || item.path.split('/').pop());
      report.by_type[cls.type] = (report.by_type[cls.type] || 0) + 1;

      // ---- Diff: have we already seen this exact (path, content_hash)? ----
      let alreadySeen = false;
      if (!dryRun) {
        const seen = await opsQuery('GET',
          `folder_feed_seen?server_relative_path=eq.${pgFilterVal(item.path)}` +
          `&content_hash=eq.${pgFilterVal(hash)}&select=id,status&limit=1`);
        if (seen.ok && seen.data?.length) {
          // A 'seen' row was recorded as known-but-DEFERRED (max_stage cap hit on
          // a prior tick) — it was NOT staged, so it stays eligible: fall through
          // and (re)attempt it now, subject to this tick's cap. Every other status
          // (staged/promoted/skipped/error/stale) is terminal for this (path,hash)
          // and short-circuits as already-handled.
          if (seen.data[0].status === 'seen') {
            alreadySeen = false;
            // re-staging below will refresh last_seen_at via upsertSeen
          } else {
            alreadySeen = true;
            // Touch last_seen_at so the stale-sweep knows it's still present, and
            // reset miss_streak — re-seeing a file clears any transient-miss count.
            await opsQuery('PATCH',
              `folder_feed_seen?id=eq.${pgFilterVal(seen.data[0].id)}`,
              { last_seen_at: new Date().toISOString(), miss_streak: 0 }).catch(() => {});
          }
        }
      }
      if (alreadySeen) continue; // idempotent — unchanged file, no re-stage

      report.files_new++;
      folderRep.new++;

      const subjectHint = parseSubjectHintFromPath(stripSitePrefix(item.path));

      if (dryRun) {
        // Report-only: what WOULD happen, no writes to LCC or SharePoint.
        if (cls.isOm) folderRep.staged++; else folderRep.skipped++;
        continue;
      }

      // ---- Non-OM: record the type, do not parse (later units) ----
      if (!cls.isOm) {
        await upsertSeen({
          path: item.path, hash, item, status: 'skipped',
          vertical: subjectHint.vertical, detectedType: cls.type,
          subjectHint, intakeId: null,
        });
        report.files_skipped++;
        folderRep.skipped++;
        continue;
      }

      // ---- Per-tick cap: once maxStage OM files are staged this tick, record
      // the rest as 'seen' (known-but-deferred) so a later uncapped tick
      // re-attempts them. Only OM-eligible files reach here, so skipped/unknown
      // types never consume the cap. ----
      if (stagedThisTick >= maxStage) {
        await upsertSeen({
          path: item.path, hash, item, status: 'seen',
          vertical: subjectHint.vertical, detectedType: cls.type,
          subjectHint, intakeId: null,
        });
        report.files_deferred++;
        folderRep.deferred++;
        continue;
      }

      // ---- OM/flyer: stage through the SAME promoter as the email channel ----
      if (!callerEmail) {
        await upsertSeen({ path: item.path, hash, item, status: 'error',
          vertical: subjectHint.vertical, detectedType: cls.type, subjectHint, intakeId: null });
        report.files_error++;
        folderRep.error++;
        continue;
      }

      // Count the attempt against the cap (success or stage-error both count —
      // it was an OM-eligible file we tried to stage). The no-callerEmail error
      // above is NOT an attempt and does not consume the cap.
      stagedThisTick++;

      let stageRes;
      try {
        stageRes = await stageOmIntake(
          {
            // No bytes — the file already lives in SharePoint. Point the artifact
            // at the existing path; the extractor fetches via the Get flow.
            storage_backend: 'sharepoint_pa',
            storage_ref:     item.path,
            size_bytes:      item.size || 0,
            file_name:       item.name || item.path.split('/').pop() || 'document.pdf',
            mime_type:       'application/pdf',
            channel:         'folder_feed',
            note:            `Folder-feed: ${item.path}`,
            seed_data: {
              tags: ['folder_feed'],
              subject_hint: subjectHint,
              source_path: item.path,
            },
          },
          { email: callerEmail, name: callerName },
          workspaceId,
        );
      } catch (err) {
        stageRes = { status: 500, body: { ok: false, error: err?.message || 'stage_error' } };
      }

      if (stageRes?.status === 200 && stageRes.body?.ok && stageRes.body.intake_id) {
        const matched = !!stageRes.body.matched_entity_id;
        await upsertSeen({
          path: item.path, hash, item, status: 'staged',
          vertical: subjectHint.vertical, detectedType: cls.type,
          subjectHint, intakeId: stageRes.body.intake_id,
        });
        report.files_staged++;
        folderRep.staged++;
        if (!matched) report.files_unresolved++;
      } else {
        await upsertSeen({
          path: item.path, hash, item, status: 'error',
          vertical: subjectHint.vertical, detectedType: cls.type,
          subjectHint, intakeId: null,
        });
        report.files_error++;
        folderRep.error++;
      }
    }

    // ---- Stale sweep: rows under this folder no longer in the listing ----
    // Only when the listing returned items (an empty/failed list must NEVER
    // mass-stale a folder). Never deletes derived data — just marks the pointer.
    if (!dryRun && listing.items.length > 0) {
      const prefix = `${folder}/`;
      const existing = await opsQuery('GET',
        `folder_feed_seen?server_relative_path=like.${pgFilterVal(prefix + '*')}` +
        `&status=in.(seen,staged,promoted,skipped)&select=id,server_relative_path,miss_streak`);
      if (existing.ok && Array.isArray(existing.data)) {
        for (const row of existing.data) {
          // Only sweep DIRECT children of this folder — a descendant lives under
          // its own subfolder and is swept when that folder is walked, so a
          // recursive listing here must not mass-stale the whole subtree.
          const rest = row.server_relative_path.slice(prefix.length);
          if (rest.includes('/')) continue;
          if (livePaths.has(row.server_relative_path)) continue;

          // Require TWO consecutive misses before staling (the availability-checker
          // consecutive_check_failures pattern). Unit 1 already prevents staling a
          // file truncated off the per-file loop; this second guard makes a single
          // transient partial-but-ok List response harmless too — only a path that
          // is genuinely absent from two consecutive full listings goes stale.
          const nextStreak = (row.miss_streak || 0) + 1;
          if (nextStreak >= 2) {
            await opsQuery('PATCH', `folder_feed_seen?id=eq.${pgFilterVal(row.id)}`,
              { status: 'stale', miss_streak: nextStreak, last_seen_at: new Date().toISOString() }).catch(() => {});
            report.files_stale++;
            folderRep.stale++;
          } else {
            // First miss — record the streak, leave status untouched.
            await opsQuery('PATCH', `folder_feed_seen?id=eq.${pgFilterVal(row.id)}`,
              { miss_streak: nextStreak }).catch(() => {});
          }
        }
      }
    }

    report.folders.push(folderRep);
  }

  return res.status(200).json(report);
}

// Idempotent record: insert the (path, hash) row, or update it in place if a
// prior walk already recorded this exact pair (re-tick safety). Keyed on the
// unique (server_relative_path, content_hash) constraint.
async function upsertSeen({ path, hash, item, status, vertical, detectedType, subjectHint, intakeId }) {
  const nowIso = new Date().toISOString();
  const row = {
    server_relative_path: path,
    content_hash:         hash,
    size_bytes:           item.size || null,
    modified_at:          isoOrNull(item.modified),
    intake_id:            intakeId || null,
    status,
    vertical:             vertical || null,
    detected_type:        detectedType || null,
    subject_hint:         subjectHint || null,
    last_seen_at:         nowIso,
    miss_streak:          0,   // recording a file = it's present → clear any miss count
  };
  const ins = await opsQuery('POST', 'folder_feed_seen', row, {
    Prefer: 'resolution=merge-duplicates,return=minimal',
  });
  if (ins.ok || ins.status === 409) return;
  // Fallback: explicit update on the unique key if merge-duplicates is unhappy.
  await opsQuery('PATCH',
    `folder_feed_seen?server_relative_path=eq.${pgFilterVal(path)}&content_hash=eq.${pgFilterVal(hash)}`,
    { status, intake_id: intakeId || null, last_seen_at: nowIso, miss_streak: 0 }
  ).catch(() => {});
}
