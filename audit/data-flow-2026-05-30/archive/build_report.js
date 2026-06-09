const fs = require("fs");
const docx = require("docx");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, PageNumber,
  Header, Footer, TabStopType, TabStopPosition, LevelFormat
} = docx;

const NAVY="003DA5", SKY="62B5E5", MID="265AB2", AXIS="6A748C", TEXT="191919",
      MUTED="666666", PALE="E0E8F4", ALT="E7E6E6",
      OK="1B7F4B", WARN="B7791F", BAD="B42318", DEAD="6B21A8";
const FONT="Calibri", FONTL="Calibri Light";

// ---------- helpers ----------
const H1 = (t)=> new Paragraph({ heading:HeadingLevel.HEADING_1, spacing:{before:260,after:120},
  children:[new TextRun({text:t,bold:true,color:NAVY,font:FONTL,size:30})]});
const H2 = (t)=> new Paragraph({ heading:HeadingLevel.HEADING_2, spacing:{before:200,after:90},
  children:[new TextRun({text:t,bold:true,color:MID,font:FONTL,size:24})]});
const H3 = (t)=> new Paragraph({ spacing:{before:140,after:60},
  children:[new TextRun({text:t,bold:true,color:TEXT,font:FONT,size:21})]});
const P = (t,opt={})=> new Paragraph({ spacing:{after:opt.after??120,line:276}, alignment:opt.align,
  children: Array.isArray(t)? t : [new TextRun({text:t,font:FONT,size:21,color:TEXT})]});
const run=(t,o={})=> new TextRun({text:t,font:FONT,size:o.size??21,color:o.color??TEXT,bold:o.bold,italics:o.italics});
const BULLET=(t,o={})=> new Paragraph({ bullet:{level:o.level??0}, spacing:{after:60,line:268},
  children: Array.isArray(t)? t : [new TextRun({text:t,font:FONT,size:21,color:TEXT})]});
const SRC=(t)=> new Paragraph({ spacing:{after:120}, children:[new TextRun({text:t,font:FONT,size:17,italics:true,color:MUTED})]});

function cell(text,{w,bold,bg,color,size,align}={}){
  return new TableCell({
    width: w?{size:w,type:WidthType.PERCENTAGE}:undefined,
    shading: bg?{type:ShadingType.CLEAR,fill:bg}:undefined,
    margins:{top:50,bottom:50,left:90,right:90},
    children:[new Paragraph({alignment:align,children:[new TextRun({text:String(text),bold,color:color??TEXT,font:FONT,size:size??18})]})]
  });
}
function table(headers,rows,widths){
  const border={style:BorderStyle.SINGLE,size:2,color:ALT};
  const borders={top:border,bottom:border,left:border,right:border,insideHorizontal:border,insideVertical:border};
  const head=new TableRow({tableHeader:true,children:headers.map((h,i)=>cell(h,{w:widths&&widths[i],bold:true,bg:NAVY,color:"FFFFFF"}))});
  const body=rows.map((r,ri)=> new TableRow({children:r.map((c,i)=>{
    const obj=(c&&typeof c==="object")?c:{text:c};
    return cell(obj.text,{w:widths&&widths[i],bg:obj.bg??(ri%2?"FAFBFD":"FFFFFF"),color:obj.color,bold:obj.bold,align:obj.align});
  })}));
  return new Table({width:{size:100,type:WidthType.PERCENTAGE},borders,rows:[head,...body]});
}
const sevCell=(s)=>({text:s,bold:true,color: s==="Critical"?BAD : s==="High"?WARN : MUTED});
const spacer=()=>P("",{after:40});

// ---------- document body ----------
const kids=[];

// Cover
kids.push(new Paragraph({spacing:{before:1400,after:0},alignment:AlignmentType.LEFT,
  children:[new TextRun({text:"NORTHMARQ",bold:true,color:NAVY,font:FONTL,size:30,characterSpacing:30})]}));
