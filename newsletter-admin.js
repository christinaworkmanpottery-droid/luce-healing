(() => {
 const root=document.querySelector('[data-newsletter-admin]');if(!root)return;
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const password=()=>typeof adminPassword!=='undefined'?adminPassword:typeof adminPw!=='undefined'?adminPw:'';
 const api=async(path,method='GET',body)=>{const r=await fetch('/api/admin/'+path+(path.includes('?')?'&':'?')+'password='+encodeURIComponent(password()),{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw Error(data.error||'Unable to complete this request.');return data;};
 const date=value=>value?new Date(value).toLocaleString():'—';
 const stateLabel=value=>({legacy_unverified:'Legacy — needs confirmation',verified:'Active / verified',pending:'Pending confirmation',unsubscribed:'Unsubscribed',bounced:'Bounced',invalid:'Invalid',accepted:'Accepted by provider',unknown:'Uncertain — needs review'}[value]||value);
 let selected=null,campaigns=[],subscribers=[],page=0,busy=false;
 root.classList.add('luce-newsletter-admin');
 root.innerHTML=`<div class="nl-card"><h3>Luce Healing newsletters</h3><p id="nl-config" class="nl-status">Open the Newsletter tab to load your settings.</p><p class="nl-muted">Only verified subscribers receive emails in their chosen categories. Historical records are preserved and are not assumed to be verified.</p><button type="button" id="nl-refresh">Refresh status</button><p id="nl-feedback" role="status" aria-live="polite"></p></div>
 <div class="nl-card"><h3 id="nl-editor-title">Create a newsletter</h3><p class="nl-muted">Write a standalone newsletter here. To send a blog article, choose the blog audience and an article. Saving changes to a scheduled email returns it to draft until you schedule it again.</p>
 <label for="nl-subject">Subject / title</label><input id="nl-subject" maxlength="180">
 <label for="nl-segment">Who should receive it?</label><select id="nl-segment"><option value="newsletter">Verified newsletter / update subscribers</option><option value="blog">Verified blog / astrology subscribers</option></select>
 <div id="nl-blog-wrap" hidden><label for="nl-blog">Published article (optional)</label><select id="nl-blog"><option value="">Write a standalone blog update</option></select></div>
 <label for="nl-content">Newsletter content</label><textarea id="nl-content" rows="10" placeholder="Write your newsletter in plain text. Blank lines create paragraphs; no HTML is needed."></textarea>
 <label for="nl-schedule">Schedule date and time</label><input id="nl-schedule" type="datetime-local"><p id="nl-timezone" class="nl-muted"></p>
 <div class="nl-actions"><button id="nl-save">Save draft</button><button id="nl-preview">Preview</button><button id="nl-send">Send now</button><button id="nl-queue">Schedule</button><button id="nl-new">New newsletter</button></div><iframe id="nl-preview-frame" title="Newsletter email preview" sandbox="" hidden></iframe></div>
 <div class="nl-card"><h3>Drafts, scheduled emails &amp; send history</h3><p class="nl-muted">Accepted means the email provider accepted the message, not proof of inbox delivery. Uncertain results are never automatically resent.</p><div id="nl-campaigns"></div></div>
 <div class="nl-card"><h3>Subscribers</h3><label for="nl-search">Find an email or name</label><input id="nl-search" type="search"><label for="nl-filter">Status</label><select id="nl-filter"><option value="">All records</option><option value="verified">Active / verified</option><option value="legacy_unverified">Legacy — needs confirmation</option><option value="pending">Pending confirmation</option><option value="unsubscribed">Unsubscribed</option><option value="bounced">Bounced</option><option value="invalid">Invalid</option></select><p id="nl-count" class="nl-muted"></p><div id="nl-subscribers"></div><div class="nl-actions"><button id="nl-prev">Previous</button><button id="nl-next">Next</button><button id="nl-export">Export preserved subscriber records</button></div></div>`;
 const el=id=>document.getElementById(id),message=text=>el('nl-feedback').textContent=text;
 el('nl-timezone').textContent='Time zone: '+Intl.DateTimeFormat().resolvedOptions().timeZone+'. Saved in UTC. Scheduling runs about every 30 seconds while the service is running, and catches up after downtime.';
 const perform=fn=>async()=>{if(busy)return;busy=true;try{await fn();}catch(e){message(e.message);}finally{busy=false;}};
 const data=()=>({subject:el('nl-subject').value.trim(),content:el('nl-content').value,segment:el('nl-segment').value,blog_post_id:el('nl-segment').value==='blog'?el('nl-blog').value||null:null,revision:selected?.revision});
 function clear(){selected=null;el('nl-editor-title').textContent='Create a newsletter';el('nl-subject').value='';el('nl-content').value='';el('nl-segment').value='newsletter';el('nl-blog').value='';el('nl-schedule').value='';el('nl-blog-wrap').hidden=true;el('nl-preview-frame').hidden=true;el('nl-content').disabled=false;}
 async function save(){selected=await api('newsletter/campaigns'+(selected?'/'+selected.id:''),selected?'PUT':'POST',data());el('nl-editor-title').textContent='Edit newsletter draft';await loadCampaigns();return selected;}
 function subscribersView(){
  const search=el('nl-search').value.toLowerCase(),filter=el('nl-filter').value;
  const rows=subscribers.filter(s=>(!filter||s.status===filter)&&(!search||(s.email+' '+(s.name||'')).toLowerCase().includes(search)));
  const pages=Math.max(1,Math.ceil(rows.length/25));page=Math.min(page,pages-1);
  el('nl-count').textContent=`${rows.length} matching records · Page ${page+1} of ${pages}`;
  el('nl-prev').disabled=page===0;el('nl-next').disabled=page>=pages-1;
  el('nl-subscribers').innerHTML=rows.slice(page*25,(page+1)*25).map(s=>`<article class="nl-row"><strong>${escape(s.email)}</strong><p>${escape(s.name||'')} · ${escape(stateLabel(s.status))}</p><p class="nl-muted">Preferences: ${s.wants_newsletter?'Newsletters':''}${s.wants_newsletter&&s.wants_blog?' + ':''}${s.wants_blog?'Blog emails':''}${!s.wants_newsletter&&!s.wants_blog?'Not confirmed / none':''}<br>Signed up: ${date(s.subscribed_at)}<br>Verified: ${date(s.verified_at)} · Unsubscribed: ${date(s.unsubscribed_at)}<br>Last email: ${escape(stateLabel(s.last_delivery_status||'None recorded'))} · ${date(s.last_delivery_at)}</p>${s.status!=='unsubscribed'?`<button data-unsubscribe="${s.id}">Unsubscribe — keep record</button>`:''}</article>`).join('')||'<p>No matching subscribers.</p>';
 }
 async function loadCampaigns(){
  campaigns=await api('newsletter/campaigns');
  el('nl-campaigns').innerHTML=campaigns.map(c=>`<article class="nl-row"><strong>${escape(c.subject)}</strong><p>${escape(c.status)} · ${c.segment==='blog'?'Blog audience':'Newsletter audience'}${c.scheduled_at?' · '+date(c.scheduled_at):''}</p><p class="nl-muted">${Object.entries(c.delivery_counts||{}).map(([k,v])=>escape(stateLabel(k))+': '+v).join(' · ')||'No recipients attempted'}${c.error?'<br>'+escape(c.error):''}</p><div class="nl-actions">${['draft','scheduled','canceled'].includes(c.status)&&!c.delivery_key?`<button data-edit="${c.id}">Edit</button>`:''}${['draft','scheduled'].includes(c.status)?`<button data-cancel="${c.id}">Cancel send</button>`:''}${c.status==='interrupted'?`<button data-resume="${c.id}">Resume never-attempted recipients</button>`:''}<button data-results="${c.id}">Recipient results</button></div>${c.delivery_key?'<p class="nl-muted">Email prepared from a blog publishing choice. Edit the article in Blog to change it.</p>':''}<div id="nl-results-${c.id}"></div></article>`).join('')||'<p>No newsletter drafts yet.</p>';
 }
 async function load(){
  if(!password())return;
  const [config,rows,posts]=await Promise.all([api('newsletter/status'),api('newsletter/subscribers'),api('blog')]);
  el('nl-config').textContent=(config.deliveryMode==='test'?'CONTROLLED TEST: only '+config.testRecipient+' can receive email. Broad sends are locked. ':config.deliveryMode==='locked'?'Newsletter email is locked. ':'')+(config.turnstileConfigured?'Signup protection configured. ':'Turnstile keys still needed. ')+(config.senderConfigured?'Luce sender: '+config.sender+'. ':'Luce email sender must be configured. ')+(config.workerEnabled?'Scheduling enabled.':'Sending and scheduling are paused in this environment.');
  subscribers=rows;subscribersView();
  const chosen=el('nl-blog').value;el('nl-blog').innerHTML='<option value="">Write a standalone blog update</option>'+posts.filter(p=>p.published).map(p=>`<option value="${p.id}">${escape(p.title)}</option>`).join('');el('nl-blog').value=chosen;
  await loadCampaigns();
 }
 el('nl-refresh').onclick=perform(load);
 el('nl-save').onclick=perform(async()=>{await save();message('Draft saved. No emails sent.');});
 el('nl-new').onclick=()=>{if(selected||el('nl-content').value||el('nl-subject').value){if(!confirm('Start a new newsletter? Save your current changes first if you want to keep them.'))return;}clear();};
 el('nl-preview').onclick=perform(async()=>{const d=await api('newsletter/preview','POST',data());el('nl-preview-frame').srcdoc=d.html;el('nl-preview-frame').hidden=false;message('Preview only. No emails sent.');});
 el('nl-send').onclick=perform(async()=>{if(!confirm('Send this email now to verified subscribers in the selected audience?'))return;await save();selected=await api('newsletter/campaigns/'+selected.id+'/queue','POST',{revision:selected.revision});clear();await loadCampaigns();message('Queued for sending. Refresh status to see provider results.');});
 el('nl-queue').onclick=perform(async()=>{const input=el('nl-schedule').value;if(!input||!Number.isFinite(new Date(input).getTime())||new Date(input)<=new Date())throw Error('Choose a future date and time.');const at=new Date(input).toISOString();await save();selected=await api('newsletter/campaigns/'+selected.id+'/queue','POST',{revision:selected.revision,scheduled_at:at});clear();await loadCampaigns();message('Newsletter scheduled for '+date(at)+'.');});
 el('nl-segment').onchange=()=>{el('nl-blog-wrap').hidden=el('nl-segment').value!=='blog';el('nl-content').disabled=el('nl-segment').value==='blog'&&!!el('nl-blog').value;};
 el('nl-blog').onchange=()=>{el('nl-content').disabled=!!el('nl-blog').value;if(el('nl-blog').value&&!el('nl-subject').value)el('nl-subject').value='New from Luce Healing: '+el('nl-blog').selectedOptions[0].textContent;};
 for(const id of ['nl-search','nl-filter'])el(id).oninput=()=>{page=0;subscribersView();};
 el('nl-prev').onclick=()=>{page--;subscribersView();};el('nl-next').onclick=()=>{page++;subscribersView();};
 el('nl-export').onclick=perform(async()=>{const r=await fetch('/api/admin/newsletter/export?password='+encodeURIComponent(password()));if(!r.ok)throw Error('Unable to export subscribers.');const url=URL.createObjectURL(await r.blob());const a=document.createElement('a');a.href=url;a.download='luce-newsletter-subscribers.csv';a.click();URL.revokeObjectURL(url);});
 root.addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b)return;
  perform(async()=>{
   if(b.dataset.unsubscribe){if(!confirm('Unsubscribe this address from marketing emails? The record will be preserved.'))return;await api('newsletter/'+b.dataset.unsubscribe,'DELETE');subscribers=await api('newsletter/subscribers');subscribersView();message('Unsubscribed; record preserved.');}
   for(const kind of ['edit','cancel','resume','results'])if(b.dataset[kind]){
    const c=campaigns.find(x=>String(x.id)===b.dataset[kind]);if(!c)return;
    if(kind==='edit'){selected=c;el('nl-editor-title').textContent='Edit newsletter';el('nl-subject').value=c.subject;el('nl-content').value=c.content;el('nl-segment').value=c.segment;el('nl-blog').value=c.blog_post_id||'';el('nl-blog-wrap').hidden=c.segment!=='blog';el('nl-content').disabled=!!c.blog_post_id;el('nl-schedule').value=c.scheduled_at?new Date(new Date(c.scheduled_at)-new Date(c.scheduled_at).getTimezoneOffset()*60000).toISOString().slice(0,16):'';el('nl-editor-title').scrollIntoView({block:'center',behavior:'smooth'});}
    if(kind==='cancel'||kind==='resume'){if(!confirm(kind==='cancel'?'Cancel this send? The draft and history stay saved.':'Resume only recipients that were never attempted? Accepted or uncertain emails will not be resent.'))return;await api('newsletter/campaigns/'+c.id+'/'+kind,'POST',{revision:c.revision});await loadCampaigns();}
    if(kind==='results'){const rows=await api('newsletter/campaigns/'+c.id+'/deliveries');el('nl-results-'+c.id).innerHTML=rows.map(r=>`<p class="nl-muted">${escape(r.email)} — ${escape(stateLabel(r.status))}<br>${escape(r.detail||'Not attempted yet')}</p>`).join('')||'<p>No recipient attempts recorded.</p>';}
   }
  })();
 });
 window.loadAdminNewsletter=()=>load().catch(e=>message(e.message));
 window.loadNewsletter=()=>load().catch(e=>message(e.message));
})();
