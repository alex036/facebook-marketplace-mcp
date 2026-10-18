import { renderReport } from './report-format.js';

let state, selectedId = null, selectedStamp = '', drafts = new Map(), reviewDrafts = new Map(), loading = false;
const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money = cents => cents == null ? 'Unknown' : new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',currencyDisplay:'narrowSymbol',maximumFractionDigits:cents%100?2:0}).format(cents/100);
const date = value => value ? new Date(value).toLocaleString('en-CA',{timeZone:'America/Toronto',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : 'Not yet';
const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const amount = cents => cents == null ? '' : String(cents/100);
function notice(text, error=false) { $('notice').textContent=text; $('notice').classList.toggle('error',error); }
async function api(url, body) {
  const response=await fetch(url,body === undefined ? {cache:'no-store'} : {method:'POST',headers:{'Content-Type':'application/json','X-Tracker-Token':state.token},body:JSON.stringify(body)});
  const result=await response.json(); if(!response.ok) throw new Error(result.error || 'Request failed'); return result;
}
function selected() { return state.cars.find(car=>car.id===selectedId); }
function stamp(car) { return car ? `${car.last_detail_at}/${car.crm_revision}/${car.review.revision}/${car.detail_error}` : ''; }
async function load() {
  if(loading) return; loading=true;
  try {
    state=await api('/api/state'); renderList();
    const current=selected();
    if(current && !drafts.has(current.id) && !reviewDrafts.has(current.id) && selectedStamp!==stamp(current)) await renderDetail(current);
    const last=state.scans[0];
    $('scan-button').disabled=last?.status==='running';
    notice(last ? `${last.status==='running'?'Scanning now':`Last scan ${last.status}`} · ${date(last.started_at)} · ${last.summary?.refreshed??0} ads refreshed${last.summary?.errors?.length?` · ${last.summary.errors.length} refresh errors`:''}${last.summary?.warnings?.length?` · coverage limited (see report)`:''} · Scheduled: 8 a.m. / 6 p.m.; report 6:15 p.m. Toronto` : 'No scan yet. Start a scan to discover donor candidates.');
  } catch(error) { notice(error.message,true); } finally { loading=false; }
}
function renderList() {
  const scope=$('scope').value, query=$('search').value.toLowerCase().trim(), sort=$('sort').value;
  const candidates=state.cars.filter(car=>car.assessment.eligible && !['Bought','Pass'].includes(car.crm_status) && car.availability!=='sold');
  const inquiries=state.cars.filter(car=>!['New','Pass'].includes(car.crm_status));
  const due=state.cars.filter(car=>car.follow_up && car.follow_up<=today() && !['Bought','Pass'].includes(car.crm_status));
  const cutoff=Date.now()-86400000;
  $('metrics').innerHTML=[['Donor candidates',candidates.length],['Found in last 24h',candidates.filter(car=>Date.parse(car.first_seen_at)>=cutoff).length],['Your inquiries',inquiries.length],['Follow-ups due',due.length]].map(([label,count])=>`<div class="metric"><strong>${count}</strong><span>${label}</span></div>`).join('');
  let cars=state.cars.filter(car=>scope==='shortlist'?candidates.includes(car):scope==='negotiation'?car.assessment.negotiation_watch && !['Bought','Pass'].includes(car.crm_status) && car.availability!=='sold':scope==='inquiries'?inquiries.includes(car):scope==='followups'?due.includes(car):scope==='passed'?car.crm_status==='Pass'||!car.assessment.eligible:true)
    .filter(car=>`${car.title} ${car.location} ${car.seller} ${car.crm_status}`.toLowerCase().includes(query));
  cars.sort((a,b)=>sort==='price'?(a.price_cents??Infinity)-(b.price_cents??Infinity):sort==='newest'?b.first_seen_at.localeCompare(a.first_seen_at):sort==='oldest'?(b.assessment.age_days??-1)-(a.assessment.age_days??-1):b.assessment.score-a.assessment.score||(b.assessment.age_days??-1)-(a.assessment.age_days??-1));
  $('count').textContent=`${cars.length} ${cars.length===1?'car':'cars'} · listing age is from Facebook when available`;
  $('cars').innerHTML=cars.length?cars.map(car=>{
    const rating=car.assessment, age=rating.age_days==null?`Age unknown · tracked ${rating.tracked_days}d`:`${rating.age_days}d listed`;
    const drop=state.drops?.find(item=>item.car_id===car.id && item.price_cents===car.price_cents);
    const photo=/^https:\/\//.test(car.image_url)?`<img class="photo" loading="lazy" src="${escape(car.image_url)}" alt="${escape(car.title)}">`:'<span class="photo no-photo">No photo</span>';
    return `<button class="car ${car.id===selectedId?'selected':''}" data-car="${car.id}" aria-label="${escape(car.title)}, ${escape(money(car.price_cents))}, ${escape(age)}">${photo}<span><span class="car-title">${escape(car.title)}</span><span class="car-place">${escape(car.location)}</span><span class="badge ${rating.label==='Worth contacting'?'good':''}">${escape(rating.label)}</span>${rating.newly_listed?'<span class="badge">Newly listed</span>':''}<span class="badge ${rating.age_days>=14?'warn':''}">${escape(age)}</span>${drop?`<span class="badge good">↓ ${escape(money(drop.previous_price-drop.price_cents))} today</span>`:''}${car.crm_status!=='New'?`<span class="badge">${escape(car.crm_status)}</span>`:''}${car.detail_error?'<span class="badge warn">Refresh failed</span>':''}${car.availability!=='available'?`<span class="badge warn">${escape(car.availability)}</span>`:''}<span class="car-small">${escape(rating.summary.join('; '))}</span></span><span class="car-price">${escape(money(car.price_cents))}</span></button>`;
  }).join(''):'<div class="empty-list">No cars in this view. Try another view or search.</div>';
}
function scoreText(a) { return a.coverage===100 ? `${a.score}/100` : `${a.score}–${a.score_max}/100 provisional`; }
function scorecard(car) {
  const a=car.assessment, review=car.review, draft=reviewDrafts.get(car.id)??{pickup:amount(review.pickup_cents),ratings:structuredClone(review.ratings),revision:review.revision,request_id:null};
  return `<section class="scorecard" aria-label="Donor opportunity scorecard"><div class="score-heading"><strong>${escape(scoreText(a))}</strong><span class="badge">${escape(a.confidence)} confidence · ${a.coverage}% assessed</span></div><meter min="0" max="100" value="${a.score}" aria-label="${a.score} supported points out of 100">${a.score}/100</meter><p class="muted">Internal breakdown based on the ad and any saved review. Unfilled categories stay blank.</p><p><span class="badge">${escape(a.vehicle_kind)}</span><span class="badge warn">${escape(a.purchase_readiness)}</span></p><p class="muted">Asking + pickup estimate: <strong>${escape(money(a.all_in_cents))}</strong>. Cost screen only; parts recovery, dismantling and disposal costs are not forecast.</p><details><summary>Category breakdown</summary><table class="score-table"><thead><tr><th scope="col">Category</th><th scope="col">Points</th><th scope="col">Evidence</th></tr></thead><tbody>${a.categories.map(category=>`<tr><th scope="row">${escape(category.label)}</th><td>${category.score==null?'Unknown':category.score+' / '+category.max}</td><td>${escape(category.evidence)}<small>${escape(category.source)}</small></td></tr>`).join('')}</tbody></table></details><details><summary>Review or adjust scorecard</summary><p class="muted">Optional: adjust a category if you learn something new.</p><form id="review-form"><label>Estimated pickup / towing cost (C$)<input id="review-pickup" type="number" min="0" max="1000000" step="0.01" placeholder="Unknown — enter 0 only if confirmed free" value="${escape(draft.pickup)}"></label>${a.categories.map(category=>{const value=draft.ratings[category.id];return `<fieldset class="review-row"><legend>${escape(category.label)} / ${category.max}</legend><label>Assessment<select id="review-score-${category.id}"><option value="auto" ${!value?'selected':''}>Use listing evidence</option><option value="unknown" ${value?.score===null?'selected':''}>Unknown / needs checking</option>${Array.from({length:category.max+1},(_,score)=>`<option value="${score}" ${value?.score===score?'selected':''}>${score} / ${category.max}</option>`).join('')}</select></label><label>Supporting evidence<input id="review-evidence-${category.id}" maxlength="500" value="${escape(value?.evidence??draft.evidence?.[category.id]??'')}" placeholder="What you confirmed, and how"></label></fieldset>`;}).join('')}<div class="form-actions"><button type="submit">Save scorecard</button><span id="review-message" class="saved-message" role="status">${reviewDrafts.has(car.id)?'Unsaved changes':''}</span></div></form></details><details><summary>Scorecard review history</summary><div id="review-history" class="muted">Loading…</div></details><p id="sources" class="muted"></p></section>`;
}
function bindScorecard(car) {
  const initial=reviewDrafts.get(car.id)??{revision:car.review.revision,request_id:null};
  const read=()=>{
    const ratings={}, evidence={};
    for(const category of car.assessment.categories) {
      const value=$(`review-score-${category.id}`).value;
      evidence[category.id]=$(`review-evidence-${category.id}`).value;
      if(value!=='auto') ratings[category.id]={score:value==='unknown'?null:Number(value),evidence:$(`review-evidence-${category.id}`).value.trim()};
    }
    return {pickup:$('review-pickup').value,ratings,evidence,revision:initial.revision,request_id:null};
  };
  $('review-form').addEventListener('input',()=>{reviewDrafts.set(car.id,read());$('review-message').textContent='Unsaved changes';});
  $('review-form').addEventListener('submit',async event=>{
    event.preventDefault();const current=reviewDrafts.get(car.id)??read();current.request_id??=crypto.randomUUID();reviewDrafts.set(car.id,current);
    const button=event.submitter;button.disabled=true;
    try {
      await api(`/api/cars/${car.id}/scorecard`,{ratings:current.ratings,pickup_cents:current.pickup===''?null:Math.round(Number(current.pickup)*100),revision:current.revision,request_id:current.request_id});
      reviewDrafts.delete(car.id);selectedStamp='';await load();if(selectedId===car.id)$('review-message').textContent='Scorecard saved';
    }catch(error){if(selectedId===car.id)$('review-message').textContent=error.message;}finally{button.disabled=false;}
  });
}
async function renderDetail(car) {
  selectedId=car.id; selectedStamp=stamp(car);
  const a=car.assessment, draft=drafts.get(car.id)??{status:car.crm_status,offer:amount(car.offer_cents),counter:amount(car.counter_cents),followup:car.follow_up??'',note:'',revision:car.crm_revision,request_id:null};
  $('detail').innerHTML=`<div class="detail-top"><div><h2>${escape(car.title)}</h2><span class="muted">${escape(car.location)}${car.seller?' · '+escape(car.seller):''}</span></div><div class="price-big">${escape(money(car.price_cents))}</div></div><div class="facts"><div class="fact"><span>Age of listing</span><strong>${a.age_days==null?'Unknown':a.age_days+' days'}</strong></div><div class="fact"><span>First found here</span><strong>${escape(date(car.first_seen_at))}</strong></div><div class="fact"><span>First recorded asking</span><strong>${escape(money(car.first_price_cents))}</strong></div><div class="fact"><span>Distance from Cambridge</span><strong>${a.distance_km==null?'Unverified':a.distance_km+' km straight-line'}</strong></div></div><a class="link-button secondary" href="https://www.facebook.com/marketplace/item/${car.id}/" target="_blank" rel="noopener noreferrer">Open on Facebook ↗</a><h3>${escape(a.label)}</h3><p class="assessment-summary">${escape(a.summary.join('; '))}</p><details><summary>Score breakdown / optional review</summary>${scorecard(car)}</details><h3>Inquiry log</h3><form id="crm-form"><div class="form-grid"><label>Status<select id="crm-status">${state.statuses.map(status=>`<option ${status===draft.status?'selected':''}>${escape(status)}</option>`).join('')}</select></label><label>Follow up on<input type="date" id="crm-followup" value="${escape(draft.followup)}"></label><label>My offer (C$)<input type="number" id="crm-offer" min="0" max="1000000" step="0.01" value="${escape(draft.offer)}" placeholder="Not offered yet"></label><label>Seller counteroffer (C$)<input type="number" id="crm-counter" min="0" max="1000000" step="0.01" value="${escape(draft.counter)}" placeholder="No counteroffer"></label><label class="span-2">Add a note<textarea id="crm-note" maxlength="10000" placeholder="Reached out, their response, inspection notes…">${escape(draft.note)}</textarea></label></div><div class="form-actions"><button type="submit">Save inquiry</button><span id="save-message" class="saved-message" role="status">${drafts.has(car.id)?'Unsaved changes':''}</span></div></form><div id="activity"></div><details open><summary>Asking-price history</summary><div id="price-history" class="muted">Loading…</div></details><details><summary>Seller’s description</summary><p class="description">${escape(car.description||'Description unavailable.')}</p></details><p class="muted">Last verified ${escape(date(car.last_detail_at))}. Availability: ${escape(car.availability)}${car.detail_error?' · latest refresh failed':''}. Final transaction price is not inferred from asking prices or sold status.</p>`;
  bindScorecard(car);
  const readDraft=()=>({status:$('crm-status').value,offer:$('crm-offer').value,counter:$('crm-counter').value,followup:$('crm-followup').value,note:$('crm-note').value,revision:draft.revision,request_id:null});
  $('crm-form').addEventListener('input',()=>{drafts.set(car.id,readDraft());$('save-message').textContent='Unsaved changes';});
  $('crm-form').addEventListener('submit',async event=>{
    event.preventDefault(); const current=drafts.get(car.id)??readDraft(); current.request_id??=crypto.randomUUID(); drafts.set(car.id,current);
    const button=event.submitter; button.disabled=true;
    try {
      await api(`/api/cars/${car.id}`,{status:current.status,offer_cents:current.offer===''?null:Math.round(Number(current.offer)*100),counter_cents:current.counter===''?null:Math.round(Number(current.counter)*100),follow_up:current.followup||null,note:current.note,revision:current.revision,request_id:current.request_id});
      drafts.delete(car.id); selectedStamp=''; await load(); if(selectedId===car.id)$('save-message').textContent='Saved to inquiry log';
    } catch(error) { if(selectedId===car.id)$('save-message').textContent=error.message; } finally { button.disabled=false; }
  });
  renderList();
  try {
    const history=await api(`/api/cars/${car.id}`); if(selectedId!==car.id)return;
    $('activity').innerHTML=history.activity.length?'<ul class="history">'+history.activity.map(item=>`<li><time>${escape(date(item.at))}</time><strong>${escape(item.changes.status)}</strong> · offer ${escape(money(item.changes.offer_cents))}${item.changes.counter_cents!=null?' · counter '+escape(money(item.changes.counter_cents)):''}${item.changes.follow_up?' · follow up '+escape(item.changes.follow_up):''}${item.note?'<p>'+escape(item.note)+'</p>':''}</li>`).join('')+'</ul>':'<p class="muted">No inquiry activity yet. Nothing is sent to the seller from this tracker.</p>';
    $('sources').textContent=history.searches?.length ? 'Found through: '+history.searches.map(item=>item.query).join(', ') : 'Search source not recorded for earlier observations.';
    $('review-history').innerHTML=history.reviews?.length ? '<ul class="history">'+history.reviews.map(item=>`<li><time>${escape(date(item.at))}</time>Review ${item.revision} · pickup estimate ${escape(money(item.data.pickup_cents))}${Object.entries(item.data.ratings).map(([id,value])=>`<p>${escape(a.categories.find(category=>category.id===id)?.label??id)}: ${value.score==null?'Unknown':value.score} — ${escape(value.evidence)}</p>`).join('')}</li>`).join('')+'</ul>' : '<p class="muted">No manual scorecard reviews yet.</p>';
    const prices=history.observations.filter((row,index,rows)=>index===rows.length-1 || row.price_cents!==rows[index+1].price_cents || row.availability!==rows[index+1].availability);
    $('price-history').innerHTML='<ul class="history">'+prices.map(row=>`<li class="timeline-price"><time>${escape(date(row.observed_at))}</time><span>${escape(money(row.price_cents))} · ${escape(row.availability)}</span></li>`).join('')+'</ul>';
  }catch(error){if(selectedId===car.id)$('price-history').textContent=error.message;}
}
$('cars').addEventListener('click',event=>{const button=event.target.closest('[data-car]');if(button)renderDetail(state.cars.find(car=>car.id===button.dataset.car));});
for(const id of ['scope','sort','search'])$(id).addEventListener(id==='search'?'input':'change',()=>{if(state)renderList();});
$('scan-button').addEventListener('click',async()=>{try{$('scan-button').disabled=true;await api('/api/scan',{});await load();}catch(error){notice(error.message,true);$('scan-button').disabled=false;}});
$('report-button').addEventListener('click',async()=>{try{const result=await api('/api/report');$('report-text').innerHTML=renderReport(result.markdown);$('report-dialog').showModal();$('report-dialog').scrollTop=0;}catch(error){notice(error.message,true);}});
$('close-report').addEventListener('click',()=>$('report-dialog').close());
window.addEventListener('beforeunload',event=>{if(drafts.size || reviewDrafts.size){event.preventDefault();event.returnValue='';}});
load(); setInterval(load,15000);
