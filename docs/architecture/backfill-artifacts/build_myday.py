import json, datetime, html
# Owner-scoped "My Day" dashboard builder. Input /tmp/myday.json = lcc_my_day()::text
# (owner Scott by default): {owner_name, todo_count, pipeline_total, todos:[...], pipeline:[...]}.
d=json.load(open('/tmp/myday.json'))
todos=d['todos']; pipe=d['pipeline']; gen=d.get('generated_at','')[:10]
owner=d.get('owner_name','')
today=datetime.date(2026,7,30)
def dt(s): return datetime.date.fromisoformat(s) if s else None
def esc(s): return html.escape(str(s if s is not None else ''))
due_soon=sum(1 for t in todos if t.get('due_date') and dt(t['due_date'])<=today+datetime.timedelta(days=1))
touches=sum(t.get('touch_count',0) or 0 for t in todos)

PR={'urgent':('Urgent','critical'),'high':('High','serious'),'normal':('Normal','neutral'),'low':('Low','neutral')}
ACT={'offer_review':'Offer review','follow_up':'Follow-up','seller_follow_up':'Seller follow-up','review_response':'Review response'}
CH={'email':'✉','call':'☎','note':'▤','meeting':'▣'}
def band_role(b):
    return 'crit' if b in('P0','P0.4') else 'serious' if b in('P0.5','P-BUYER','P-CONTACT','P1') else 'neutral'
def reason_h(r):
    return {'resolve_ownership_control':'Resolve ownership / control','acquire_contact':'Acquire decision-maker contact'}.get(r, (r or '').replace('_',' ').capitalize())
def money(v):
    try: v=float(v)
    except: return '—'
    return '—' if not v else ('$'+format(int(v),','))
def rel_days(dsc):
    if dsc is None: return 'no touches yet'
    return 'touched today' if dsc==0 else ('touched yesterday' if dsc==1 else f'touched {dsc}d ago')
def due_badge(t):
    dd=t.get('due_date')
    if not dd: return ''
    delta=(dt(dd)-today).days
    role,txt=(('critical',f'Overdue {abs(delta)}d') if delta<0 else ('serious','Due today') if delta==0 else ('warning','Due tomorrow') if delta==1 else ('neutral',f'Due {dd}'))
    return f'<span class="badge b-{role}">{esc(txt)}</span>'
def timeline(recent):
    if not recent: return '<div class="tl-empty">Waiting on a first outbound touch (email or call) — it self-resolves on contact.</div>'
    rows=[]
    for r in recent:
        ch=r.get('channel','note'); dirn=r.get('direction')
        dlabel,dcls=(('Sent','out') if dirn=='outbound' else ('Received','in') if dirn=='inbound' else (ch.capitalize() if ch!='note' else 'Note','na'))
        who=r.get('who'); when=(r.get('occurred_at') or '')[:10]
        rows.append(f'<li class="tl-item"><span class="tl-ch">{CH.get(ch,"•")}</span><span class="tl-dir d-{dcls}">{esc(dlabel)}</span>'
          f'<span class="tl-body"><span class="tl-title">{esc(r.get("title",""))}</span>{("<span class=tl-who>"+esc(who)+"</span>") if who else ""}</span>'
          f'<time class="tl-when">{esc(when)}</time></li>')
    return '<ul class="tl">'+''.join(rows)+'</ul>'

todo_cards=[]
for t in todos:
    pl,prole=PR.get(t.get('priority','normal'),('Normal','neutral'))
    chips=''.join(f'<span class="chip">{CH.get(c,"•")} {esc(c)}</span>' for c in (t.get('channels') or []))
    todo_cards.append(f'''<article class="card">
      <div class="card-hd"><div class="hl"><span class="pill p-{prole}">{esc(pl)}</span><span class="act">{esc(ACT.get(t.get("action_type"),t.get("action_type","")))}</span>{due_badge(t)}</div><div class="rank">rank {int(t.get("rank_score",0))}</div></div>
      <h3 class="ent">{esc(t.get("entity_name","(unnamed)"))} <span class="etype">{esc(t.get("entity_type",""))}</span></h3>
      <div class="task">{esc(t.get("title",""))}</div>
      <div class="meta"><span class="{'stale' if (t.get('days_since_touch') or 0)>7 or t.get('days_since_touch') is None else ''}">{esc(rel_days(t.get('days_since_touch')))}</span><span class="dot">·</span>{int(t.get('touch_count',0) or 0)} touches{(" "+chips) if chips else ""}</div>
      {timeline(t.get('recent') or [])}</article>''')

