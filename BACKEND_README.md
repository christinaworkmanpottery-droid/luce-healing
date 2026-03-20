# Luce Healing - Booking & Payment Backend

## Overview

This backend provides a complete booking and payment system for the Luce Healing website, powered by Stripe for payments and SQLite for data storage.

## Features

✅ **Booking System**
- 4-step booking modal UI matching site design
- Date/time selection with real-time availability checking
- Session duration selection (15-120 minutes)
- Single session and 3-pack pricing options

✅ **Payment Processing**
- Stripe Checkout integration
- Real-time payment confirmation via webhooks
- Success and cancellation pages
- Full pricing support for all session types

✅ **Admin Dashboard**
- Protected admin panel (password: `luce2026admin`)
- View all bookings by date
- Manage weekly availability (Mon-Fri 9am-6pm, Sat 10am-2pm)
- Block specific times (vacations, events, etc.)
- Client management with session tracking
- Revenue and booking statistics

✅ **Database**
- SQLite with 4 tables: bookings, availability, blocked_times, clients
- Automatic session tracking for 3-packs
- Stripe integration with payment status tracking

## Getting Started

### Installation

```bash
npm install
```

### Environment Variables

Set these before starting:
```bash
export PORT=3000
export STRIPE_SECRET_KEY=sk_live_...
export STRIPE_WEBHOOK_SECRET=whsec_...  # Optional for local testing
export DOMAIN=https://www.lucehealing.com  # For production
```

### Running the Server

```bash
npm start
# or
node server.js
```

Server will start on `http://localhost:3000`

## API Endpoints

### Public Endpoints

**Get Available Slots**
```
GET /api/availability?date=2026-03-25&duration=45
```

**Get Weekly Availability**
```
GET /api/availability/week?start=2026-03-24
```

**Create Checkout Session**
```
POST /api/booking/checkout
Body: {
  name, email, phone, 
  session_type, date, time, duration, 
  is_pack
}
```

**Get Booking Session Details**
```
GET /api/booking/session/:sessionId
```

### Admin Endpoints (Protected)

All admin endpoints require `?password=luce2026admin`

```
GET /api/admin/bookings              # List all bookings
GET /api/admin/bookings?date=YYYY-MM-DD
GET /api/admin/clients               # List all clients
GET /api/admin/dashboard             # Stats
PUT /api/admin/availability          # Update weekly schedule
POST /api/admin/block                # Block a time
DELETE /api/admin/block/:id          # Unblock a time
```

## Pricing Structure

| Duration | Single | 3-Pack |
|----------|--------|--------|
| 15 min   | $45    | $125   |
| 30 min   | $60    | $150   |
| 45 min   | $75    | $175   |
| 60 min   | $100   | $250   |
| 90 min   | $145   | $375   |
| 120 min  | $200   | $525   |

## Default Schedule

- **Monday-Friday**: 9am - 6pm PT
- **Saturday**: 10am - 2pm PT
- **Sunday**: Closed

## Accessing the Admin Panel

1. Open the website and scroll to the top
2. Visit `/#admin` or navigate to `/admin`
3. Enter password: `luce2026admin`
4. Manage bookings, availability, and clients

## Database Schema

### bookings
- id, client_name, email, phone, session_type, duration, date, time
- is_pack, status, stripe_session_id, stripe_payment_status, notes, created_at

### availability
- id, day_of_week (0-6), start_time, end_time, is_available

### blocked_times
- id, date, start_time, end_time, reason, created_at

### clients
- id, name, email, phone, notes, sessions_remaining, created_at

## Stripe Integration

- Uses Stripe Checkout for secure payments
- Webhook endpoint at `/api/stripe/webhook` confirms payments
- On payment success:
  - Booking is created with status "completed"
  - Client record created/updated
  - 3-pack purchases add 3 to client's sessions_remaining

## Important Notes

- **Time Zone**: All times stored and served in UTC; converted to PT for display
- **Buffers**: 15 minutes automatically added between sessions
- **Past Dates**: Cannot book dates in the past
- **Database**: SQLite database auto-initializes on first run
- **Webhook Secret**: For production Stripe webhooks, set `STRIPE_WEBHOOK_SECRET`

## Development Tips

- Database file: `luce-healing.db`
- Check database directly: `sqlite3 luce-healing.db`
- Test Stripe webhooks locally using Stripe CLI
- All prices stored in cents internally (divide by 100 for display)

## Files

- **server.js** - Express backend with all API endpoints
- **index.html** - Updated with booking modal and admin panel
- **booking-success.html** - Success page after payment
- **booking-cancel.html** - Cancellation page
- **styles.css** - Added modal and admin styles
- **luce-healing.db** - SQLite database (auto-created)

## Support

For issues or questions, contact: lucehealing13@gmail.com
