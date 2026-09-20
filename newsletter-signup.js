(() => {
  const form=document.getElementById('newsletter-form')||document.getElementById('signupForm');
  if(!form)return;
  const button=form.querySelector('button[type="submit"]'),feedback=document.getElementById('newsletter-feedback')||document.getElementById('feedback');
  const show=message=>{feedback.hidden=false;feedback.style.display='block';feedback.textContent=message;};
  const fields=document.createElement('div');fields.className='luce-email-options';
  fields.innerHTML='<fieldset style="border:0;padding:8px 0;margin:0"><legend style="font-size:15px">What would you like to receive?</legend><label style="display:flex;align-items:center;gap:8px;font-size:15px;margin:8px 0"><input name="wants_newsletter" type="checkbox" checked style="width:auto;margin:0"> Luce newsletters &amp; updates</label><label style="display:flex;align-items:center;gap:8px;font-size:15px;margin:8px 0"><input name="wants_blog" type="checkbox" checked style="width:auto;margin:0"> New blog &amp; astrology articles</label></fieldset><div aria-hidden="true" style="position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden"><label>Leave this blank<input name="website" tabindex="-1" autocomplete="off"></label></div><div class="luce-turnstile"></div><p style="font-size:13px">We’ll email you a confirmation link. You can change these choices or unsubscribe anytime.</p>';
  button.before(fields);button.disabled=true;
  let widgetId,securityToken='';
  async function setup(){
    try{
      const r=await fetch('/api/newsletter/config'),config=await r.json();
      if(!r.ok||!config.configured)throw Error('Email signup is temporarily unavailable. Please try again later.');
      await new Promise((resolve,reject)=>{
        if(window.turnstile)return resolve();
        const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;script.onload=resolve;script.onerror=()=>reject(Error('The security check could not load. Please refresh and try again.'));document.head.append(script);
      });
      widgetId=window.turnstile.render(fields.querySelector('.luce-turnstile'),{sitekey:config.siteKey,action:'newsletter_signup',size:'flexible',appearance:'interaction-only',callback:token=>{securityToken=token;button.disabled=false;},'expired-callback':()=>{securityToken='';button.disabled=true;window.turnstile.reset(widgetId);},'error-callback':()=>{securityToken='';button.disabled=true;show('The security check could not finish. Please refresh and try again.');}});
    }catch(e){show(e.message);}
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(!form.elements.wants_newsletter.checked&&!form.elements.wants_blog.checked){show('Choose at least one type of email.');return;}
    if(!securityToken){show('Please wait for the quick security check.');return;}
    const label=button.textContent;button.disabled=true;button.textContent='Sending confirmation…';show('');
    try{
      const r=await fetch('/api/newsletter/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:form.querySelector('input[type="email"]').value.trim(),name:form.querySelector('input[name="name"]')?.value.trim()||'',website:form.elements.website.value,wants_newsletter:form.elements.wants_newsletter.checked,wants_blog:form.elements.wants_blog.checked,turnstile_token:securityToken})});
      const data=await r.json();if(!r.ok)throw Error(data.error||'Unable to send your confirmation.');show(data.message);
    }catch(e){show(e.message==='Failed to fetch'?'We couldn’t connect. Please try again shortly.':e.message);}
    finally{securityToken='';button.textContent=label;button.disabled=true;if(widgetId!==undefined)window.turnstile.reset(widgetId);}
  });
  setup();
})();
