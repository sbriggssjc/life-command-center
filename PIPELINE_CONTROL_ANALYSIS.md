# Pipeline Control Mode Analysis — gov.js
**Date**: April 1, 2026
**File**: /sessions/laughing-zen-heisenberg/mnt/life-command-center/gov.js
**Function**: `renderGovPipelineControl()` (Lines 4051-4136)
**Load Function**: `window.loadGovPipelineRuns()` (Lines 4034-4049)

---

## EXECUTIVE SUMMARY

**Pipeline Control is COMPLETE and FUNCTIONAL** — not a placeholder. It displays real pipeline run history from the `ingestion_tracker` table with proper loading states, summary metrics, and a detailed 20-run table view. However, **6 significant UX/functionality gaps** exist:

| Severity | Count | Category |
|----------|-------|----------|
| CRITICAL | 1 | Missing retry functionality for failed runs |
| MEDIUM | 3 | UX/visibility: progress tracking, error readability, stale metrics |
| LOW | 2 | Feature gaps: date filtering, progress tracking |

---

## IMPLEMENTATION STATUS

### Is It Complete or Placeholder?
**COMPLETE** — This is a working implementation:
- Queries real data: `govQuery('ingestion_tracker', '*', { order: 'started_at.desc', limit: 50 })` (Line 4038)
- Renders 20 most recent runs with status, duration, row counts
- Shows summary metrics: Last Run, Success Rate, Active Errors
- Has proper loading state and empty state handling

**NOT** a placeholder with hardcoded data (unlike Monitor Dashboard, which has hardcoded arrays per Issue 4.1 in the UX audit).

---

## WHAT IT SHOWS

### 1. **Summary Metrics Panel** (Lines 4072-4082)
Displays 3 KPIs:
- **Last Run**: Formatted date (e.g., "3/31/2026") | Fallback: "Pending"
- **Success Rate**: Percentage of completed runs (e.g., "87%")
- **Active Errors**: Count of failed runs with red/green status badge

**Calculation Logic**:
```javascript
const completedRuns = runs.filter(r => r.run_status === 'completed').length;
const successRate = runs.length > 0 ? Math.round((completedRuns / runs.length) * 100) : 0;
const failedRuns = runs.filter(r => r.run_status === 'failed').length;
```

### 2. **Information Banner** (Lines 4084-4086)
Yellow warning banner explaining:
"Pipeline runs are triggered via CLI. Contact your administrator to schedule automated runs."

### 3. **Recent Runs Table** (Lines 4088-4131)
Shows 20 most recent runs (sliced from up to 50 loaded; Line 4103: `.slice(0, 20)`)

**Table Columns**:
| Column | Source Field | Format |
|--------|------------|--------|
| Source | `run.source` | Escaped text (Line 4111) |
| Task | `run.task_name` | Escaped text (Line 4112) |
| Status | `run.run_status` | Color-coded badge (Line 4104-4105): green (completed), red (failed), amber (running) |
| Started | `run.started_at` | `toLocaleString()` (Line 4106) |
| Duration | `run.started_at` + `run.finished_at` | Calculated seconds (Line 4107) |
| Rows | `run.rows_inserted` | Raw count or 0 fallback (Line 4108) |

**Error Rows** (Lines 4119-4125):
- If `run.error_summary` exists AND status is 'failed', shows red error row below the run:
  ```html
  <tr style="background: rgba(239,68,68,0.1);">
    <td colspan="6">Error: [escaped error_summary]</td>
  </tr>
  ```

### 4. **Loading & Empty States**
- **Loading** (Lines 4052-4055): Spinner + "Loading pipeline runs..." text
- **Empty** (Lines 4066-4070): Icon + "No runs recorded" + "Pipeline run history will appear here"

---

## UX GAPS & SAFETY ISSUES

### CRITICAL ISSUES

#### 1. NO RETRY ACTION FOR FAILED RUNS ⚠️ CRITICAL
**Location**: Lines 4103-4126
**Issue**: Failed runs display but cannot be retried from the UI