kids.push(new Paragraph({border:{bottom:{style:BorderStyle.SINGLE,size:12,color:SKY}},spacing:{after:240},children:[]}));
kids.push(new Paragraph({spacing:{after:80},children:[new TextRun({text:"Life Command Center",bold:true,color:NAVY,font:FONTL,size:56})]}));
kids.push(new Paragraph({spacing:{after:300},children:[new TextRun({text:"Data-Flow & Information-Architecture Audit",color:MID,font:FONTL,size:34})]}));
kids.push(P([run("How data moves from the databases to the app, where review work lives today, and where the gaps are.",{size:22,color:MUTED})]));
kids.push(P([run("Prepared: 2026-05-30   ·   Scope: whole app, breadth-first   ·   Method: read-only sweep of three live Supabase projects plus frontend / API code review and prior-audit synthesis",{size:18,color:MUTED})]));
kids.push(new Paragraph({pageBreakBefore:true,children:[]}));

// 1. Executive summary
kids.push(H1("1.  Executive summary"));
kids.push(P("The Life Command Center plumbing is mature and largely sound. External sources flow into three Supabase databases, a consolidated twelve-function API serves them, and the app renders them across a clean primary navigation. The pipes work. The problem this audit surfaces is the last mile: the app collects and computes far more review-ready work than it presents, and the work it does present is fragmented by domain rather than organized by the job the reviewer is doing."));
kids.push(P([run("Three findings dominate. First, ",{}),run("review work has no proportionate home.",{bold:true}),run(" The largest backlogs in the system sit in database views with little or no UI surface — government ownership research at 49,547 rows, dialysis next-best-research at 27,974, field-provenance conflicts at 12,332, and stale identities at 18,838 — while the queues that are surfaced are split across three separate research screens (a standalone Research page plus a six-mode research tab inside each domain). A reviewer resolving one ownership question routinely hops between four contexts.",{})]));
kids.push(P([run("Second, ",{}),run("the system cannot watch itself.",{bold:true}),run(" The live sweep caught a dialysis auto-merge job failing every hour for more than a day, a government nightly hygiene sweep failing two steps every night, and LLC/SOS research worker that has drained zero rows in over a week while its queue grows past 1,900. None of these are visible anywhere in the app, so they have been degrading silently.",{})]));
kids.push(P([run("Third, ",{}),run("the data-quality governance layer is effectively un-deployed.",{bold:true}),run(" The field-source-priority registry that is supposed to arbitrate competing writes holds eight rules in production against the 462 documented, which is the direct cause of the 12,332 unresolved provenance conflicts and 37 unranked-field drift rows.",{})]));
kids.push(P("None of this requires re-plumbing. The recommendation is to add a work-type spine on top of the existing system: a single Review Console that consolidates every review queue (with a domain filter rather than a domain destination), a top-level Ops Health surface fed by the existing health views, and a small number of elevation moves so that conflicts and merge candidates surface where the user already is. Two of the six health findings are also straightforward code bugs with fixes identified below."));

// 2. Method & scope
kids.push(H1("2.  Method and scope"));
kids.push(P("This was a fresh, breadth-first audit across the whole app, requested to map the flow of data from the databases into the LCC and how that data is laid out and presented, with an eye toward a more intuitive, purpose-built layout. Four parallel work streams fed it:"));
kids.push(BULLET([run("Frontend / IA map — ",{bold:true}),run("the navigation, every surface, and every place a human reviews queued work, read from index.html and the app's JavaScript modules.")]));
kids.push(BULLET([run("Data-layer / API map — ",{bold:true}),run("the twelve API functions and their sub-routes, the three databases, and the views and tables that drive review work, from CLAUDE.md, vercel.json and the handlers.")]));
kids.push(BULLET([run("Prior-audit synthesis — ",{bold:true}),run("consolidated and de-duplicated findings from the existing internal audit corpus (gaps register, holistic audit, pending-updates friction log, gov UX audit, data-integrity audit, BD engine audit).")]));
kids.push(BULLET([run("Live database sweep — ",{bold:true}),run("read-only SELECTs against all three Supabase projects to capture actual row counts for every review queue and to check the health/alert views. No data was modified.")]));
kids.push(SRC("Note on a documentation discrepancy worth correcting: the three databases each use a single public schema. The “dia.” / “gov.” prefixes throughout the internal docs are logical naming on the standalone domain databases, not Postgres schemas. The government project ref is scknotsqkcheojiaewwh."));

