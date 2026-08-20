// ─────────────────────────────────────────────────────────────────────────────
// app-tasks.js — W6.5 Stage 3, Unit 4 (extracted from app.js 2026-08-20).
// Moved VERBATIM from app.js lines 5304-5564.
//
// The shared task store: _updateTaskInAllStores (mktData + every
// _mktProspectContacts domain), the fire-and-forget Salesforce outbound sync
// (_syncTaskToSalesforce / _closeOriginalSfTask / _updateSfTaskDate), and the
// three public actions completeTask / rescheduleTask / dismissTask.
//
// ⚠️ THE MAP'S RANGE FOR THIS UNIT WAS WRONG IN BOTH DIRECTIONS (5361-6260).
// It began 57 lines too late — missing _updateTaskInAllStores, the store this
// module exists for — and ran ~700 lines past the last task function, which
// would have swept FOUR unrelated subsystems into a file called "app-tasks":
// the Marketing actions (mktReclassifyDeal/mktMatchLead/mktUpdateStatus), the
// Prospects search AND ITS THREE TOP-LEVEL LETS (prospectsSearchTerm,
// prospectsResults, prospectsSearching), the detail-record view
// (showDetail/closeDetail/switchDetailTab + window._detailRecord), and the
// Log Call / Log & Reschedule modals. The "reclassify" in the map's own label
// is mktReclassifyDeal — Marketing, not tasks. Measure the file, not the plan.
//
// ⚠️ PASSENGER, not task logic: _rerenderCurrentView is a GENERIC view
// dispatcher (reads currentBizTab / currentGovTab / currentDiaTab, calls
// renderMarketing / renderDomainProspects). It rides here only because it was
// authored inside this block and three of its four callers are task actions.
// Its fourth caller is submitLogReschedule, still in app.js. If a later unit
// gives the view dispatchers a home, re-home this with them.
//
// NOT a leaf: submitLogReschedule (app.js ~6327/6347/6348) reaches back into
// _updateSfTaskDate, _updateTaskInAllStores and _rerenderCurrentView, and the
// Marketing contact rows build inline onclick="completeTask(...)" /
// "dismissTask(...)" at app.js ~4520/4522. All of that resolves at CALL time in
// the shared global scope, and these are top-level `function` declarations, so
// they are on `window` automatically — no explicit export line to preserve.
// What that DOES require is that this file loads as a CLASSIC script before
// app.js and that the declarations stay top-level function declarations.
// ─────────────────────────────────────────────────────────────────────────────

// ── Shared task store helpers (works across marketing + domain prospect views) ──
function _updateTaskInAllStores(sfContactId, subject, action, newDate) {
  // Update a task across mktData and all _mktProspectContacts domains
  var stores = [mktData];
  ['government', 'dialysis', 'all_other'].forEach(function(dom) {
    if (window._mktProspectContacts && window._mktProspectContacts[dom]) {
      stores.push(window._mktProspectContacts[dom]);
    }
  });

  stores.forEach(function(store) {
    for (var i = store.length - 1; i >= 0; i--) {
      var d = store[i];
      if (d.sf_contact_id !== sfContactId || !d.open_tasks) continue;

      if (action === 'complete') {
        // Remove only the FIRST task matching this subject (not all with same subject)
        var removed = false;
        d.open_tasks = d.open_tasks.filter(function(t) {
          if (!removed && t.subject === subject) { removed = true; return false; }
          return true;
        });
        d.open_task_count = d.open_tasks.length;
        d.completed_activity_count = (d.completed_activity_count || 0) + 1;
        // Remove from active view when no open tasks remain
        if (d.open_tasks.length === 0) store.splice(i, 1);
      } else if (action === 'reschedule') {
        // Only reschedule the FIRST matching task
        var rescheduled = false;
        d.open_tasks.forEach(function(t) {
          if (!rescheduled && t.subject === subject) { t.date = newDate; rescheduled = true; }
        });
        d.due_date = newDate;
      } else if (action === 'dismiss') {
        // Remove only the FIRST task matching this subject
        var dismissed = false;
        d.open_tasks = d.open_tasks.filter(function(t) {
          if (!dismissed && t.subject === subject) { dismissed = true; return false; }
          return true;
        });
        d.open_task_count = d.open_tasks.length;
        // Remove from active view when no open tasks remain
        if (d.open_tasks.length === 0) store.splice(i, 1);
      }
    }
  });
}