**Current Code**:
```javascript
// Failed runs show status and error, but no action button
<span style="...">✗ Failed</span>
```

**Impact**: User must go to CLI to retry failed ingestion. Reduces usability.

**Fix Required**:
```javascript
// Add button to each failed run
if (run.run_status === 'failed') {
  html += `<button onclick="window.retryPipelineRun('${esc(run.id)}')">Retry</button>`;
}
```

**Estimated Effort**: Medium (requires backend endpoint: POST /api/retry-pipeline-run/{id})

---

### MEDIUM PRIORITY ISSUES

#### 2. NO PROGRESS INDICATOR FOR IN-PROGRESS RUNS
**Location**: Lines 4104-4117
**Issue**: Running jobs show status "⟳ Running" but no ETA or % complete

**Current Code**:
```javascript
const statusText = run.run_status === 'completed' ? '✓ Completed' :
                   run.run_status === 'failed' ? '✗ Failed' : '⟳ Running';
```

**Missing Fields**:
- If `run.rows_processed` and `run.rows_total` exist: Could show progress bar
- If `run.started_at` exists: Could estimate ETA based on historical run times

**Fix Example**:
```javascript
if (run.run_status === 'running' && run.rows_processed && run.rows_total) {
  const pct = Math.round((run.rows_processed / run.rows_total) * 100);
  html += `<div style="height:4px; background:#f0f0f0; margin:4px 0;">
            <div style="width:${pct}%; height:100%; background:#3b82f6;"></div>
          </div>`;
}
```