// 3. How data flows today
kids.push(H1("3.  How data flows today"));
kids.push(P("Data moves left to right through four stages. The companion interactive map renders this visually; the summary is below."));
kids.push(H3("Sources → Databases"));
kids.push(P("Flagged Outlook email (via Power Automate), CoStar sidebar captures, Salesforce, SharePoint, Outlook and Calendar bridges, county records, CMS, and federal datasets (GSA, FRPP, SAM, OPM, USAJobs) land in three Supabase projects: LCC Opps (the orchestrator — auth, the BD engine, field provenance, and the work / inbox queues), Dialysis_DB (12,400 properties, CMS clinics, financials, ~180 views), and Government (17,790 properties, GSA/FRPP, ownership research, ~160 views)."));
kids.push(H3("Databases → API"));
kids.push(P("A twelve-function Vercel layer (at the Hobby-plan ceiling) serves everything through query-param sub-routing. entity-hub serves contacts, entities and property detail; queue serves my-work, team, inbox and research; operations carries bridge actions, the workflow engine and Copilot chat; intake and intake-share handle OM staging; admin carries config, flags, edge proxies and more than thirty review sub-routes; sync and bridges handle the external connectors; apply-change performs audited domain writes with provenance; and actions, domains and capital-markets round it out."));
kids.push(H3("API → UI"));
kids.push(P("The app presents a bottom navigation (Today, Dialysis, Gov, Pipeline, Inbox) plus a ten-item “More” drawer, with a shared six-tab Property Detail slide-over. The domain dashboards each carry eleven to fourteen inner tabs. This is where the structure starts to work against the user, which the next section quantifies."));

