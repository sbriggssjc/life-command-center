const fs = require("fs");
const docx = require("docx");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, PageNumber,
  Header, Footer
} = docx;

const NAVY="003DA5", SKY="62B5E5", MID="265AB2", AXIS="6A748C", TEXT="191919",
      MUTED="666666", PALE="E0E8F4", ALT="E7E6E6",
      OK="1B7F4B", WARN="B7791F", BAD="B42318", DEAD="6B21A8";
const FONT="Calibri", FONTL="Calibri Light";

const H1=(t)=>new Paragraph({heading:HeadingLevel.HEADING_1,spacing:{before:260,after:120},
  children:[new TextRun({text:t,bold:true,color:NAVY,font:FONTL,size:30})]});
const H2=(t)=>new Paragraph({heading:HeadingLevel.HEADING_2,spacing:{before:200,after:90},
  children:[new TextRun({text:t,bold:true,color:MID,font:FONTL,size:24})]});
const H3=(t)=>new Paragraph({spacing:{before:140,after:50},
  children:[new TextRun({text:t,bold:true,color:TEXT,font:FONT,size:21})]});
const P=(t,o={})=>new Paragraph({spacing:{after:o.after??120,line:276},alignment:o.align,
  children:Array.isArray(t)?t:[new TextRun({text:t,font:FONT,size:21,color:TEXT})]});
const run=(t,o={})=>new TextRun({text:t,font:o.mono?"JetBrains Mono":FONT,size:o.size??21,color:o.color??TEXT,bold:o.bold,italics:o.italics});
const B=(t,o={})=>new Paragraph({bullet:{level:o.level??0},spacing:{after:60,line:268},
  children:Array.isArray(t)?t:[new TextRun({text:t,font:FONT,size:21,color:TEXT})]});
const SRC=(t)=>new Paragraph({spacing:{after:130},children:[new TextRun({text:t,font:FONT,size:17,italics:true,color:MUTED})]});
const SP=()=>new Paragraph({spacing:{after:40},children:[]});

function cell(text,{w,bold,bg,color,size,align}={}){
  return new TableCell({width:w?{size:w,type:WidthType.PERCENTAGE}:undefined,
    shading:bg?{type:ShadingType.CLEAR,fill:bg}:undefined,
    margins:{top:50,bottom:50,left:90,right:90},
    children:[new Paragraph({alignment:align,children:[new TextRun({text:String(text),bold,color:color??TEXT,font:FONT,size:size??18})]})]});
}
function table(headers,rows,widths){
  const bd={style:BorderStyle.SINGLE,size:2,color:ALT};
  const borders={top:bd,bottom:bd,left:bd,right:bd,insideHorizontal:bd,insideVertical:bd};
  const head=new TableRow({tableHeader:true,children:headers.map((h,i)=>cell(h,{w:widths&&widths[i],bold:true,bg:NAVY,color:"FFFFFF"}))});
  const body=rows.map((r,ri)=>new TableRow({children:r.map((c,i)=>{const o=(c&&typeof c==="object")?c:{text:c};
    return cell(o.text,{w:widths&&widths[i],bg:o.bg??(ri%2?"FAFBFD":"FFFFFF"),color:o.color,bold:o.bold,align:o.align});})}));
  return new Table({width:{size:100,type:WidthType.PERCENTAGE},borders,rows:[head,...body]});
}
const HB=(s)=> s==="ok"?{text:"Solid",color:OK,bold:true} : s==="warn"?{text:"Weak",color:WARN,bold:true} : {text:"Broken",color:BAD,bold:true};

const K=[];

