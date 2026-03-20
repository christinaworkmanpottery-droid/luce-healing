# Luce Healing Website

A beautiful, production-ready static website for Luce Healing, a spiritual healing and guidance practice in Culver City, CA.

**Website:** www.lucehealing.com  
**Owner:** Christina Workman  
**Contact:** lucehealing13@gmail.com | 310-310-4686

---

## 📁 Files

- **index.html** (580 lines) — Complete single-page website with all sections, inline metadata, and JavaScript
- **styles.css** (864 lines) — Responsive, beautiful styling with animations and accessibility
- **sitemap.xml** — SEO sitemap for search engines
- **robots.txt** — Search engine crawling directives
- **README.md** — This file

---

## ✨ Features

### Design & User Experience
- **Calming aesthetic** — Warm golds, soft whites, gentle cream and sage tones
- **Fully responsive** — Mobile, tablet, desktop optimized
- **Smooth navigation** — Sticky nav, smooth scrolling, mobile menu
- **Subtle animations** — Fade-in cards on scroll, floating symbols, hover effects
- **Scroll-to-top button** — Fixed button for easy navigation

### Content Sections
1. **Hero/Home** — Introduction with CTA
2. **About** — Christina's story and qualifications with highlight cards
3. **Services** — Three main services with details:
   - Personal Energy Healing Sessions
   - End-of-Life & Grief Support
   - Space & Land Clearing
4. **Work With Me** — Booking process and quick contact info
5. **FAQ** — 8 common questions answered
6. **Contact** — Contact form (Formspree) + direct contact methods
7. **Footer** — Links to Christina's other websites

### SEO Optimization
- ✅ Full meta tags (title, description, keywords)
- ✅ Open Graph tags for social sharing
- ✅ Pinterest rich pin tags
- ✅ JSON-LD structured data (LocalBusiness, FAQPage, HealthAndBeautyBusiness)
- ✅ Canonical URLs
- ✅ Sitemap.xml
- ✅ Robots.txt

### Accessibility
- Semantic HTML structure
- ARIA labels on buttons
- Clear, jargon-free language
- High contrast and readable fonts
- Keyboard navigation support

### Technical Stack
- **HTML5** — Semantic markup
- **CSS3** — Flexbox and Grid layouts, animations, responsive design
- **Vanilla JavaScript** — No dependencies, lightweight
- **Google Fonts** — Cormorant Garamond (headings), Lato (body)
- **Form Handling** — Formspree integration (configure with your email)

---

## 🚀 Deployment

### Local Testing
```bash
# Simple Python server
python3 -m http.server 8000

# Or Node.js
npx http-server
```

Then visit `http://localhost:8000`

### Production Deployment
1. Update the form action in `index.html` (line ~467):
   ```html
   <form class="contact-form" action="https://formspree.io/f/YOUR_FORMSPREE_ID" method="POST">
   ```
   Get your ID from [formspree.io](https://formspree.io)

2. Update canonical URL and og:url in meta tags if hosting on a different domain

3. Deploy to:
   - **Netlify** — Drag & drop or Git push
   - **Vercel** — Git push or CLI
   - **GitHub Pages** — Push to gh-pages branch
   - **Traditional hosting** — SFTP or Git deployment

---

## 🎨 Customization

### Colors
Edit CSS variables in `styles.css` (top of file):
```css
:root {
    --primary-gold: #D4A574;
    --light-gold: #E8C9A0;
    --warm-white: #F9F7F3;
    --cream: #FFFEF8;
    --soft-sage: #B8C9B8;
    --soft-lavender: #D4C4E5;
    --dark-text: #2C2C2C;
    --light-text: #6B6B6B;
    --accent-gold: #C9945C;
}
```

### Typography
Fonts are from Google Fonts:
- Headings: Cormorant Garamond (elegant serif)
- Body: Lato (clean sans-serif)

Change in the `<link>` tag in `<head>` and CSS `--font-serif` / `--font-sans` variables.

### Contact Form
The form currently uses **Formspree** for email delivery. Set it up:
1. Go to [formspree.io](https://formspree.io)
2. Create a new project and connect your email
3. Copy the form endpoint ID
4. Update `action="https://formspree.io/f/YOUR_ID"` in the HTML

---

## 📝 Content Management

All content is in `index.html`. Edit:
- Hero text and CTA buttons
- About section and highlight cards
- Service descriptions and features
- FAQ items
- Contact info and footer links
- Contact form fields

---

## 🔍 SEO Keywords Targeted

- Energy healing Culver City
- Reiki healer Los Angeles
- Grief support healer
- Space clearing Los Angeles
- Spiritual guidance
- End-of-life support
- Master energy healer
- Distance healing
- Ordained minister

---

## 📱 Browser Support

- Chrome/Edge: Latest 2 versions
- Firefox: Latest 2 versions
- Safari: Latest 2 versions
- Mobile browsers: iOS Safari, Chrome Mobile

---

## 🔐 Security & Privacy

- Static site (no database or backend needed)
- HTTPS recommended for production
- Contact form data sent to your email via Formspree
- No cookies or tracking (add Google Analytics/Hotjar separately if desired)

---

## ✅ Checklist for Launch

- [ ] Update Formspree form ID in contact form
- [ ] Test contact form end-to-end
- [ ] Verify all links work (internal nav, external links)
- [ ] Test on mobile devices (iOS, Android)
- [ ] Test in major browsers
- [ ] Verify SEO meta tags with browser DevTools
- [ ] Set up domain and SSL certificate
- [ ] Submit sitemap to Google Search Console
- [ ] Set up Google Analytics if desired
- [ ] Test email notifications from contact form

---

## 📧 Contact & Support

**For website issues:** Contact Christina at lucehealing13@gmail.com

---

## 📄 License

© 2024 Luce Healing. All rights reserved.