// 4. Core finding
kids.push(H1("4.  The core finding: review work has no proportionate home"));
kids.push(P("The table below lists the largest review queues found across the three databases, the live row count at audit time, the UI surface that owns each today, and a status. The pattern is unambiguous: the biggest backlogs are precisely the ones that are orphaned (no meaningful surface) or buried (reachable only several clicks deep or conditionally)."));
kids.push(table(
  ["Queue / view","DB","Live count","UI home today","Status"],
  [
    ["ownership_research_queue","Gov",{text:"49,547",bold:true},"— none proportionate",sevCell("Critical").text? {text:"Orphaned",bold:true,color:BAD}:""],
    ["v_ownership_gaps","Gov",{text:"39,191"},"— none",{text:"Orphaned",color:BAD}],
    ["v_next_best_research","Dia",{text:"27,974",bold:true},"Dialysis › Research (thin)",{text:"Buried",color:WARN}],
    ["v_stale_identities","LCC",{text:"18,838",bold:true},"— none",{text:"Orphaned",color:BAD}],
    ["v_field_provenance_actionable","LCC",{text:"12,332",bold:true},"— none meaningful",{text:"Orphaned",color:BAD}],
    ["prospect_leads","Gov",{text:"11,532"},"Gov › Prospects",{text:"Surfaced",color:OK}],
    ["v_my_work","LCC",{text:"10,299"},"Pipeline › My Work",{text:"Surfaced",color:OK}],
    ["vw_lead_work_queue","Gov",{text:"8,133"},"Gov › Prospects/Pipeline",{text:"Buried",color:WARN}],
    ["v_inbox_triage","LCC",{text:"7,974"},"Inbox",{text:"Surfaced",color:OK}],
    ["v_clinic_research_priority","Dia",{text:"7,526"},"Dialysis › Research",{text:"Buried",color:WARN}],
    ["duplicate_property_address (DQ)","Gov",{text:"6,912",bold:true},"Data Quality (partial)",{text:"Buried",color:WARN}],
    ["pending_updates","Gov",{text:"5,979"},"Gov › Research › pending_updates",{text:"Surfaced",color:OK}],
    ["expired_lease_not_superseded (DQ)","Gov",{text:"5,676"},"— none",{text:"Orphaned",color:BAD}],
    ["v_ownership_research_backlog","Dia",{text:"4,842"},"Dialysis › Research › property",{text:"Buried",color:WARN}],
    ["v_ingest_write_failures_recent","LCC",{text:"2,676"},"— none",{text:"Orphaned",color:BAD}],
    ["v_research_queue","LCC",{text:"2,325"},"Research page",{text:"Surfaced",color:OK}],
    ["llc_research_queue (dia+gov)","Dia+Gov",{text:"1,968",bold:true},"Research page / gov mode",{text:"Dead worker",color:DEAD}],
    ["v_recorded_vs_assessor_owner_divergence","Gov",{text:"561"},"— none",{text:"Orphaned",color:BAD}],
    ["v_lcc_merge_candidates","LCC",{text:"156"},"Detail › Consolidate button",{text:"Buried",color:WARN}],
  ],
  [30,9,12,28,13]
));
kids.push(spacer());
kids.push(SRC("Counts captured live via read-only SELECTs on 2026-05-30. Orphaned = no meaningful UI surface; Buried = reachable but ≥2–3 clicks deep or conditional; Dead worker = rows accumulate with no process draining them. The interactive map carries the full ~40-queue inventory with filters."));
kids.push(P([run("The fragmentation compounds this. ",{bold:true}),run("Identical review work is split into parallel places: there is a standalone Research page, a six-mode Research tab inside Gov (pending_updates, pipeline_control, ownership, leads, intel, financial_overrides), and a six-mode Research tab inside Dialysis (quarantine, unmatched, clarification, property, lease, clinic_leads, staleness). Resolving one ownership data question can require the Gov ownership mode, the Dialysis property mode, the Property-detail Ownership & CRM tab, and the standalone Research page — four contexts for one job.",{})]));

// 5. IA assessment
kids.push(H1("5.  Information-architecture assessment"));
kids.push(P("The current IA is organized primarily by domain. That made sense when Gov and Dialysis were separate efforts, but it forces the user to choose a vertical before choosing a task, and it scatters cross-cutting work (conflicts, merges, research, verification) into per-domain corners. Several specific symptoms recur in both the live review and the prior audits:"));
kids.push(BULLET("Manual-review surfaces are buried: provenance conflicts appear only inside a conditional Property-detail tab; merge candidates only behind a small “Consolidate” button; listing verification three levels deep under Dialysis › Activity › expand."));
kids.push(BULLET("The Pending Updates workbench overloads a single “Approve” button with three different semantic actions (overwrite recorded owner, set a row approved with no inventory change, cement a suspect link), shows a confidence pill computed even on non-field-change actions, and never surfaces the record IDs or context keys a reviewer needs to investigate."));
kids.push(BULLET("Large views render all rows client-side (5,000-row pulls on the Dialysis overview and Inbox), freezing the browser."));
kids.push(BULLET("The “More” drawer is a flat list of ten items where critical destinations (Research, Data Quality) rank visually equal to Settings."));
kids.push(BULLET("Backend capability exists with no front-end: the next-best-research generator is live and feeding views, but no widget renders it in the detail panel or research tab."));
kids.push(H3("Proposed direction — add a work-type spine"));
kids.push(P("Keep the domain dashboards for browsing and analysis, but lift the review work out of them into two new top-level surfaces, and elevate two buried affordances:"));
kids.push(BULLET([run("Review Console (new). ",{bold:true}),run("One destination, organized into work-type lanes — Ownership & LLC research, Data conflicts & provenance, Property merges & duplicates, Listing verification, Pending updates, and Intake & identity. Each lane carries a live badge and a domain filter, so Gov vs Dia becomes a filter rather than a separate place. The existing Sale-Link Resolver pattern (today available for only one reason code) generalizes into the lane detail view for every review type, with reason-aware actions and proper save confirmations.")]));
kids.push(BULLET([run("Ops Health (new). ",{bold:true}),run("A surface fed by the health views (v_cron_health_summary, v_lcc_health_alerts_open, v_flow_run_failures_open) and the two domain data-quality summaries, plus an “open alerts” badge on Today, so failing jobs and dead workers stop degrading silently.")]));
kids.push(BULLET([run("Elevate in Property Detail. ",{bold:true}),run("A persistent “Needs review” banner that surfaces provenance conflicts and merge candidates the moment the panel opens, routing to the relevant Review Console lane pre-filtered to that property.")]));
kids.push(BULLET([run("Group the drawer. ",{bold:true}),run("Replace the flat ten-item list with Work (Pipeline, Inbox, Review Console), Intelligence (Contacts, Entities, Capital Markets, Metrics), and Admin (Sync Health, Ops Health, Settings).")]));
kids.push(SRC("The companion mockup file renders all five of these screens in brand-accurate wireframe form."));

