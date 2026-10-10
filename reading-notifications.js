'use strict';
const crypto = require('node:crypto');
const ADMIN = 'lucehealing13@gmail.com';
const safeCode = e => ['EAUTH','ECONNECTION','ETIMEDOUT','ESOCKET','EENVELOPE','SMTP_UNAVAILABLE','SMTP_REJECTED'].includes(e?.code) ? e.code : 'DELIVERY_ERROR';
function createReadingNotifications({pool, getTransporter, stripe, logger=console}) {
  const q = (sql,args=[]) => pool.query(sql,args);
  let timer, busy=false;
  async function initialize() {
    await q(`ALTER TABLE astrology_reading_orders ADD COLUMN IF NOT EXISTS amount_paid INTEGER,
      ADD COLUMN IF NOT EXISTS complimentary_evidence TEXT,
      ADD COLUMN IF NOT EXISTS payment_checked_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS payment_check_error TEXT`);
    await q(`CREATE TABLE IF NOT EXISTS reading_notifications (
      id SERIAL PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES astrology_reading_orders(id),
      kind TEXT NOT NULL CHECK(kind IN ('received','confirmed_admin','confirmed_customer')),
      status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), lease_until TIMESTAMPTZ, lease_token TEXT,
      last_error TEXT, sent_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(order_id,kind))`);
    // Transactional outbox: a committed order always has a committed admin alert.
    await q(`CREATE OR REPLACE FUNCTION enqueue_reading_notifications() RETURNS trigger AS $$
      BEGIN
        INSERT INTO reading_notifications(order_id,kind) VALUES(NEW.id,'received') ON CONFLICT DO NOTHING;
        IF NEW.stripe_payment_status IN ('paid','complimentary') THEN
          IF TG_OP='INSERT' OR OLD.stripe_payment_status NOT IN ('paid','complimentary') THEN
            INSERT INTO reading_notifications(order_id,kind) VALUES(NEW.id,'confirmed_admin'),(NEW.id,'confirmed_customer') ON CONFLICT DO NOTHING;
          END IF;
        END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql`);
    await q(`DO $trigger$ BEGIN DROP TRIGGER IF EXISTS reading_notification_outbox ON astrology_reading_orders;
      CREATE TRIGGER reading_notification_outbox AFTER INSERT OR UPDATE OF stripe_payment_status
      ON astrology_reading_orders FOR EACH ROW EXECUTE FUNCTION enqueue_reading_notifications(); END $trigger$`);
    // Recover previously missed submissions, without re-confirming historical purchases.
    await q(`INSERT INTO reading_notifications(order_id,kind)
      SELECT id,'received' FROM astrology_reading_orders WHERE stripe_payment_status NOT IN ('paid','complimentary')
      ON CONFLICT DO NOTHING`);
  }
  async function submitOrder({name,email,birthDate,birthTime,birthLocation,question,purchaserId,promoCode}) {
    const values=[name,email.trim(),birthDate,birthTime||null,birthLocation,question,purchaserId];
    if (!promoCode) return (await q(`INSERT INTO astrology_reading_orders
      (client_name,email,birth_date,birth_time,birth_location,question,luce_customer_id)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *,3300 AS checkout_amount`,values)).rows[0];
    if(typeof promoCode!=='string'||promoCode.length>100) throw Object.assign(new Error('Invalid promotion code'),{status:400});
    const row=(await q(`WITH promotion AS (
      UPDATE promo_codes SET times_used=COALESCE(times_used,0)+1
      WHERE upper(code)=upper($8) AND active=1 AND discount_percent BETWEEN 1 AND 100
        AND (expires_at IS NULL OR expires_at>NOW()) AND (max_uses IS NULL OR COALESCE(times_used,0)<max_uses)
      RETURNING id,discount_percent
    ) INSERT INTO astrology_reading_orders(client_name,email,birth_date,birth_time,birth_location,question,
      luce_customer_id,stripe_payment_status,amount_paid,complimentary_evidence)
      SELECT $1,$2,$3,$4,$5,$6,$7,CASE WHEN discount_percent=100 THEN 'complimentary' ELSE 'pending' END,
      CASE WHEN discount_percent=100 THEN 0 ELSE NULL END,
      CASE WHEN discount_percent=100 THEN 'Authorized promotion #'||id::text ELSE NULL END FROM promotion
      RETURNING *, (SELECT 3300*(100-discount_percent)/100 FROM promotion) AS checkout_amount`,[...values,promoCode.trim()])).rows[0];
    if(!row) throw Object.assign(new Error('This promotion code is invalid, expired, or fully used.'),{status:400});
    return row;
  }
  async function handleSession(session) {
    if (session.metadata?.type !== 'astrology_reading') return false;
    const order=(await q('SELECT * FROM astrology_reading_orders WHERE stripe_session_id=$1 OR (id::text=$2 AND stripe_session_id IS NULL)',[session.id,session.metadata.reading_order_id||''])).rows[0];
    if (!order) throw Object.assign(new Error('Reading order not yet available'),{code:'ORDER_NOT_READY'});
    let status;
    const amount=session.amount_total;
    const complete=session.status==='complete';
    if (complete && session.currency==='usd' && Number.isInteger(amount) && amount>=0 &&
        (session.payment_status==='paid' || (session.payment_status==='no_payment_required' && amount===0))) {
      status=amount===0?'complimentary':'paid';
    } else if (session.status==='expired') status='expired';
    if (status) await q(`UPDATE astrology_reading_orders SET stripe_payment_status=$2,
      amount_paid=CASE WHEN $2 IN ('paid','complimentary') THEN $3 ELSE amount_paid END,
      complimentary_evidence=CASE WHEN $2='complimentary' THEN $4 ELSE complimentary_evidence END,
      payment_checked_at=NOW(),payment_check_error=NULL
      WHERE id=$1 AND stripe_payment_status NOT IN ('paid','complimentary')`,
      [order.id,status,status==='paid'?amount:0,status==='complimentary'?'Stripe completed zero-total checkout '+session.id:null]);
    else await q('UPDATE astrology_reading_orders SET payment_checked_at=NOW(),payment_check_error=NULL WHERE id=$1',[order.id]);
    return true;
  }
  async function reconcile() {
    if (!stripe) return;
    const orders=(await q(`SELECT id,stripe_session_id FROM astrology_reading_orders
      WHERE stripe_payment_status='pending' AND stripe_session_id IS NOT NULL
      AND (payment_checked_at IS NULL OR payment_checked_at<NOW()-INTERVAL '5 minutes')
      ORDER BY payment_checked_at NULLS FIRST,id LIMIT 10`)).rows;
    for (const order of orders) {
      try { await handleSession(await stripe.checkout.sessions.retrieve(order.stripe_session_id,{}, {timeout:10000,maxNetworkRetries:1})); }
      catch(e) {
        await q("UPDATE astrology_reading_orders SET payment_checked_at=NOW(),payment_check_error='STRIPE_CHECK_FAILED' WHERE id=$1",[order.id]);
        logger.error('Reading payment check failed',{orderId:order.id,code:'STRIPE_CHECK_FAILED'});
      }
    }
  }
  function mailFor(row, job) {
    const comp=row.stripe_payment_status==='complimentary';
    const ready=['paid','complimentary'].includes(row.stripe_payment_status);
    const details=`Order #${row.id}\nOrder date (UTC): ${new Date(row.created_at).toISOString()}\nReading: $33 One-Question Email Reading\nName: ${row.client_name}\nEmail: ${row.email}\nQuestion: ${row.question}\nBirth date: ${row.birth_date}\nBirth time: ${row.birth_time||'Not provided'}\nBirth location: ${row.birth_location}\nListed price: $${(row.price/100).toFixed(2)}\nActual payment status: ${row.stripe_payment_status}\nAmount paid: ${row.amount_paid==null?'Not recorded':'$'+(row.amount_paid/100).toFixed(2)}\nComplimentary: ${comp?'Yes — '+row.complimentary_evidence:row.stripe_payment_status==='paid'?'No':'Not verified'}\n`;
    const customer=job.kind==='confirmed_customer';
    const label=job.kind==='received'?'Order Received':comp?'Complimentary Reading Confirmed':'Payment Confirmed';
    return {from:`"Luce Healing" <${ADMIN}>`,to:customer?row.email:ADMIN,replyTo:ADMIN,
      messageId:`<luce-reading-${row.id}-${job.kind}@lucehealing.com>`,
      subject:customer?'Your Astrology Reading is Confirmed ✦':`${label} — One-Question Reading #${row.id}`,
      text:customer?`Hi ${row.client_name},\n\nYour ${comp?'complimentary ':''}reading is confirmed. I've received your question and will deliver your personalized astrology reading within 1–3 days by email.\n\n${details}\nIf you have anything to add, simply reply to this email.\n\nWith love and light,\nChristina\nLuce Healing`:
      `${label}\n\n${details}\nAction required: ${ready?'Deliver the reading within 1–3 days.':'Review this request. Payment is NOT confirmed. Do not fulfill or send a paid-order confirmation until payment or an authorized complimentary arrangement is verified.'}\n\nOpen the Luce Healing admin dashboard to review the order.`};
  }
  async function deliver() {
    for(let i=0;i<20;i++) {
      const token=crypto.randomUUID();
      const job=(await q(`UPDATE reading_notifications SET status='sending',attempts=attempts+1,
        lease_until=NOW()+INTERVAL '5 minutes',lease_token=$1
        WHERE id=(SELECT id FROM reading_notifications WHERE
          (status IN ('queued','retry') AND next_attempt_at<=NOW()) OR (status='sending' AND lease_until<NOW())
          ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,[token])).rows[0];
      if(!job) break;
      try {
        const row=(await q('SELECT * FROM astrology_reading_orders WHERE id=$1',[job.order_id])).rows[0];
        if(job.kind!=='received' && !['paid','complimentary'].includes(row.stripe_payment_status)) throw Object.assign(new Error(),{code:'INVALID_PAYMENT_STATE'});
        const transporter=getTransporter();
        if(!transporter) throw Object.assign(new Error(),{code:'SMTP_UNAVAILABLE'});
        const mail=mailFor(row,job), result=await transporter.sendMail(mail);
        if(!result?.accepted?.some(address=>String(address).toLowerCase()===mail.to.toLowerCase())) throw Object.assign(new Error(),{code:'SMTP_REJECTED'});
        await q("UPDATE reading_notifications SET status='sent',sent_at=NOW(),last_error=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2",[job.id,token]);
        logger.info('Reading notification accepted by SMTP',{orderId:job.order_id,kind:job.kind});
      } catch(e) {
        const code=safeCode(e), delay=Math.min(3600,30*2**Math.min(job.attempts-1,7));
        await q(`UPDATE reading_notifications SET status='retry',last_error=$3,
          next_attempt_at=NOW()+($4 * INTERVAL '1 second'),lease_until=NULL WHERE id=$1 AND lease_token=$2`,[job.id,token,code,delay]);
        logger.error('Reading notification delivery failed',{orderId:job.order_id,kind:job.kind,code});
      }
    }
  }
  async function tick() {
    if(busy)return;busy=true;
    try {await deliver();await reconcile();await deliver();} catch(e) {logger.error('Reading notification worker failed',{code:'WORKER_ERROR'});} finally {busy=false;}
  }
  function start(){if(timer)return;void tick();timer=setInterval(()=>void tick(),15000);timer.unref?.();}
  function stop(){clearInterval(timer);timer=null;}
  return {initialize,submitOrder,handleSession,reconcile,deliver,tick,start,stop,mailFor};
}
module.exports={createReadingNotifications};
