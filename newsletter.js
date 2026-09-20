const crypto = require('crypto');
const net = require('net');
const path = require('path');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const token = () => crypto.randomBytes(32).toString('hex');
const tokenOK = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validEmail = value => typeof value === 'string' && value.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
const problem = (message, status = 400) => Object.assign(new Error(message), {status});

function createNewsletterService({pool, getTransporter, env = process.env, fetcher = global.fetch, clock = () => new Date()}) {
  const origin = (env.NEWSLETTER_BASE_URL || 'https://lucehealing.com').replace(/\/$/, '');
  // No newsletter mail is authorized by default. Controlled tests have one fixed recipient.
  const testRecipient = 'info@christinaworkman.com';
  const deliveryMode = () => ['test','live'].includes(env.NEWSLETTER_DELIVERY_MODE) ? env.NEWSLETTER_DELIVERY_MODE : 'locked';
  const recipientAllowed = email => deliveryMode()==='live' || (deliveryMode()==='test' && email===testRecipient);
  const q = (sql, values = []) => pool.query(sql, values);
  const one = async (sql, values) => (await q(sql, values)).rows[0];
  const wrap = fn => async (req,res) => {try {await fn(req,res);} catch(e) {if(!e.status) console.error('[Luce newsletter]',e.code || e.name);res.status(e.status || 500).json({error:e.status ? e.message : 'Unable to complete this request. Please try again.'});}};
  async function transaction(fn) {
    const client = await pool.connect();
    try {await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}
    catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }
  async function initialize() {
    await transaction(async c => {
      await c.query(`ALTER TABLE newsletter_subscribers
        ADD COLUMN IF NOT EXISTS status TEXT,
        ADD COLUMN IF NOT EXISTS spam_archived_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS spam_restore_requires_confirmation BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS wants_newsletter BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS wants_blog BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS verification_hash TEXT,
        ADD COLUMN IF NOT EXISTS verification_expires_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS verification_requested_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS pending_newsletter BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS pending_blog BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS last_delivery_status TEXT,
        ADD COLUMN IF NOT EXISTS last_delivery_at TIMESTAMPTZ`);
      // Preserve every historical row and its original active/source/name/date fields.
      await c.query("UPDATE newsletter_subscribers SET status = CASE WHEN active = 0 THEN 'unsubscribed' ELSE 'legacy_unverified' END WHERE status IS NULL");
      await c.query("ALTER TABLE newsletter_subscribers ALTER COLUMN status SET DEFAULT 'pending'");
      await c.query('CREATE INDEX IF NOT EXISTS newsletter_email_normalized ON newsletter_subscribers (lower(email))');
      await c.query('CREATE UNIQUE INDEX IF NOT EXISTS newsletter_verification_hash ON newsletter_subscribers (verification_hash) WHERE verification_hash IS NOT NULL');
      await c.query(`CREATE TABLE IF NOT EXISTS newsletter_rate_limits (key TEXT NOT NULL, bucket BIGINT NOT NULL, count INTEGER NOT NULL DEFAULT 1, expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '2 days'), PRIMARY KEY(key,bucket))`);
      await c.query(`CREATE TABLE IF NOT EXISTS newsletter_campaigns (
        id SERIAL PRIMARY KEY, subject TEXT NOT NULL, content TEXT NOT NULL DEFAULT '',
        segment TEXT NOT NULL CHECK(segment IN ('newsletter','blog')), blog_post_id INTEGER,
        delivery_key TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'draft', scheduled_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ, heartbeat_at TIMESTAMPTZ,
        send_id TEXT UNIQUE, audience_captured BOOLEAN NOT NULL DEFAULT false, error TEXT, revision INTEGER NOT NULL DEFAULT 1)`);
      await c.query('ALTER TABLE newsletter_campaigns ADD COLUMN IF NOT EXISTS test_only BOOLEAN NOT NULL DEFAULT false');
      await c.query(`CREATE TABLE IF NOT EXISTS newsletter_deliveries (
        id SERIAL PRIMARY KEY, campaign_id INTEGER NOT NULL REFERENCES newsletter_campaigns(id),
        subscriber_id INTEGER NOT NULL, email TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
        attempted_at TIMESTAMPTZ, finished_at TIMESTAMPTZ, detail TEXT, message_id TEXT,
        UNIQUE(campaign_id,email))`);
      await c.query('CREATE INDEX IF NOT EXISTS newsletter_campaigns_due ON newsletter_campaigns(status,scheduled_at)');
      await c.query('ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS publish_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS email_on_publish BOOLEAN NOT NULL DEFAULT false');
    });
  }
  function ready() {
    const site = env.TURNSTILE_SITE_KEY, secret = env.TURNSTILE_SECRET_KEY;
    return Boolean(site && secret && (!(env.NODE_ENV === 'production') || !/^[123]x00000000000000000000/.test(site)));
  }
  function clientIP(req) {
    // Only trust the configured number of reverse-proxy hops, never arbitrary leftmost XFF.
    const hops = Math.max(0,Math.min(3,Number(env.NEWSLETTER_TRUST_PROXY_HOPS) || 0));
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map(x=>x.trim());
    let ip = hops && forwarded.length >= hops ? forwarded[forwarded.length-hops] : req.socket?.remoteAddress || 'unknown';
    if (!net.isIP(ip)) ip='unknown';
    if(net.isIP(ip)===6 && !ip.startsWith('::ffff:')) ip=ip.split(':').slice(0,4).join(':');
    return ip;
  }
  async function limit(key, max, windowMs) {
    const bucket=Math.floor(clock().getTime()/windowMs);
    const row=await one(`INSERT INTO newsletter_rate_limits(key,bucket,count) VALUES($1,$2,1)
      ON CONFLICT(key,bucket) DO UPDATE SET count=newsletter_rate_limits.count+1 RETURNING count`,[hash(key),bucket]);
    if(row.count>max)throw problem('Please wait before trying again.',429);
  }
  async function protect(req) {
    await limit('signup-ip:'+clientIP(req),12,3600000);
    if (req.body.website) return false;
    if(!ready())throw problem('Email signup is temporarily unavailable. Please try again later.',503);
    const response=req.body.turnstile_token || req.body['cf-turnstile-response'];
    if(typeof response!=='string'||!response||response.length>2048)throw problem('Please complete the quick security check.');
    let result;
    try {
      const r=await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:env.TURNSTILE_SECRET_KEY,response}),signal:AbortSignal.timeout(10000)});
      if(!r.ok)throw Error('Turnstile unavailable');result=await r.json();
    } catch(_){throw problem('The security check is temporarily unavailable. Please try again.',503);}
    const hosts=(env.TURNSTILE_HOSTNAMES || 'lucehealing.com,www.lucehealing.com').split(',').map(s=>s.trim());
    if(!result.success || !hosts.includes(result.hostname) || result.action!=='newsletter_signup')throw problem('The security check expired or could not be verified. Please try again.');
    return true;
  }
  async function mailer() {
    const transport=getTransporter();
    const row=await one("SELECT value FROM admin_settings WHERE key='smtp_user'");
    const from=String(row?.value || '').trim().toLowerCase();
    const expected=String(env.NEWSLETTER_FROM || 'lucehealing13@gmail.com').toLowerCase();
    if(!transport || from!==expected || !(from==='lucehealing13@gmail.com' || /^[^@]+@lucehealing\.com$/.test(from))) throw problem('A Luce Healing email sender must be configured before sending.',503);
    return {transport:{
      verify:()=>transport.verify(),
      sendMail:mail=>{
        // Final guard covers confirmation mail and campaign mail, even with an old delivery ledger.
        if(!recipientAllowed(mail.to) || mail.cc || mail.bcc || mail.envelope)
          throw problem('Newsletter delivery is locked for this recipient.',503);
        return transport.sendMail(mail);
      }
    },from:{name:'Christina at Luce Healing',address:from}};
  }
  function shell(body,footer='') {
    return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f3eef6;color:#392c44"><div style="max-width:640px;margin:auto;font:17px/1.7 Georgia,serif;background:white"><header style="padding:24px;background:#624373;color:white;font-size:26px;text-align:center">Luce Healing</header><main style="padding:24px;overflow-wrap:anywhere">${body}</main><footer style="padding:24px;font:13px/1.6 Arial,sans-serif;color:#62546d">${footer}<p><a href="${origin}">Luce Healing</a> · Christina Workman</p></footer></div></body></html>`;
  }
  const genericSignup={success:true,message:'Check your inbox for a Luce Healing confirmation email. If you already receive our emails, use the link to confirm any preference changes. You can try again after 10 minutes.'};
  async function subscribe(req,res) {
    if(!await protect(req))return res.json(genericSignup);
    const email=typeof req.body.email==='string'?req.body.email.trim().toLowerCase():'';
    if(!validEmail(email))throw problem('Please enter a valid email address.');
    if(!recipientAllowed(email))throw problem('Newsletter signup is temporarily paused while we finish testing. Please try again later.',503);
    const wantsNewsletter=req.body.wants_newsletter===true,wantsBlog=req.body.wants_blog===true;
    if(!wantsNewsletter&&!wantsBlog)throw problem('Choose at least one type of email.');
    await limit('signup-email:'+email,3,86400000);
    const {transport,from}=await mailer();
    const secret=token(),now=clock(),expiry=new Date(now.getTime()+86400000);
    const sub=await transaction(async c=>{
      // Serialize all signup attempts for the same normalized email without deleting duplicates.
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[email]);
      let row=(await c.query('SELECT * FROM newsletter_subscribers WHERE lower(email)=$1 ORDER BY id LIMIT 1 FOR UPDATE',[email])).rows[0];
      if((await c.query('SELECT 1 FROM newsletter_subscribers WHERE lower(email)=$1 AND spam_archived_at IS NOT NULL',[email])).rows.length)return null;
      if(row?.status==='bounced' || row?.status==='invalid')return null;
      if(row?.verification_requested_at && now-new Date(row.verification_requested_at)<600000)return null;
      if(!row)row=(await c.query(`INSERT INTO newsletter_subscribers(email,name,active,source,status,unsubscribe_token) VALUES($1,$2,0,'luce-healing','pending',$3) RETURNING *`,[email,String(req.body.name||'').trim().slice(0,120),token()])).rows[0];
      await c.query(`UPDATE newsletter_subscribers SET verification_hash=$1,verification_expires_at=$2,verification_requested_at=$3,pending_newsletter=$4,pending_blog=$5 WHERE id=$6`,[hash(secret),expiry,now,wantsNewsletter,wantsBlog,row.id]);
      return row;
    });
    if(!sub)return res.json(genericSignup);
    const url=origin+'/newsletter/confirm?token='+secret;
    try{
      const result=await transport.sendMail({from,to:email,subject:'Confirm your Luce Healing email preferences',html:shell(`<h1>One more step.</h1><p>Please confirm that you want to receive ${wantsNewsletter&&wantsBlog?'Luce newsletters and new blog articles':wantsBlog?'new Luce blog and astrology articles':'Luce newsletters and updates'}.</p><p><a href="${url}" style="display:inline-block;background:#624373;color:white;padding:14px 20px;border-radius:6px">Confirm my email</a></p><p>This link expires in 24 hours. If you did not request this, ignore this email. Your preferences will not change.</p>`),text:`Confirm your Luce Healing email preferences: ${url}\nThis link expires in 24 hours. Ignore it if you did not request it.`});
      if(!result.accepted?.length)throw Error('Not accepted');
    }catch(e){await q('UPDATE newsletter_subscribers SET verification_requested_at=NULL WHERE id=$1 AND verification_hash=$2',[sub.id,hash(secret)]);throw problem('Your confirmation email could not be sent. Please try again shortly.',503);}
    res.json(genericSignup);
  }
  async function confirm(req,res) {
    if(!tokenOK(req.body.token))throw problem('This confirmation link is invalid. Please request another at /subscribe.');
    const sub=await transaction(async c=>{
      const row=(await c.query('SELECT * FROM newsletter_subscribers WHERE verification_hash=$1 FOR UPDATE',[hash(req.body.token)])).rows[0];
      if(!row || !row.verification_expires_at || new Date(row.verification_expires_at)<=clock())throw problem('This link has expired or was already used. Please request a new confirmation email.',410);
      if(row.spam_archived_at || ['bounced','invalid'].includes(row.status))throw problem('This address cannot receive emails. Please contact Luce Healing.');
      const result=await c.query(`UPDATE newsletter_subscribers SET status='verified',active=1,spam_restore_requires_confirmation=false,verified_at=COALESCE(verified_at,$1),unsubscribed_at=NULL,wants_newsletter=pending_newsletter,wants_blog=pending_blog,verification_hash=NULL,verification_expires_at=NULL,unsubscribe_token=COALESCE(unsubscribe_token,$2) WHERE id=$3 RETURNING unsubscribe_token`,[clock(),token(),row.id]);
      return result.rows[0];
    });
    res.json({success:true,message:'Your email is confirmed. Welcome to Luce Healing.',preferencesUrl:'/newsletter/preferences?token='+sub.unsubscribe_token});
  }
  async function preferenceRecord(secret) {
    if(!tokenOK(secret))throw problem('This email preference link is invalid. Please use a link from a Luce Healing email.');
    const sub=await one('SELECT * FROM newsletter_subscribers WHERE unsubscribe_token=$1',[secret]);
    if(!sub)throw problem('This link is no longer valid. Please use your latest email.',404);
    return sub;
  }
  async function unsubscribe(req,res) {
    const sub=await preferenceRecord(req.body.token || req.query.token);
    await q(`UPDATE newsletter_subscribers SET active=0,status='unsubscribed',wants_newsletter=false,wants_blog=false,unsubscribed_at=$1,verification_hash=NULL,verification_expires_at=NULL WHERE lower(email)=$2`,[clock(),sub.email.toLowerCase()]);
    res.json({success:true,message:'You are unsubscribed from Luce Healing marketing emails. Your purchases and customer records are unchanged.'});
  }
  async function preferences(req,res) {
    const sub=await preferenceRecord(req.method==='GET'?req.query.token:req.body.token);
    if(req.method==='GET')return res.json({status:sub.status,wants_newsletter:sub.wants_newsletter,wants_blog:sub.wants_blog,verified:!!sub.verified_at});
    const n=req.body.wants_newsletter===true,b=req.body.wants_blog===true;
    if(sub.spam_archived_at)throw problem('This subscription is archived. Please contact Luce Healing.',409);
    if((n||b)&&(sub.spam_restore_requires_confirmation||!sub.verified_at||['bounced','invalid','pending','legacy_unverified'].includes(sub.status)))throw problem('Please confirm your email through the signup form before subscribing.',409);
    await q(`UPDATE newsletter_subscribers SET wants_newsletter=$1,wants_blog=$2,status=$3,active=$4,unsubscribed_at=$5,verification_hash=NULL,verification_expires_at=NULL WHERE id=$6`,[n,b,n||b?'verified':'unsubscribed',n||b?1:0,n||b?null:clock(),sub.id]);
    res.json({success:true,message:'Your Luce Healing email preferences are saved.'});
  }
  const plain = value => String(value||'').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<\/(p|div|h[1-6]|li)>|<br\s*\/?>/gi,'\n\n').replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").trim();
  const paragraphs = value => String(value||'').split(/\n\s*\n/).filter(Boolean).map(p=>'<p>'+esc(p).replace(/\n/g,'<br>')+'</p>').join('');
  async function emailContent(campaign, sub) {
    let content=campaign.content, article='';
    if(campaign.blog_post_id){
      const post=await one('SELECT * FROM blog_posts WHERE id=$1',[campaign.blog_post_id]);
      if(!post || !post.published)throw problem('The selected blog article must be published before it can be emailed.',409);
      content=plain(post.content);article=origin+'/blog/'+encodeURIComponent(post.slug);
    }
    const secret=sub?.unsubscribe_token || 'PREVIEW';
    const unsubscribeUrl=origin+'/unsubscribe?token='+secret,preferencesUrl=origin+'/newsletter/preferences?token='+secret;
    const footer=`You chose ${campaign.segment==='blog'?'new blog and astrology articles':'Luce newsletters and updates'}.<p><a href="${preferencesUrl}">Manage email preferences</a> · <a href="${unsubscribeUrl}">Unsubscribe from all marketing emails</a></p>`;
    return {html:shell('<h1>'+esc(campaign.subject)+'</h1>'+paragraphs(content)+(article?`<p><a href="${article}">Read this article on Luce Healing →</a></p>`:''),footer),text:campaign.subject+'\n\n'+content+(article?'\n\nRead online: '+article:'')+'\n\nPreferences: '+preferencesUrl+'\nUnsubscribe: '+unsubscribeUrl,unsubscribeUrl};
  }
  function campaignInput(body) {
    const subject=String(body.subject||'').trim(),content=String(body.content||'').trim(),segment=body.segment;
    if(!subject || subject.length>180 || /[\r\n]/.test(subject))throw problem('Enter a subject of 1–180 characters on one line.');
    if(!['newsletter','blog'].includes(segment))throw problem('Choose newsletters or blog emails.');
    const blogId=body.blog_post_id?Number(body.blog_post_id):null;
    if(blogId && (!Number.isSafeInteger(blogId)||segment!=='blog'))throw problem('Blog articles must use the blog email audience.');
    if(!blogId && (!content || content.length>100000))throw problem('Enter newsletter content (up to 100,000 characters).');
    return {subject,content,segment,blogId};
  }
  function scheduleDate(value) {
    if(typeof value!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(value))throw problem('Choose a date and time with a time zone.');
    const d=new Date(value);
    if(!Number.isFinite(d.getTime())||d<=clock())throw problem('Choose a future date and time.');
    return d;
  }
  async function saveCampaign(req,res) {
    const x=campaignInput(req.body);
    if(x.blogId&&!await one('SELECT id FROM blog_posts WHERE id=$1',[x.blogId]))throw problem('Blog article not found.',404);
    let row;
    if(req.params.id){
      row=await one(`UPDATE newsletter_campaigns SET subject=$1,content=$2,segment=$3,blog_post_id=$4,status='draft',scheduled_at=NULL,updated_at=$5,revision=revision+1,error=NULL
        WHERE id=$6 AND revision=$7 AND status IN ('draft','scheduled','canceled') AND delivery_key IS NULL RETURNING *`,[x.subject,x.content,x.segment,x.blogId,clock(),req.params.id,req.body.revision]);
      if(!row)throw problem('This draft changed or has started sending. Refresh before editing. Automatic blog emails are edited with their blog post.',409);
    }else row=await one(`INSERT INTO newsletter_campaigns(subject,content,segment,blog_post_id) VALUES($1,$2,$3,$4) RETURNING *`,[x.subject,x.content,x.segment,x.blogId]);
    res.json(row);
  }
  async function queueCampaign(req,res) {
    const testing=deliveryMode()==='test' && req.body.controlled_test===true;
    if(!testing && (deliveryMode()!=='live' || env.NEWSLETTER_WORKER_ENABLED!=='true'))throw problem('Newsletter sending is not enabled in this environment.',503);
    await mailer();
    const at=req.body.scheduled_at?scheduleDate(req.body.scheduled_at):clock();
    const row=await one(`UPDATE newsletter_campaigns SET status='scheduled',scheduled_at=$1,updated_at=$2,error=NULL,revision=revision+1,test_only=$5
      WHERE id=$3 AND revision=$4 AND status IN ('draft','scheduled','canceled') AND (test_only=false OR $5=true) RETURNING *`,[at,clock(),req.params.id,req.body.revision,testing]);
    if(!row)throw problem('This newsletter changed or has already started. Refresh its status.',409);
    res.json(row);
  }
  async function saveBlog(body,id) {
    const {title,slug,content,excerpt,published}=body;
    if(!title||!slug||!content)throw problem('Missing required fields');
    const publishAt=body.publish_at?scheduleDate(body.publish_at):null;
    const pub=publishAt?0:published?1:0,email=body.email_blog===true && !!(pub||publishAt);
    return transaction(async c=>{
      let post;
      if(id){
        const sending=(await c.query("SELECT id FROM newsletter_campaigns WHERE delivery_key=$1 AND status='sending' FOR UPDATE",['blog:'+id])).rows[0];
        if(sending)throw problem('The article email is sending. Please wait before editing this post.',409);
        post=(await c.query(`UPDATE blog_posts SET title=$1,slug=$2,content=$3,excerpt=$4,published=$5,publish_at=$6,email_on_publish=$7,updated_at=NOW() WHERE id=$8 RETURNING *`,[title,slug,content,excerpt||'',pub,publishAt,email,id])).rows[0];
        if(!post)throw problem('Post not found',404);
      }else post=(await c.query(`INSERT INTO blog_posts(title,slug,content,excerpt,published,publish_at,email_on_publish) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[title,slug,content,excerpt||'',pub,publishAt,email])).rows[0];
      if(email){
        await c.query(`INSERT INTO newsletter_campaigns(subject,content,segment,blog_post_id,delivery_key,status,scheduled_at)
          VALUES($1,'','blog',$2,$3,'scheduled',$4) ON CONFLICT(delivery_key) DO UPDATE SET subject=EXCLUDED.subject,scheduled_at=EXCLUDED.scheduled_at,status='scheduled',revision=newsletter_campaigns.revision+1,updated_at=NOW()
          WHERE newsletter_campaigns.status IN ('draft','scheduled','canceled')`,['New from Luce Healing: '+title,post.id,'blog:'+post.id,publishAt||clock()]);
      }else await c.query("UPDATE newsletter_campaigns SET status='canceled',revision=revision+1,updated_at=NOW() WHERE delivery_key=$1 AND status IN ('draft','scheduled')",['blog:'+post.id]);
      return post;
    });
  }
  async function processCampaign(campaign) {
    let config;
    try {config=await mailer();await config.transport.verify();}
    catch(e){await q("UPDATE newsletter_campaigns SET status='scheduled',error=$1,scheduled_at=$2,revision=revision+1 WHERE id=$3",['Email connection unavailable; retrying in five minutes.',new Date(clock().getTime()+300000),campaign.id]);return;}
    const pref=campaign.segment==='blog'?'wants_blog':'wants_newsletter';
    const sendId=campaign.send_id || crypto.randomUUID();
    try{
      // Freeze one rendered message per campaign, not a moving blog body during delivery.
      const message=await emailContent(campaign);
      await transaction(async c=>{
        await c.query(`INSERT INTO newsletter_sends(send_id,blog_post_id,subject,recipients_count) VALUES($1,$2,$3,0) ON CONFLICT(send_id) DO NOTHING`,[sendId,campaign.blog_post_id,campaign.subject]);
        await c.query('UPDATE newsletter_campaigns SET send_id=$1 WHERE id=$2',[sendId,campaign.id]);
        if(!campaign.audience_captured) await c.query(`INSERT INTO newsletter_deliveries(campaign_id,subscriber_id,email)
          SELECT $1,min(id),lower(email) FROM newsletter_subscribers WHERE spam_archived_at IS NULL AND status='verified' AND active=1 AND verified_at IS NOT NULL AND ${pref}=true
          AND NOT EXISTS (SELECT 1 FROM newsletter_subscribers suppressed WHERE lower(suppressed.email)=lower(newsletter_subscribers.email) AND (suppressed.spam_archived_at IS NOT NULL OR suppressed.status IN ('unsubscribed','bounced','invalid')))
          AND ($2::text IS NULL OR lower(email)=$2)
          GROUP BY lower(email) ON CONFLICT(campaign_id,email) DO NOTHING`,[campaign.id,campaign.test_only?testRecipient:null]);
        await c.query('UPDATE newsletter_campaigns SET audience_captured=true WHERE id=$1',[campaign.id]);
      });
      const deliveries=(await q("SELECT * FROM newsletter_deliveries WHERE campaign_id=$1 AND status='pending' ORDER BY id",[campaign.id])).rows;
      for(const delivery of deliveries){
        await q('UPDATE newsletter_campaigns SET heartbeat_at=$1 WHERE id=$2',[clock(),campaign.id]);
        const sub=await one(`SELECT * FROM newsletter_subscribers WHERE id=$1 AND spam_archived_at IS NULL AND status='verified' AND active=1 AND verified_at IS NOT NULL AND ${pref}=true
          AND NOT EXISTS (SELECT 1 FROM newsletter_subscribers suppressed WHERE lower(suppressed.email)=lower(newsletter_subscribers.email) AND (suppressed.spam_archived_at IS NOT NULL OR suppressed.status IN ('unsubscribed','bounced','invalid')))`,[delivery.subscriber_id]);
        if(!sub || !recipientAllowed(delivery.email) || (campaign.test_only && delivery.email!==testRecipient)){await q("UPDATE newsletter_deliveries SET status='skipped',detail='Preferences changed before sending',finished_at=$1 WHERE id=$2",[clock(),delivery.id]);continue;}
        if(!sub.unsubscribe_token){sub.unsubscribe_token=token();await q('UPDATE newsletter_subscribers SET unsubscribe_token=$1 WHERE id=$2',[sub.unsubscribe_token,sub.id]);}
        const claimed=await one("UPDATE newsletter_deliveries SET status='delivering',attempted_at=$1 WHERE id=$2 AND status='pending' RETURNING id",[clock(),delivery.id]);
        if(!claimed)continue;
        let status='unknown',detail='Delivery result needs review; not automatically resent.',messageId=null;
        try{
          const secret=sub.unsubscribe_token;
          const html=message.html.replaceAll('token=PREVIEW','token='+secret),text=message.text.replaceAll('token=PREVIEW','token='+secret);
          const result=await config.transport.sendMail({from:config.from,to:delivery.email,subject:campaign.subject,html,text,
            headers:{'List-Unsubscribe':`<${origin}/api/newsletter/one-click?token=${secret}>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'}});
          status=result.accepted?.length?'accepted':'rejected';detail=status==='accepted'?'Accepted by email provider; inbox delivery is not confirmed.':'Recipient rejected by email provider.';messageId=result.messageId||null;
        }catch(e){
          // Only explicit permanent recipient failures suppress a subscriber. Timeouts are uncertain.
          if(e.command==='RCPT TO' && Number(e.responseCode)>=500){status='bounced';detail='Email provider permanently rejected this recipient.';}
          else if(e.code==='EENVELOPE'){status='rejected';detail='Email provider rejected the recipient.';}
        }
        await q('UPDATE newsletter_deliveries SET status=$1,detail=$2,message_id=$3,finished_at=$4 WHERE id=$5',[status,detail,messageId,clock(),delivery.id]);
        await q(`UPDATE newsletter_subscribers SET last_delivery_status=$1,last_delivery_at=$2,status=CASE WHEN $1='bounced' THEN 'bounced' ELSE status END,active=CASE WHEN $1='bounced' THEN 0 ELSE active END WHERE id=$3`,[status,clock(),sub.id]);
      }
      const counts=(await q('SELECT status,count(*)::int AS count FROM newsletter_deliveries WHERE campaign_id=$1 GROUP BY status',[campaign.id])).rows;
      const accepted=counts.find(x=>x.status==='accepted')?.count||0;
      const failed=counts.some(x=>['unknown','rejected','bounced','delivering','pending'].includes(x.status));
      await q('UPDATE newsletter_sends SET recipients_count=$1 WHERE send_id=$2',[accepted,sendId]);
      await q('UPDATE newsletter_campaigns SET status=$1,finished_at=$2,error=$3,revision=revision+1 WHERE id=$4',[failed?'partial':'sent',clock(),failed?'Review recipient results. Uncertain outcomes are never automatically resent.':null,campaign.id]);
    }catch(e){await q("UPDATE newsletter_campaigns SET status='interrupted',error=$1,revision=revision+1 WHERE id=$2",[e.status?e.message:'Sending stopped; review recipient results before continuing.',campaign.id]);}
  }
  let ticking=false,timer;
  async function tick(controlledTest=false) {
    const testing=deliveryMode()==='test';
    if(ticking || (testing ? controlledTest!==true : deliveryMode()!=='live' || env.NEWSLETTER_WORKER_ENABLED!=='true'))return;
    ticking=true;
    try{
      await q('DELETE FROM newsletter_rate_limits WHERE expires_at < $1',[clock()]);
      if(!testing)await q("UPDATE blog_posts SET published=1,publish_at=NULL,updated_at=NOW() WHERE publish_at <= $1 AND published=0",[clock()]);
      await q("UPDATE newsletter_campaigns SET status='interrupted',error='Worker stopped during sending. Review results; pending recipients may be resumed.',revision=revision+1 WHERE status='sending' AND heartbeat_at < $1 AND test_only=$2",[new Date(clock().getTime()-900000),testing]);
      await q("UPDATE newsletter_deliveries SET status='unknown',detail='Worker stopped before result was recorded; do not resend automatically.' WHERE status='delivering' AND campaign_id IN (SELECT id FROM newsletter_campaigns WHERE status='interrupted' AND test_only=$1)",[testing]);
      const campaign=await one(`UPDATE newsletter_campaigns SET status='sending',started_at=COALESCE(started_at,$1),heartbeat_at=$1,revision=revision+1
        WHERE id=(SELECT id FROM newsletter_campaigns WHERE status='scheduled' AND test_only=$2 AND scheduled_at<=$1 ORDER BY scheduled_at,id LIMIT 1 FOR UPDATE SKIP LOCKED) AND status='scheduled' RETURNING *`,[clock(),testing]);
      if(campaign)await processCampaign(campaign);
    }finally{ticking=false;}
  }
  function start(){if(timer||deliveryMode()!=='live'||env.NEWSLETTER_WORKER_ENABLED!=='true')return;timer=setInterval(()=>tick().catch(e=>console.error('[Luce newsletter worker]',e.code||e.name)),30000);timer.unref();tick().catch(e=>console.error('[Luce newsletter worker]',e.code||e.name));}
  function stop(){clearInterval(timer);timer=null;}
  function register(app,checkAdminPassword){
    app.use(['/newsletter','/api/newsletter','/api/admin/newsletter'],(req,res,next)=>{res.set('X-Robots-Tag','noindex, nofollow').set('Cache-Control','no-store').set('Referrer-Policy','no-referrer');next();});
    app.get('/api/newsletter/config',(req,res)=>res.json({configured:ready(),siteKey:ready()?env.TURNSTILE_SITE_KEY:null}));
    app.post('/api/newsletter/subscribe',wrap(subscribe));
    app.post('/api/newsletter/resend',wrap(subscribe));
    app.post('/api/newsletter/confirm',wrap(confirm));
    app.post('/api/newsletter/unsubscribe',wrap(unsubscribe));
    app.post('/api/newsletter/one-click',wrap(unsubscribe));
    app.get('/api/newsletter/preferences',wrap(preferences));
    app.post('/api/newsletter/preferences',wrap(preferences));
    for(const p of ['/newsletter/confirm','/newsletter/preferences','/unsubscribe'])app.get(p,(req,res)=>res.set('X-Robots-Tag','noindex, nofollow').set('Cache-Control','no-store').sendFile(path.join(__dirname,'unsubscribe.html')));
    const admin=(method,p,fn)=>app[method]('/api/admin/newsletter'+p,checkAdminPassword,wrap(fn));
    admin('get','/status',async(req,res)=>{let sender;try{sender=await mailer();}catch(_){}res.json({turnstileConfigured:ready(),senderConfigured:!!sender,sender:sender?.from.address||null,deliveryMode:deliveryMode(),testRecipient:deliveryMode()==='test'?testRecipient:null,workerEnabled:deliveryMode()==='live'&&env.NEWSLETTER_WORKER_ENABLED==='true',scheduleNote:'Saved times use your device time zone. Due work is processed about every 30 seconds while the service is running; after downtime it resumes when the service starts.'});});
    admin('get','/subscribers',async(req,res)=>res.json((await q(`SELECT id,email,name,subscribed_at,active,CASE WHEN spam_archived_at IS NOT NULL THEN 'spam' ELSE status END AS status,spam_archived_at,verified_at,unsubscribed_at,wants_newsletter,wants_blog,last_delivery_status,last_delivery_at FROM newsletter_subscribers WHERE spam_archived_at IS NULL OR $1=true ORDER BY subscribed_at DESC,id DESC`,[req.query.include_archived==='true'])).rows));
    admin('post','/subscribers/:id/archive',async(req,res)=>{
      if(typeof req.body.archived!=='boolean')throw problem('Choose archive or restore.');
      await transaction(async c=>{
        const row=(await c.query('SELECT email FROM newsletter_subscribers WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];
        if(!row)throw problem('Subscriber not found.',404);
        if(req.body.archived){
          await c.query(`UPDATE newsletter_subscribers SET spam_archived_at=COALESCE(spam_archived_at,$1),verification_hash=NULL,verification_expires_at=NULL WHERE lower(email)=lower($2)`,[clock(),row.email]);
        }else{
          // Restore visibility without silently restoring marketing consent.
          await c.query(`UPDATE newsletter_subscribers SET spam_archived_at=NULL,spam_restore_requires_confirmation=true,active=0,status=CASE WHEN status IN ('unsubscribed','bounced','invalid') THEN status ELSE 'pending' END,wants_newsletter=false,wants_blog=false,verification_hash=NULL,verification_expires_at=NULL,verification_requested_at=NULL WHERE lower(email)=lower($1) AND spam_archived_at IS NOT NULL`,[row.email]);
        }
      });
      res.json({success:true});
    });
    admin('delete','/:id',async(req,res)=>{await q("UPDATE newsletter_subscribers SET active=0,status='unsubscribed',wants_newsletter=false,wants_blog=false,verification_hash=NULL,verification_expires_at=NULL,unsubscribed_at=$1 WHERE lower(email)=(SELECT lower(email) FROM newsletter_subscribers WHERE id=$2)",[clock(),req.params.id]);res.json({success:true});});
    admin('get','/export',async(req,res)=>{
      const rows=(await q(`SELECT email,name,CASE WHEN spam_archived_at IS NOT NULL THEN 'spam' ELSE status END AS status,wants_newsletter,wants_blog,subscribed_at,verified_at,unsubscribed_at FROM newsletter_subscribers ORDER BY subscribed_at DESC`)).rows;
      const cell=x=>'"'+String(x??'').replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"';
      res.type('text/csv').attachment('luce-newsletter-subscribers.csv').send(['Email,Name,Status,Newsletters,Blog emails,Signup date,Verified date,Unsubscribed date',...rows.map(r=>Object.values(r).map(cell).join(','))].join('\r\n'));
    });
    admin('get','/campaigns',async(req,res)=>res.json((await q(`SELECT c.*,COALESCE((SELECT json_object_agg(status,n) FROM (SELECT status,count(*) n FROM newsletter_deliveries WHERE campaign_id=c.id GROUP BY status) counts),'{}'::json) AS delivery_counts FROM newsletter_campaigns c WHERE c.test_only=false OR $1=true ORDER BY created_at DESC,id DESC LIMIT 100`,[deliveryMode()==='test'])).rows));
    admin('post','/controlled-test/tick',async(req,res)=>{
      if(deliveryMode()!=='test')throw problem('Controlled testing is disabled.',403);
      await tick(true);res.json({success:true,testRecipient});
    });
    admin('post','/campaigns',saveCampaign);
    admin('put','/campaigns/:id',saveCampaign);
    admin('post','/campaigns/:id/queue',queueCampaign);
    admin('post','/campaigns/:id/cancel',async(req,res)=>{const row=await one("UPDATE newsletter_campaigns SET status='canceled',revision=revision+1,updated_at=$1 WHERE id=$2 AND revision=$3 AND status IN ('draft','scheduled') RETURNING *",[clock(),req.params.id,req.body.revision]);if(!row)throw problem('This send has already started or changed. Refresh its status.',409);res.json(row);});
    admin('post','/campaigns/:id/resume',async(req,res)=>{await mailer();if(deliveryMode()!=='live'||env.NEWSLETTER_WORKER_ENABLED!=='true')throw problem('Sending is disabled.',503);const row=await one("UPDATE newsletter_campaigns SET status='scheduled',scheduled_at=$1,error=NULL,revision=revision+1 WHERE id=$2 AND revision=$3 AND status='interrupted' AND test_only=false RETURNING *",[clock(),req.params.id,req.body.revision]);if(!row)throw problem('Only an interrupted send can resume its never-attempted recipients.',409);res.json(row);});
    admin('get','/campaigns/:id/deliveries',async(req,res)=>res.json((await q('SELECT email,status,attempted_at,finished_at,detail FROM newsletter_deliveries WHERE campaign_id=$1 ORDER BY id',[req.params.id])).rows));
    admin('post','/preview',async(req,res)=>{const x=campaignInput(req.body);res.json(await emailContent({subject:x.subject,content:x.content,segment:x.segment,blog_post_id:x.blogId}));});
    // The old one-step broadcast must not bypass drafts, preferences or verification.
    admin('post','/send',async()=>{throw problem('Create or open a newsletter draft, then choose Send now.',409);});
  }
  async function deleteBlog(id) {
    return transaction(async c=>{
      const sending=(await c.query("SELECT id FROM newsletter_campaigns WHERE blog_post_id=$1 AND status='sending' FOR UPDATE",[id])).rows[0];
      if(sending)throw problem('The article email is sending. Please wait before deleting this post.',409);
      await c.query("UPDATE newsletter_campaigns SET status='canceled',revision=revision+1 WHERE blog_post_id=$1 AND status IN ('draft','scheduled')",[id]);
      await c.query('DELETE FROM blog_posts WHERE id=$1',[id]);
    });
  }
  return {initialize,register,saveBlog,deleteBlog,start,stop,tick,protect,clientIP};
}
module.exports={createNewsletterService};
