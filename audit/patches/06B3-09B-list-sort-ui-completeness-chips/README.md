# Item #6 Phase B-3 + Item #9 Phase B — list sort UI + completeness chips

Combined patch because the two items overlap on the same surface — a
sort toggle whose options include completeness, plus a chip rendering
the band. Ships the building blocks; per-tab adoption is the Phase C
punch list.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/06B3-09B-list-sort-ui-completeness-chips
node audit/patches/06B3-09B-list-sort-ui-completeness-chips/apply.mjs --dry
node audit/patches/06B3-09B-list-sort-ui-completeness-chips/apply.mjs --apply
git add -A
git commit -F audit/patches/06B3-09B-list-sort-ui-completeness-chips/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/06B3-09B-list-sort-ui-completeness-chips -m "Merge audit/06B3-09B-list-sort-ui-completeness-chips: list sort + chip helpers"
git push origin main
```

No SQL migration. No backend changes.

## Smoke test (after Railway redeploy)

1. Hard-reload the app. Land on Home.
2. The NBA rail should now show **a colored band chip on each row**,
   next to the DIA/GOV tag:
   - Green pill = EXCELLENT (completeness 90+)
   - Blue pill  = GOOD (70–89)
   - Yellow pill= FAIR (40–69)
   - Red pill   = POOR (<40)
   - Grey "—"   = unknown / no band
3. In devtools, sanity-check the helpers:
   ```js
   lccCompletenessChip(87, 'good');
   // → '<span class="lcc-cmp-chip lcc-cmp-chip-good" title="...">GOOD</span>'

   lccRenderSortToggle('test', 'value',
     [{key:'value',label:'Value'},{key:'date',label:'Date'}], 'someFn');
   // → DOM HTML for the toggle

   lccSortListByKey(
     [{a: 5}, {a: null}, {a: 9}, {a: 2}],
     'a',
     { a: { field: 'a', dir: 'desc', nulls: 'last' } }
   );
   // → [{a:9},{a:5},{a:2},{a:null}]
   ```

## Per-tab adoption pattern (Phase C)

Each list tab needs the same 6-step recipe — see the
`AUDIT_PROGRESS.md` closeout for full details. Quick version:

```js
// 1. Define sort specs:
const SPECS = {
  value:        { field: 'sold_price', dir: 'desc', nulls: 'last' },
  date:         { field: 'sale_date',  dir: 'desc', nulls: 'last' },
  completeness: { field: 'completeness_score', dir: 'desc', nulls: 'last' },
};

// 2. Read user preference + sort:
const sortKey = lccGetListSort('gov_sales_transactions', 'value');
const rows = lccSortListByKey(rawData, sortKey, SPECS);

// 3. Render toggle in header:
header.innerHTML += lccRenderSortToggle(
  'gov_sales_transactions', 'value',
  [{key:'value',label:'Value'},{key:'date',label:'Date'},
   {key:'completeness',label:'Completeness'}],
  'renderGovSales'
);

// 4. Render chip in each row:
'<td>' + lccCompletenessChip(row.completeness_score, row.completeness_band) + '</td>'

// 5. Make sure the SELECT includes completeness_score, completeness_band.
//    (They're indexed since Phase B-1, so the join is cheap.)
```

## Punch list (Phase C — per-tab rollout)

| Tab | DB | Default sort |
|---|---|---|
| Sales transactions | both | value |
| Available listings | both | date |
| Portfolio properties | gov | value |
| Prospect leads | gov | priority_score |
| Operations / CMS table | dia | value |
| Loans | both | value |

Each of these can ship as a separate small patch using the recipe
above. No further app-wide work is needed — the helpers are in place.
