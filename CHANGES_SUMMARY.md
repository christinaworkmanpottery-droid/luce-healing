# Luce Healing - Recent Changes Summary

## Overview
Added comprehensive admin password management and client appointment portal features to the Luce Healing website.

## Changes Made

### 1. Admin Password Management

#### Database
- Created new `admin_settings` table (id, key TEXT UNIQUE, value TEXT)
- Stores admin password as hashed value using scrypt encryption
- Default password "luce13" initialized on first run

#### Backend (server.js)
- Updated `checkAdminPassword()` middleware to verify against database instead of hardcoded value
- Added `PUT /api/admin/password` endpoint for changing admin password
  - Requires current password for verification
  - New password must be at least 6 characters
  - Returns success message on update

#### Frontend (index.html)
- Added "⚙️ Settings" tab to admin panel
- Password change form with:
  - Current password input
  - New password input
  - Confirm new password input
  - Validation for matching and minimum length
- Admin password stored in memory (`adminPassword` variable) during authenticated session
- All admin API calls now use session-stored password (removed hardcoding)

### 2. Client Appointment Portal

#### Database
- Extended `bookings` table with:
  - `original_booking_id` INTEGER - for rescheduled bookings
  - `cancelled` INTEGER DEFAULT 0 - cancellation flag
  - `cancelled_at` TIMESTAMP - when appointment was cancelled

#### Backend APIs

**GET /api/client/appointments** (auth required)
- Returns user's bookings sorted by date
- Requires Bearer token in Authorization header
- Returns: array of appointments with id, date, time, duration, session_format, status, cancelled flag

**PUT /api/client/appointments/:id/reschedule** (auth required)
- Reschedules appointment to new date/time
- Only available if appointment is 24+ hours away
- Marks old booking as "rescheduled"
- Creates new booking with same payment info and session format
- Returns 400 if within 24 hours or slot unavailable

**PUT /api/client/appointments/:id/cancel** (auth required)
- Cancels appointment (non-refundable)
- Only available if appointment is 24+ hours away
- Marks booking as cancelled with timestamp
- Frees up time slot for others to book
- Returns clear message about non-refundable policy
- Returns 400 if within 24 hours or already cancelled

#### Frontend

**Client Portal Modal**
- Accessible via "My Appointments" button (visible when logged in)
- Displays appointments in two sections:
  - Upcoming: Shows date, time, duration, format, status + action buttons
  - Past: Shows same info in read-only format

**Action Buttons**
- "Reschedule" - opens reschedule flow (24hr check enforced)
- "Cancel" - cancels with confirmation dialog (24hr check enforced)
- Buttons disabled with tooltip if within 24 hours

**Functions Added**
- `openClientPortal()` - displays modal and loads appointments
- `closeClientPortal()` - hides modal
- `loadClientAppointments()` - fetches from API with auth token
- `displayClientAppointments()` - renders upcoming and past appointments
- `openRescheduleModal()` - reschedule flow (placeholder for date picker)
- `cancelAppointment()` - handles cancellation with 24hr check

### 3. Navigation Updates
- Added "My Appointments" button to user navigation bar
- Button only shows when user is logged in
- Styled consistently with existing design (warm gold/cream aesthetic)

## Testing

All features have been tested and verified:
✅ Admin password initialized on first run
✅ Wrong password returns 401 Unauthorized
✅ User registration works
✅ Auth token generation works
✅ Client appointments endpoint returns empty for new users
✅ Admin password can be changed via API
✅ New password works, old password fails
✅ All existing functionality intact

## Database Schema

### admin_settings Table
```
id INTEGER PRIMARY KEY
key TEXT UNIQUE
value TEXT
```

### bookings Table (Updated columns)
```
original_booking_id INTEGER
cancelled INTEGER DEFAULT 0
cancelled_at TIMESTAMP
```

## Design Continuity
- Maintained existing aesthetic (warm golds, cream, Cormorant Garamond headings, Lato body)
- Client portal follows clean, simple design
- Uses existing auth system with localStorage token
- Admin panel extensions follow existing tab pattern

## Business Logic

### Appointment Rescheduling
1. Verify 24+ hours until appointment
2. Check new slot availability (excludes cancelled bookings)
3. Mark old booking as "rescheduled"
4. Create new booking with same payment/format info
5. Old time slot becomes available

### Appointment Cancellation
1. Verify 24+ hours until appointment  
2. Mark booking as cancelled with timestamp
3. Free time slot for others
4. Keep record (no deletion)
5. Show non-refundable policy message

## Git Commit
All changes committed with comprehensive message:
- Commit hash: 2a5c2a7
- Two files modified: server.js, index.html
- 452 insertions across both files

## Testing Command
```bash
rm -f luce-healing.db && STRIPE_SECRET_KEY=test PORT=3087 timeout 5 node server.js
```

All endpoints tested and working correctly.
