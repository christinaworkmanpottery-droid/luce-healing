const express = require('express');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
const { Pool } = require('pg');

const stripeKey = process.env.STRIPE_SECRET_KEY;
if (!stripeKey) {
  console.warn('WARNING: STRIPE_SECRET_KEY not set. Payment features will not work.');
}
const stripe = stripeKey ? require('stripe')(stripeKey) : null;

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

// ============================================================================
// DATABASE HELPER FUNCTIONS (PostgreSQL)
// ============================================================================

async function dbRun(sql, params = []) {
  await pool.query(sql, params);
}

async function dbGet(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows[0] || null;
}

async function dbAll(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows;
}

// ============================================================================
// CRYPTO HELPERS
// ============================================================================

function hashPassword(password) {
  return crypto.scryptSync(password, 'luce-salt', 64).toString('hex');
}

function verifyPassword(password, hash) {
  return crypto.scryptSync(password, 'luce-salt', 64).toString('hex') === hash;
}

function generateToken(userId) {
  const data = `${userId}:${Date.now()}`;
  return Buffer.from(data).toString('base64');
}

function verifyToken(token) {
  try {
    const data = Buffer.from(token, 'base64').toString('utf-8');
    const [userId] = data.split(':');
    return parseInt(userId);
  } catch {
    return null;
  }
}

