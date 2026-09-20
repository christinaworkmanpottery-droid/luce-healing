(async()=>{
 const secret=new URLSearchParams(location.search).get('token'),actions=document.getElementById('actions'),status=document.getElementById('status');
 const call=async(path,body)=>{const r=await fetch('/api/newsletter/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify({...body,token:secret}):undefined});const d=await r.json();if(!r.ok)throw Error(d.error||'Please try again.');return d;};
 const button=(label,fn)=>{const b=document.createElement('button');b.textContent=label;b.addEventListener('click',async()=>{b.disabled=true;try{await fn();}catch(e){status.textContent=e.message;}finally{b.disabled=false;}});actions.append(b);return b;};
 if(!secret){status.textContent='This link is missing its confirmation code. Please use a link from your Luce Healing email.';return;}
 if(location.pathname==='/newsletter/confirm'){
  document.getElementById('heading').textContent='Confirm your email';document.getElementById('intro').textContent='One click confirms your Luce Healing subscription and selected preferences.';
  button('Confirm my email',async()=>{const d=await call('confirm',{});status.textContent=d.message;actions.replaceChildren();const a=document.createElement('a');a.href=d.preferencesUrl;a.textContent='Manage my email preferences';actions.append(a);});return;
 }
 const unsubscribe=async()=>{const d=await call('unsubscribe',{});status.textContent=d.message;actions.replaceChildren();};
 if(location.pathname==='/unsubscribe'){button('Unsubscribe from all marketing emails',unsubscribe);const a=document.createElement('a');a.href='/newsletter/preferences?token='+encodeURIComponent(secret);a.textContent='Choose which emails to keep instead';actions.append(document.createElement('p'),a);return;}
 try{
  const d=await call('preferences?token='+encodeURIComponent(secret));
  if(d.verified&&!['bounced','invalid'].includes(d.status)){
   actions.innerHTML='<label><input id="news" type="checkbox">Luce newsletters &amp; updates</label><label><input id="blog" type="checkbox">New blog &amp; astrology articles</label>';
   document.getElementById('news').checked=d.wants_newsletter;document.getElementById('blog').checked=d.wants_blog;
   button('Save preferences',async()=>{const result=await call('preferences',{wants_newsletter:document.getElementById('news').checked,wants_blog:document.getElementById('blog').checked});status.textContent=result.message;});
  }else status.textContent='Your email needs confirmation before you can subscribe. Use the link below to request a confirmation email.';
  actions.append(document.createElement('br'));button('Unsubscribe from all marketing emails',unsubscribe);
 }catch(e){status.textContent=e.message;}
})();