// cover
K.push(new Paragraph({spacing:{before:1300,after:0},children:[new TextRun({text:"NORTHMARQ",bold:true,color:NAVY,font:FONTL,size:30,characterSpacing:30})]}));
K.push(new Paragraph({border:{bottom:{style:BorderStyle.SINGLE,size:12,color:SKY}},spacing:{after:240},children:[]}));
K.push(new Paragraph({spacing:{after:80},children:[new TextRun({text:"Property Intelligence Flow",bold:true,color:NAVY,font:FONTL,size:54})]}));
K.push(new Paragraph({spacing:{after:300},children:[new TextRun({text:"A phase-by-phase blueprint: from asset to prospect",color:MID,font:FONTL,size:32})]}));
K.push(P([run("Re-sequencing how property information is presented so each phase advances ownership de-anonymization, research, and prospecting — grounded in the real data lineage across all three databases.",{size:22,color:MUTED})]));
K.push(P([run("Prepared 2026-05-30 · Companion to the Data-Flow & IA audit · Counts captured live, read-only",{size:18,color:MUTED})]));
K.push(new Paragraph({pageBreakBefore:true,children:[]}));

// 1 thesis
K.push(H1("1.  The thesis"));
K.push(P("A property record is not an endpoint; it is the entry point to a chain of questions that ends in a relationship worth pursuing. Today the app answers those questions out of order, across six tabs the user must already know how to read, and the chain dead-ends in an audit log. The richest, highest-value links — who truly owns this behind the LLC, who built it, what else they control, and what to do about it — are either rendered in the wrong place, rendered as flat name-strings, or not rendered at all."));
K.push(P([run("The reframing this blueprint proposes: ",{}),run("the broken links in a property's chain are the prospecting opportunities.",{bold:true}),run(" A property whose true owner is unresolved, whose ownership history is a name-only list, and whose developer is unknown is precisely the research target. The system already computes those gaps — the next-best-research and ownership-research queues together hold more than 67,000 rows. The job is to present the lifecycle as one guided flow where every phase surfaces its data and its gap, and hands the gap forward as a concrete action, converging on a prospecting move.",{})]));
K.push(P([run("Two phases carry the weight. ",{}),run("Phase 4 (ownership de-anonymization)",{bold:true,color:MID}),run(" and ",{}),run("Phase 6 (the principal / developer)",{bold:true,color:MID}),run(" are the de-anonymization payoff; ",{}),run("Phase 8 (prospecting convergence)",{bold:true,color:MID}),run(" is where every upstream gap becomes a ranked action and a cadence placement. The interactive companion renders the full journey.",{})]));

// 2 lineage reality
K.push(H1("2.  The data lineage this flow rests on"));
K.push(P("The flow is not invented; it follows the real foreign-key topology. Dialysis_DB and Government share an identical ten-stage shape, with LCC Opps sitting above both as the cross-vertical entity layer. The canonical join path:"));
K.push(P([run("properties → leases / lease_escalations → operation (medicare_clinics | property_agencies + gsa_leases) → sales_transactions / cap_rate_history → available_listings → recorded_owners → true_owners → ownership_history → developer (free text / inferred) → prospect_leads / ownership_research_queue → [LCC] lcc_entity_portfolio_facts → entities → v_priority_queue → v_bd_cadence_dashboard",{mono:true,size:17,color:MID})]));
K.push(P("Three structural truths shape the design and explain why the payoff phases are where the value (and the difficulty) concentrate:"));
K.push(B([run("Ownership history can't price its own transfers. ",{bold:true}),run("ownership_history does carry recorded_owner_id and true_owner_id, but 61% of dia rows (and ~5,800 gov) have no sale_id, so most transfers can't be anchored to a transaction or priced. The recorded→true link is also asymmetric: dia has a direct recorded_owners.true_owner_id FK, while gov resolves it only per-row inside ownership_history. The timeline must render the chain AND drive entity-resolution + sale-matching research.")]));
K.push(B([run("Developer barely exists as an entity. ",{bold:true}),run("There is no dedicated developers table; developer is represented four inconsistent ways — properties.developer free text (dia 315 / gov 17), dia true_owners.developer_flag (2 TRUE), is_build_to_suit (gov 155), and inference candidate views. The trace-back is structurally incomplete, so the developer phase is presented as an explicit research opportunity, strongest where the build-to-suit signal exists.")]));
K.push(B([run("Beneficial ownership is thin and asymmetric. ",{bold:true}),run("True owner is NULL on 24% of dialysis and 60% of government properties, and 81% of dia / 55% of gov properties carry no recorded-owner FK at all (the owner is stranded in ownership_history / deed_records). Government recorded_owners has no true_owner_id column, so the deed→beneficial link there exists only per-row inside ownership_history. The owner an investor cares about is frequently missing or unlinked — which is exactly why the flow must converge on resolving it.")]));

