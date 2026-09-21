(()=>{fetch('/api/membership/config').then(r=>{if(!r.ok)throw Error();return r.json();}).then(config=>{
const status=document.getElementById('enrollment-status'),actions=document.getElementById('membership-actions'),note=document.getElementById('publication-note');
if(config.purchasingEnabled){status.textContent='Membership enrollment is open. Create your account and confirm your email, then choose monthly or annual membership.';actions.innerHTML='<a class="button" href="/members">Join Astrology Membership</a><a class="button" href="/members/account">Member sign in</a>';}
if(config.latestMonth==='2026-10')note.textContent='October’s horoscopes are available early to welcome our founding members. Starting in November, new horoscopes will be published on the 1st of each month, Pacific Time.';
else if(config.nextPublication)note.textContent='The next monthly readings are scheduled for '+new Date(config.nextPublication.scheduled_at).toLocaleString('en-US',{timeZone:'America/Los_Angeles',dateStyle:'long',timeStyle:'short'})+' Pacific Time. Starting in November, new horoscopes will be published on the 1st of each month, Pacific Time.';
}).catch(()=>{});})();