function _rerenderCurrentView() {
  if (typeof currentBizTab !== 'undefined') {
    if (currentBizTab === 'marketing') { renderMarketing(); return; }
    if (currentBizTab === 'other') { renderDomainProspects('all_other'); return; }
  }
  // Check if we're on a domain sub-tab (prospects)
  if (typeof currentGovTab !== 'undefined' && currentGovTab === 'prospects') {
    renderDomainProspects('government'); return;
  }
  if (typeof currentDiaTab !== 'undefined' && currentDiaTab === 'prospects') {
    renderDomainProspects('dialysis'); return;
  }
  // Fallback: re-render marketing
  renderMarketing();
}

// ── Salesforce outbound sync helper ──
// Fire-and-forget: log task action to Salesforce via the outbound sync pipeline
function _syncTaskToSalesforce(sfContactId, subject, action) {
  // Look up sf_company_id and deal context from local stores
  var sfCompanyId = null;
  var dealName = '';
  var stores = [mktData];
  ['government', 'dialysis', 'all_other'].forEach(function(dom) {
    if (window._mktProspectContacts && window._mktProspectContacts[dom]) stores.push(window._mktProspectContacts[dom]);
  });
  for (var s = 0; s < stores.length; s++) {
    for (var i = 0; i < stores[s].length; i++) {
      if (stores[s][i].sf_contact_id === sfContactId) {
        sfCompanyId = stores[s][i].sf_company_id;
        // Find the deal_name from the matching task
        var tasks = stores[s][i].open_tasks || [];
        for (var j = 0; j < tasks.length; j++) {
          if (tasks[j].subject === subject && tasks[j].deal_name) {
            dealName = tasks[j].deal_name;
            break;
          }
        }
        break;
      }
    }
    if (sfCompanyId) break;
  }

  var today = localToday();
  var actionLabel = action === 'complete' ? 'Completed' : action === 'dismiss' ? 'Dismissed' : 'Updated';
  // Map action to appropriate SF activity_type
  var activityType = action === 'complete' ? 'Call' : 'Follow-up';
  var payload = {
    sf_contact_id: sfContactId,
    sf_company_id: sfCompanyId || undefined,
    activity_type: activityType,
    activity_date: today,
    subject: subject,
    deal_name: dealName || undefined,
    notes: '[' + actionLabel + '] ' + subject + (dealName ? ' | Deal: ' + dealName : ''),
    force: true
  };

  // Non-blocking: fire the sync, log errors but don't block UI
  fetch('/api/sync?action=outbound', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      command: 'log_to_sf',
      payload
    })
  }).then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function(data) {
    if (data.status === 'completed' || data.success) {
      console.debug('[SF Sync] ' + actionLabel + ' logged for ' + sfContactId + ': ' + subject);
    } else if (data.warning) {
      console.warn('[SF Sync] Warning: ' + (data.message || 'Recent activity detected'));
    } else {
      console.error('[SF Sync] Error: ' + (data.error || 'Unknown'));
    }
  }).catch(function(e) {
    console.error('[SF Sync] Network error:', e.message);
    showToast('SF activity sync failed', 'error');
  });
}

// Fire-and-forget: close the original open SF task via Power Automate
function _closeOriginalSfTask(sfContactId, subject) {
  fetch('/api/sync?action=complete_sf_task', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sf_contact_id: sfContactId, subject: subject })
  }).then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function(data) {
    if (data.success) {
      var action = data.pa_response && data.pa_response.action;
      if (action === 'completed') {
        console.debug('[SF Complete] Original task closed for ' + sfContactId + ': ' + subject);
      } else {
        console.debug('[SF Complete] Original task not found (already closed?) for ' + sfContactId);
      }
    } else {
      console.error('[SF Complete] Error: ' + (data.error || 'Unknown'));
    }
  }).catch(function(e) {
    console.error('[SF Complete] Network error:', e.message);
  });
}