// 3 the phases table
K.push(H1("3.  The nine phases at a glance"));
K.push(P("Each phase has one job, one question it answers, the data that feeds it, and the gap it must surface as a forward action."));
K.push(table(
  ["#","Phase","Question it answers","Data health"],
  [
   ["0","Asset Identity","What and where is this asset?",HB("ok")],
   ["1","Tenancy & Terms","Who occupies it, on what economics?",HB("ok")],
   ["2","Occupier & Operations","Who operates it, and how healthy is it?",HB("ok")],
   ["3","Market Activity & Value","What has it sold for; is it listed now?",HB("warn")],
   [{text:"4",bold:true},{text:"Ownership De-anonymization",bold:true},"Recorded owner → true owner behind the LLC?",HB("bad")],
   ["5","Ownership Timeline","Who has owned it over time?",HB("bad")],
   [{text:"6",bold:true},{text:"The Principal / Developer",bold:true},"Who built it; what is their pattern?",HB("bad")],
   ["7","Portfolio & Cross-Vertical Fusion","What else does this owner control?",HB("bad")],
   [{text:"8",bold:true},{text:"Prospecting Convergence",bold:true},"What do I do about it, right now?",HB("warn")],
  ],
  [6,28,46,20]
));
K.push(SP());
K.push(SRC("Data health reflects the live lineage sweep: Solid = well-populated and FK-linked; Weak = partial population or async/ordering issues; Broken = missing FK, missing entity, or not rendered at all."));

// 4 per-phase spec
K.push(H1("4.  Phase specifications"));

