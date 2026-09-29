const path = require('node:path');
const tables = { question: 'astrology_reading_orders', forecast: 'forecast_orders', booking: 'bookings' };
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
function createCustomerLibrary({ pool, session, getMailer = () => null, origin = 'https://lucehealing.com' }) {
  const q = (sql, args) => pool.query(sql, args);
  const one = async (sql, args) => (await q(sql, args)).rows[0];
  async function initialize() {
    for (const table of Object.values(tables)) {
      await q(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS luce_customer_id INTEGER REFERENCES luce_members(id)`);
      await q(`CREATE INDEX IF NOT EXISTS ${table}_customer_email ON ${table}(lower(trim(email)))`);
    }
    await q(`CREATE TABLE IF NOT EXISTS luce_customer_readings (
      order_kind TEXT NOT NULL, order_id INTEGER NOT NULL, reading_text TEXT NOT NULL DEFAULT '',
      pdf BYTEA, pdf_name TEXT, revision INTEGER NOT NULL DEFAULT 1, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(order_kind,order_id), CHECK(order_kind IN ('question','forecast','booking')))`);
    await q('ALTER TABLE luce_customer_readings ADD COLUMN IF NOT EXISTS notified_revision INTEGER NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS notification_pending_at TIMESTAMPTZ');
  }
  async function customer(req) {
    const m = await session(req);
    if (!m) throw fail('Please sign in to your Luce account.', 401);
    if (!m.verified_at) throw fail('Confirm your email to see purchases made with that address.', 403);
    if (m.is_test) throw fail('Use your customer account to view purchases.', 403);
    return m;
  }
  function key(kind, id) {
    if (!tables[kind] || !/^[1-9][0-9]{0,9}$/.test(String(id))) throw fail('Purchase not found.', 404);
    return tables[kind];
  }
  async function order(kind, id, member) {
    const table = key(kind, id);
    const args = [id];
    const ownership = member ? ' AND (luce_customer_id=$2 OR (luce_customer_id IS NULL AND lower(trim(email))=$3))' : '';
    if (member) args.push(member.id, member.email.trim().toLowerCase());
    const row = await one(`SELECT * FROM ${table} WHERE id=$1 AND stripe_payment_status='paid'${ownership}`, args);
    if (!row) throw fail('Purchase not found.', 404);
    return row;
  }
  function summary(kind, row, doc) {
    const chartNames = { 'chart-written':'Written Birth Chart Reading', 'chart-30min':'Birth Chart + 30-Minute Consultation', 'chart-60min':'Birth Chart + 60-Minute Consultation' };
    const title = kind === 'question' ? 'Ask One Question' : kind === 'forecast' ? (row.forecast_type === '12month' ? '12-Month Forecast' : '6-Month Forecast') : chartNames[row.session_type] || 'Healing / Support Session';
    const hasReading = !!(doc?.reading_text || doc?.has_pdf);
    return { kind, id: row.id, title, recipient: row.client_name, purchasedAt: row.created_at,
      amount: kind === 'booking' ? row.amount_paid : row.price, ready: hasReading,
      isReading: kind !== 'booking' || String(row.session_type).startsWith('chart-'),
      ...(kind === 'booking' ? { date: row.date, time: row.time, status: row.cancelled ? 'cancelled' : row.status, format: row.session_format } : {}) };
  }
  async function document(kind, id) {
    return one('SELECT reading_text,pdf_name,pdf IS NOT NULL AS has_pdf,revision,updated_at,notified_revision,notified_at FROM luce_customer_readings WHERE order_kind=$1 AND order_id=$2', [kind,id]);
  }
  async function notificationEmail(row) {
    if(row.luce_customer_id){const owner=await one('SELECT email FROM luce_members WHERE id=$1',[row.luce_customer_id]);return owner?.email||null;}
    return row.email?.trim().toLowerCase();
  }
  const wrap = fn => async (req,res) => { try { res.set('Cache-Control','private, no-store'); await fn(req,res); } catch(e) { res.status(e.status || 500).json({error:e.status?e.message:'Unable to load this purchase. Please try again.'}); } };
  function register(app, adminAuth) {
    app.use(['/api/customer-library','/api/admin/customer-readings'], (req,res,next) => { res.set({'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow, noarchive','Referrer-Policy':'no-referrer'});next(); });
    app.get('/api/customer-library', wrap(async (req,res) => {
      const m = await customer(req), result = [];
      for (const [kind,table] of Object.entries(tables)) {
        const rows = (await q(`SELECT o.*,d.reading_text <> '' OR d.pdf IS NOT NULL AS ready FROM ${table} o LEFT JOIN luce_customer_readings d ON d.order_kind=$1 AND d.order_id=o.id
          WHERE o.stripe_payment_status='paid' AND (o.luce_customer_id=$2 OR (o.luce_customer_id IS NULL AND lower(trim(o.email))=$3))`,[kind,m.id,m.email.trim().toLowerCase()])).rows;
        result.push(...rows.map(r=>summary(kind,r,r.ready?{has_pdf:true}:null)));
      }
      result.sort((a,b)=>new Date(b.purchasedAt)-new Date(a.purchasedAt));
      res.json(result);
    }));
    app.get('/api/customer-library/:kind/:id',wrap(async(req,res)=>{
      const m=await customer(req), {kind,id}=req.params, row=await order(kind,id,m), doc=await document(kind,id);
      res.json({...summary(kind,row,doc),text:doc?.reading_text || '',hasPdf:!!doc?.has_pdf,pdfName:doc?.pdf_name || null,updatedAt:doc?.updated_at || null});
    }));
    app.get('/api/customer-library/:kind/:id/pdf',wrap(async(req,res)=>{
      const m=await customer(req), {kind,id}=req.params;await order(kind,id,m);
      const doc=await one('SELECT pdf,pdf_name FROM luce_customer_readings WHERE order_kind=$1 AND order_id=$2',[kind,id]);
      if(!doc?.pdf)throw fail('No PDF has been attached yet.',404);
      res.set({'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="'+(doc.pdf_name || 'Luce-Reading.pdf')+'"','X-Content-Type-Options':'nosniff'}).send(Buffer.from(doc.pdf));
    }));
    app.get('/api/admin/customer-readings/:kind/:id',adminAuth,wrap(async(req,res)=>{
      const {kind,id}=req.params,row=await order(kind,id),doc=await document(kind,id);
      res.json({...summary(kind,row,doc),text:doc?.reading_text||'',pdfName:doc?.pdf_name||null,revision:doc?.revision||0,notificationEmail:await notificationEmail(row),notifiedRevision:doc?.notified_revision||0,notifiedAt:doc?.notified_at||null});
    }));
    app.put('/api/admin/customer-readings/:kind/:id',adminAuth,wrap(async(req,res)=>{
      const {kind,id}=req.params;await order(kind,id);
      const {text,revision,pdfBase64,pdfName,removePdf}=req.body;
      if(typeof text!=='string'||text.length>250000||!Number.isInteger(revision)||revision<0)throw fail('Check the reading text and reopen this editor.');
      let pdf=null, name=null;
      if(pdfBase64!==undefined){
        if(typeof pdfBase64!=='string'||pdfBase64.length>11200000||! /^[A-Za-z0-9+/]+={0,2}$/.test(pdfBase64))throw fail('Choose a PDF up to 8 MB.');
        pdf=Buffer.from(pdfBase64,'base64');if(pdf.length>8*1024*1024||pdf.subarray(0,5).toString()!=='%PDF-')throw fail('Choose a valid PDF up to 8 MB.');
        name=path.basename(String(pdfName||'Luce-Reading.pdf')).replace(/[^a-zA-Z0-9_. -]/g,'').slice(0,100)||'Luce-Reading.pdf';
        if(!name.toLowerCase().endsWith('.pdf'))name+='.pdf';
      }
      const previous=await document(kind,id);
      if(!text.trim()&&!pdf&&(!previous?.has_pdf||removePdf))throw fail('Add the reading text or a PDF before saving.');
      const result=await q(`INSERT INTO luce_customer_readings(order_kind,order_id,reading_text,pdf,pdf_name,revision)
        SELECT $1,$2,$3,$4,$5,1 WHERE $6=0
        ON CONFLICT(order_kind,order_id) DO NOTHING RETURNING revision`,[kind,id,text,pdf,name,revision]);
      let saved=result.rows[0];
      if(!saved&&revision>0)saved=await one(`UPDATE luce_customer_readings SET reading_text=$3,
        pdf=CASE WHEN $7 THEN NULL ELSE COALESCE($4,pdf) END,pdf_name=CASE WHEN $7 THEN NULL ELSE COALESCE($5,pdf_name) END,
        revision=revision+1,updated_at=NOW() WHERE order_kind=$1 AND order_id=$2 AND revision=$6 RETURNING revision`,[kind,id,text,pdf,name,revision,!!removePdf&&!pdf]);
      if(!saved)throw fail('This reading changed in another window. Reopen it before saving.',409);
      res.json({success:true,revision:saved.revision,message:'Saved to the customer’s purchase. No email was sent.'});
    }));
    app.post('/api/admin/customer-readings/:kind/:id/notify',adminAuth,wrap(async(req,res)=>{
      const {kind,id}=req.params,row=await order(kind,id),doc=await document(kind,id),revision=req.body.revision;
      if(!doc||!Number.isInteger(revision)||revision!==doc.revision)throw fail('Save the reading and reopen it before notifying the customer.',409);
      if(doc.notified_revision>=revision)return res.json({success:true,message:'The customer has already been notified about this saved version.'});
      const mailer=getMailer(),to=await notificationEmail(row);
      if(!mailer||!to||! /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(to))throw fail('The reading is saved, but email is unavailable. Check email settings and retry the notification.',503);
      const claimed=await one(`UPDATE luce_customer_readings SET notification_pending_at=NOW()
        WHERE order_kind=$1 AND order_id=$2 AND revision=$3 AND notified_revision<$3
        AND (notification_pending_at IS NULL OR notification_pending_at<NOW()-INTERVAL '5 minutes') RETURNING notification_pending_at`,[kind,id,revision]);
      if(!claimed)throw fail('A notification is already being sent. Check again shortly.',409);
      try{
        const link=origin.replace(/\/$/,'')+'/my-purchased-readings?order='+kind+':'+id;
        const result=await mailer.sendMail({from:'"Christina at Luce Healing" <lucehealing13@gmail.com>',to,
          subject:'Your reading is ready — Luce Healing',
          text:`Your reading is ready in your Luce Healing account.\n\nOpen your reading: ${link}\n\nSign in with this email address. If you have not created your free Luce account yet, create it with this email and confirm your address to access your purchase.\n\nThis individually purchased reading remains available regardless of your Astrology Membership status.\n\nWith care,\nChristina\nLuce Healing`});
        if(!result?.accepted?.length)throw Error('Not accepted');
        await q('UPDATE luce_customer_readings SET notified_revision=GREATEST(notified_revision,$3),notified_at=NOW(),notification_pending_at=NULL WHERE order_kind=$1 AND order_id=$2',[kind,id,revision]);
        res.json({success:true,message:'Reading saved. The notification email was sent to '+to+'.'});
      }catch(e){
        await q('UPDATE luce_customer_readings SET notification_pending_at=NULL WHERE order_kind=$1 AND order_id=$2',[kind,id]);
        throw fail('The reading is saved, but the notification email could not be sent. Retry the notification; you do not need to save again.',503);
      }
    }));
  }
  return { initialize, register };
}
module.exports={createCustomerLibrary};
