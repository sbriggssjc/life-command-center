import { summarizeCapture, validatePrimaryDraft } from './asc-review-presentation.js';

let current = null;
const el = (id) => document.getElementById(id);
const tri = (value) => value === true ? 'true' : value === false ? 'false' : 'null';
const parseTri = (value) => value === 'true' ? true : value === 'false' ? false : null;
const formattedDate = (value) => value ? new Date(value).toLocaleString() : 'Not yet';
function message(text, cls = 'notice') { el('message').className = `bar ${cls}`; el('message').textContent = text; }
function fact(label, value) { const box=document.createElement('div');box.className='fact';const name=document.createElement('span');name.textContent=label;box.append(name,document.createTextNode(value ?? '—'));return box; }
function setRadio(name, value) { const input=document.querySelector(`input[name="${name}"][value="${String(value)}"]`);if(input)input.checked=true; }
function fillReview(review) {
  if (!review?.primary_reviewed_at) return;
  setRadio('clinical', review.clinical_verified); el('property-form').value=review.property_form||'';
  el('landlord-owner').value=review.landlord_owner||'';el('addressable').value=tri(review.landlord_addressable);
  el('economics').value=tri(review.economics_bounded);el('confidence').value=review.reviewer_confidence||'medium';
  el('second-required').checked=review.second_review_required===true;el('ownership-evidence').value=JSON.stringify(review.ownership_evidence||[],null,2);
  el('citations').value=JSON.stringify(review.evidence_citations||[],null,2);el('notes').value=review.notes||'';
  document.querySelectorAll('.mins').forEach((input)=>{input.value=review.research_minutes?.[input.dataset.key]??0;});
}
function appendEvidenceCard(summary) {
  const card=document.createElement('article');card.className='evidence-card';
  const head=document.createElement('div');head.className='evidence-card-head';const heading=document.createElement('h4');heading.textContent=summary.title;head.append(heading);
  if(summary.sourceUrl){const link=document.createElement('a');link.className='source-link';link.href=summary.sourceUrl;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Open source page ↗';head.append(link);}
  card.append(head);const metadata=document.createElement('div');metadata.className='status-row';
  for(const value of [summary.capturedAt&&`Captured ${formattedDate(summary.capturedAt)}`,summary.identity.mode&&`Identity: ${summary.identity.mode}`,summary.identity.secondReviewRequired&&'Second review required'].filter(Boolean)){const badge=document.createElement('span');badge.className=`badge${String(value).includes('required')?' required':''}`;badge.textContent=value;metadata.append(badge);}
  card.append(metadata,fact('Source address',summary.address));if(summary.identity.basis)card.append(fact('Identity corroboration',summary.identity.basis));
  if(summary.fields.length){const grid=document.createElement('div');grid.className='evidence-grid';for(const item of summary.fields)grid.append(fact(item.label,item.value));card.append(grid);}else{const empty=document.createElement('p');empty.className='notice';empty.textContent='No additional structured commercial fields were captured.';card.append(empty);}
  el('evidence-summary').append(card);
}
function renderEvidence() {
  const target=el('evidence-summary');target.replaceChildren();
  if(current.captures?.length){current.captures.forEach((capture,index)=>appendEvidenceCard(summarizeCapture(capture,index)));el('evidence').textContent=JSON.stringify(current.captures,null,2);return;}
  const box=document.createElement('div');box.className='callout warning';const disposition=current.review?.final_disposition||'No licensed-source capture';const strong=document.createElement('strong');strong.textContent='Governed source exception: ';box.append(strong,document.createTextNode(`${disposition}. This is a source exception, not evidence for a commercial property conclusion.`));target.append(box);
  const cms=document.createElement('div');cms.className='evidence-card';const heading=document.createElement('h4');heading.textContent='Frozen CMS evidence';cms.append(heading);Object.entries(current.cms_evidence||{}).slice(0,14).forEach(([key,value])=>cms.append(fact(key.replaceAll('_',' '),typeof value==='object'?JSON.stringify(value):value)));target.append(cms);
  el('evidence').textContent=JSON.stringify({source_exception:disposition,cms_evidence:current.cms_evidence},null,2);
}
function renderReviewContext() {
  const review=current.review||{};const context=el('review-context');context.replaceChildren();const title=document.createElement('strong');title.textContent=review.primary_reviewed_at?'Existing review loaded':'Reviewer checkpoint';const text=document.createElement('p');text.className='help';text.textContent=review.primary_reviewed_at?`Primary saved ${formattedDate(review.primary_reviewed_at)}. Saving changes resets any completed second review.`:'Your signed-in identity is visible in the sticky blue header and is recorded automatically when you save.';
  const statuses=document.createElement('div');statuses.className='status-row';for(const value of [`Primary: ${review.primary_reviewed_at?'complete':'not started'}`,`Second review: ${review.second_review_required?(review.second_reviewed_at?'complete':'required'):'not required'}`,review.final_disposition&&`Disposition: ${review.final_disposition}`].filter(Boolean)){const badge=document.createElement('span');badge.className=`badge${String(value).includes('required')?' required':''}`;badge.textContent=value;statuses.append(badge);}context.append(title,text,statuses);
}
function primaryDraft() {
  const clinical=document.querySelector('input[name="clinical"]:checked');
  return {clinicalVerified:clinical?clinical.value==='true':null,propertyForm:el('property-form').value,researchMinutes:Object.fromEntries([...document.querySelectorAll('.mins')].map((input)=>[input.dataset.key,input.value])),ownershipEvidence:el('ownership-evidence').value,citations:el('citations').value};
}
function updateValidation() {
  const blockers=validatePrimaryDraft(primaryDraft());const summary=el('validation-summary');summary.replaceChildren();
  if(!blockers.length){summary.className='validation ready';summary.textContent='Ready to save. Review each answer and citation before submitting.';el('save-primary').disabled=false;return blockers;}
  summary.className='validation';const intro=document.createElement('strong');intro.textContent='Complete these items before saving:';const list=document.createElement('ul');for(const blocker of blockers){const item=document.createElement('li');item.textContent=blocker;list.append(item);}summary.append(intro,list);el('save-primary').disabled=true;return blockers;
}
async function load(ordinal) {
  message('Loading governed review record…');const suffix=ordinal?`?ordinal=${encodeURIComponent(ordinal)}`:'';const response=await LCC_AUTH.apiFetch(`/api/asc-research-review${suffix}`);const data=await response.json();
  if(!response.ok)throw new Error(data.detail||data.error||'Review load failed');current=data.target;if(!current){message('No ASC review run was found.','error');return;}el('ordinal').value=current.sample_ordinal;
  const remaining=Math.max(0,data.progress.total-data.progress.primary_done);el('progress').textContent=`Primary ${data.progress.primary_done}/${data.progress.total} (${remaining} remaining) · second ${data.progress.second_done}/${data.progress.second_required}`;
  const identity=current.cms_identity||{};el('title').textContent=`${current.sample_ordinal}/50 · ${identity.facility_name||identity.ccn||'Frozen candidate'}`;el('identity').replaceChildren(fact('Frozen CMS address',[identity.address,identity.city,identity.state,identity.zip].filter(Boolean).join(', ')),fact('Candidate fingerprint',current.candidate_fingerprint),fact('Sampling cell',current.sampling_cell),fact('Collection status',current.status));
  renderEvidence();el('primary').reset();document.querySelectorAll('.mins').forEach((input)=>{input.value=0;});el('ownership-evidence').value='[]';el('citations').value='[]';fillReview(current.review);
  if(current.collection_second_review_required){el('second-required').checked=true;el('second-required').disabled=true;}else el('second-required').disabled=false;
  const needsSecond=current.review?.primary_reviewed_at&&current.review?.second_review_required;el('second').hidden=!needsSecond;if(current.review?.second_reviewed_at){el('verdict').value=current.review.second_review_verdict;el('second-notes').value=current.review.second_review_notes||'';}
  renderReviewContext();updateValidation();message(current.review?.primary_reviewed_at?'Existing primary scorecard loaded. Saving it again resets any prior second review.':'Complete the primary scorecard from cited evidence only.');
}
async function post(body){const response=await LCC_AUTH.apiFetch('/api/asc-research-review',{method:'POST',body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw new Error(data.detail||data.error||'Review save failed');return data;}
el('primary').addEventListener('input',updateValidation);
el('primary').addEventListener('submit',async(event)=>{event.preventDefault();try{const blockers=updateValidation();if(blockers.length)throw new Error(blockers[0]);const json=(id)=>JSON.parse(el(id).value||'[]');const draft=primaryDraft();const minutes=Object.fromEntries(Object.entries(draft.researchMinutes).map(([key,value])=>[key,Number(value)]));await post({run_id:current.run_id||current.review?.run_id,candidate_fingerprint:current.candidate_fingerprint,mode:'primary',clinical_verified:draft.clinicalVerified,property_form:draft.propertyForm,landlord_owner:el('landlord-owner').value,ownership_evidence:json('ownership-evidence'),landlord_addressable:parseTri(el('addressable').value),economics_bounded:parseTri(el('economics').value),reviewer_confidence:el('confidence').value,second_review_required:el('second-required').checked,research_minutes:minutes,evidence_citations:json('citations'),notes:el('notes').value});message('Primary scorecard saved.','success');await load(current.sample_ordinal);}catch(error){message(error.message,'error');}});
el('second').addEventListener('submit',async(event)=>{event.preventDefault();try{await post({run_id:current.run_id||current.review?.run_id,candidate_fingerprint:current.candidate_fingerprint,mode:'second',verdict:el('verdict').value,notes:el('second-notes').value});message('Independent second review saved.','success');await load(current.sample_ordinal);}catch(error){message(error.message,'error');}});
el('prev').onclick=()=>load(Math.max(1,Number(el('ordinal').value)-1)).catch((error)=>message(error.message,'error'));el('next').onclick=()=>load(Math.min(50,Number(el('ordinal').value)+1)).catch((error)=>message(error.message,'error'));el('go').onclick=()=>load(Number(el('ordinal').value)).catch((error)=>message(error.message,'error'));
(async()=>{try{await LCC_AUTH.init();if(!LCC_AUTH.isAuthenticated&&!LCC_AUTH.isDevMode){LCC_AUTH.showLoginModal();message('Sign in with an operator account to open the private review ledger.');return;}await load();}catch(error){message(error.message,'error');}})();