const PHASES=[
 {n:"0",t:"Asset Identity",health:"ok",
  job:"Anchor the journey on one trustworthy asset record; everything downstream hangs off this id.",
  present:"Address, city/state/zip, county; lat/lng map pin; building SF, year built, property type/subtype; domain badge.",
  data:"properties (Dia 12,377 · Gov 17,895); /api/property → entity-hub.",
  gap:"Geocoding gaps leave some assets without a map pin; type/subtype occasionally blank. Minor.",
  fwd:"Confirm the asset, then ask who occupies it."},
 {n:"1",t:"Tenancy & Terms",health:"ok",
  job:"Present the lease(s) and escalations as the income story and the timing signal for any approach.",
  present:"Tenant, lease start/end, type; base rent, rent/SF, escalations; rent projected to today; expiration countdown.",
  data:"leases (Dia 12,323 · Gov 16,494); lease_escalations (Gov 93,669); v_sales_comps via /api/data-query.",
  gap:"Async lease enrichment re-renders mid-view with no loading state; expirations aren't turned into a dated prospecting trigger.",
  fwd:"Lease economics set the table — now surface who runs the operation."},
 {n:"2",t:"Occupier & Operations",health:"ok",
  job:"Surface operating reality behind the tenant — the leading indicator of renewal / replacement risk.",
  present:"Dialysis: CMS facility, CCN, chain, stations, census, payer mix, quality star / QIP. Gov: agency, occupancy SF, GSA lease #, expiration.",
  data:"medicare_clinics (Dia 8,535); property_agencies (Gov 64,386); clinic_financial_estimates 188K and facility_patient_counts 145K (both unsurfaced).",
  gap:"The richest data in the system is buried in a third tab with nothing summarized on the overview; ~372 dia properties carry an orphan Medicare id.",
  fwd:"With asset, lease and operation known, ask what the market has done with it."},
 {n:"3",t:"Market Activity & Value",health:"warn",
  job:"Fuse closed sales (with derived cap rates) and live listings (with verification status) into one liquidity-and-value read.",
  present:"Sales: date, price, derived cap rate, buyer, seller, $/SF. Listings: asking price/cap, DOM, status. Verification: sold / off-market / unreachable. Cap-rate provenance ladder.",
  data:"sales_transactions (Dia 3,067 · Gov 10,474); cap_rate_history (Dia 8,790); available_listings (Dia 265 · Gov 169 active); listing_verification_history.",
  gap:"Sales and listings are co-mingled and out of lifecycle order; verification status is computed but never shown; implausible cap rates still pollute comps.",
  fwd:"The market view raises the real question: who owns this, and can we reach them?"},
 {n:"4",t:"Ownership De-anonymization  (payoff)",health:"bad",
  job:"Move from deed-level recorded owner to beneficial true owner, exposing confidence and divergence explicitly.",
  present:"Recorded owner (name, mailing, type); LLC research (manager, registered agent, filing state); true owner (name, type, parent); recorded≠true≠assessor divergence with confidence.",
  data:"recorded_owners (Dia 4,104 · Gov 15,615); true_owners (Dia 3,953 · Gov 14,128); v_recorded_vs_assessor_owner_divergence (Gov 561); llc_research_queue 1,968 with 0 drained.",
  gap:"True owner NULL on 24% of dia / 60% of gov properties; 81% of dia / 55% of gov properties have no recorded-owner FK. Gov recorded_owners has no true_owner_id column (deed→beneficial link lives only in ownership_history). Divergence is never surfaced; the LLC/SOS worker is dead (1,968 queued, 0 completed, 8+ days). The biggest break in the chain.",
  fwd:"Resolve the owner, then trace ownership backward through time."},
 {n:"5",t:"Ownership Timeline",health:"bad",
  job:"Render ownership history as a true chain (acquisition → disposition → next owner), not a flat list; transitions are the signal.",
  present:"Chronological owner chain with dates and sale price per transition; sale-leaseback / portfolio-deal flags; each entry linked to a canonical entity.",
  data:"ownership_history (Dia 7,797 · Gov 14,727); lcc_listing_events 58.",
  gap:"61% of dia ownership_history rows (≈5,800 gov) carry no sale_id, so most transfers can't be priced or anchored. Today a flat, 50-row-capped list — oldest-first, no continuity check (seller N ≠ buyer N-1 never flagged), no entity links or portfolio expansion.",
  fwd:"Follow the chain to its origin: who built this asset?"},
 {n:"6",t:"The Principal / Developer  (payoff)",health:"bad",
  job:"Trace the chain back to the developer / principal — the entity worth a relationship, not a one-off call.",
  present:"Developer entity (name, HQ, specialty); build-to-suit + first-generation status; the developer's repeat pattern; role classification (developer vs REIT vs flipper).",
  data:"properties.developer free text (Dia 315 / 2.5% · Gov 17); dia true_owners.developer_flag (2 TRUE); is_build_to_suit (Gov 155); inference views v_dia/gov_developer_candidates; developer_scorecard empty.",
  gap:"Developer is represented four inconsistent ways and never rendered as an entity. Gov true_owners has no developer columns; dia has only 2 flagged owners; attribution depends entirely on inference candidate views. The UI shows at most a binary flag — no first-generation/BTS detection, no current-vs-former, no portfolio. The developer-centric BD strategy has no surface to act on.",
  fwd:"Once you know the principal, see everything they touch."},
 {n:"7",t:"Portfolio & Cross-Vertical Fusion",health:"bad",
  job:"Expand from one asset to the principal's whole footprint across both verticals, turning a property into a relationship-sized opportunity.",
  present:"Owner's other properties across both domains; concentration / affiliate rollup; cross-vertical entity identity; effective portfolio including affiliates.",
  data:"lcc_entity_portfolio_facts 5,873 (dia 1,664 · gov 4,209); entities (canonical) 15,546; v_entity_portfolio_all / v_lcc_operator_affiliates.",
  gap:"No 'owner's other properties' view is reachable from the property — the Portfolio tab requires opening a separate owner drawer first. LCC joins the domains only by (source_domain, source_property_id) string match (no FK), so a domain-side merge silently breaks the rollup. Cross-vertical fusion stays invisible in the property flow.",
  fwd:"Portfolio context makes the prospecting move obvious — converge."},
 {n:"8",t:"Prospecting Convergence  (destination)",health:"warn",
  job:"Turn every upstream gap into a ranked, concrete action and a cadence placement — the flow's whole point.",
  present:"Ranked next-best-research for THIS property; priority band (P0–P8) with reason; one-click add-to-cadence / create-lead / log-call; open the relevant Review Console lane pre-filtered.",
  data:"v_next_best_research (Dia 27,974 · Gov 39,191); ownership_research_queue (Gov 49,547 · Dia 4,842); v_priority_queue 1,062; v_bd_cadence_dashboard 270.",
  gap:"Generator and queues exist but never render on the property; prospecting is a 1–3 chip afterthought, so the flow dead-ends at the Activity Log instead of converging.",
  fwd:"Turn the asset into a move that advances the pipeline."},
];
PHASES.forEach(p=>{
  K.push(H2(`Phase ${p.n} — ${p.t}`));
  K.push(P([run("Job in the flow.  ",{bold:true,color:MID}),run(p.job)],{after:60}));
  K.push(P([run("What it presents.  ",{bold:true,color:MID}),run(p.present)],{after:60}));
  K.push(P([run("Data sources (live).  ",{bold:true,color:MID}),run(p.data,{size:19})],{after:60}));
  K.push(new Paragraph({spacing:{after:60,line:268},children:[
    run((p.health==="bad"?"Research gap (broken).  ":"Research gap.  "),{bold:true,color:(p.health==="bad"?BAD:WARN)}),run(p.gap)]}));
  K.push(P([run("Hand forward.  ",{bold:true,color:OK}),run(p.fwd,{italics:true})],{after:140}));
});