pipe_rows=[]
for p in pipe:
    b=p.get('band',''); role=band_role(b); dom=(p.get('domain') or '').upper(); ov=p.get('days_overdue')
    overdue = f'<span class="od">{ov}d overdue</span>' if ov else '<span class="od-none">not yet due</span>'
    tag = '<span class="team">team</span>' if p.get('unassigned') else ''
    pipe_rows.append(f'''<li class="prow">
      <span class="band bd-{role}" title="priority band">{esc(b)}</span>
      <span class="pmain"><span class="pname">{esc(p.get("name",""))}</span><span class="preason">{esc(reason_h(p.get("reason")))}{(" · "+dom) if dom else ""}</span></span>
      <span class="pval">{esc(money(p.get("annual_rent")))}</span>
      <span class="pdue">{overdue} {tag}</span></li>''')

H=f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>My Day — {esc(owner)}</title><style>
:root{{--bg:#f6f7f9;--surface:#fff;--surface2:#f0f2f5;--ink:#1a1f2b;--ink2:#4a5567;--muted:#8a94a6;--line:#e4e8ee;
--crit:#b42318;--serious:#b54708;--warning:#a16207;--good:#087443;--neutral:#5a6473;--in:#087443;--out:#1d63c4;--accent:#1F3864}}
@media(prefers-color-scheme:dark){{:root{{--bg:#0e1116;--surface:#161b22;--surface2:#1c232d;--ink:#e8ecf2;--ink2:#aab4c4;--muted:#7d8798;--line:#252d38;
--crit:#ff6b5e;--serious:#f59e5a;--warning:#e0b341;--good:#43c98a;--neutral:#8a94a6;--in:#43c98a;--out:#6fa8ff;--accent:#7aa2e3}}}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased}}
.wrap{{max-width:940px;margin:0 auto;padding:32px 20px 60px}}
header{{display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:8px;margin-bottom:20px}}
h1{{font-size:26px;margin:0;letter-spacing:-.02em}}.sub{{color:var(--muted);font-size:13px}}
.kpis{{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:8px}}@media(max-width:640px){{.kpis{{grid-template-columns:repeat(2,1fr)}}}}
.kpi{{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:14px 16px}}.kpi .n{{font-size:26px;font-weight:650;letter-spacing:-.02em}}.kpi .l{{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.04em;margin-top:2px}}
.sect{{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:650;margin:26px 2px 12px}}
.card{{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:18px 18px 14px;margin-bottom:12px;box-shadow:0 1px 2px rgba(10,15,25,.03)}}
.card-hd{{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px}}.hl{{display:flex;align-items:center;gap:8px;flex-wrap:wrap}}
.pill{{font-size:11.5px;font-weight:650;padding:3px 9px;border-radius:999px}}.p-critical{{color:#fff;background:var(--crit)}}.p-serious{{color:#fff;background:var(--serious)}}.p-neutral{{color:var(--ink2);background:var(--surface2);border:1px solid var(--line)}}
.act{{font-size:12.5px;color:var(--ink2);font-weight:600}}.badge{{font-size:11px;font-weight:650;padding:2px 8px;border-radius:6px}}.b-critical{{color:#fff;background:var(--crit)}}.b-serious{{color:#fff;background:var(--serious)}}.b-warning{{color:#111;background:var(--warning)}}.b-neutral{{color:var(--ink2);background:var(--surface2);border:1px solid var(--line)}}
.rank{{color:var(--muted);font-size:11.5px;font-variant-numeric:tabular-nums;white-space:nowrap}}
.ent{{font-size:17px;margin:2px 0}}.etype{{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-left:6px}}
.task{{color:var(--ink2);font-size:14px;margin-bottom:8px}}.meta{{color:var(--muted);font-size:12.5px;margin-bottom:12px;display:flex;gap:6px;flex-wrap:wrap;align-items:center}}.meta .stale{{color:var(--serious);font-weight:600}}.dot{{opacity:.5}}
.chip{{background:var(--surface2);border:1px solid var(--line);border-radius:6px;padding:1px 7px;font-size:11px;color:var(--ink2)}}
.tl{{list-style:none;margin:0;padding:10px 0 0;border-top:1px dashed var(--line)}}.tl-item{{display:grid;grid-template-columns:20px 74px 1fr auto;align-items:baseline;gap:10px;padding:5px 0}}
.tl-ch{{color:var(--muted);text-align:center}}.tl-dir{{font-size:11px;font-weight:650;text-transform:uppercase}}.d-out{{color:var(--out)}}.d-in{{color:var(--in)}}.d-na{{color:var(--muted)}}
.tl-title{{display:block;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}.tl-who{{font-size:11.5px;color:var(--muted)}}.tl-when{{color:var(--muted);font-size:11.5px;font-variant-numeric:tabular-nums}}
.tl-empty{{color:var(--muted);font-size:12.5px;padding:10px 0 4px;border-top:1px dashed var(--line);font-style:italic}}
.plist{{list-style:none;margin:0;padding:0;background:var(--surface);border:1px solid var(--line);border-radius:14px;overflow:hidden}}
.prow{{display:grid;grid-template-columns:56px 1fr auto auto;gap:12px;align-items:center;padding:11px 16px;border-top:1px solid var(--line)}}.prow:first-child{{border-top:none}}
.band{{font-size:11px;font-weight:700;text-align:center;padding:3px 0;border-radius:6px;letter-spacing:.02em}}.bd-crit{{color:#fff;background:var(--crit)}}.bd-serious{{color:#fff;background:var(--serious)}}.bd-neutral{{color:var(--ink2);background:var(--surface2);border:1px solid var(--line)}}
.pmain{{min-width:0}}.pname{{display:block;font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}.preason{{font-size:11.5px;color:var(--muted)}}
.pval{{font-size:13px;font-variant-numeric:tabular-nums;color:var(--ink2);white-space:nowrap}}
.pdue{{font-size:11px;white-space:nowrap;text-align:right}}.od{{color:var(--crit);font-weight:650}}.od-none{{color:var(--muted)}}.team{{margin-left:6px;background:var(--surface2);border:1px solid var(--line);border-radius:5px;padding:1px 6px;color:var(--muted);font-size:10.5px}}
footer{{color:var(--muted);font-size:11.5px;margin-top:22px;text-align:center}}
</style></head><body><div class="wrap">
<header><div><h1>My Day</h1><div class="sub">{esc(owner)} · your work only, ranked to drive the pipeline toward targets</div></div><div class="sub">generated {esc(gen)}</div></header>
<section class="kpis">
  <div class="kpi"><div class="n">{d.get("todo_count",len(todos))}</div><div class="l">My to-dos</div></div>
  <div class="kpi"><div class="n">{due_soon}</div><div class="l">Due ≤ tomorrow</div></div>
  <div class="kpi"><div class="n">{len(pipe)}</div><div class="l">Pipeline shown</div></div>
  <div class="kpi"><div class="n">{touches}</div><div class="l">Touches on to-dos</div></div>
</section>
<div class="sect">To-dos · ranked by urgency</div>
{''.join(todo_cards)}
<div class="sect">Pipeline I drive · top {len(pipe)} of {d.get('pipeline_total',0)} by priority band</div>
<ul class="plist">{''.join(pipe_rows)}</ul>
<footer>Owner-scoped to {esc(owner)} (LCC override wins over Salesforce owner) · pipeline ordered by band → overdue → value · teammate-owned work is hidden · lcc_my_day / v_priority_queue_enriched</footer>
</div></body></html>'''
open('/tmp/My_Day_Scott_Briggs.html','w').write(H)
print("wrote",len(H),"bytes;",len(todos),"todos;",len(pipe),"pipeline")
