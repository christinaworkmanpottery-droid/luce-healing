// Complimentary entitlements never create or modify Stripe billing records.
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const normalize=value=>typeof value==='string'?value.trim().toUpperCase():'';
function createComplimentary({q,now,scheduleInstant}) {
 const active=m=>!!m.complimentary_granted_at&&(!m.complimentary_until||new Date(m.complimentary_until)>now());
 async function initialize(){
  await q(`ALTER TABLE luce_members ADD COLUMN IF NOT EXISTS complimentary_granted_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS complimentary_until TIMESTAMPTZ`);
  await q(`CREATE TABLE IF NOT EXISTS luce_complimentary_codes(
   id SERIAL PRIMARY KEY,code TEXT UNIQUE NOT NULL,name TEXT NOT NULL,active BOOLEAN NOT NULL DEFAULT true,
   max_redemptions INTEGER CHECK(max_redemptions>0),duration_days INTEGER CHECK(duration_days>0),expires_at TIMESTAMPTZ,
   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),CHECK(duration_days IS NULL OR expires_at IS NULL))`);
  await q(`CREATE TABLE IF NOT EXISTS luce_complimentary_redemptions(
   id SERIAL PRIMARY KEY,code_id INTEGER NOT NULL REFERENCES luce_complimentary_codes(id),member_id INTEGER NOT NULL REFERENCES luce_members(id),
   redeemed_at TIMESTAMPTZ NOT NULL,access_until TIMESTAMPTZ,UNIQUE(code_id,member_id))`);
 }
 async function redeem(c,memberId,value){
  const code=normalize(value);if(!/^[A-Z0-9_-]{3,64}$/.test(code))throw fail('Enter a valid complimentary access code.');
  const m=(await c.query('SELECT * FROM luce_members WHERE id=$1 FOR UPDATE',[memberId])).rows[0];
  if(!m||m.is_test)throw fail('Use a regular Luce account to redeem complimentary access.',409);
  const p=(await c.query('SELECT * FROM luce_complimentary_codes WHERE code=$1 FOR UPDATE',[code])).rows[0];
  if(!p)throw fail('This complimentary code is invalid or unavailable.');
  const previous=(await c.query('SELECT id FROM luce_complimentary_redemptions WHERE code_id=$1 AND member_id=$2',[p.id,m.id])).rows[0];
  if(previous)return m; // Retries never consume another use or restart the duration.
  if(!p.active||p.expires_at&&new Date(p.expires_at)<=now())throw fail('This complimentary code is invalid or unavailable.');
  if(m.checkout_id||m.stripe_subscription_id&&!['canceled','incomplete_expired'].includes(m.status))throw fail('This account has an existing subscription or checkout. Complimentary codes do not cancel or replace paid billing. Please contact Christina before redeeming.',409);
  if(active(m))throw fail('You already have active complimentary access.',409);
  const used=Number((await c.query('SELECT COUNT(*) AS n FROM luce_complimentary_redemptions WHERE code_id=$1',[p.id])).rows[0].n);
  if(p.max_redemptions!==null&&used>=p.max_redemptions)throw fail('This complimentary code has reached its redemption limit.');
  const until=p.duration_days?new Date(+now()+p.duration_days*86400000):p.expires_at;
  await c.query('INSERT INTO luce_complimentary_redemptions(code_id,member_id,redeemed_at,access_until) VALUES($1,$2,$3,$4)',[p.id,m.id,now(),until]);
  return (await c.query('UPDATE luce_members SET complimentary_granted_at=$1,complimentary_until=$2 WHERE id=$3 RETURNING *',[now(),until,m.id])).rows[0];
 }
 async function create(b){
  const code=normalize(b.code),name=String(b.name||code).trim();
  if(!/^[A-Z0-9_-]{3,64}$/.test(code))throw fail('Use 3–64 letters, numbers, hyphens or underscores for the code.');
  if(!name||name.length>120)throw fail('Use a name of up to 120 characters.');
  if(!['once','multiple'].includes(b.usage))throw fail('Choose single use or multiple uses.');
  const max=b.usage==='once'?1:b.max_redemptions==null||b.max_redemptions===''?null:Number(b.max_redemptions);
  if(max!==null&&(!Number.isInteger(max)||max<1||max>1000000))throw fail('Enter a positive maximum number of redemptions.');
  let days=null,expires=null;
  if(b.expiration==='duration'){days=Number(b.duration_days);if(!Number.isInteger(days)||days<1||days>36500)throw fail('Enter a duration of 1–36,500 days.');}
  else if(b.expiration==='date'){expires=scheduleInstant(b.localTime,b.occurrence);if(expires<=now())throw fail('Choose a future expiration date and time.');}
  else if(b.expiration!=='never')throw fail('Choose when complimentary access expires.');
  const r=await q('INSERT INTO luce_complimentary_codes(code,name,max_redemptions,duration_days,expires_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(code) DO NOTHING RETURNING *',[code,name,max,days,expires]);
  if(!r.rows.length)throw fail('A complimentary code with this name already exists.',409);return r.rows[0];
 }
 async function list(){return (await q(`SELECT c.*,COUNT(r.id)::integer AS redemption_count,
  COALESCE(jsonb_agg(jsonb_build_object('name',m.name,'email',m.email,'redeemed_at',r.redeemed_at,'access_until',r.access_until) ORDER BY r.redeemed_at DESC) FILTER(WHERE r.id IS NOT NULL),'[]'::jsonb) AS redemptions
  FROM luce_complimentary_codes c LEFT JOIN luce_complimentary_redemptions r ON r.code_id=c.id LEFT JOIN luce_members m ON m.id=r.member_id GROUP BY c.id ORDER BY c.created_at DESC,c.id DESC`)).rows;}
 async function setActive(id,value){if(typeof value!=='boolean')throw fail('Choose active or inactive.');const r=await q('UPDATE luce_complimentary_codes SET active=$1 WHERE id=$2 RETURNING *',[value,id]);if(!r.rows.length)throw fail('Code not found.',404);return r.rows[0];}
 return {initialize,active,redeem,create,list,setActive};
}
module.exports={createComplimentary};
