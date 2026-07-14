# How to Set Up Google Analytics for LuceHealing.com

## Quick Setup (10 minutes)

### Step 1: Create Google Analytics Account
1. Go to https://analytics.google.com
2. Sign in with `lucehealing13@gmail.com` (or any Google account)
3. Click **"Start measuring"**

### Step 2: Create Property
1. **Property name:** Luce Healing
2. **Reporting time zone:** Pacific Time (US & Canada)
3. **Currency:** USD
4. Click **"Next"**

### Step 3: Business Information
1. **Industry category:** Health & Fitness
2. **Business size:** Small (1-10 employees)
3. **How you plan to use Google Analytics:** Check relevant boxes
4. Click **"Create"**

### Step 4: Accept Terms
1. Accept Google Analytics Terms of Service
2. Accept Google Measurement Controller-Controller Data Protection Terms
3. Click **"I Accept"**

### Step 5: Set Up Data Stream
1. Choose **"Web"**
2. **Website URL:** `https://lucehealing.com`
3. **Stream name:** Luce Healing Website
4. Click **"Create stream"**

### Step 6: Get Your Measurement ID
You'll see a screen showing your **Measurement ID**.

It looks like: `G-XXXXXXXXXX`

**COPY THIS ID!**

### Step 7: Update Website Code
1. Open `index.html` in your code editor
2. Find this section (around line 18-23):

```html
<!-- Google Analytics (Replace GA_MEASUREMENT_ID with your actual ID) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=GA_MEASUREMENT_ID"></script>
<script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'GA_MEASUREMENT_ID');
</script>
```

3. Replace **both instances** of `GA_MEASUREMENT_ID` with your actual ID:

```html
<!-- Google Analytics -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
<script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-XXXXXXXXXX');
</script>
```

4. Save the file

### Step 8: Deploy to Website
```bash
cd ~/.openclaw/workspace/luce-healing
git add index.html
git commit -m "Add Google Analytics tracking"
git push origin main
```

Render will automatically deploy the update (takes ~2-3 minutes).

### Step 9: Verify Tracking Works
1. Go back to Google Analytics
2. Click **"Reports"** → **"Realtime"**
3. Open https://lucehealing.com in a new browser tab
4. You should see **1 active user** appear in Google Analytics

✅ **Done!** Analytics is now tracking all visitors.

---

## What Google Analytics Will Track

Once configured, you'll be able to see:

### Visitor Metrics
- Total visitors (daily, weekly, monthly)
- New vs returning visitors
- Geographic location (city, state, country)
- Device type (mobile, desktop, tablet)
- Browser and operating system

### Traffic Sources
- **Direct:** People typing URL directly or from bookmarks
- **Organic Search:** Google, Bing, other search engines
- **Social:** Instagram, Facebook, etc.
- **Referral:** Other websites linking to you
- **Email:** Newsletter clicks

### Behavior Metrics
- Pages visited
- Time on page
- Bounce rate (% who leave immediately)
- Navigation paths (which pages lead to bookings)

### Conversion Tracking
- Button clicks (Book Now, $33 Reading)
- Form submissions
- External link clicks
- Scroll depth

---

## How to Use Analytics

### Daily Quick Check (2 minutes)
1. Go to **Realtime** → See current active visitors
2. Check which pages they're viewing

### Weekly Review (10 minutes)
1. Go to **Reports** → **Acquisition** → **Traffic acquisition**
2. See where visitors are coming from
3. Go to **Reports** → **Engagement** → **Pages and screens**
4. See which pages are most popular
5. Go to **Reports** → **Engagement** → **Events**
6. See which buttons are getting clicked

### Monthly Analysis (30 minutes)
1. Compare month-over-month growth
2. Identify best-performing content
3. Find drop-off points in booking flow
4. Adjust strategy based on data

---

## Helpful Reports to Set Up

### Custom Events (Optional)
Track specific actions by adding event tracking:

**Book Now button clicks:**
```javascript
gtag('event', 'click', {
  'event_category': 'engagement',
  'event_label': 'book_now_button'
});
```

**$33 Reading button clicks:**
```javascript
gtag('event', 'click', {
  'event_category': 'conversion',
  'event_label': '33_dollar_reading'
});
```

Ask Esme to add these if you want more detailed tracking.

---

## Troubleshooting

### "No data showing in Analytics"
- Wait 24 hours — initial data can take time
- Check Realtime view first (shows immediate activity)
- Verify Measurement ID is correct in code
- Clear browser cache and test again

### "Only seeing my own visits"
- This is normal at first
- Exclude your own IP address in GA settings (optional)
- Share site with friends to test tracking

### "Analytics seems slow"
- Standard reports update every 24-48 hours
- Use Realtime view for immediate feedback
- Full historical data takes time to accumulate

---

## Support

If you need help:
1. Ask Esme (I can help with code changes)
2. Google Analytics Help Center: https://support.google.com/analytics
3. YouTube: Search "Google Analytics 4 tutorial"

---

**Quick Start Checklist:**
- [ ] Sign in to analytics.google.com
- [ ] Create property for lucehealing.com
- [ ] Copy Measurement ID (G-XXXXXXXXXX)
- [ ] Replace GA_MEASUREMENT_ID in index.html (2 places)
- [ ] Commit and push to GitHub
- [ ] Wait 2-3 minutes for Render deployment
- [ ] Check Realtime view in Google Analytics
- [ ] See yourself as active user
- [ ] ✅ Done!
