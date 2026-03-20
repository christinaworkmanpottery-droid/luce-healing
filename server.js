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

  // Bookings table (UPDATED with session_format and date_of_birth)
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
  if (password !== 'luce2026admin') {
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
