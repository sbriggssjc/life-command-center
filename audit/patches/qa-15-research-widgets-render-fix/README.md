# QA-15 — Research page widgets render fix (P2 deferred)

**Severity: P2.** The Research page rendered as just
"Research · 0 tasks · Active Completed All · No research tasks
match this filter" even though the LLC research queue had 1,200+
items and the Agency Drift queue had hundreds of rows. The
widget functions were defined and the render call wired up — but
the parent function destroyed them on the next line.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/qa-15-research-widgets-render-fix
node audit/patches/qa-15-research-widgets-render-fix/apply.mjs --dry
node audit/patches/qa-15-research-widgets-render-fix/apply.mjs --apply
git add -A
git commit -F audit/patches/qa-15-research-widgets-render-fix/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/qa-15-research-widgets-render-fix -m "Merge audit/qa-15-research-widgets-render-fix"
git push origin main
```

## The bug

`renderResearchPage` (`ops.js`) had this shape:

```js
async function renderResearchPage(page) {
  const el = document.getElementById('researchContent');
  el.innerHTML = '<div class="loading">…</div>';      // 1. wipe + spinner

  await renderLlcResearchQueueWidget(el);             // 2. widget prepends
                                                       //    itself into el
  await renderAgencyDriftQueueWidget(el);             // 3. second widget
                                                       //    prepends too

  // … fetch research tasks, build `html` …

  el.innerHTML = html;                                 // 4. WIPES the widgets
}                                                      //    inserted at #2/#3
```

The widget functions were correctly inserting into `el` at step 2-3,
but step 4's `el.innerHTML = html` assignment replaced everything,
including the just-rendered widgets. Both widgets appeared briefly
during the await of step 4's fetch, then vanished when the assignment
fired.

Result: Research page looked empty even though `renderLlcResearchQueueWidget`
+ `renderAgencyDriftQueueWidget` ran successfully every page-load.

## The fix

Restructure `renderResearchPage` to:
1. Build the queue-list `html` string first.
2. Set `el.innerHTML` to TWO wrapper divs: `.lcc-research-widgets` (empty
   placeholder) + `.lcc-research-queue` (containing the queue-list `html`).
3. **Then** call the widget render functions, passing the
   `.lcc-research-widgets` wrapper so they prepend into it without
   conflicting with subsequent re-renders.

```js
el.innerHTML = '<div class="lcc-research-widgets"></div>' +
               '<div class="lcc-research-queue">' + html + '</div>';
const widgetsEl = el.querySelector('.lcc-research-widgets');
if (widgetsEl) {
  if (typeof renderLlcResearchQueueWidget === 'function') {
    await renderLlcResearchQueueWidget(widgetsEl);
  }
  if (typeof renderAgencyDriftQueueWidget === 'function') {
    await renderAgencyDriftQueueWidget(widgetsEl);
  }
}
```

## After

- **LLC Research Queue widget** — renders at the top, lists the
  top 15 queued LLCs with Open SoS → / Mark found / etc. (was
  already wired; now actually visible).
- **Agency Drift widget** — below the LLC widget, shows agency-name
  mismatches between property + lease records (was already wired;
  now actually visible).
- **Research tasks list** — the original list (0 tasks today)
  renders below both widgets.

## Why this wasn't caught earlier

The widget render functions don't throw on success, the page
inserted them then wiped them, and there was no console error.
A user looking at the page just saw the bare research-tasks list
and assumed the widgets didn't exist. The original wiring (item
#2 Phase B from 2026-05-17 and Fresh audit A-5 from 2026-05-18)
appeared to work in isolation but never produced output in
production.

## Files changed

- `ops.js` — `renderResearchPage` restructure
- `AUDIT_PROGRESS.md` (closeout)

## That closes the deferred queue

QA-13 / QA-14 / QA-15 were the three items deferred at the end of
the original QA pass. All shipped.