// ============================================================================
// DATABASE INITIALIZATION
// ============================================================================

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL,
      date_of_birth TEXT,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id SERIAL PRIMARY KEY,
      client_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      date_of_birth TEXT,
      session_type TEXT NOT NULL,
      duration INTEGER NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      session_format TEXT,
      is_pack INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      stripe_session_id TEXT,
      stripe_payment_status TEXT,
      notes TEXT,
      original_booking_id INTEGER,
      cancelled INTEGER DEFAULT 0,
      cancelled_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS availability (
      id SERIAL PRIMARY KEY,
      day_of_week INTEGER NOT NULL UNIQUE,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      is_available INTEGER DEFAULT 1
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS blocked_times (
      id SERIAL PRIMARY KEY,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      reason TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS clients (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL,
      date_of_birth TEXT,
      notes TEXT,
      sessions_remaining INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS blog_posts (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL,
      excerpt TEXT,
      published INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS newsletter_subscribers (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      subscribed_at TIMESTAMP DEFAULT NOW(),
      active INTEGER DEFAULT 1
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reviews (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      rating INTEGER NOT NULL,
      review_text TEXT NOT NULL,
      session_type TEXT,
      approved INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS page_views (
      id SERIAL PRIMARY KEY,
      path TEXT NOT NULL,
      referrer TEXT,
      user_agent TEXT,
      ip TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS recurring_blocks (
      id SERIAL PRIMARY KEY,
      day_of_week INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      reason TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_settings (
      id SERIAL PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL
    )
  `);

  // Seed default availability if empty
  const availCount = await dbGet('SELECT COUNT(*) as count FROM availability');
  if (parseInt(availCount.count) === 0) {
    const defaults = [
      [0, '09:00', '18:00'], // Monday
      [1, '09:00', '18:00'], // Tuesday
      [2, '09:00', '18:00'], // Wednesday
      [3, '09:00', '18:00'], // Thursday
      [4, '09:00', '18:00'], // Friday
      [5, '10:00', '14:00'], // Saturday
    ];
    for (const [day, start, end] of defaults) {
      await dbRun('INSERT INTO availability (day_of_week, start_time, end_time, is_available) VALUES ($1, $2, $3, 1)', [day, start, end]);
    }
  }

  // Seed blog posts if empty
  const blogCount = await dbGet('SELECT COUNT(*) as count FROM blog_posts');
  if (parseInt(blogCount.count) === 0) {
    const posts = [
      {
        title: "You Are Your Own Healer",
        slug: "you-are-your-own-healer",
        excerpt: "Understanding that no one can heal you but yourself — and why that's empowering.",
        content: '<p>One of the most important truths I\'ve learned through decades of energy work is this: <strong>I don\'t heal you. You heal yourself.</strong></p><p>No one else can do it for you. Not me, not another healer, not a doctor, not anyone.</p><p>What I do is move energy. I clear what\'s blocking you. I give you tools. I hold space while you remember your own power. But the actual healing work? That happens inside you.</p><h3>Why This Matters</h3><p>When you understand this, everything shifts. You stop waiting for someone to fix you. You stop giving away your power to an external source. Instead, you step into the truth: <strong>you were never broken in the first place.</strong></p><p>You\'re simply stuck. Blocked. Full of energy that isn\'t flowing, emotions that aren\'t moving, old stories that are taking up space.</p><h3>My Role</h3><p>What I do is help you unstick. I work with the energy around you and within you. I show you where things are congested. I move the stagnant energy. I give you practices and tools to continue that work on your own.</p><p>But the transformation? That\'s all you.</p><p>Every shift you feel after our session — that clarity, that lightness, that sense of possibility — that\'s you doing your own healing work.</p><h3>This Is Empowering</h3><p>It might sound like I\'m saying "I can\'t help you," but it\'s actually the opposite. I\'m saying you\'re more powerful than you think. You don\'t need rescuing. You need remembering.</p><p>When you own your own healing, you own your own power. And that changes everything.</p>'
      },
      {
        title: "What to Expect in an Energy Healing Session",
        slug: "what-to-expect-in-energy-healing",
        excerpt: "Demystifying the process so you feel safe, grounded, and empowered.",
        content: '<p>If you\'ve never had an energy healing session before, it\'s natural to wonder what\'s going to happen.</p><h3>Before Your Session</h3><p>Come as you are. No special preparation needed. You might want to wear something comfortable and avoid heavy meals right before.</p><h3>The Beginning</h3><p>We start with a conversation. I want to know what brought you here. What are you hoping for? What\'s weighing on you?</p><h3>The Work</h3><p>Depending on whether you\'re in-person or distance, you\'ll either lie on a table or settle into a comfortable position. I\'ll guide you into a relaxed state.</p><p>What happens next varies. Some people feel warmth, tingling, movement of energy. Some feel deeply relaxed. Some see colors or images. All of this is normal and valuable.</p><h3>After the Session</h3><p>The real work often happens after we\'re done. Insights emerge. Emotions move. You might sleep deeply or feel unusually awake.</p>'
      },
      {
        title: "Why Your Space Holds Energy (And How to Clear It)",
        slug: "why-space-holds-energy",
        excerpt: "Understanding how environments absorb energy — and why clearing them matters.",
        content: '<p>Your home is alive with energy. Not metaphorically — literally.</p><p>Every space absorbs the energy of everyone who\'s been in it. The emotions. The conflicts. The grief. The joy. It all gets stored.</p><h3>How It Affects You</h3><p>When you live or work in a space full of stuck energy, you absorb it. It drains you. Makes it harder to sleep. Creates subtle anxiety or sadness you can\'t quite explain.</p><h3>How to Clear It</h3><ul><li><strong>Intentional cleansing:</strong> Open windows. Let sunlight and fresh air move through.</li><li><strong>Sound:</strong> Ring bells, play certain music, clap your hands in corners.</li><li><strong>Smoke or incense:</strong> Sage, palo santo, or other sacred plants.</li><li><strong>Salt:</strong> Place salt in corners or around doorways.</li></ul><p>Your space is an extension of you. When it\'s clear and light, you feel clear and light too.</p>'
      }
    ];
    for (const post of posts) {
      await dbRun('INSERT INTO blog_posts (title, slug, content, excerpt, published) VALUES ($1, $2, $3, $4, 1)', 
        [post.title, post.slug, post.content, post.excerpt]);
    }
  }

  // Seed admin password if not set
  const adminPw = await dbGet('SELECT value FROM admin_settings WHERE key = $1', ['admin_password']);
  if (!adminPw) {
    const defaultHash = hashPassword('luce13');
    await dbRun('INSERT INTO admin_settings (key, value) VALUES ($1, $2)', ['admin_password', defaultHash]);
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function timeToMinutes(timeStr) {
  const [hours, mins] = timeStr.split(':').map(Number);
  return hours * 60 + mins;
}

function minutesToTime(mins) {
  const hours = Math.floor(mins / 60);
  const minutes = mins % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function to12HourFormat(timeStr) {
  const [hours, mins] = timeStr.split(':').map(Number);
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHours}:${String(mins).padStart(2, '0')} ${ampm}`;
}

function dateToJS(dateStr) {
  return new Date(dateStr + 'T00:00:00Z');
}

function getDayOfWeek(dateStr) {
  const date = dateToJS(dateStr);
  return (date.getUTCDay() + 6) % 7; // Mon=0, Tue=1, ..., Sun=6
}

function isDatePassed(dateStr) {
  const today = new Date();
  const date = dateToJS(dateStr);
  date.setUTCHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return date < today;
}

async function getAvailableSlots(dateStr, duration) {
  if (isDatePassed(dateStr)) return [];

  const dayOfWeek = getDayOfWeek(dateStr);
  const dayAvail = await dbGet('SELECT * FROM availability WHERE day_of_week = $1', [dayOfWeek]);
  if (!dayAvail || !dayAvail.is_available) return [];

  const startMins = timeToMinutes(dayAvail.start_time);
  const endMins = timeToMinutes(dayAvail.end_time);

  const blocked = await dbAll('SELECT * FROM blocked_times WHERE date = $1', [dateStr]);
  const blockedRanges = blocked.map(b => ({ start: timeToMinutes(b.start_time), end: timeToMinutes(b.end_time) }));

  const recurringBlocks = await dbAll('SELECT * FROM recurring_blocks WHERE day_of_week = $1', [dayOfWeek]);
  const recurringRanges = recurringBlocks.map(b => ({ start: timeToMinutes(b.start_time), end: timeToMinutes(b.end_time) }));

  const allBlockedRanges = blockedRanges.concat(recurringRanges);

  const bookings = await dbAll('SELECT time, duration FROM bookings WHERE date = $1 AND status = $2 AND cancelled = 0', [dateStr, 'completed']);
  const bookedRanges = bookings.map(b => {
    const bookStart = timeToMinutes(b.time);
    return { start: bookStart, end: bookStart + b.duration + 15 };
  });

  const slots = [];
  for (let slotStart = startMins; slotStart + duration <= endMins; slotStart += duration) {
    const slotEnd = slotStart + duration;
    const isBlocked = allBlockedRanges.some(r => slotStart < r.end && slotEnd > r.start);
    const isBooked = bookedRanges.some(r => slotStart < r.end && slotEnd > r.start);
    if (!isBlocked && !isBooked) slots.push(minutesToTime(slotStart));
  }
  return slots;
}

function getPricingInfo() {
  return {
    15: { single: 4500, pack: 12500 },
    30: { single: 6000, pack: 15000 },
    45: { single: 7500, pack: 17500 },
    60: { single: 10000, pack: 25000 },
    90: { single: 14500, pack: 37500 },
    120: { single: 20000, pack: 52500 }
  };
}

// ============================================================================
// AVAILABILITY ENDPOINTS
// ============================================================================

app.get('/api/availability', async (req, res) => {
  try {
    const { date, duration } = req.query;
    if (!date || !duration) return res.status(400).json({ error: 'date and duration required' });
    const slots = await getAvailableSlots(date, parseInt(duration));
    const formattedSlots = slots.map(slot => to12HourFormat(slot));
    res.json({ date, duration: parseInt(duration), slots: formattedSlots });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/availability/week', async (req, res) => {
  try {
    const { start } = req.query;
    if (!start) return res.status(400).json({ error: 'start date required' });
    const startDate = dateToJS(start);
    const weekData = {};
    for (let i = 0; i < 7; i++) {
      const date = new Date(startDate);
      date.setUTCDate(date.getUTCDate() + i);
      const dateStr = date.toISOString().split('T')[0];
      const dayOfWeek = getDayOfWeek(dateStr);
      const dayAvail = await dbGet('SELECT * FROM availability WHERE day_of_week = $1', [dayOfWeek]);
      weekData[dateStr] = dayAvail ? { available: dayAvail.is_available, start: dayAvail.start_time, end: dayAvail.end_time } : { available: false };
    }
    res.json({ start, week: weekData });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// AUTH ENDPOINTS
// ============================================================================

app.post('/api/auth/register', async (req, res) => {
  try {
    const { full_name, email, phone, date_of_birth, password } = req.body;
    if (!full_name || !email || !phone || !password) return res.status(400).json({ error: 'Missing required fields' });
    const existing = await dbGet('SELECT id FROM users WHERE email = $1', [email]);
    if (existing) return res.status(400).json({ error: 'Email already registered' });
    const passwordHash = hashPassword(password);
    await dbRun('INSERT INTO users (full_name, email, phone, date_of_birth, password_hash) VALUES ($1, $2, $3, $4, $5)', [full_name, email, phone, date_of_birth || null, passwordHash]);
    const user = await dbGet('SELECT id, full_name, email, phone, date_of_birth FROM users WHERE email = $1', [email]);
    const token = generateToken(user.id);
    res.json({ success: true, token, user });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const user = await dbGet('SELECT * FROM users WHERE email = $1', [email]);
    if (!user || !verifyPassword(password, user.password_hash)) return res.status(401).json({ error: 'Invalid email or password' });
    const token = generateToken(user.id);
    res.json({ success: true, token, user: { id: user.id, full_name: user.full_name, email: user.email, phone: user.phone, date_of_birth: user.date_of_birth } });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });
    const userId = verifyToken(token);
    if (!userId) return res.status(401).json({ error: 'Invalid token' });
    const user = await dbGet('SELECT id, full_name, email, phone, date_of_birth FROM users WHERE id = $1', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// BOOKING CHECKOUT ENDPOINT
// ============================================================================

app.post('/api/booking/checkout', async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: 'Payment system not configured' });
    const { name, email, phone, date_of_birth, session_type, date, time, duration, is_pack, session_format } = req.body;
    if (!name || !email || !phone || !session_type || !date || !time || !duration || !session_format) return res.status(400).json({ error: 'Missing required fields' });

    const slots = await getAvailableSlots(date, parseInt(duration));
    const slotsFormatted = slots.map(slot => to12HourFormat(slot));
    if (!slotsFormatted.includes(time)) return res.status(400).json({ error: 'Selected time slot is no longer available' });

    const pricing = getPricingInfo();
    const durationInt = parseInt(duration);
    const priceAmount = is_pack ? pricing[durationInt].pack : pricing[durationInt].single;
    const packLabel = is_pack ? ' (3-Pack)' : '';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: `${durationInt}-Minute Energy Healing Session${packLabel}`, description: `Date: ${date}, Time: ${time} PT, Format: ${session_format}` },
          unit_amount: priceAmount
        },
        quantity: 1
      }],
      customer_email: email,
      metadata: { client_name: name, phone, date_of_birth: date_of_birth || '', session_type, date, time, duration: durationInt, is_pack: is_pack ? 'true' : 'false', session_format },
      success_url: `${process.env.DOMAIN || 'http://localhost:3000'}/booking-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.DOMAIN || 'http://localhost:3000'}/booking-cancel.html`
    });
    res.json({ sessionId: session.id, url: session.url });
  } catch (error) {
    console.error('Checkout error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// STRIPE WEBHOOK ENDPOINT
// ============================================================================

app.post('/api/stripe/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_secret';
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (error) {
    console.error('Webhook signature verification failed:', error.message);
    return res.sendStatus(400);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const m = session.metadata;
    let client = await dbGet('SELECT * FROM clients WHERE email = $1', [m.email]);
    if (!client) {
      await dbRun('INSERT INTO clients (name, email, phone, date_of_birth, sessions_remaining) VALUES ($1, $2, $3, $4, $5)', [m.client_name, m.email, m.phone, m.date_of_birth || null, m.is_pack === 'true' ? 3 : 0]);
    } else if (m.is_pack === 'true') {
      await dbRun('UPDATE clients SET sessions_remaining = sessions_remaining + 3 WHERE id = $1', [client.id]);
    }
    await dbRun('INSERT INTO bookings (client_name, email, phone, date_of_birth, session_type, duration, date, time, session_format, is_pack, status, stripe_session_id, stripe_payment_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
      [m.client_name, m.email, m.phone, m.date_of_birth || null, m.session_type, m.duration, m.date, m.time, m.session_format || 'in-person', m.is_pack === 'true' ? 1 : 0, 'completed', session.id, 'paid']);
    console.log(`Booking created for ${m.client_name} on ${m.date} at ${m.time}`);
  }
  res.json({ received: true });
});

// ============================================================================
// ADMIN ENDPOINTS (PASSWORD PROTECTED)
// ============================================================================

async function checkAdminPassword(req, res, next) {
  try {
    const password = req.query.password || req.body.password;
    const record = await dbGet('SELECT value FROM admin_settings WHERE key = $1', ['admin_password']);
    if (!record) return res.status(500).json({ error: 'Admin password not initialized' });
    if (!verifyPassword(password, record.value)) return res.status(401).json({ error: 'Unauthorized' });
    next();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

app.get('/api/admin/calendar', checkAdminPassword, async (req, res) => {
  try {
    const { week_start } = req.query;
    if (!week_start) return res.status(400).json({ error: 'week_start required (YYYY-MM-DD)' });
    const startDate = dateToJS(week_start);
    const endDate = new Date(startDate);
    endDate.setUTCDate(endDate.getUTCDate() + 6);
    const endStr = endDate.toISOString().split('T')[0];

    const availability = await dbAll('SELECT * FROM availability ORDER BY day_of_week');
    const bookings = await dbAll('SELECT * FROM bookings WHERE date >= $1 AND date <= $2 AND cancelled = 0 ORDER BY date, time', [week_start, endStr]);
    const blocked_times = await dbAll('SELECT * FROM blocked_times WHERE date >= $1 AND date <= $2 ORDER BY date, start_time', [week_start, endStr]);
    const recurring_blocks = await dbAll('SELECT * FROM recurring_blocks ORDER BY day_of_week, start_time');
    res.json({ availability, bookings, blocked_times, recurring_blocks });
  } catch (error) {
    console.error('Calendar endpoint error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/bookings', checkAdminPassword, async (req, res) => {
  try {
    const { date } = req.query;
    let query = 'SELECT * FROM bookings';
    let params = [];
    if (date) { query += ' WHERE date = $1'; params.push(date); }
    query += ' ORDER BY date ASC, time ASC';
    const bookings = await dbAll(query, params);
    res.json(bookings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/clients', checkAdminPassword, async (req, res) => {
  try {
    const clients = await dbAll(`
      SELECT c.*, COUNT(DISTINCT b.id) as total_bookings,
        COUNT(DISTINCT CASE WHEN b.status = 'completed' THEN b.id END) as completed_bookings,
        SUM(CASE WHEN b.status = 'completed' AND b.is_pack = 0 THEN 1 ELSE 0 END) as single_sessions_used,
        COUNT(DISTINCT CASE WHEN b.status = 'pending' THEN b.id END) as pending_bookings
      FROM clients c LEFT JOIN bookings b ON c.email = b.email
      GROUP BY c.id, c.name, c.email, c.phone, c.date_of_birth, c.notes, c.sessions_remaining, c.created_at
      ORDER BY c.created_at DESC
    `);
    res.json(clients);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/dashboard', checkAdminPassword, async (req, res) => {
  try {
    const stats = {};
    const revenue = await dbGet(`
      SELECT SUM(
        CASE
          WHEN is_pack = 1 AND duration = 15 THEN 12500 WHEN is_pack = 0 AND duration = 15 THEN 4500
          WHEN is_pack = 1 AND duration = 30 THEN 15000 WHEN is_pack = 0 AND duration = 30 THEN 6000
          WHEN is_pack = 1 AND duration = 45 THEN 17500 WHEN is_pack = 0 AND duration = 45 THEN 7500
          WHEN is_pack = 1 AND duration = 60 THEN 25000 WHEN is_pack = 0 AND duration = 60 THEN 10000
          WHEN is_pack = 1 AND duration = 90 THEN 37500 WHEN is_pack = 0 AND duration = 90 THEN 14500
          WHEN is_pack = 1 AND duration = 120 THEN 52500 WHEN is_pack = 0 AND duration = 120 THEN 20000
        END
      ) as total FROM bookings WHERE status = 'completed'
    `);
    stats.total_revenue = (parseFloat(revenue.total) || 0) / 100;
    const today = new Date().toISOString().split('T')[0];
    const upcoming = await dbGet('SELECT COUNT(*) as count FROM bookings WHERE date >= $1 AND status = $2', [today, 'completed']);
    stats.upcoming_bookings = parseInt(upcoming.count);
    const totalClients = await dbGet('SELECT COUNT(*) as count FROM clients');
    stats.total_clients = parseInt(totalClients.count);
    const completedBookings = await dbGet('SELECT COUNT(*) as count FROM bookings WHERE status = $1', ['completed']);
    stats.completed_bookings = parseInt(completedBookings.count);
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/admin/availability', checkAdminPassword, async (req, res) => {
  try {
    const { availability } = req.body;
    await dbRun('DELETE FROM availability');
    for (const slot of availability) {
      await dbRun('INSERT INTO availability (day_of_week, start_time, end_time, is_available) VALUES ($1, $2, $3, $4)', [slot.day_of_week, slot.start_time, slot.end_time, slot.is_available ? 1 : 0]);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/availability', checkAdminPassword, async (req, res) => {
  try {
    const availability = await dbAll('SELECT * FROM availability ORDER BY day_of_week');
    res.json(availability);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// RECURRING BLOCKS ENDPOINTS
// ============================================================================

app.get('/api/admin/recurring-blocks', checkAdminPassword, async (req, res) => {
  try {
    const blocks = await dbAll('SELECT * FROM recurring_blocks ORDER BY day_of_week, start_time');
    res.json(blocks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/recurring-blocks', checkAdminPassword, async (req, res) => {
  try {
    const { day_of_week, start_time, end_time, reason } = req.body;
    if (day_of_week === undefined || day_of_week === null || !start_time || !end_time) return res.status(400).json({ error: 'day_of_week, start_time, and end_time required' });
    if (day_of_week < 0 || day_of_week > 6) return res.status(400).json({ error: 'day_of_week must be 0-6' });
    await dbRun('INSERT INTO recurring_blocks (day_of_week, start_time, end_time, reason) VALUES ($1, $2, $3, $4)', [day_of_week, start_time, end_time, reason || '']);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/recurring-blocks/:id', checkAdminPassword, async (req, res) => {
  try {
    await dbRun('DELETE FROM recurring_blocks WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/blocks', checkAdminPassword, async (req, res) => {
  try {
    const blocks = await dbAll('SELECT * FROM blocked_times ORDER BY date, start_time');
    res.json(blocks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/block', checkAdminPassword, async (req, res) => {
  try {
    const { date, start_time, end_time, reason } = req.body;
    if (!date || !start_time || !end_time) return res.status(400).json({ error: 'date, start_time, and end_time required' });
    await dbRun('INSERT INTO blocked_times (date, start_time, end_time, reason) VALUES ($1, $2, $3, $4)', [date, start_time, end_time, reason || '']);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/block/:id', checkAdminPassword, async (req, res) => {
  try {
    await dbRun('DELETE FROM blocked_times WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// BLOG ENDPOINTS
// ============================================================================

app.get('/api/blog', async (req, res) => {
  try {
    const posts = await dbAll('SELECT id, title, slug, excerpt, created_at FROM blog_posts WHERE published = 1 ORDER BY created_at DESC');
    res.json(posts);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/blog/latest', async (req, res) => {
  try {
    const posts = await dbAll('SELECT id, title, slug, excerpt, created_at FROM blog_posts WHERE published = 1 ORDER BY created_at DESC LIMIT 3');
    res.json(posts);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/blog/:slug', async (req, res) => {
  try {
    const post = await dbGet('SELECT * FROM blog_posts WHERE slug = $1 AND published = 1', [req.params.slug]);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    res.json(post);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/admin/blog', checkAdminPassword, async (req, res) => {
  try {
    const { title, slug, content, excerpt, published } = req.body;
    if (!title || !slug || !content) return res.status(400).json({ error: 'Missing required fields' });
    await dbRun('INSERT INTO blog_posts (title, slug, content, excerpt, published) VALUES ($1, $2, $3, $4, $5)', [title, slug, content, excerpt || '', published ? 1 : 0]);
    const post = await dbGet('SELECT * FROM blog_posts WHERE slug = $1', [slug]);
    res.json(post);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/admin/blog/:id', checkAdminPassword, async (req, res) => {
  try {
    const { title, slug, content, excerpt, published } = req.body;
    if (!title || !slug || !content) return res.status(400).json({ error: 'Missing required fields' });
    await dbRun('UPDATE blog_posts SET title = $1, slug = $2, content = $3, excerpt = $4, published = $5, updated_at = NOW() WHERE id = $6', [title, slug, content, excerpt || '', published ? 1 : 0, req.params.id]);
    const post = await dbGet('SELECT * FROM blog_posts WHERE id = $1', [req.params.id]);
    res.json(post);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/admin/blog/:id', checkAdminPassword, async (req, res) => {
  try {
    await dbRun('DELETE FROM blog_posts WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/admin/blog', checkAdminPassword, async (req, res) => {
  try {
    const posts = await dbAll('SELECT * FROM blog_posts ORDER BY created_at DESC');
    res.json(posts);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================================================
// NEWSLETTER ENDPOINTS
// ============================================================================

app.post('/api/newsletter/subscribe', async (req, res) => {
  try {
    const { email, name } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const existing = await dbGet('SELECT id FROM newsletter_subscribers WHERE email = $1', [email]);
    if (existing) return res.status(400).json({ error: 'Email already subscribed' });
    await dbRun('INSERT INTO newsletter_subscribers (email, name, active) VALUES ($1, $2, 1)', [email, name || '']);
    res.json({ success: true, message: 'Thank you for subscribing to Healing Insights!' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/admin/newsletter/subscribers', checkAdminPassword, async (req, res) => {
  try {
    const subscribers = await dbAll('SELECT * FROM newsletter_subscribers WHERE active = 1 ORDER BY subscribed_at DESC');
    res.json(subscribers);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/admin/newsletter/export', checkAdminPassword, async (req, res) => {
  try {
    const subscribers = await dbAll('SELECT email, name, subscribed_at FROM newsletter_subscribers WHERE active = 1 ORDER BY subscribed_at DESC');
    let csv = 'Email,Name,Subscribed Date\n';
    subscribers.forEach(sub => {
      const date = new Date(sub.subscribed_at).toISOString().split('T')[0];
      csv += `"${sub.email}","${sub.name || ''}","${date}"\n`;
    });
    res.header('Content-Type', 'text/csv');
    res.header('Content-Disposition', 'attachment; filename="newsletter-subscribers.csv"');
    res.send(csv);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/admin/newsletter/:id', checkAdminPassword, async (req, res) => {
  try {
    await dbRun('UPDATE newsletter_subscribers SET active = 0 WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================================================
// REVIEWS/TESTIMONIALS ENDPOINTS
// ============================================================================

app.post('/api/reviews/submit', async (req, res) => {
  try {
    const { name, rating, review_text, session_type } = req.body;
    if (!name || !rating || !review_text) return res.status(400).json({ error: 'Missing required fields' });
    if (rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    await dbRun('INSERT INTO reviews (name, rating, review_text, session_type, approved) VALUES ($1, $2, $3, $4, 0)', [name, rating, review_text, session_type || '']);
    res.json({ success: true, message: 'Thank you for your review! It will appear on our site after approval.' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/reviews', async (req, res) => {
  try {
    const reviews = await dbAll('SELECT * FROM reviews WHERE approved = 1 ORDER BY created_at DESC');
    res.json(reviews);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/admin/reviews', checkAdminPassword, async (req, res) => {
  try {
    const reviews = await dbAll('SELECT * FROM reviews ORDER BY created_at DESC');
    res.json(reviews);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/admin/reviews/:id', checkAdminPassword, async (req, res) => {
  try {
    const { approved } = req.body;
    if (typeof approved !== 'number' || (approved !== 0 && approved !== 1)) return res.status(400).json({ error: 'approved must be 0 or 1' });
    await dbRun('UPDATE reviews SET approved = $1 WHERE id = $2', [approved, req.params.id]);
    const review = await dbGet('SELECT * FROM reviews WHERE id = $1', [req.params.id]);
    res.json(review);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/admin/reviews/:id', checkAdminPassword, async (req, res) => {
  try {
    await dbRun('DELETE FROM reviews WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================================================
// TRAFFIC TRACKING
// ============================================================================

app.post('/api/track', async (req, res) => {
  try {
    const { path: pagePath } = req.body;
    const referrer = req.headers.referer || req.headers.referrer || '';
    const userAgent = req.headers['user-agent'] || '';
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || '';
    await dbRun('INSERT INTO page_views (path, referrer, user_agent, ip) VALUES ($1, $2, $3, $4)', [pagePath || '/', referrer, userAgent, ip]);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: true }); // fail silently
  }
});

app.get('/api/admin/traffic', checkAdminPassword, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const weekAgo = new Date(Date.now() - 7*24*60*60*1000).toISOString().split('T')[0];
    const monthAgo = new Date(Date.now() - 30*24*60*60*1000).toISOString().split('T')[0];

    const todayViews = await dbGet("SELECT COUNT(*) as count FROM page_views WHERE DATE(created_at) = $1", [today]);
    const weekViews = await dbGet("SELECT COUNT(*) as count FROM page_views WHERE DATE(created_at) >= $1", [weekAgo]);
    const monthViews = await dbGet("SELECT COUNT(*) as count FROM page_views WHERE DATE(created_at) >= $1", [monthAgo]);
    const totalViews = await dbGet("SELECT COUNT(*) as count FROM page_views");
    const topPages = await dbAll("SELECT path, COUNT(*) as views FROM page_views GROUP BY path ORDER BY views DESC LIMIT 10");
    const dailyViews = await dbAll("SELECT DATE(created_at) as date, COUNT(*) as views FROM page_views WHERE DATE(created_at) >= $1 GROUP BY DATE(created_at) ORDER BY date DESC", [monthAgo]);
    const topReferrers = await dbAll("SELECT referrer, COUNT(*) as views FROM page_views WHERE referrer != '' GROUP BY referrer ORDER BY views DESC LIMIT 10");

    res.json({
      today: parseInt(todayViews.count),
      week: parseInt(weekViews.count),
      month: parseInt(monthViews.count),
      total: parseInt(totalViews.count),
      topPages,
      dailyViews,
      topReferrers
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// ADMIN PASSWORD MANAGEMENT
// ============================================================================

app.put('/api/admin/password', checkAdminPassword, async (req, res) => {
  try {
    const { new_password } = req.body;
    if (!new_password || new_password.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
    const newPasswordHash = hashPassword(new_password);
    await dbRun('UPDATE admin_settings SET value = $1 WHERE key = $2', [newPasswordHash, 'admin_password']);
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// CLIENT APPOINTMENT ENDPOINTS (AUTHENTICATED)
// ============================================================================

async function verifyAuthToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  const userId = verifyToken(token);
  if (!userId) return res.status(401).json({ error: 'Invalid token' });
  req.userId = userId;
  next();
}

app.get('/api/client/appointments', verifyAuthToken, async (req, res) => {
  try {
    const user = await dbGet('SELECT email FROM users WHERE id = $1', [req.userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const bookings = await dbAll('SELECT id, client_name, date, time, duration, session_format, status, cancelled, cancelled_at, original_booking_id FROM bookings WHERE email = $1 ORDER BY date DESC, time DESC', [user.email]);
    res.json(bookings);
  } catch (error) {
    console.error('Error fetching appointments:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/client/appointments/:id/reschedule', verifyAuthToken, async (req, res) => {
  try {
    const { new_date, new_time } = req.body;
    if (!new_date || !new_time) return res.status(400).json({ error: 'New date and time required' });
    const user = await dbGet('SELECT email FROM users WHERE id = $1', [req.userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const booking = await dbGet('SELECT * FROM bookings WHERE id = $1 AND email = $2', [req.params.id, user.email]);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    const appointmentDate = new Date(booking.date + 'T' + booking.time);
    const now = new Date();
    if ((appointmentDate - now) / (1000 * 60 * 60) < 24) return res.status(400).json({ error: 'Cannot reschedule within 24 hours of appointment' });

    const slots = await getAvailableSlots(new_date, booking.duration);
    const slotsFormatted = slots.map(slot => to12HourFormat(slot));
    if (!slotsFormatted.includes(new_time)) return res.status(400).json({ error: 'Selected time slot is not available' });

    await dbRun('UPDATE bookings SET status = $1 WHERE id = $2', ['rescheduled', booking.id]);
    await dbRun('INSERT INTO bookings (client_name, email, phone, date_of_birth, session_type, duration, date, time, session_format, is_pack, status, stripe_session_id, stripe_payment_status, original_booking_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
      [booking.client_name, booking.email, booking.phone, booking.date_of_birth, booking.session_type, booking.duration, new_date, new_time, booking.session_format, booking.is_pack, 'completed', booking.stripe_session_id, booking.stripe_payment_status, booking.id]);
    const newBooking = await dbGet('SELECT * FROM bookings WHERE email = $1 AND date = $2 AND time = $3', [user.email, new_date, new_time]);
    res.json({ success: true, booking: newBooking });
  } catch (error) {
    console.error('Error rescheduling:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/client/appointments/:id/cancel', verifyAuthToken, async (req, res) => {
  try {
    const user = await dbGet('SELECT email FROM users WHERE id = $1', [req.userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const booking = await dbGet('SELECT * FROM bookings WHERE id = $1 AND email = $2', [req.params.id, user.email]);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.cancelled) return res.status(400).json({ error: 'Already cancelled' });

    const appointmentDate = new Date(booking.date + 'T' + booking.time);
    const now = new Date();
    if ((appointmentDate - now) / (1000 * 60 * 60) < 24) return res.status(400).json({ error: 'Cannot cancel within 24 hours' });

    await dbRun('UPDATE bookings SET cancelled = 1, cancelled_at = NOW() WHERE id = $1', [booking.id]);
    res.json({ success: true, message: 'Session cancelled. Sessions are non-refundable. You may rebook using your session credit.' });
  } catch (error) {
    console.error('Error cancelling:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// STATIC PAGES
// ============================================================================

app.get('/booking-success.html', (req, res) => { res.sendFile(path.join(__dirname, 'booking-success.html')); });
app.get('/booking-cancel.html', (req, res) => { res.sendFile(path.join(__dirname, 'booking-cancel.html')); });
app.get('/blog', (req, res) => { res.sendFile(path.join(__dirname, 'blog.html')); });
app.get('/blog/:slug', (req, res) => { res.sendFile(path.join(__dirname, 'blog.html')); });

app.get('/api/booking/session/:sessionId', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
    res.json(session);
  } catch (error) {
    console.error('Error retrieving session:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// START SERVER
// ============================================================================

async function startServer() {
  try {
    await initializeDatabase();
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization error:', error);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`Luce Healing server running on port ${PORT}`);
  });
}

startServer().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
