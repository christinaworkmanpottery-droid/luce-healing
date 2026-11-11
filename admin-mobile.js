(() => {
  const esc = x => String(x ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date = x => x ? new Date(x).toLocaleDateString('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',year:'numeric'}) : 'Not recorded';
  const password = () => typeof adminPassword !== 'undefined' ? adminPassword : typeof adminPw !== 'undefined' ? adminPw : '';
  async function request(path,method='GET',body) {
    const r=await fetch('/api/admin/'+path+(path.includes('?')?'&':'?')+'password='+encodeURIComponent(password()),{method,cache:'no-store',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    const data=await r.json();if(!r.ok)throw Error(data.error||'Unable to load. Please retry.');return data;
  }
  const card=(label,value,detail='')=>`<article class="mobile-stat"><span>${esc(label)}</span><strong>${esc(value)}</strong>${detail?`<small>${esc(detail)}</small>`:''}</article>`;
  const recent=(rows,kind)=>rows.slice(0,3).map(r=>`<div class="mobile-record"><strong>${esc(r.name||r.email)}</strong><span>${esc(kind==='member'?r.tier:r.status)} · ${esc(kind==='member'?r.status:date(r.subscribed_at))}</span>${kind==='member'?`<span>${date(r.created_at)}</span>`:''}</div>`).join('')||'<p>No signups recorded.</p>';
  function overview(subs,members) {
    const real=members.filter(m=>!m.is_test),visible=subs.filter(s=>!['spam','archived'].includes(s.status));
    return `<div class="mobile-stats">${card('Subscribers',visible.length,visible.filter(s=>s.status==='verified').length+' active / verified')}${card('Active memberships',real.filter(m=>m.access).length,real.filter(m=>m.access&&m.membership_type==='paid').length+' paid · '+real.filter(m=>m.access&&m.complimentary).length+' complimentary')}</div>`;
  }
  async function dashboard() {
    const target=document.getElementById('mobile-dashboard');if(!target)return;
    target.innerHTML='<p role="status">Loading your overview…</p>';
    const results=await Promise.allSettled([request('newsletter/subscribers'),request('membership/members'),request('traffic')]);
    const [s,m,t]=results.map(r=>r.status==='fulfilled'?r.value:null);
    target.innerHTML=`<h2>Your overview</h2>${s&&m?overview(s,m):'<p>Signup summary unavailable. Refresh to retry.</p>'}${t?`<div class="mobile-stats">${card('Visitors today',t.periods[0].visitors,'Unique browsers · Pacific Time')}${card('Page views today',t.periods[0].views,'Filtered views')}</div>`:'<p>Traffic unavailable. Refresh to retry.</p>'}<div class="mobile-actions"><button data-open="newsletter">Newsletter</button><button data-open="membership">Membership</button><button data-open="traffic">Traffic</button><button data-open="blog">Arrange blogs</button><button id="mobile-refresh">Refresh overview</button></div>${s?`<details><summary>Newest newsletter signups</summary>${recent(s.filter(r=>!['spam','archived'].includes(r.status)).sort((a,b)=>new Date(b.subscribed_at)-new Date(a.subscribed_at)),'subscriber')}</details>`:''}${m?`<details><summary>Newest membership signups</summary>${recent(m.filter(r=>!r.is_test),'member')}</details>`:''}`;
    target.querySelector('#mobile-refresh').onclick=dashboard;
    target.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>navigate(b.dataset.open));
  }
  function navigate(name) {
    if(document.querySelector('.admin-tab'))document.querySelector(`[data-tab="admin-${name}"]`)?.click();
    else window.switchTab(name);
  }
  function comparison(row,key) {
    const before=row['previous_'+key],now=row[key];
    return before===0 ? (now===0?'No change (0 → 0)':'No percentage baseline (0 → '+now+')') : `${now>=before?'+':''}${Math.round((now-before)/before*100)}% (${before} → ${now})`;
  }
  function rowsTable(rows,columns) {
    if(!rows.length)return '<p>No recorded visits in this period.</p>';
    return `<table class="mobile-table"><thead><tr>${columns.map(c=>`<th scope="col">${esc(c[0])}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${columns.map(c=>`<td>${esc(typeof c[1]==='function'?c[1](r):r[c[1]])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }
  async function traffic() {
    const root=document.getElementById('admin-traffic')||document.getElementById('trafficTab');if(!root)return;
    root.innerHTML='<p role="status">Loading traffic…</p>';
    try {
      const data=await request('traffic');
      root.innerHTML=`<h2>Website traffic</h2><p>Today uses Pacific Time. Other periods are rolling days.</p><div class="mobile-stats traffic-cards">${data.periods.map(p=>`<article class="mobile-stat"><h3>${esc(p.label)}</h3><strong>${p.visitors} visitors</strong><span>${p.views} page views</span><small>Visitors: ${comparison(p,'visitors')}<br>Views: ${comparison(p,'views')}<br>Compared with ${p.label==='Today'?'all of yesterday':'the preceding equal period'}${new Date(data.startedAt)>new Date(p.previous_at)?'<br>Limited history: tracking began within this comparison.':''}</small></article>`).join('')}</div>
      <details><summary>Most visited articles · 30 days</summary>${rowsTable(data.topArticles,[['Article',r=>r.path.replace('/blog/','').replace(/-/g,' ')],['Visitors','visitors'],['Views','views']])}</details>
      <details><summary>Traffic sources · 30 days</summary>${rowsTable(data.trafficSources,[['Source','source'],['Views','views']])}<p>Direct / unknown includes apps that hide their source. Sources follow a browser for up to 30 minutes of inactivity.</p></details>
      <details><summary>Daily trend · 30 days</summary>${rowsTable(data.dailyTrend,[['Day','date'],['Visitors','visitors'],['Views','views']])}</details>
      <details><summary>Weekly trend · 8 weeks</summary><p>Weeks begin Monday in Pacific Time. Current week is incomplete.</p>${rowsTable(data.weeklyTrend,[['Week of','date'],['Visitors','visitors'],['Views','views']])}</details>
      <details><summary>Signups and conversions</summary><div id="mobile-conversions">Loading signup information…</div><p>Article-to-signup and source-to-membership conversion attribution is not recorded. These counts are not conversion rates or confirmed purchases.</p></details>
      <details><summary>All-time pages and referring websites</summary>${rowsTable(data.topPages,[['Page','path'],['Views','views']])}${rowsTable(data.topReferrers,[['Referrer','referrer'],['Views','views']])}</details>
      <details><summary>How traffic is counted</summary><p>Tracking since ${date(data.startedAt)}. Dates before tracking began have no history; zeros there do not mean no visitors. Unique visitors estimate browsers, not people. Repeat views of the same page count at most once per browser every 30 minutes. Recognized admin browsers and obvious bots are excluded. Blocked scripts or cookies may undercount; sophisticated bots may remain.</p><p>${data.total} filtered page views · ${data.unique_total} unique browsers all time. ${data.legacyTotal} Legacy Website Events are preserved separately.</p></details><button id="mobile-traffic-refresh">Refresh traffic</button>`;
      root.querySelector('#mobile-traffic-refresh').onclick=traffic;
      try {
        const [s,m]=await Promise.all([request('newsletter/subscribers'),request('membership/members')]);
        const cutoff=Date.now()-30*86400000;
        root.querySelector('#mobile-conversions').innerHTML=overview(s,m)+`<p>Last 30 days: ${s.filter(r=>new Date(r.subscribed_at)>=cutoff&&!['spam','archived'].includes(r.status)).length} newsletter signups; ${m.filter(r=>!r.is_test&&new Date(r.created_at)>=cutoff).length} membership accounts created.</p>`;
      } catch {root.querySelector('#mobile-conversions').textContent='Signup information unavailable. Refresh to retry.';}
    } catch(e) {root.innerHTML=`<p role="alert">${esc(e.message)}</p><button id="mobile-traffic-retry">Retry</button>`;root.querySelector('button').onclick=traffic;}
  }
  let posts=[],saving=false;
  async function blogs() {
    const root=document.getElementById('admin-blog-list')||document.getElementById('postsList');if(!root)return;
    try {posts=await request('blog');renderBlogs(root);}catch(e){root.innerHTML=`<p role="alert">${esc(e.message)}</p><button id="blog-retry">Retry</button>`;root.querySelector('button').onclick=blogs;}
  }
  function renderBlogs(root,focusId) {
    const published=posts.filter(p=>p.published);
    const scheduled=posts.filter(p=>!p.published&&p.publish_at).sort((a,b)=>new Date(a.publish_at)-new Date(b.publish_at));
    const drafts=posts.filter(p=>!p.published&&!p.publish_at);
    const dateTime=x=>x?new Date(x).toLocaleString('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}):'Not scheduled';
    root.innerHTML=`<details open class="admin-card"><summary>Scheduled Posts (${scheduled.length})</summary><div id="scheduled-blog-posts"></div></details><details class="admin-card"><summary>Draft Posts (${drafts.length})</summary><div id="draft-blog-posts"></div></details><details open class="admin-card"><summary>Published Posts (${published.length})</summary><p>The first published post is featured on your homepage. Move to top changes that featured post.</p><p id="blog-order-message" role="status" aria-live="polite"></p><label>Find a published post<input id="blog-order-search" type="search" placeholder="Search titles"></label><div id="blog-order-list"></div></details>`;
    const cardFor=p=>{
      const i=published.findIndex(x=>x.id===p.id);
      const status=p.published?'Published':p.publish_at?'Scheduled for '+dateTime(p.publish_at):'Draft';
      return `<article class="mobile-post"><h3>${i>=0?i+1+'. ':''}${esc(p.title)}</h3><span>${esc(status)}</span>${p.published?`<div class="mobile-actions"><button data-move="${p.id}" data-direction="-1" ${i===0?'disabled':''}>↑ Up</button><button data-move="${p.id}" data-direction="1" ${i===published.length-1?'disabled':''}>↓ Down</button><button data-move="${p.id}" data-direction="top" ${i===0?'disabled':''}>Move to top</button></div>`:''}<details><summary>Post details and editing</summary><p>/${esc(p.slug)}<br>${p.filtered_reader_views||0} Filtered Reader Views<br>${p.view_count||0} Legacy Views</p><div class="mobile-actions"><button data-edit-post="${p.id}">Edit</button><button data-preview-post="${p.id}">Preview</button><button data-delete-post="${p.id}">Delete</button></div></details></article>`;
    };
    root.querySelector('#scheduled-blog-posts').innerHTML=scheduled.map(cardFor).join('')||'<p>No scheduled posts.</p>';
    root.querySelector('#draft-blog-posts').innerHTML=drafts.map(cardFor).join('')||'<p>No drafts.</p>';
    const list=root.querySelector('#blog-order-list');
    function render(filter='') {list.innerHTML=published.filter(p=>p.title.toLowerCase().includes(filter.toLowerCase())).map(cardFor).join('')||'<p>No matching published posts.</p>';}
    render();root.querySelector('#blog-order-search').oninput=e=>render(e.target.value);
    root.onclick=async e=>{
      const b=e.target.closest('button');if(!b||saving)return;
      if(b.dataset.move){
        const ids=published.map(p=>p.id),previous=[...ids],id=Number(b.dataset.move),from=ids.indexOf(id),to=b.dataset.direction==='top'?0:from+Number(b.dataset.direction);
        if(from<0||to<0||to>=ids.length)return;ids.splice(from,1);ids.splice(to,0,id);saving=true;
        root.querySelectorAll('button').forEach(b=>b.disabled=true);
        try {const saved=await request('blog-order','PUT',{ids,previous});posts=saved.ids.map(id=>posts.find(p=>p.id===id)).concat(posts.filter(p=>!p.published));renderBlogs(root,id);root.querySelector('#blog-order-message').textContent='Order saved. The first post is featured on your homepage.';}
        catch(err){renderBlogs(root);root.querySelector('#blog-order-message').textContent=err.message+' Your move was not applied. Reopen Blog to refresh.';}
        finally{saving=false;}
      }
      for(const [key,main,alternate] of [['editPost','openBlogEditor','editPost'],['previewPost','previewAdminBlogPost','previewPost'],['deletePost','deleteBlogPost','deletePost']])if(b.dataset[key])window[document.getElementById('admin-blog-list')?main:alternate](Number(b.dataset[key]));
    };
    if(focusId)root.querySelector(`[data-move="${focusId}"]`)?.focus({preventScroll:true});
  }
  window.loadAdminBlog=blogs;window.loadPosts=blogs;window.loadAdminTraffic=traffic;
  window.loadMobileDashboard=dashboard;
  const panel=document.getElementById('admin-panel');
  if(panel){
    const dashboardTab=document.getElementById('admin-dashboard');
    const summary=document.createElement('section');summary.id='mobile-dashboard';dashboardTab.prepend(summary);
    const oldStats=dashboardTab.querySelector('.dashboard-stats');if(oldStats){const d=document.createElement('details');d.innerHTML='<summary>Booking totals</summary>';oldStats.before(d);d.append(oldStats);}
    const nav=document.querySelector('.admin-tabs'),select=document.createElement('select');select.id='mobile-admin-section';select.setAttribute('aria-label','Admin section');
    const labels=[...nav.querySelectorAll('button')];const home=labels.find(b=>b.dataset.tab==='admin-dashboard');nav.prepend(home);
    select.innerHTML=[home,...labels.filter(b=>b!==home)].map(b=>`<option value="${b.dataset.tab}">${esc(b.textContent)}</option>`).join('');nav.before(select);
    select.onchange=()=>document.querySelector(`[data-tab="${select.value}"]`).click();
    document.querySelectorAll('.admin-tab').forEach(b=>b.addEventListener('click',()=>{select.value=b.dataset.tab;if(b.dataset.tab==='admin-dashboard')dashboard();if(b.dataset.tab==='admin-traffic')traffic();panel.scrollTop=0;}));
    // Open on the overview after successful authentication, without a second login.
    document.querySelectorAll('.admin-tab,.admin-tab-content').forEach(e=>e.classList.remove('active'));home.classList.add('active');dashboardTab.classList.add('active');
    if(panel.classList.contains('active'))dashboard();
    // Keep existing email settings and history available without a long initial page.
    document.querySelectorAll('#admin-newsletter > .admin-card').forEach((c,i)=>{if(!i)return;const d=document.createElement('details');d.className='admin-card';const h=c.querySelector('h3');const title=h?.textContent||'More options';if(h)h.remove();d.innerHTML=`<summary>${esc(title)}</summary>`;c.before(d);while(c.firstChild)d.append(c.firstChild);c.remove();});
  } else {
    const screen=document.getElementById('adminScreen');if(!screen)return;
    const nav=screen.querySelector('.tabs');
    for(const name of ['dashboard','traffic']){const b=document.createElement('button');b.className='tab';b.textContent=name==='dashboard'?'Dashboard':'Traffic';b.onclick=()=>window.switchTab(name);nav.append(b);const section=document.createElement('div');section.id=name+'Tab';section.className='hidden';if(name==='dashboard')section.innerHTML='<section id="mobile-dashboard"></section>';screen.append(section);}
    const oldSwitch=window.switchTab;window.switchTab=name=>{oldSwitch(name);for(const n of ['dashboard','traffic'])document.getElementById(n+'Tab').classList.toggle('hidden',n!==name);if(name==='dashboard')dashboard();if(name==='traffic')traffic();if(name==='blog')blogs();};
    const login=window.doLogin;window.doLogin=async()=>{await login();if(!screen.classList.contains('hidden'))window.switchTab('dashboard');};
  }
})();
