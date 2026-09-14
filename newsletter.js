const crypto = require('crypto');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function createNewsletterHandlers({ dbGet, dbAll, dbRun, getTransporter }) {
  async function subscribe(req, res) {
    try {
      const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const name = typeof req.body.name === 'string' ? req.body.name.trim().slice(0, 120) : '';
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
      const existing = await dbGet('SELECT id, active FROM newsletter_subscribers WHERE lower(email) = $1', [email]);
      if (existing) {
        if (!existing.active) await dbRun('UPDATE newsletter_subscribers SET active = 1, name = $1, unsubscribe_token = $2 WHERE id = $3', [name, crypto.randomBytes(32).toString('hex'), existing.id]);
      } else {
        await dbRun(`INSERT INTO newsletter_subscribers (email, name, active, source, unsubscribe_token) VALUES ($1, $2, 1, $3, $4)
          ON CONFLICT (email) DO UPDATE SET active = 1`, [email, name, typeof req.body.source === 'string' ? req.body.source.slice(0, 80) : 'luce-healing', crypto.randomBytes(32).toString('hex')]);
      }
      return res.json({ success: true, message: 'You’re subscribed. Look out for the next Luce Healing email.' });
    } catch (_) { return res.status(500).json({ error: 'We couldn’t save your signup. Please try again.' }); }
  }
  async function unsubscribe(req, res) {
    const token = req.body.token;
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ error: 'This unsubscribe link is invalid.' });
    try {
      const sub = await dbGet('SELECT id FROM newsletter_subscribers WHERE unsubscribe_token = $1', [token]);
      if (!sub) return res.status(404).json({ error: 'This link is no longer valid. Please use the link in your latest email.' });
      await dbRun('UPDATE newsletter_subscribers SET active = 0 WHERE id = $1', [sub.id]);
      return res.json({ success: true, message: 'You’re unsubscribed from Luce Healing emails.' });
    } catch (_) { return res.status(500).json({ error: 'We couldn’t update your subscription. Please try again.' }); }
  }
  let sending = false;
  async function send(req, res) {
    if (sending) return res.status(409).json({ error: 'A newsletter is already sending. Please wait before sending another.' });
    const transporter = getTransporter();
    if (!transporter) return res.status(503).json({ error: 'Email is not configured. No newsletter was sent.' });
    sending = true;
    try {
      const { blogPostId, subject: customSubject } = req.body;
      let subject, content, postSlug;
      if (blogPostId) {
        const post = await dbGet('SELECT * FROM blog_posts WHERE id = $1 AND published = 1', [blogPostId]);
        if (!post) return res.status(404).json({ error: 'Published blog post not found. No newsletter was sent.' });
        subject = customSubject || 'New from Luce Healing: ' + post.title;
        content = `<h1 style="color:#392c44">${escapeHtml(post.title)}</h1>${post.content || `<p>${escapeHtml(post.excerpt)}</p>`}`;
        postSlug = post.slug;
      } else if (typeof customSubject === 'string' && customSubject.trim()) {
        subject = customSubject;
        content = `<p>${escapeHtml(req.body.content)}</p>`;
      } else return res.status(400).json({ error: 'Choose a blog post or enter a subject.' });
      const smtpUser = await dbGet("SELECT value FROM admin_settings WHERE key = 'smtp_user'");
      if (!smtpUser?.value) return res.status(503).json({ error: 'Email sender is not configured. No newsletter was sent.' });
      // Check connectivity before recording an attempted campaign.
      await transporter.verify();
      const subscribers = await dbAll('SELECT id, email, name, unsubscribe_token FROM newsletter_subscribers WHERE active = 1');
      const unique = [...new Map(subscribers.map(s => [s.email.trim().toLowerCase(), s])).values()];
      if (!unique.length) return res.json({ success: true, recipientCount: 0, failedCount: 0 });
      const sendId = crypto.randomUUID();
      await dbRun('INSERT INTO newsletter_sends (send_id, blog_post_id, subject, recipients_count) VALUES ($1, $2, $3, $4)', [sendId, blogPostId || null, subject, 0]);
      let accepted = 0, failed = 0;
      for (const sub of unique) {
        try {
          const token = sub.unsubscribe_token || crypto.randomBytes(32).toString('hex');
          if (!sub.unsubscribe_token) await dbRun('UPDATE newsletter_subscribers SET unsubscribe_token = $1 WHERE id = $2', [token, sub.id]);
          const unsubscribeUrl = `https://lucehealing.com/unsubscribe?token=${token}`;
          const emailB64 = encodeURIComponent(Buffer.from(sub.email).toString('base64'));
          const postUrl = postSlug ? `https://lucehealing.com/blog/${encodeURIComponent(postSlug)}` : 'https://lucehealing.com';
          const clickUrl = `https://lucehealing.com/api/newsletter/click/${sendId}/${emailB64}?url=${encodeURIComponent(postUrl)}`;
          const html = `<div style="max-width:640px;margin:auto;font-family:Georgia,serif;line-height:1.8;color:#332b3b">
            <div style="background:#624373;color:white;padding:24px;font-size:26px;text-align:center">Luce Healing</div>
            <div style="padding:24px">${content}<p><a href="${clickUrl}" style="color:#624373">Read on the website →</a></p>
            <p style="padding:20px;background:#f1ebf5">Want personal insight? <a href="https://lucehealing.com/reading" style="color:#513262">Ask One Question — $33</a></p></div>
            <footer style="padding:20px;font:13px Arial,sans-serif;color:#62566b;text-align:center">You subscribed to Luce Healing emails.<br><a href="${unsubscribeUrl}" style="color:#624373">Unsubscribe</a> · <a href="https://lucehealing.com" style="color:#624373">Luce Healing</a></footer>
            <img src="https://lucehealing.com/api/newsletter/open/${sendId}/${emailB64}" width="1" height="1" alt=""></div>`;
          const result = await transporter.sendMail({ from: { name: 'Christina at Luce Healing', address: smtpUser.value }, to: sub.email, subject, html,
            text: `${subject}\n\n${content.replace(/<[^>]*>/g, ' ')}\n\nRead online: ${postUrl}\nAsk One Question — $33: https://lucehealing.com/reading\nUnsubscribe: ${unsubscribeUrl}` });
          if (result.accepted?.length) accepted++; else failed++;
        } catch (_) { failed++; }
      }
      await dbRun('UPDATE newsletter_sends SET recipients_count = $1 WHERE send_id = $2', [accepted, sendId]);
      if (failed) return res.status(502).json({ success: false, recipientCount: accepted, failedCount: failed, error: `${accepted} emails accepted by the email provider; ${failed} failed. Do not resend to everyone, as that could create duplicates.` });
      return res.json({ success: true, recipientCount: accepted, failedCount: 0 });
    } catch (_) { return res.status(500).json({ error: 'Newsletter sending could not complete. Check email settings and send history before retrying.' }); }
    finally { sending = false; }
  }
  return { subscribe, unsubscribe, send };
}
module.exports = { createNewsletterHandlers };