// 6. Gap register
kids.push(H1("6.  Gap register"));
kids.push(P("Consolidated from the live sweep and the prior-audit corpus, de-duplicated and grouped by theme. The interactive map carries the same register with live filtering."));

kids.push(H2("6.1  Data-flow and wiring"));
kids.push(table(["Gap","Sev","Where"],[
  ["Field-priority registry only 8 rules live (462 documented) — provenance ungoverned",sevCell("Critical"),"LCC field_source_priority"],
  ["18,838 stale identities + 2,676 recent write failures unsurfaced",sevCell("High"),"LCC Opps"],
  ["Salesforce prospecting link 97% missing (13,675 of 14,106 ownership groups)",sevCell("High"),"Ownership ↔ SF"],
  ["SAM.gov 0 rows ingested; OPM / USAJobs snapshots ~64 days stale",sevCell("Medium"),"Gov enrichment"],
],[64,12,24]));
kids.push(spacer());

kids.push(H2("6.2  Information architecture and layout"));
kids.push(table(["Gap","Sev","Where"],[
  ["Three fragmented research queues — no unified triage",sevCell("High"),"LCC + Gov + Dia Research"],
  ["Monitor dashboard is 100% placeholder data",sevCell("High"),"Gov Pipeline › Monitor"],
  ["Large views render all rows client-side → browser freeze",sevCell("High"),"Dia Overview, Inbox"],
  ["Provenance conflicts only visible via a conditional detail tab",sevCell("Medium"),"Detail › Ownership & CRM"],
  ["Merge candidates reachable only via small Consolidate button",sevCell("Medium"),"Detail header"],
  ["Listing verification buried 3 levels deep",sevCell("Medium"),"Dialysis Activity tab"],
  ["Sale-Link Resolver pattern excellent but used for one reason code only",sevCell("Medium"),"Gov Pending Updates"],
  ["Drawer is a flat list of 10 — critical items rank equal to Settings",sevCell("Medium"),"More drawer"],
  ["Marketing badge shows total opportunities, not actionable tasks",sevCell("Medium"),"app.js Marketing badge"],
],[64,12,24]));
kids.push(spacer());

kids.push(H2("6.3  Review workflow"));
kids.push(table(["Gap","Sev","Where"],[
  ["One “Approve” button = three different semantic actions",sevCell("High"),"Gov Pending Updates"],
  ["Confidence pill computed on non-field-change actions (meaningless)",sevCell("Medium"),"Gov Pending Updates"],
  ["Record IDs / context keys never shown to the reviewer",sevCell("Medium"),"Gov Pending Updates"],
  ["Missing success/confirm toasts + no destructive-action guards",sevCell("Medium"),"Gov research saves"],
],[64,12,24]));
kids.push(spacer());