// Fire-and-forget: push new task date to SF via Power Automate
function _updateSfTaskDate(sfContactId, subject, newDate) {
  fetch('/api/sync?action=complete_sf_task', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sf_contact_id: sfContactId, subject: subject, action: 'reschedule', new_date: newDate })
  }).then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function(data) {
    if (data.success) {
      var action = data.pa_response && data.pa_response.action;
      if (action === 'rescheduled') {
        console.debug('[SF Reschedule] Task date updated to ' + newDate + ' for ' + sfContactId + ': ' + subject);
      } else {
        console.debug('[SF Reschedule] Original task not found for ' + sfContactId + ' (may need manual update in SF)');
      }
    } else {
      console.error('[SF Reschedule] Error: ' + (data.error || 'Unknown'));
    }
  }).catch(function(e) {
    console.error('[SF Reschedule] Network error:', e.message);
  });
}

// ── Task management: complete, reschedule, dismiss ──
async function completeTask(sfContactId, subject) {
  showToast('Marking task complete...', 'success');
  try {
    const result = await applyChangeWithFallback({
      proxyBase: '/api/dia-query',
      table: 'salesforce_activities',
      idColumn: 'sf_contact_id',
      idValue: sfContactId,
      matchFilters: [{ column: 'subject', value: subject }],
      data: { status: 'Completed' },
      source_surface: 'marketing_task_complete',
      notes: subject,
      propagation_scope: 'salesforce_activity_status'
    });
    if (!result.ok) {
      throw new Error((result.errors || ['Unable to complete task']).join('; '));
    }
    showToast('Task completed!', 'success');
    // Sync completion to Salesforce (non-blocking) — includes deal context
    _syncTaskToSalesforce(sfContactId, subject, 'complete');
    // Close the ORIGINAL open task in SF via Power Automate (non-blocking)
    _closeOriginalSfTask(sfContactId, subject);
    // Remove from local data (marketing + prospect contacts) and re-render
    _updateTaskInAllStores(sfContactId, subject, 'complete');
    _rerenderCurrentView();
  } catch (e) {
    showToast('Error completing task: ' + e.message, 'error');
  }
}

async function rescheduleTask(sfContactId, subject, newDate) {
  if (!newDate) return;
  showToast('Rescheduling to ' + newDate + '...', 'success');
  try {
    const result = await applyChangeWithFallback({
      proxyBase: '/api/dia-query',
      table: 'salesforce_activities',
      idColumn: 'sf_contact_id',
      idValue: sfContactId,
      matchFilters: [{ column: 'subject', value: subject }],
      data: { activity_date: newDate },
      source_surface: 'marketing_task_reschedule',
      notes: subject,
      propagation_scope: 'salesforce_activity_date'
    });
    if (!result.ok) {
      throw new Error((result.errors || ['Unable to reschedule task']).join('; '));
    }
    showToast('Rescheduled to ' + newDate, 'success');
    // Push new date to SF via Power Automate (non-blocking)
    _updateSfTaskDate(sfContactId, subject, newDate);
    // Update local data (marketing + prospect contacts)
    _updateTaskInAllStores(sfContactId, subject, 'reschedule', newDate);
    _rerenderCurrentView();
  } catch (e) {
    showToast('Error rescheduling: ' + e.message, 'error');
  }
}

async function dismissTask(sfContactId, subject) {
  if (!(await lccConfirm('Dismiss "' + subject + '"? This will mark it as Abandoned.', 'Dismiss'))) return;
  showToast('Dismissing task...', 'success');
  try {
    const result = await applyChangeWithFallback({
      proxyBase: '/api/dia-query',
      table: 'salesforce_activities',
      idColumn: 'sf_contact_id',
      idValue: sfContactId,
      matchFilters: [{ column: 'subject', value: subject }],
      data: { status: 'Abandoned' },
      source_surface: 'marketing_task_dismiss',
      notes: subject,
      propagation_scope: 'salesforce_activity_status'
    });
    if (!result.ok) {
      throw new Error((result.errors || ['Unable to dismiss task']).join('; '));
    }
    showToast('Task dismissed', 'success');
    // Sync dismissal to Salesforce (non-blocking) — includes deal context
    _syncTaskToSalesforce(sfContactId, subject, 'dismiss');
    // Remove from local data (marketing + prospect contacts)
    _updateTaskInAllStores(sfContactId, subject, 'dismiss');
    _rerenderCurrentView();
  } catch (e) {
    showToast('Error dismissing task: ' + e.message, 'error');
  }
}