**Severity**: MEDIUM (nice-to-have, doesn't block functionality)

---

#### 3. ERROR TEXT UNREADABLE — NOT TRUNCATED
**Location**: Lines 4119-4124
**Issue**: Long `error_summary` shown as single line with no truncation; could overflow table

**Current Code**:
```html
<tr style="background: rgba(239,68,68,0.1); border-bottom: 1px solid var(--border);">
  <td colspan="6" style="padding: 8px; font-size: 12px; color: var(--text3);">
    <strong style="color: #ef4444;">Error:</strong> ${esc(run.error_summary)}
  </td>
</tr>
```

**Risk**:
- 500+ character error message breaks table layout
- No way to see full error without HTML inspector

**Fix**:
```javascript
const truncatedError = (run.error_summary || '').substring(0, 200);
const hasMore = (run.error_summary || '').length > 200;
html += `<tr style="...">
  <td colspan="6">
    <strong style="color: #ef4444;">Error:</strong> ${esc(truncatedError)}
    ${hasMore ? `<button onclick="showErrorDetails('${run.id}')"> [Show Details]</button>` : ''}
  </td>
</tr>`;
```

**Severity**: MEDIUM (usability)

---

#### 4. STALE METRICS — NO TIMESTAMP OR REFRESH BUTTON
**Location**: Lines 4078-4082
**Issue**: Summary metrics computed once on load; if page left open, metrics become outdated

**Current Code**:
```javascript
html += metricHTML('Last Run', lastRun.finished_at ? new Date(lastRun.finished_at).toLocaleDateString() : 'Pending', ...);
```

**Problem**:
- If runs complete while viewing this page, metrics won't update
- User may make decisions based on stale success rate

**Fix**:
```javascript
html += `<div style="font-size: 11px; color: var(--text3); margin-bottom: 8px;">
  Last updated: ${new Date().toLocaleTimeString()}
  <button onclick="window.loadGovPipelineRuns()">↻ Refresh</button>
</div>`;
```

Note: Monitor Dashboard already has a refresh button (Line 4198 in the audit) — Pipeline Control should match.

**Severity**: MEDIUM (consistency, data freshness)

---

### LOW PRIORITY ISSUES

#### 5. NO DATE RANGE FILTER — HARDCODED LIMIT:50
**Location**: Line 4040
**Issue**: Query loads last 50 runs; no way to see older runs or filter by date range

**Current Code**:
```javascript
const result = await govQuery('ingestion_tracker', '*', {
  order: 'started_at.desc',
  limit: 50  // ← hardcoded
});
```

**Impact**: Users cannot find specific historical runs without scrolling past 20+ visible rows and can't see runs older than load point.

**Fix**: Add date picker above table:
```javascript
html += `<div style="margin-bottom: 12px;">
  <input type="date" id="pipeline-date-from" /> to
  <input type="date" id="pipeline-date-to" />
  <button onclick="window.filterPipelineRuns()">Filter</button>
</div>`;
```

**Severity**: LOW (enhancement)

---

#### 6. TABLE LIMIT OF 20 NOT OBVIOUS
**Location**: Line 4103
**Issue**: Displays 20 of 50 loaded runs with no indicator; user may think "only 20 runs exist"

**Current Code**:
```javascript
runs.slice(0, 20).forEach(run => { ... });
```

**Fix**: Add item counter:
```javascript
const showing = Math.min(20, runs.length);
html += `<h3 style="margin-bottom: 12px;">Recent Runs (${showing} of ${runs.length})</h3>`;
```

**Severity**: LOW (clarity)

---

## ARRAY ACCESS & ERROR HANDLING

### Safe Array Accesses ✓
The function properly handles missing data:

| Line | Pattern | Safety |
|------|---------|--------|
| 4064 | `const runs = govPipelineRuns \|\| [];` | ✓ Fallback to empty array |
| 4073 | `const lastRun = runs[0];` | ✓ Safe (checks `runs.length === 0` first on line 4066) |
| 4074-4076 | `.filter()` methods | ✓ Safe (array.filter() works on empty arrays) |
| 4106 | `run.started_at`, `run.finished_at` | ✓ Ternary with fallback (Lines 4106-4107) |
| 4108 | `run.rows_inserted \|\| 0` | ✓ Nullish coalescing |

### Error Handling in Load Function ✓
Lines 4034-4049 show proper error handling:
```javascript
window.loadGovPipelineRuns = async function() {
  if (govPipelineLoading) return;  // ✓ Guard against concurrent loads
  govPipelineLoading = true;
  try {
    const result = await govQuery('ingestion_tracker', '*', {
      order: 'started_at.desc',
      limit: 50
    });
    govPipelineRuns = result.data || [];  // ✓ Fallback
  } catch(e) {
    console.error('loadGovPipelineRuns error:', e);  // ✓ Logged
    govPipelineRuns = [];  // ✓ Graceful fallback
  }
  govPipelineLoading = false;
  renderGovTab();  // ✓ Triggers re-render
};
```

**Assessment**: Error handling is solid. No unsafe array accesses.

---

## GOV WRITE SERVICE ANALYSIS

### ISSUE: govWriteService() — UNDEFINED FUNCTION ⚠️ CRITICAL BUG

**Problem**: `govWriteService()` is called 5 times in gov.js but **never defined**:

| Line | Usage |
|------|-------|
| 1664 | `await govWriteService('ownership', {...})` |
| 1764 | `await govWriteService('lead-research', leadData)` |
| 1988 | `await govWriteService('ownership', {...})` |
| 2202 | `await govWriteService('lead-research', {...})` |
| 4995 | `govWriteService('lead-research', {...})` |

**Detection Method**: Searched entire codebase:
```bash
grep -r "govWriteService\s*=" *.js        # No definition found
find . -name "*.js" -exec grep -l "govWriteService\s*=" # No matches
grep "^function govWriteService" gov.js   # No matches
grep "^const govWriteService" gov.js      # No matches
```

**Status**: UNDEFINED in gov.js, detail.js, app.js, index.html

**Impact**:
- Line 1764 (Lead Research save): Will throw `ReferenceError: govWriteService is not defined`
- Line 1988 (Intel save): Same error
- Line 2202 (Mark research): Same error
- Line 4995 (Update lead): Same error (though this one has `.then()` chaining suggesting it expects a Promise)

**Runtime Failure**: Calling any of these functions will crash:
```
Uncaught ReferenceError: govWriteService is not defined
```

---

### Analysis: patchRecord() — ERROR FEEDBACK ✓ GOOD

**Location**: Lines 2109-2133
**Status**: PROPERLY IMPLEMENTED with error feedback

```javascript
async function patchRecord(table, idCol, idVal, data) {
  try {
    const result = await applyChangeWithFallback({
      proxyBase: '/api/gov-query',
      table, idColumn: idCol, idValue: idVal, data,
      source_surface: 'gov_workspace'
    });

    if (!result.ok) {
      console.error(`patchRecord error: ${(result.errors || []).join(', ')}`);
      showToast('Error saving data', 'error');  // ← Toast feedback ✓
      return false;
    }
    return true;
  } catch (err) {
    console.error('patchRecord error:', err);
    showToast('Error saving', 'error');  // ← Toast feedback ✓
    return false;
  }
}
```

**Strengths**:
- ✓ Catches both API errors (`!result.ok`) and network errors (catch block)
- ✓ Logs errors to console
- ✓ Shows user-facing toast notification
- ✓ Returns boolean for caller to handle (`return false` on error)

**Callers Using patchRecord() Properly**:
- Line 1678: `await patchRecord(...)` — no success toast (Issue 5.2 per audit)
- Line 1823: `await patchRecord(...)` — no success toast (Issue 5.3 per audit)
- Line 1852: `await patchRecord(...)` — no success toast (Issue 5.4 per audit)
- Line 1982: `await patchRecord(...)` — silent success
- Line 2024: `await patchRecord(...)` — silent success
- Line 2190: `const ok = await patchRecord(...); if (!ok) return;` — ✓ checks return value
- Line 2196: `const ok = await patchRecord(...); if (!ok) return;` — ✓ checks return value

**Assessment**: patchRecord() has **proper error feedback (showToast)**, but 4 callers lack **success feedback** (per UX audit Issues 5.2-5.4).

---

## COMPARATIVE ANALYSIS: Pipeline Control vs Other Modes

| Mode | Status | Loading State | Empty State | Success Toast | Retry/Action | Error Feedback |
|------|--------|---------------|-------------|---------------|--------------|-----------------|
| **Pipeline Control** | ✓ Functional | ✓ Yes | ✓ Yes | N/A | ✗ NO | Error displayed |
| Pending Updates | ✓ Functional | ✓ Yes | ✓ Yes | ✗ Missing | ✓ Action buttons | ✓ Toast on error |
| Financial Overrides | ✓ Functional | ✓ Limited | N/A | Uses alert() | ✗ No undo | ✓ Toast |
| Monitor Dashboard | ✗ Placeholder | ✗ Hardcoded | ✓ Visual | N/A | ✗ None | Hardcoded data |

**Pipeline Control ranks in the middle**: Good rendering, but missing retry functionality and progress tracking.

---

## SUMMARY TABLE: All Issues

| # | Issue | Line(s) | Severity | Category | Status |
|---|-------|---------|----------|----------|--------|
| 1 | **govWriteService undefined** | 1664, 1764, 1988, 2202, 4995 | CRITICAL | Code Error | BUG — blocks functionality |
| 2 | **No retry button for failed runs** | 4088-4126 | CRITICAL | UX/Feature | Missing feature |
| 3 | **No progress bar for in-progress runs** | 4104-4105 | MEDIUM | UX | Enhancement |
| 4 | **Error text not truncated** | 4119-4124 | MEDIUM | UX | Layout risk |
| 5 | **Stale metrics, no timestamp** | 4078-4082 | MEDIUM | Data Freshness | Consistency gap |
| 6 | **No date range filter** | 4040 | LOW | Feature | Enhancement |
| 7 | **Table limit not obvious** | 4103 | LOW | UX Clarity | Minor |

---

## RECOMMENDED IMMEDIATE FIXES

### Fix #1: DEFINE govWriteService() — URGENT
**Effort**: 30 min | **Priority**: CRITICAL

This function is called but undefined. Either:
1. Define it in gov.js as a fetch wrapper, OR
2. Import/alias it from another module, OR
3. Replace calls with direct API calls to `/api/gov-write`

**Template**:
```javascript
async function govWriteService(table, data) {
  try {
    const response = await fetch('/api/gov-write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table, data })
    });
    if (!response.ok) throw new Error(await response.text());
    return await response.json();
  } catch (err) {
    console.error(`govWriteService(${table}) error:`, err);
    throw err;
  }
}
```

---

### Fix #2: Add Retry Button to Failed Runs
**Effort**: 45 min | **Priority**: CRITICAL

Replace line 4113 to add retry button for failed runs:
```javascript
html += `<tr style="border-bottom: 1px solid var(--border);">
  <td style="padding: 8px;">${esc(run.source || '—')}</td>
  <td style="padding: 8px;">${esc(run.task_name || '—')}</td>
  <td style="padding: 8px; text-align: center;">
    <span style="background: ${statusColor}; color: white; padding: 2px 8px; border-radius: 3px; font-size: 11px; font-weight: 600;">
      ${statusText}
    </span>
    ${run.run_status === 'failed' ? `<button onclick="window.retryPipelineRun('${run.id}')" style="margin-left: 8px; padding: 2px 6px; font-size: 11px;">Retry</button>` : ''}
  </td>
  <td style="padding: 8px; font-size: 12px; color: var(--text3);">${startDate}</td>
  <td style="padding: 8px; font-size: 12px; color: var(--text3);">${duration}</td>
  <td style="padding: 8px; text-align: center; font-size: 12px;">${rowStr}</td>
</tr>`;
```

Requires backend endpoint: `POST /api/pipeline-runs/{runId}/retry`

---

### Fix #3: Add Refresh Button & Last Updated Timestamp
**Effort**: 15 min | **Priority**: MEDIUM

Add after line 4067:
```javascript
html += `<div style="display: flex; justify-content: space-between; align-items: center; padding: 0 0 12px 0; font-size: 12px; color: var(--text3);">
  <span>Last updated: ${new Date().toLocaleTimeString()}</span>
  <button onclick="window.loadGovPipelineRuns()" style="padding: 4px 10px; font-size: 11px;">↻ Refresh</button>
</div>`;
```

---

### Fix #4: Truncate Long Error Messages
**Effort**: 10 min | **Priority**: MEDIUM

Replace lines 4119-4124:
```javascript
if (run.error_summary && run.run_status === 'failed') {
  const truncated = (run.error_summary || '').substring(0, 200);
  const isTruncated = run.error_summary.length > 200;
  html += `<tr style="background: rgba(239,68,68,0.1); border-bottom: 1px solid var(--border);">
    <td colspan="6" style="padding: 8px; font-size: 12px; color: var(--text3);">
      <strong style="color: #ef4444;">Error:</strong> ${esc(truncated)}${isTruncated ? '...' : ''}
      ${isTruncated ? `<button onclick="alert('${esc(run.error_summary)}')" style="margin-left: 8px; color: #3b82f6; text-decoration: underline;">Show full</button>` : ''}
    </td>
  </tr>`;
}
```

---

## TESTING CHECKLIST

- [ ] Verify govWriteService is defined and callable
- [ ] Test Pipeline Control renders with real data from `ingestion_tracker`
- [ ] Test loading state appears when data not yet loaded
- [ ] Test empty state when no runs exist
- [ ] Test summary metrics calculation (completed count, success rate, failed count)
- [ ] Test error row displays for failed runs with error_summary
- [ ] **Verify retry button works for failed runs** (after implementing Fix #2)
- [ ] Test refresh button updates data (after implementing Fix #3)
- [ ] Test error message truncation with 500+ char error (after implementing Fix #4)
- [ ] Compare metrics freshness vs Monitor Dashboard behavior
- [ ] Verify Escape handling on source/task names (using `esc()` function — already done Line 4111-4112)

---

## REFERENCES

- **UX Audit Report**: GOV_UX_AUDIT_REPORT.md (Issue 3.1-3.5)
- **Related Issues**:
  - Issue 5.2-5.4: Missing success toasts on research saves (patchRecord callers)
  - Issue 4.1: Monitor Dashboard placeholder data (comparison point)
- **Load Function**: Lines 4034-4049
- **Render Function**: Lines 4051-4136

