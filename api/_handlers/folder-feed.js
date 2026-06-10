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
// Server-relative-ish folder paths the PA List flow understands. The flat OM
// store + the per-vertical research roots are the cheapest high-signal start;
// PROPERTIES/* buckets can be added to FOLDER_FEED_ROOTS as the flow's recursion
// is dialed in.
const DEFAULT_ROOTS = [
  "Storage OM's",
  "Gv't Leased Research",
  'Dialysis Research',
];

// Change-signature hash: with no bytes in hand the cloud worker keys idempotency
// on the SharePoint etag (changes when the file content changes), falling back
// to size+modified when the flow can't supply an etag.
function changeHash(item) {
  const sig = item.etag
    ? `etag:${item.etag}`
    : `sm:${item.size ?? ''}|${item.modified ?? ''}`;
  return createHash('sha1').update(`${item.path}|${sig}`).digest('hex');
}

// POST the PA "SharePoint → List folder" flow. Tolerant of a couple of response
// shapes; returns { ok, items:[{path,name,size,modified,etag}], status, detail }.
async function listFolder(folderPath) {
  const listUrl = process.env.SHAREPOINT_LIST_URL;
  if (!listUrl) return { ok: false, status: 0, detail: 'SHAREPOINT_LIST_URL unset', items: [] };
  try {
    const res = await fetchWithTimeout(listUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder_path: folderPath }),
    }, 25000);
    const text = await res.text().catch(() => '');
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* keep text */ }
    if (!res.ok || !json?.ok) {
      return { ok: false, status: res.status, detail: String(json?.error || text || 'pa_list_failed').slice(0, 200), items: [] };
    }
    const rawItems = Array.isArray(json.items) ? json.items
      : Array.isArray(json.value) ? json.value : [];
    const items = rawItems.map(it => ({
      path:     it.path || it.server_relative_url || it.serverRelativeUrl || it.full_path || null,
      name:     it.name || it.file_name || it.fileName || null,
      size:     it.size ?? it.size_bytes ?? it.length ?? null,
      modified: it.modified || it.modified_at || it.last_modified || it.lastModified || null,
      etag:     it.etag || it.e_tag || it.eTag || null,
    })).filter(it => it.path);
    return { ok: true, status: res.status, items };
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
  const rootsParam = String(req.query.folders || process.env.FOLDER_FEED_ROOTS || '').trim();
  const roots = (rootsParam ? rootsParam.split(',') : DEFAULT_ROOTS)
    .map(s => s.trim().replace(/^\/+|\/+$/g, '')).filter(Boolean);

  const limitFolders = Math.min(20, Math.max(1, parseInt(req.query.limit_folders || '8', 10)));
  const foldersToWalk = roots.slice(0, limitFolders);

  const callerEmail = user.email || process.env.LCC_FOLDER_FEED_EMAIL || null;
  const callerName  = user.display_name || 'Folder Feed';

  const startedAt = Date.now();
  const TIME_BUDGET_MS = 22000; // leave headroom under the 25s race / function cap

  const report = {
    ok: true,
    mode: dryRun ? 'dry_run' : 'drain',
    folders_requested: roots.length,
    folders_walked: 0,
    files_seen: 0,
    files_new: 0,
    files_staged: 0,
    files_skipped: 0,
    files_stale: 0,
    files_error: 0,
    files_unresolved: 0,   // staged but the matcher could not resolve a property
    by_type: {},
    folders: [],
  };

  for (const folder of foldersToWalk) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break;
    report.folders_walked++;

    const folderRep = { folder, listed: 0, new: 0, staged: 0, skipped: 0, stale: 0, error: 0 };
    const listing = await listFolder(folder);
    if (!listing.ok) {
      folderRep.error_detail = listing.detail || `status ${listing.status}`;
      report.folders.push(folderRep);
      continue;
    }
    folderRep.listed = listing.items.length;
    report.files_seen += listing.items.length;

    const livePaths = new Set();

    for (const item of listing.items) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) break;
      livePaths.add(item.path);

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
          alreadySeen = true;
          // Touch last_seen_at so the stale-sweep knows it's still present.
          await opsQuery('PATCH',
            `folder_feed_seen?id=eq.${pgFilterVal(seen.data[0].id)}`,
            { last_seen_at: new Date().toISOString() }).catch(() => {});
        }
      }
      if (alreadySeen) continue; // idempotent — unchanged file, no re-stage

      report.files_new++;
      folderRep.new++;

      const subjectHint = parseSubjectHintFromPath(item.path);

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

      // ---- OM/flyer: stage through the SAME promoter as the email channel ----
      if (!callerEmail) {
        await upsertSeen({ path: item.path, hash, item, status: 'error',
          vertical: subjectHint.vertical, detectedType: cls.type, subjectHint, intakeId: null });
        report.files_error++;
        folderRep.error++;
        continue;
      }

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
        `&status=in.(seen,staged,promoted,skipped)&select=id,server_relative_path`);
      if (existing.ok && Array.isArray(existing.data)) {
        for (const row of existing.data) {
          if (!livePaths.has(row.server_relative_path)) {
            await opsQuery('PATCH', `folder_feed_seen?id=eq.${pgFilterVal(row.id)}`,
              { status: 'stale', last_seen_at: new Date().toISOString() }).catch(() => {});
            report.files_stale++;
            folderRep.stale++;
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
  };
  const ins = await opsQuery('POST', 'folder_feed_seen', row, {
    Prefer: 'resolution=merge-duplicates,return=minimal',
  });
  if (ins.ok || ins.status === 409) return;
  // Fallback: explicit update on the unique key if merge-duplicates is unhappy.
  await opsQuery('PATCH',
    `folder_feed_seen?server_relative_path=eq.${pgFilterVal(path)}&content_hash=eq.${pgFilterVal(hash)}`,
    { status, intake_id: intakeId || null, last_seen_at: nowIso }
  ).catch(() => {});
}
