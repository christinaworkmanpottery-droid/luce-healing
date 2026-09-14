const birthFields=document.createElement('div');birthFields.id='chart-birth-fields';birthFields.hidden=true;birthFields.innerHTML='<div class="form-group"><label for="chart-birth-time">Birth time *</label><input type="time" id="chart-birth-time"><small>If unknown, contact Christina before ordering this broader reading.</small></div><div class="form-group"><label for="chart-birth-place">Birthplace (city, state, country) *</label><input id="chart-birth-place" type="text"></div>';
document.getElementById('client-dob').closest('.form-group').after(birthFields);
birthFields.addEventListener('input',()=>updateStepIndicators());
document.querySelectorAll('.book-chart-reading').forEach(b=>b.addEventListener('click',()=>birthFields.hidden=false));
document.querySelectorAll('.open-booking').forEach(b=>b.addEventListener('click',()=>{birthFields.hidden=true;bookingState.isChartReading=false;bookingState.currentStep=1;updateBookingStep();}));
document.querySelectorAll('.book-chart-reading').forEach(b=>b.addEventListener('click',()=>{document.querySelector('#booking-modal h2').textContent=bookingState.chartName;document.querySelector('[data-step="4"] h3').textContent='Your reading details';}));
document.querySelectorAll('.open-booking').forEach(b=>b.addEventListener('click',()=>{document.querySelector('#booking-modal h2').textContent='Book Your Session';document.querySelector('[data-step="4"] h3').textContent='Your information';}));
document.querySelectorAll('.open-booking').forEach(button=>button.addEventListener('click',()=>{
bookingState.selectedDuration=null;bookingState.selectedDate=null;bookingState.selectedTime=null;bookingState.isPack=false;bookingState.sessionFormat=null;bookingState.remoteType=null;
document.querySelectorAll('.duration-card,.time-slot,.format-option,.remote-type-option').forEach(e=>e.classList.remove('selected'));
document.querySelectorAll('.pack-option').forEach(e=>e.classList.toggle('selected',e.dataset.pack==='false'));
document.querySelectorAll('#policy-cancellation,#policy-nonrefundable,#policy-disclaimer').forEach(e=>e.checked=false);
updateBookingStep();
}));
async function businessGet(route){const r=await fetch('/api/admin/'+route+'?password='+encodeURIComponent(adminPassword));const data=await r.json();if(!r.ok)throw new Error(data.error||'Unable to load business data.');return data;}
async function loadReadingOrders(){
 const el=document.getElementById('reading-orders-list');el.replaceChildren();
 try{for(const [route,label] of [['gifts','Gift purchases'],['astrology-reading-orders','One-question email reading'],['forecast-orders','Email forecast'],['bookings','Reading / appointment']]){
 const rows=await businessGet(route);
 for(const row of rows){const card=document.createElement('article');card.className='order-card';const title=document.createElement('h4');title.textContent=label;card.append(title);for(const [k,v]of Object.entries(row)){if(v==null||k==='id'||k==='stripe_session_id')continue;const line=document.createElement('p');line.textContent=k.replaceAll('_',' ')+': '+(['price','amount_paid'].includes(k)?'$'+(Number(v)/100).toFixed(2):typeof v==='object'?Object.entries(v).map(([a,b])=>a.replaceAll('_',' ')+': '+b).join('; '):v);card.append(line);}el.append(card);}}
 if(!el.children.length)el.textContent='No orders yet.';
 }catch(e){el.textContent=e.message;}
}
async function loadClientSummary(){const table=document.getElementById('admin-clients-table');try{const rows=await businessGet('clients');table.replaceChildren();for(const c of rows){const tr=document.createElement('tr');for(const value of [c.name,c.email,c.total_bookings,c.completed_bookings,c.sessions_remaining||0]){const td=document.createElement('td');td.textContent=value;tr.append(td);}table.append(tr);}}catch(e){table.textContent=e.message;}}
async function loadBusinessSummary(){try{const d=await businessGet('dashboard');document.querySelectorAll('#admin-dashboard .stat-value').forEach((e,i)=>e.textContent=['$'+Number(d.total_revenue).toFixed(2),d.total_clients,d.upcoming_bookings,d.completed_bookings][i]);}catch(e){console.error(e.message);}}
document.querySelector('[data-tab="admin-clients"]').addEventListener('click',loadClientSummary);
document.querySelector('[data-tab="admin-dashboard"]').addEventListener('click',loadBusinessSummary);
const exportButton=document.querySelector('#admin-dashboard button');
if(exportButton)exportButton.addEventListener('click',async()=>{try{const rows=await businessGet('bookings');const url=URL.createObjectURL(new Blob([JSON.stringify(rows,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='luce-bookings.json';a.click();URL.revokeObjectURL(url);}catch(e){alert(e.message);}});