kids.push(H2("6.4  Missing coverage"));
kids.push(table(["Gap","Sev","Where"],[
  ["Gov ownership research backlog 49,547 with no proportionate UI",sevCell("High"),"Gov ownership_research_queue"],
  ["Former ownership / cross-vertical history never rendered on contacts",sevCell("High"),"Contact / entity hub"],
  ["Next-best-research generator live but no UI widget renders it",sevCell("High"),"detail.js / research tab"],
  ["Recorded vs assessor owner divergence (561) not surfaced",sevCell("Medium"),"Gov ownership"],
  ["SOS officer/manager/agent data shows 0 with no research prompt",sevCell("Medium"),"Ownership detail"],
  ["Rich data unsurfaced: clinic financial estimates 188K, patient counts 145K",sevCell("Medium"),"Dialysis detail"],
  ["Gov property_financials 98K + CMBS loan history barely exposed",sevCell("Medium"),"Gov detail"],
],[64,12,24]));
kids.push(spacer());

kids.push(H2("6.5  Data integrity"));
kids.push(table(["Gap","Sev","Where"],[
  ["6,912 duplicate-address property clusters — largest DQ liability",sevCell("High"),"Gov properties"],
  ["Implausible cap rates (>10% / <3%) pollute market metrics",sevCell("High"),"dia+gov cap_rate_history"],
  ["Triple-pipeline duplicate sales (490 dia / 380 gov groups)",sevCell("High"),"sales_transactions"],
  ["Owner entity dedup gaps (373 dia / 1,349 gov) break ownership chains",sevCell("High"),"recorded / true owners"],
],[64,12,24]));

// 7. Ops health
kids.push(H1("7.  Live ops-health findings"));
kids.push(P("These were caught by querying the health and alert views during the sweep. None of them surface anywhere a human would see them in the app, so each has been degrading silently. Two are also code bugs with clear fixes."));
kids.push(table(["Finding","Detail","Status"],[
  [{text:"Dialysis auto-merge failing hourly",bold:true},"auto_merge_property_failures fires every hour for 24h+. FK violation: the losing property can't be deleted because sales_transactions rows aren't reparented first. ~24 open alerts.",{text:"Code bug",bold:true,color:BAD}],
  [{text:"Gov nightly hygiene sweep broken",bold:true},"data_hygiene_sweep_step_error: REFRESH MATERIALIZED VIEW is called on v_sales_comps and v_available_listings, which are plain views. Two steps fail every night.",{text:"Code bug",bold:true,color:BAD}],
  [{text:"LLC / SOS research stalled 8+ days",bold:true},"research_queue_stalled open on dia (1,304) and gov (664). 0 completed — no worker drains the queue (deferred pending a free SOS scraper). The queue only grows.",{text:"Dead worker",bold:true,color:DEAD}],
  [{text:"SF→LCC file backfill + write pile-up",bold:true},"Open flow_failure: Power Automate “SF → LCC Daily Bulk File Backfill” failed at Apply-to-each. ingest_write_failures at 10,577 rows.",{text:"Open",color:WARN}],
  [{text:"Provenance governance un-deployed",bold:true},"field_source_priority = 8 rows vs 462 documented; 37 unranked-field drift rows; 12,332 actionable conflicts ungoverned.",{text:"Open",color:WARN}],
  [{text:"Listing verification falling behind",bold:true},"Gov: 200 never verified, 126 overdue 30d. Dia: 74 never verified, 26 overdue. Probe cadence outruns capacity.",{text:"Open",color:WARN}],
],[24,58,18]));

