let current = null;
const el = (id) => document.getElementById(id);
const tri = (value) => value === true ? 'true' : value === false ? 'false' : 'null';
const parseTri = (value) => value === 'true' ? true : value === 'false' ? false : null;
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
async function load(ordinal) {
  message('Loading governed review record…');
  const suffix=ordinal?`?ordinal=${encodeURIComponent(ordinal)}`:'';const response=await LCC_AUTH.apiFetch(`/api/asc-research-review${suffix}`);const data=await response.json();
  if(!response.ok)throw new Error(data.detail||data.error||'Review load failed');current=data.target;
  if(!current){message('No ASC review run was found.','error');return;}el('ordinal').value=current.sample_ordinal;
  el('progress').textContent=`Primary ${data.progress.primary_done}/${data.progress.total} · second ${data.progress.second_done}/${data.progress.second_required}`;
  const identity=current.cms_identity||{};el('title').textContent=`${current.sample_ordinal}/50 · ${identity.facility_name||identity.ccn||'Frozen candidate'}`;
  const facts=el('identity');facts.replaceChildren(fact('Frozen CMS address',[identity.address,identity.city,identity.state,identity.zip].filter(Boolean).join(', ')),fact('Candidate fingerprint',current.candidate_fingerprint),fact('Sampling cell',current.sampling_cell),fact('Collection status',current.status));
  el('evidence').textContent=current.captures?.length?JSON.stringify(current.captures,null,2):JSON.stringify({source_exception:current.review?.final_disposition||'no licensed-source capture',cms_evidence:current.cms_evidence},null,2);
  el('primary').reset();document.querySelectorAll('.mins').forEach((input)=>{input.value=0;});el('ownership-evidence').value='[]';el('citations').value='[]';fillReview(current.review);
  if(current.collection_second_review_required){el('second-required').checked=true;el('second-required').disabled=true;}else{el('second-required').disabled=false;}
  const needsSecond=current.review?.primary_reviewed_at&&current.review?.second_review_required;el('second').hidden=!needsSecond;
  if(current.review?.second_reviewed_at){el('verdict').value=current.review.second_review_verdict;el('second-notes').value=current.review.second_review_notes||'';}
  message(current.review?.primary_reviewed_at?'Existing primary scorecard loaded. Saving it again resets any prior second review.':'Complete the primary scorecard from cited evidence only.');
}
async function post(body){const response=await LCC_AUTH.apiFetch('/api/asc-research-review',{method:'POST',body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw new Error(data.detail||data.error||'Review save failed');return data;}
el('primary').addEventListener('submit',async(event)=>{event.preventDefault();try{const json=(id)=>{const value=JSON.parse(el(id).value||'[]');if(!Array.isArray(value))throw new Error(`${id} must be a JSON array`);return value;};const clinical=document.querySelector('input[name="clinical"]:checked');if(!clinical)throw new Error('Clinical identity decision is required');const minutes=Object.fromEntries([...document.querySelectorAll('.mins')].map((input)=>[input.dataset.key,Number(input.value)]));await post({run_id:current.run_id||current.review?.run_id,candidate_fingerprint:current.candidate_fingerprint,mode:'primary',clinical_verified:clinical.value==='true',property_form:el('property-form').value,landlord_owner:el('landlord-owner').value,ownership_evidence:json('ownership-evidence'),landlord_addressable:parseTri(el('addressable').value),economics_bounded:parseTri(el('economics').value),reviewer_confidence:el('confidence').value,second_review_required:el('second-required').checked,research_minutes:minutes,evidence_citations:json('citations'),notes:el('notes').value});message('Primary scorecard saved.','success');await load(current.sample_ordinal);}catch(error){message(error.message,'error');}});
el('second').addEventListener('submit',async(event)=>{event.preventDefault();try{await post({run_id:current.run_id||current.review?.run_id,candidate_fingerprint:current.candidate_fingerprint,mode:'second',verdict:el('verdict').value,notes:el('second-notes').value});message('Independent second review saved.','success');await load(current.sample_ordinal);}catch(error){message(error.message,'error');}});
el('prev').onclick=()=>load(Math.max(1,Number(el('ordinal').value)-1)).catch((e)=>message(e.message,'error'));el('next').onclick=()=>load(Math.min(50,Number(el('ordinal').value)+1)).catch((e)=>message(e.message,'error'));el('go').onclick=()=>load(Number(el('ordinal').value)).catch((e)=>message(e.message,'error'));
(async()=>{try{await LCC_AUTH.init();if(!LCC_AUTH.isAuthenticated&&!LCC_AUTH.isDevMode){LCC_AUTH.showLoginModal();message('Sign in with an operator account to open the private review ledger.');return;}await load();}catch(error){message(error.message,'error');}})();
