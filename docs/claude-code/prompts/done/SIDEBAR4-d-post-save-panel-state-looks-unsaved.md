# SIDEBAR4-d — after Save, the side panel re-renders as if nothing was saved, so Scott clicks Update *and* Re-run

Backlog: `SIDEBAR4-d`. Source: Scott, 2026-09-23. This is the real cause behind SIDEBAR4-c's double runs.

## What Scott does (his words)

"I click the initial save or add to LCC button and then the request sends but then the app reloads and prompts me to send the data again with an update LCC with CoStar Data or Rerun Pipeline buttons and it looks like its all fresh data or hasn't been saved. So I usually click both of those buttons after the reload."

## Measured

- **After a successful Save.** `extension/sidepanel.js` (~2639–2653) shows "Saved! Checking pipeline…", awaits `pollPipelineStatus`, then calls `setTimeout(() => loadPropertyTab({ prefetchEntityId }), 1500)`. That full re-render lands in the *matched* state. The matched state shows exactly the same **"Update LCC with CoStar Data"** + **"Re-run Pipeline"** buttons as a property that was saved months ago and never refreshed.
- **Nothing tells him it's current.** There is no "saved just now", no "pipeline ✓ at 9:14", and no "nothing new on this page". The toasts vanish with the re-render.
- **Other re-renders.** `chrome.storage.onChanged` → `pageContext` also calls `loadPropertyTab()` whenever the CoStar page updates its context (~4485–4500). So the panel can "reload" on its own.
- **Update and Re-run are redundant.** Update (PATCH) already runs the pipeline server-side (`entities.patch` trigger). Re-run then runs it again: every PATCH → process pair in the SIDEBAR4 run logs, now serialized by the coalescer. 1.0.56's action guard (SIDEBAR4-c) blocks a Re-run *while* an Update is in flight. It does not stop Scott's deliberate click after the reload, because nothing on screen tells him not to.

## Ask

1. **An honest "in LCC" state in the matched render.** Show when the entity was last saved/updated, the last pipeline status and time (from `metadata._pipeline_status` / `_pipeline_processed_at` / `_pipeline_run_log`), and whether the page shows anything the stored capture doesn't.
2. **Update only when there's something to update.** Compare the live page context to the stored capture (a stable hash of the fields `extractSourceFields` / `buildMetadata` send). If nothing changed, the primary button reads e.g. "Up to date in LCC ✓" and is disabled. If fields changed, it reads "Update LCC (N fields changed)".
3. **Re-run becomes secondary.** Show it prominently only when the last pipeline run failed, or put it behind an overflow ("…"). Update already runs the pipeline.
4. **Keep the post-save state visible.** The "Saved ✓ / pipeline ✓" result must survive the 1.5 s re-render and any `pageContext` re-render for the same entity.
5. Keep the SIDEBAR4-c action guard and the server coalescer.
6. **Tests.** A DOM test for Save → re-render: shows "in LCC, up to date", and Update is disabled when the context is unchanged. A test that a changed field enables Update with the count. A test that Re-run is secondary unless the last status is failed. Each needs a mutation that turns it red.
7. Bump the manifest. Scott reloads the extension after deploy.

## Done means

- Backlog row updated.
- Deploy = redeploy both Railway services (if server code changes) + extension reload.
- Cowork verifies in the run logs that a Save is followed by exactly one run, and that an unchanged page produces no Update.
