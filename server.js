const express = require('express');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');
const cors = require('cors');
const crypto = require('crypto');
const stripeKey = process.env.STRIPE_SECRET_KEY;
if (!stripeKey) {
  console.warn('WARNING: STRIPE_SECRET_KEY not set. Payment features will not work.');
}
const stripe = stripeKey ? require('stripe')(stripeKey) : null;

const app = express();
const dbPath = path.join(__dirname, 'luce-healing.db');

let db = null; // Will be initialized async

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Raw body parser for webhook
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

const PORT = process.env.PORT || 3000;

// ============================================================================
// SQL.JS HELPER FUNCTIONS
// ============================================================================

function dbRun(sql, params = []) {
  db.run(sql, params);
  saveDb();
}

function dbGet(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  let result = null;
  if (stmt.step()) {
    result = stmt.getAsObject();
  }
  stmt.free();
  return result;
}

function dbAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function saveDb() {
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

function loadDb() {
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    return new (require('sql.js')).Database(fileBuffer);
  }
  return null;
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

function initializeDatabase() {
  // Users table (NEW)
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL,
      date_of_birth TEXT,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Bookings table (UPDATED with session_format, date_of_birth, and appointment tracking)
  db.exec(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Availability table
  db.exec(`
    CREATE TABLE IF NOT EXISTS availability (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_of_week INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      is_available INTEGER DEFAULT 1,
      UNIQUE(day_of_week)
    )
  `);

  // Blocked times table
  db.exec(`
    CREATE TABLE IF NOT EXISTS blocked_times (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      reason TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Clients table (UPDATED with date_of_birth)
  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL,
      date_of_birth TEXT,
      notes TEXT,
      sessions_remaining INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Blog posts table
  db.exec(`
    CREATE TABLE IF NOT EXISTS blog_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL,
      excerpt TEXT,
      published INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Newsletter subscribers table
  db.exec(`
    CREATE TABLE IF NOT EXISTS newsletter_subscribers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      subscribed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      active INTEGER DEFAULT 1
    )
  `);

  // Reviews/Testimonials table
  db.exec(`
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      rating INTEGER NOT NULL,
      review_text TEXT NOT NULL,
      session_type TEXT,
      approved INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS page_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      referrer TEXT,
      user_agent TEXT,
      ip TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Admin settings table (NEW)
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL
    )
  `);
  saveDb();

  // Initialize default availability if empty
  const availabilityCount = dbGet('SELECT COUNT(*) as count FROM availability');
  if (availabilityCount.count === 0) {
    const defaultAvailability = [
      { day: 0, start: '09:00', end: '18:00' }, // Monday 9am-6pm
      { day: 1, start: '09:00', end: '18:00' }, // Tuesday 9am-6pm
      { day: 2, start: '09:00', end: '18:00' }, // Wednesday 9am-6pm
      { day: 3, start: '09:00', end: '18:00' }, // Thursday 9am-6pm
      { day: 4, start: '09:00', end: '18:00' }, // Friday 9am-6pm
      { day: 5, start: '10:00', end: '14:00' }, // Saturday 10am-2pm
      // Sunday (6) is closed, no entry
    ];

    defaultAvailability.forEach(slot => {
      dbRun('INSERT INTO availability (day_of_week, start_time, end_time, is_available) VALUES (?, ?, ?, 1)', 
        [slot.day, slot.start, slot.end]);
    });
  }

  // Initialize starter blog posts if empty
  const blogCount = dbGet('SELECT COUNT(*) as count FROM blog_posts');
  if (blogCount.count === 0) {
    const starterPosts = [
      {
        title: "You Are Your Own Healer",
        slug: "you-are-your-own-healer",
        excerpt: "Understanding that no one can heal you but yourself — and why that's empowering.",
        content: `<p>One of the most important truths I've learned through decades of energy work is this: <strong>I don't heal you. You heal yourself.</strong></p>

<p>No one else can do it for you. Not me, not another healer, not a doctor, not anyone.</p>

<p>What I do is move energy. I clear what's blocking you. I give you tools. I hold space while you remember your own power. But the actual healing work? That happens inside you.</p>

<h3>Why This Matters</h3>

<p>When you understand this, everything shifts. You stop waiting for someone to fix you. You stop giving away your power to an external source. Instead, you step into the truth: <strong>you were never broken in the first place.</strong></p>

<p>You're simply stuck. Blocked. Full of energy that isn't flowing, emotions that aren't moving, old stories that are taking up space.</p>

<h3>My Role</h3>

<p>What I do is help you unstick. I work with the energy around you and within you. I show you where things are congested. I move the stagnant energy. I give you practices and tools to continue that work on your own.</p>

<p>But the transformation? That's all you.</p>

<p>Every shift you feel after our session — that clarity, that lightness, that sense of possibility — that's you doing your own healing work.</p>

<h3>This Is Empowering</h3>

<p>It might sound like I'm saying "I can't help you," but it's actually the opposite. I'm saying you're more powerful than you think. You don't need rescuing. You need remembering.</p>

<p>When you own your own healing, you own your own power. And that changes everything.</p>`
      },
      {
        title: "What to Expect in an Energy Healing Session",
        slug: "what-to-expect-in-energy-healing",
        excerpt: "Demystifying the process so you feel safe, grounded, and empowered.",
        content: `<p>If you've never had an energy healing session before, it's natural to wonder what's going to happen. What do I do? What will you feel? Is it real? Will it be weird?</p>

<p>Let me walk you through what a typical session looks like, from start to finish.</p>

<h3>Before Your Session</h3>

<p>Come as you are. No special preparation needed. You might want to wear something comfortable and avoid heavy meals right before, but that's about it.</p>

<p>If it's a distance session, find a quiet, comfortable space where you can lie down or sit without interruption for the duration of our time together.</p>

<h3>The Beginning</h3>

<p>We start with a conversation. I want to know what brought you here. What are you hoping for? What's weighing on you? Is there anything you need me to know?</p>

<p>This isn't a therapy session, but I do listen deeply. Your intention matters. The more I understand what you're working with, the more focused and effective our work can be.</p>

<h3>The Work</h3>

<p>Depending on whether you're in-person or distance, you'll either lie on a table or settle into a comfortable position. I'll guide you into a relaxed state.</p>

<p>What happens next varies. Some people feel a lot of sensation — warmth, tingling, movement of energy through their body. Some feel deeply relaxed. Some see colors or images. Some feel nothing particularly special in the moment, but notice shifts later.</p>

<p>All of this is normal and valuable.</p>

<p>During the session, I'm working with your energy field. Moving what's stuck. Clearing what no longer serves you. Sometimes I'll narrate what I'm sensing or suggest gentle breathing or movement to support the work.</p>

<h3>Integration</h3>

<p>As we finish, we'll spend some time grounding you back into your body. I might share observations about what came up or suggest practices to support your continued healing.</p>

<p>You might feel spacey, relaxed, emotional, or energized. This is all part of the process. Drink water. Rest. Let yourself integrate.</p>

<h3>After the Session</h3>

<p>The real work often happens after we're done. Insights emerge. Emotions move. You might sleep deeply. You might feel unusually awake. You might notice shifts over the next few days or weeks.</p>

<p>This is why I always say: no one heals you but yourself. The session creates space for healing. What you do with that space is up to you.</p>`
      },
      {
        title: "Why Your Space Holds Energy (And How to Clear It)",
        slug: "why-space-holds-energy",
        excerpt: "Understanding how environments absorb energy — and why clearing them matters.",
        content: `<p>Your home is alive with energy. Not metaphorically — literally.</p>

<p>Every space absorbs the energy of everyone who's been in it. The emotions. The conflicts. The grief. The joy. The trauma. It all gets stored in the walls, the furniture, the air itself.</p>

<h3>What Gets Stored?</h3>

<p>Think about places that feel heavy or stuck. A bedroom where someone struggled with illness. A kitchen where a marriage fell apart. A living room where arguments happened repeatedly. These spaces carry the residue of those experiences.</p>

<p>You can feel it when you walk in. That heaviness. That sense that something happened here and it never quite left.</p>

<p>The same is true for spaces where beautiful things happened — they carry that lightness too. But when we don't clear the old, stagnant, or traumatic energy, it gets thicker and thicker.</p>

<h3>How It Affects You</h3>

<p>When you live or work in a space full of stuck energy, you absorb it. It drains you. Makes it harder to sleep. Creates subtle anxiety or sadness you can't quite explain. Affects your creativity, your mood, your sense of peace.</p>

<p>You might not consciously notice it, but your body knows. Your energy knows.</p>

<h3>How to Clear It</h3>

<p>There are many ways to clear space energy. Some are simple practices you can do yourself:</p>

<ul>
<li><strong>Intentional cleansing:</strong> Open windows. Let sunlight and fresh air move through. Set an intention: "I clear this space of all stuck and stagnant energy."</li>
<li><strong>Sound:</strong> Ring bells, play certain music, clap your hands in corners and doorways. Sound moves energy.</li>
<li><strong>Smoke or incense:</strong> Sage, palo santo, or other sacred plants have been used for centuries to clear energy.</li>
<li><strong>Salt:</strong> Place salt in corners or around doorways. Salt absorbs negative energy.</li>
</ul>

<p>For deeper clearing — especially if a space holds heavy trauma, grief, or conflict — you might want to work with someone experienced in space clearing work. I do this kind of clearing, and it's profound work.</p>

<h3>Maintaining the Shift</h3>

<p>After clearing, maintain the lightness. Open windows regularly. Play music that lifts you. Spend time in that space consciously, with good intention. Move stagnant energy regularly.</p>

<p>Your space is an extension of you. When it's clear and light, you feel clear and light too.</p>`
      }
    ];

    starterPosts.forEach(post => {
      dbRun(
        'INSERT INTO blog_posts (title, slug, content, excerpt, published, created_at, updated_at) VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
        [post.title, post.slug, post.content, post.excerpt]
      );
    });
  }

  // Initialize default admin password if not set
  const adminPasswordSet = dbGet('SELECT value FROM admin_settings WHERE key = ?', ['admin_password']);
  if (!adminPasswordSet) {
    const defaultPasswordHash = hashPassword('luce13');
    dbRun('INSERT INTO admin_settings (key, value) VALUES (?, ?)', ['admin_password', defaultPasswordHash]);
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

// Convert 24-hour time to 12-hour format with AM/PM
function to12HourFormat(timeStr) {
  const [hours, mins] = timeStr.split(':').map(Number);
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;
  const displayMins = String(mins).padStart(2, '0');
  return `${displayHours}:${displayMins} ${ampm}`;
}

function dateToJS(dateStr) {
  return new Date(dateStr + 'T00:00:00Z');
}

function getDayOfWeek(dateStr) {
  const date = dateToJS(dateStr);
  return (date.getUTCDay() + 1) % 7; // Convert to Monday=0, Sunday=6
}

function isDatePassed(dateStr) {
  const today = new Date();
  const date = dateToJS(dateStr);
  date.setUTCHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return date < today;
}

function getAvailableSlots(dateStr, duration) {
  // Check if date is in the past
  if (isDatePassed(dateStr)) {
    return [];
  }

  const dayOfWeek = getDayOfWeek(dateStr);
  
  // Get availability for this day
  const dayAvail = dbGet('SELECT * FROM availability WHERE day_of_week = ?', [dayOfWeek]);
  if (!dayAvail || !dayAvail.is_available) {
    return [];
  }

  const startMins = timeToMinutes(dayAvail.start_time);
  const endMins = timeToMinutes(dayAvail.end_time);

  // Get blocked times for this date
  const blocked = dbAll('SELECT * FROM blocked_times WHERE date = ?', [dateStr]);
  const blockedRanges = blocked.map(b => ({
    start: timeToMinutes(b.start_time),
    end: timeToMinutes(b.end_time)
  }));

  // Get booked times for this date (with 15 min buffer)
  const bookings = dbAll('SELECT time, duration FROM bookings WHERE date = ? AND status = ?', [dateStr, 'completed']);
  const bookedRanges = bookings.map(b => {
    const bookStart = timeToMinutes(b.time);
    const bookEnd = bookStart + b.duration + 15; // 15 min buffer
    return { start: bookStart, end: bookEnd };
  });

  const slots = [];
  for (let slotStart = startMins; slotStart + duration <= endMins; slotStart += duration) {
    const slotEnd = slotStart + duration;

    // Check if slot overlaps with blocked times
    const isBlocked = blockedRanges.some(range => 
      slotStart < range.end && slotEnd > range.start
    );

    // Check if slot overlaps with bookings
    const isBooked = bookedRanges.some(range =>
      slotStart < range.end && slotEnd > range.start
    );

    if (!isBlocked && !isBooked) {
      slots.push(minutesToTime(slotStart));
    }
  }

  return slots;
}

function getPricingInfo() {
  return {
    15: { single: 4500, pack: 12500 },   // $45, $125
    30: { single: 6000, pack: 15000 },   // $60, $150
    45: { single: 7500, pack: 17500 },   // $75, $175
    60: { single: 10000, pack: 25000 },  // $100, $250
    90: { single: 14500, pack: 37500 },  // $145, $375
    120: { single: 20000, pack: 52500 }  // $200, $525
  };
}

// ============================================================================
// AVAILABILITY ENDPOINTS
// ============================================================================

app.get('/api/availability', (req, res) => {
  const { date, duration } = req.query;
  if (!date || !duration) {
    return res.status(400).json({ error: 'date and duration required' });
  }

  const slots = getAvailableSlots(date, parseInt(duration));
  // Convert all slots to 12-hour format
  const formattedSlots = slots.map(slot => to12HourFormat(slot));
  res.json({ date, duration: parseInt(duration), slots: formattedSlots });
});

app.get('/api/availability/week', (req, res) => {
  const { start } = req.query;
  if (!start) {
    return res.status(400).json({ error: 'start date required' });
  }

  const startDate = dateToJS(start);
  const weekData = {};

  for (let i = 0; i < 7; i++) {
    const date = new Date(startDate);
    date.setUTCDate(date.getUTCDate() + i);
    const dateStr = date.toISOString().split('T')[0];
    
    const dayAvail = dbGet('SELECT * FROM availability WHERE day_of_week = ?', [(i + 1) % 7]);
    weekData[dateStr] = dayAvail ? {
      available: dayAvail.is_available,
      start: dayAvail.start_time,
      end: dayAvail.end_time
    } : { available: false };
  }

  res.json({ start, week: weekData });
});

// ============================================================================
// AUTH ENDPOINTS
// ============================================================================

app.post('/api/auth/register', (req, res) => {
  try {
    const { full_name, email, phone, date_of_birth, password } = req.body;

    if (!full_name || !email || !phone || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check if user already exists
    const existing = dbGet('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const passwordHash = hashPassword(password);
    dbRun('INSERT INTO users (full_name, email, phone, date_of_birth, password_hash) VALUES (?, ?, ?, ?, ?)',
      [full_name, email, phone, date_of_birth || null, passwordHash]);

    const user = dbGet('SELECT id, full_name, email, phone, date_of_birth FROM users WHERE email = ?', [email]);
    const token = generateToken(user.id);

    res.json({ success: true, token, user });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const user = dbGet('SELECT * FROM users WHERE email = ?', [email]);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = generateToken(user.id);
    res.json({ 
      success: true, 
      token, 
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        phone: user.phone,
        date_of_birth: user.date_of_birth
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/auth/me', (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const userId = verifyToken(token);
    if (!userId) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const user = dbGet('SELECT id, full_name, email, phone, date_of_birth FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

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
    if (!stripe) {
      return res.status(500).json({ error: 'Payment system not configured' });
    }
    const { name, email, phone, date_of_birth, session_type, date, time, duration, is_pack, session_format } = req.body;

    if (!name || !email || !phone || !session_type || !date || !time || !duration || !session_format) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Verify slot is available - need to convert time back to 24-hour for comparison
    const slots = getAvailableSlots(date, parseInt(duration));
    // The time coming from frontend is in 12-hour format, need to match with returned slots
    // Actually, let's store both formats or just verify based on date/time logic
    const slotsFormatted = slots.map(slot => to12HourFormat(slot));
    if (!slotsFormatted.includes(time)) {
      return res.status(400).json({ error: 'Selected time slot is no longer available' });
    }

    const pricing = getPricingInfo();
    const durationInt = parseInt(duration);
    const priceAmount = is_pack ? pricing[durationInt].pack : pricing[durationInt].single;
    const displayPrice = (priceAmount / 100).toFixed(2);
    const packLabel = is_pack ? ' (3-Pack)' : '';

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${durationInt}-Minute Energy Healing Session${packLabel}`,
              description: `Date: ${date}, Time: ${time} PT, Format: ${session_format}`
            },
            unit_amount: priceAmount
          },
          quantity: 1
        }
      ],
      customer_email: email,
      metadata: {
        client_name: name,
        phone,
        date_of_birth: date_of_birth || '',
        session_type,
        date,
        time,
        duration: durationInt,
        is_pack: is_pack ? 'true' : 'false',
        session_format
      },
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
    const metadata = session.metadata;

    // Get or create client
    let client = dbGet('SELECT * FROM clients WHERE email = ?', [metadata.email]);
    if (!client) {
      dbRun('INSERT INTO clients (name, email, phone, date_of_birth, sessions_remaining) VALUES (?, ?, ?, ?, ?)', [
        metadata.client_name,
        metadata.email,
        metadata.phone,
        metadata.date_of_birth || null,
        metadata.is_pack === 'true' ? 3 : 0
      ]);
      client = dbGet('SELECT * FROM clients WHERE email = ?', [metadata.email]);
    } else if (metadata.is_pack === 'true') {
      // Update sessions remaining if it's a pack
      dbRun('UPDATE clients SET sessions_remaining = sessions_remaining + 3 WHERE id = ?', [client.id]);
    }

    // Create booking record
    dbRun(`
      INSERT INTO bookings 
      (client_name, email, phone, date_of_birth, session_type, duration, date, time, session_format, is_pack, status, stripe_session_id, stripe_payment_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      metadata.client_name,
      metadata.email,
      metadata.phone,
      metadata.date_of_birth || null,
      metadata.session_type,
      metadata.duration,
      metadata.date,
      metadata.time,
      metadata.session_format || 'in-person',
      metadata.is_pack === 'true' ? 1 : 0,
      'completed',
      session.id,
      'paid'
    ]);

    console.log(`Booking created for ${metadata.client_name} on ${metadata.date} at ${metadata.time}`);
  }

  res.json({ received: true });
});

// ============================================================================
// ADMIN ENDPOINTS (PASSWORD PROTECTED)
// ============================================================================

function checkAdminPassword(req, res, next) {
  const password = req.query.password || req.body.password;
  const adminPasswordRecord = dbGet('SELECT value FROM admin_settings WHERE key = ?', ['admin_password']);
  
  if (!adminPasswordRecord) {
    return res.status(500).json({ error: 'Admin password not initialized' });
  }
  
  if (!verifyPassword(password, adminPasswordRecord.value)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.get('/api/admin/bookings', checkAdminPassword, (req, res) => {
  const { date } = req.query;
  let query = 'SELECT * FROM bookings';
  let params = [];

  if (date) {
    query += ' WHERE date = ?';
    params.push(date);
  }

  query += ' ORDER BY date ASC, time ASC';
  const bookings = dbAll(query, params);
  res.json(bookings);
});

app.get('/api/admin/clients', checkAdminPassword, (req, res) => {
  const clients = dbAll(`
    SELECT 
      c.*,
      COUNT(DISTINCT b.id) as total_bookings,
      COUNT(DISTINCT CASE WHEN b.status = 'completed' THEN b.id END) as completed_bookings,
      SUM(CASE WHEN b.status = 'completed' AND b.is_pack = 0 THEN 1 ELSE 0 END) as single_sessions_used,
      COUNT(DISTINCT CASE WHEN b.status = 'pending' THEN b.id END) as pending_bookings
    FROM clients c
    LEFT JOIN bookings b ON c.id = (SELECT id FROM clients WHERE email = b.email)
    GROUP BY c.id
    ORDER BY c.created_at DESC
  `);
  res.json(clients);
});

app.get('/api/admin/dashboard', checkAdminPassword, (req, res) => {
  const stats = {};

  // Total revenue (prices in cents)
  const revenue = dbGet(`
    SELECT SUM(
      CASE 
        WHEN is_pack = 1 AND duration = 15 THEN 12500
        WHEN is_pack = 0 AND duration = 15 THEN 4500
        WHEN is_pack = 1 AND duration = 30 THEN 15000
        WHEN is_pack = 0 AND duration = 30 THEN 6000
        WHEN is_pack = 1 AND duration = 45 THEN 17500
        WHEN is_pack = 0 AND duration = 45 THEN 7500
        WHEN is_pack = 1 AND duration = 60 THEN 25000
        WHEN is_pack = 0 AND duration = 60 THEN 10000
        WHEN is_pack = 1 AND duration = 90 THEN 37500
        WHEN is_pack = 0 AND duration = 90 THEN 14500
        WHEN is_pack = 1 AND duration = 120 THEN 52500
        WHEN is_pack = 0 AND duration = 120 THEN 20000
      END
    ) as total
    FROM bookings
    WHERE status = 'completed'
  `);

  stats.total_revenue = (revenue.total || 0) / 100;

  // Upcoming bookings
  const today = new Date().toISOString().split('T')[0];
  stats.upcoming_bookings = dbGet('SELECT COUNT(*) as count FROM bookings WHERE date >= ? AND status = ?', [today, 'completed']).count;

  // Total clients
  stats.total_clients = dbGet('SELECT COUNT(*) as count FROM clients').count;

  // Completed bookings
  stats.completed_bookings = dbGet('SELECT COUNT(*) as count FROM bookings WHERE status = ?', ['completed']).count;

  res.json(stats);
});

app.put('/api/admin/availability', checkAdminPassword, (req, res) => {
  const { availability } = req.body;
  
  try {
    db.exec('DELETE FROM availability');
    
    availability.forEach(slot => {
      dbRun('INSERT INTO availability (day_of_week, start_time, end_time, is_available) VALUES (?, ?, ?, ?)', 
        [slot.day_of_week, slot.start_time, slot.end_time, slot.is_available ? 1 : 0]);
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/blocks', checkAdminPassword, (req, res) => {
  try {
    const blocks = dbAll('SELECT * FROM blocked_times ORDER BY date, start_time');
    res.json(blocks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/block', checkAdminPassword, (req, res) => {
  const { date, start_time, end_time, reason } = req.body;
  
  if (!date || !start_time || !end_time) {
    return res.status(400).json({ error: 'date, start_time, and end_time required' });
  }

  try {
    dbRun('INSERT INTO blocked_times (date, start_time, end_time, reason) VALUES (?, ?, ?, ?)', [
      date,
      start_time,
      end_time,
      reason || ''
    ]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/block/:id', checkAdminPassword, (req, res) => {
  try {
    dbRun('DELETE FROM blocked_times WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// BLOG ENDPOINTS
// ============================================================================

app.get('/api/blog', (req, res) => {
  try {
    const posts = dbAll('SELECT id, title, slug, excerpt, created_at FROM blog_posts WHERE published = 1 ORDER BY created_at DESC');
    res.json(posts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/blog/latest', (req, res) => {
  try {
    const posts = dbAll('SELECT id, title, slug, excerpt, created_at FROM blog_posts WHERE published = 1 ORDER BY created_at DESC LIMIT 3');
    res.json(posts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/blog/:slug', (req, res) => {
  try {
    const post = dbGet('SELECT * FROM blog_posts WHERE slug = ? AND published = 1', [req.params.slug]);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }
    res.json(post);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/blog', checkAdminPassword, (req, res) => {
  try {
    const { title, slug, content, excerpt, published } = req.body;
    if (!title || !slug || !content) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    dbRun(
      'INSERT INTO blog_posts (title, slug, content, excerpt, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
      [title, slug, content, excerpt || '', published ? 1 : 0]
    );
    const post = dbGet('SELECT * FROM blog_posts WHERE slug = ?', [slug]);
    res.json(post);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/admin/blog/:id', checkAdminPassword, (req, res) => {
  try {
    const { title, slug, content, excerpt, published } = req.body;
    if (!title || !slug || !content) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    dbRun(
      'UPDATE blog_posts SET title = ?, slug = ?, content = ?, excerpt = ?, published = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [title, slug, content, excerpt || '', published ? 1 : 0, req.params.id]
    );
    const post = dbGet('SELECT * FROM blog_posts WHERE id = ?', [req.params.id]);
    res.json(post);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/blog/:id', checkAdminPassword, (req, res) => {
  try {
    dbRun('DELETE FROM blog_posts WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/blog', checkAdminPassword, (req, res) => {
  try {
    const posts = dbAll('SELECT * FROM blog_posts ORDER BY created_at DESC');
    res.json(posts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// NEWSLETTER ENDPOINTS
// ============================================================================

app.post('/api/newsletter/subscribe', (req, res) => {
  try {
    const { email, name } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }
    
    // Check if already subscribed
    const existing = dbGet('SELECT id FROM newsletter_subscribers WHERE email = ?', [email]);
    if (existing) {
      return res.status(400).json({ error: 'Email already subscribed' });
    }
    
    dbRun(
      'INSERT INTO newsletter_subscribers (email, name, subscribed_at, active) VALUES (?, ?, CURRENT_TIMESTAMP, 1)',
      [email, name || '']
    );
    res.json({ success: true, message: 'Thank you for subscribing to Healing Insights!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/newsletter/subscribers', checkAdminPassword, (req, res) => {
  try {
    const subscribers = dbAll('SELECT * FROM newsletter_subscribers WHERE active = 1 ORDER BY subscribed_at DESC');
    res.json(subscribers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/newsletter/export', checkAdminPassword, (req, res) => {
  try {
    const subscribers = dbAll('SELECT email, name, subscribed_at FROM newsletter_subscribers WHERE active = 1 ORDER BY subscribed_at DESC');
    
    let csv = 'Email,Name,Subscribed Date\n';
    subscribers.forEach(sub => {
      const date = new Date(sub.subscribed_at).toISOString().split('T')[0];
      csv += `"${sub.email}","${sub.name || ''}","${date}"\n`;
    });
    
    res.header('Content-Type', 'text/csv');
    res.header('Content-Disposition', 'attachment; filename="newsletter-subscribers.csv"');
    res.send(csv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/newsletter/:id', checkAdminPassword, (req, res) => {
  try {
    dbRun('UPDATE newsletter_subscribers SET active = 0 WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// REVIEWS/TESTIMONIALS ENDPOINTS
// ============================================================================

app.post('/api/reviews/submit', (req, res) => {
  try {
    const { name, rating, review_text, session_type } = req.body;
    if (!name || !rating || !review_text) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }
    
    dbRun(
      'INSERT INTO reviews (name, rating, review_text, session_type, approved, created_at) VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP)',
      [name, rating, review_text, session_type || '']
    );
    res.json({ success: true, message: 'Thank you for your review! It will appear on our site after approval.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/reviews', (req, res) => {
  try {
    const reviews = dbAll('SELECT * FROM reviews WHERE approved = 1 ORDER BY created_at DESC');
    res.json(reviews);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/reviews', checkAdminPassword, (req, res) => {
  try {
    const reviews = dbAll('SELECT * FROM reviews ORDER BY created_at DESC');
    res.json(reviews);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/admin/reviews/:id', checkAdminPassword, (req, res) => {
  try {
    const { approved } = req.body;
    if (typeof approved !== 'number' || (approved !== 0 && approved !== 1)) {
      return res.status(400).json({ error: 'approved must be 0 or 1' });
    }
    dbRun('UPDATE reviews SET approved = ? WHERE id = ?', [approved, req.params.id]);
    const review = dbGet('SELECT * FROM reviews WHERE id = ?', [req.params.id]);
    res.json(review);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/reviews/:id', checkAdminPassword, (req, res) => {
  try {
    dbRun('DELETE FROM reviews WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// TRAFFIC TRACKING
// ============================================================================

app.post('/api/track', (req, res) => {
  const { path } = req.body;
  const referrer = req.headers.referer || req.headers.referrer || '';
  const userAgent = req.headers['user-agent'] || '';
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || '';
  
  try {
    dbRun('INSERT INTO page_views (path, referrer, user_agent, ip) VALUES (?, ?, ?, ?)',
      [path || '/', referrer, userAgent, ip]);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: true }); // fail silently
  }
});

app.get('/api/admin/traffic', checkAdminPassword, (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const weekAgo = new Date(Date.now() - 7*24*60*60*1000).toISOString().split('T')[0];
    const monthAgo = new Date(Date.now() - 30*24*60*60*1000).toISOString().split('T')[0];

    const todayViews = dbGet("SELECT COUNT(*) as count FROM page_views WHERE date(created_at) = ?", [today]);
    const weekViews = dbGet("SELECT COUNT(*) as count FROM page_views WHERE date(created_at) >= ?", [weekAgo]);
    const monthViews = dbGet("SELECT COUNT(*) as count FROM page_views WHERE date(created_at) >= ?", [monthAgo]);
    const totalViews = dbGet("SELECT COUNT(*) as count FROM page_views");
    
    const topPages = dbAll("SELECT path, COUNT(*) as views FROM page_views GROUP BY path ORDER BY views DESC LIMIT 10");
    
    const dailyViews = dbAll("SELECT date(created_at) as date, COUNT(*) as views FROM page_views WHERE date(created_at) >= ? GROUP BY date(created_at) ORDER BY date DESC", [monthAgo]);
    
    const topReferrers = dbAll("SELECT referrer, COUNT(*) as views FROM page_views WHERE referrer != '' GROUP BY referrer ORDER BY views DESC LIMIT 10");

    res.json({
      today: todayViews.count,
      week: weekViews.count,
      month: monthViews.count,
      total: totalViews.count,
      topPages,
      dailyViews,
      topReferrers
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// BOOKING SUCCESS & CANCEL PAGES REDIRECT
// ============================================================================

app.get('/booking-success.html', (req, res) => {
  const sessionId = req.query.session_id;
  res.sendFile(path.join(__dirname, 'booking-success.html'));
});

app.get('/booking-cancel.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'booking-cancel.html'));
});

// ============================================================================
// BLOG PAGES
// ============================================================================

app.get('/blog', (req, res) => {
  res.sendFile(path.join(__dirname, 'blog.html'));
});

app.get('/blog/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, 'blog.html'));
});

// ============================================================================
// GET BOOKING SESSION DETAILS (for success page)
// ============================================================================

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
// START SERVER WITH ASYNC DB INITIALIZATION
// ============================================================================

async function startServer() {
  const SQL = await initSqlJs();
  
  // Load existing database or create new one
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }
  
  initializeDatabase();
  
  app.listen(PORT, () => {
    console.log(`Luce Healing server running on http://localhost:${PORT}`);
    console.log(`Database: ${dbPath}`);
  });
}

startServer().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