// 8. Recommendations
kids.push(H1("8.  Recommendations and sequencing"));
kids.push(P("The work divides cleanly into surfacing (new homes for existing data), repair (the code bugs and dead workers), and hygiene (the data-integrity backlog). A pragmatic order:"));
kids.push(H3("Phase 1 — stop the silent bleeding (days)"));
kids.push(BULLET("Fix the two code bugs: reparent sales_transactions before delete in the dialysis auto-merge; change the gov hygiene sweep to refresh plain views (or convert them to matviews) instead of REFRESH MATERIALIZED VIEW."));
kids.push(BULLET("Ship a minimal Ops Health surface reading the existing health views, plus an “open alerts” badge on Today. This is mostly wiring — the views already exist."));
kids.push(BULLET("Decide the LLC/SOS worker: either stand up the free SOS-direct scraper or pause enqueuing, so the queue stops growing with no drain."));
kids.push(H3("Phase 2 — consolidate review work (weeks)"));
kids.push(BULLET("Build the Review Console shell with the six work-type lanes and live badges; deep-link the existing domain research modes into it so nothing is lost during migration."));
kids.push(BULLET("Generalize the Sale-Link Resolver into the lane detail view: reason-aware actions, record-ID and context-key chips, success toasts, and destructive-action guards — this directly clears the Pending Updates friction list."));
kids.push(BULLET("Add the persistent “Needs review” banner to Property Detail and render the next-best-research card that the backend already feeds."));
kids.push(BULLET("Paginate / virtualize the 5,000-row client-side renders that freeze the browser."));
kids.push(H3("Phase 3 — governance and hygiene (ongoing)"));
kids.push(BULLET("Deploy the full field-source-priority registry so the 12,332 provenance conflicts become governable, then work the conflict and unranked-field lanes down."));
kids.push(BULLET("Run the data-integrity remediations already specified in the prior audits: duplicate-address clusters, duplicate sales, owner dedup, cap-rate validation bands."));
kids.push(BULLET("Group the drawer and re-point the Marketing badge to actionable tasks."));

// 9. Companion artifacts
kids.push(H1("9.  Companion artifacts"));
kids.push(P("This report is one of three deliverables produced together:"));
kids.push(BULLET([run("LCC_Data_Flow_Audit_Map.html ",{bold:true}),run("— interactive map: the DB→API→UI flow, the full ~40-queue heatmap with filters, current-vs-proposed IA trees, a filterable gap register, and the live ops-health panel.")]));
kids.push(BULLET([run("LCC_Proposed_Redesign_Mockups.html ",{bold:true}),run("— five brand-accurate wireframes: the Today review-strip, the Review Console, a generalized resolver, the elevated Property Detail banner, and Ops Health.")]));
kids.push(BULLET([run("LCC_Data_Flow_Audit_Report.docx ",{bold:true}),run("— this document.")]));
kids.push(SRC("All counts in this report were captured read-only on 2026-05-30 and will drift as the system runs. The interactive map is the living view; regenerate the sweep to refresh the numbers."));

// ---------- assemble ----------
const doc=new Document({
  styles:{default:{document:{run:{font:FONT,size:21,color:TEXT}}}},
  numbering:{config:[]},
  sections:[{
    properties:{page:{margin:{top:1100,bottom:1100,left:1200,right:1200}}},
    headers:{default:new Header({children:[new Paragraph({alignment:AlignmentType.RIGHT,
      children:[new TextRun({text:"Northmarq — LCC Data-Flow & IA Audit",font:FONT,size:15,color:MUTED})]})]})},
    footers:{default:new Footer({children:[new Paragraph({alignment:AlignmentType.CENTER,
      children:[new TextRun({text:"Confidential — internal  ·  ",font:FONT,size:15,color:MUTED}),
        new TextRun({children:["Page ",PageNumber.CURRENT," of ",PageNumber.TOTAL_PAGES],font:FONT,size:15,color:MUTED})]})]})},
    children:kids
  }]
});
Packer.toBuffer(doc).then(b=>{
  const out="/sessions/sharp-ecstatic-mendel/mnt/life-command-center/audit/data-flow-2026-05-30/LCC_Data_Flow_Audit_Report.docx";
  fs.writeFileSync(out,b);
  console.log("WROTE",out,b.length,"bytes");
});