// 5 cross-cutting principles
K.push(H1("5.  Design principles that hold across every phase"));
K.push(B([run("Sequence is the product. ",{bold:true}),run("Present in lifecycle order (identity → tenancy → operation → market → ownership → timeline → developer → portfolio → prospect), with a persistent stepper showing where you are and what's next. Replace tab-hunting with a guided path.")]));
K.push(B([run("Every gap is a button. ",{bold:true}),run("A missing true owner, a name-only history entry, an absent developer, a recorded≠true divergence — each renders as a one-click research action that lands in the queue and, where relevant, the cadence.")]));
K.push(B([run("Show confidence, not just values. ",{bold:true}),run("Ownership and cap-rate data carry real uncertainty; surface source and confidence (e.g. cmbs_audited vs market_implied; recorded vs true vs assessor) instead of a bare number.")]));
K.push(B([run("Converge, don't dead-end. ",{bold:true}),run("The journey ends in Phase 8 — a ranked set of actions and a cadence placement — not in an audit log. The Activity Log becomes a side panel, not the terminus.")]));
K.push(B([run("Two surfaces, one model. ",{bold:true}),run("The quick detail slide-over presents the same phases collapsed for fast lookups; the full Property Intelligence workspace expands them for deep research. Both read from one phase model so they never diverge.")]));

// 6 build sequence
K.push(H1("6.  Suggested build sequence"));
K.push(P("This blueprint reuses data and endpoints that already exist; most of the work is presentation and a few wiring fixes. A pragmatic order:"));
K.push(H3("Step 1 — Re-sequence what already renders (low effort, high clarity)"));
K.push(B("Reorder the existing detail tabs into lifecycle order and add the stepper; split Market Activity (sales vs live listings) and show verification status."));
K.push(B("Summarize operations richness (census, payer mix, financial estimates) on the overview instead of burying it in tab three."));
K.push(H3("Step 2 — Build the payoff phases (the differentiators)"));
K.push(B("Render the ownership chain as a timeline and wire the recorded→true→divergence panel with confidence and a 'resolve owner' action."));
K.push(B("Add the developer phase (gov first, where the FK + 210 records exist); for dialysis, present it as an explicit research opportunity until a developer entity is modeled."));
K.push(B("Build the owner-portfolio view from lcc_entity_portfolio_facts / v_entity_portfolio_all — the first cross-vertical fusion surface."));
K.push(H3("Step 3 — Wire the convergence (the point)"));
K.push(B("Render v_next_best_research for the current property as ranked actions; show the priority band; add one-click create-lead / add-to-cadence / log-call."));
K.push(B("Restart the LLC/SOS worker (or pause enqueuing) so resolved-owner actions actually complete — today that queue is dead, which would make the payoff phases stall."));
K.push(H3("Step 4 — Strengthen the underlying links (so the flow stays true)"));
K.push(B("Backfill sale_id on ownership_history (61% of dia rows are unanchored) and resolve owner names to canonical entities, so the timeline can price transfers and the portfolio rollup is reliable."));
K.push(B("Strengthen the LCC-to-domain join beyond (source_domain, source_property_id) string-matching, so domain-side property merges don't silently break the cross-vertical rollup."));
K.push(B("Model a developer/principal entity (a real table, not free text or flags) so the trace-back and developer portfolio work in both verticals — gov build-to-suit (155) is the natural seed."));

// 7 companions
K.push(H1("7.  Companion artifacts"));
K.push(B([run("LCC_Property_Intelligence_Flow.html ",{bold:true}),run("— the interactive guided journey: a stepper rail plus a card per phase showing purpose, presented data, live sources, the research gap, and the forward action, ending in the prospecting convergence lanes.")]));
K.push(B([run("LCC_Property_Intelligence_Flow_Spec.docx ",{bold:true}),run("— this blueprint.")]));
K.push(B([run("From the 2026-05-30 audit: ",{bold:true}),run("LCC_Data_Flow_Audit_Map.html, LCC_Proposed_Redesign_Mockups.html, LCC_Data_Flow_Audit_Report.docx — the system-wide context this property flow sits inside (the Review Console is where Phase 8's research actions are worked).")]));
K.push(SRC("All counts captured read-only on 2026-05-30 and will drift as the system runs. Regenerate the lineage sweep to refresh."));

const doc=new Document({
  styles:{default:{document:{run:{font:FONT,size:21,color:TEXT}}}},
  sections:[{
    properties:{page:{margin:{top:1100,bottom:1100,left:1200,right:1200}}},
    headers:{default:new Header({children:[new Paragraph({alignment:AlignmentType.RIGHT,
      children:[new TextRun({text:"Northmarq — LCC Property Intelligence Flow",font:FONT,size:15,color:MUTED})]})]})},
    footers:{default:new Footer({children:[new Paragraph({alignment:AlignmentType.CENTER,
      children:[new TextRun({text:"Confidential — internal  ·  ",font:FONT,size:15,color:MUTED}),
        new TextRun({children:["Page ",PageNumber.CURRENT," of ",PageNumber.TOTAL_PAGES],font:FONT,size:15,color:MUTED})]})]})},
    children:K
  }]
});
Packer.toBuffer(doc).then(b=>{
  const out="/sessions/sharp-ecstatic-mendel/mnt/life-command-center/audit/data-flow-2026-05-30/LCC_Property_Intelligence_Flow_Spec.docx";
  fs.writeFileSync(out,b); console.log("WROTE",out,b.length);
});
