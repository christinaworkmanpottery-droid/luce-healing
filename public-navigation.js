const fs = require('fs');
const path = require('path');
const membership = {label:'Astrology Membership',href:'https://lucehealing.com/astrology-membership'};
const links = [
 ['Home','/'],['My Purchases & Readings','/my-purchased-readings'],['Readings','/readings.html'],['Gift a Reading','/gift'],
 ['Personalized Monthly Reading','/personalized-monthly-reading'],
 ['Astrology Membership','/astrology-membership'],['Meet Christina','/about.html'],
 ['Sessions','/sessions.html'],['Pricing','/pricing.html'],['Blog','/blog'],
 ['Free astrology emails','/subscribe'],['Contact','/contact.html'],['FAQ','/faq.html']
];
const pages = new Set(['index.html','blog.html','pricing.html','reading.html','forecast.html','gift.html','subscribe.html','astrology-membership.html','memes-gallery.html','about.html','contact.html','faq.html','readings.html','sessions.html','reading-success.html','forecast-success.html','booking-success.html','booking-cancel.html','unsubscribe.html']);
function header(accountItems='') {
 return `<nav class="navbar luce-site-header" id="navbar" aria-label="Main navigation"><div class="nav-container"><div class="nav-logo"><a href="/" aria-label="Luce Healing home"><img class="nav-logo-img" src="/images/logo.jpg" alt=""> Luce Healing</a></div><a class="luce-home-link" href="/">Home</a><button class="hamburger luce-menu-toggle" type="button" aria-controls="main-menu" aria-expanded="false" aria-label="Open menu">Menu <span aria-hidden="true">☰</span></button><ul class="nav-menu" id="main-menu">${links.map(([label,href])=>`<li><a class="nav-link" href="${href}">${label}</a></li>`).join('')}${accountItems}</ul></div></nav>`;
}
function render(html){
 if(typeof html!=='string'||!/<body\b/i.test(html)||html.includes('class="navbar luce-site-header"'))return html;
 // Replace only the site navbar; reading/account navigation remains intact.
 let found=false;
 html=html.replace(/<nav\b[^>]*class=["'][^"']*\bnavbar\b[^"']*["'][^>]*>[\s\S]*?<\/nav>/i,nav=>{
  found=true;
  const accounts=nav.match(/<li\b[^>]*id="(?:auth-nav-item|user-nav-item)"[^>]*>[\s\S]*?<\/li>/g)||[];
  return header(accounts.join(''));
 });
 if(!found)html=html.replace(/<body\b[^>]*>/i,match=>match+header());
 html=html.replace(/<head\b[^>]*>/i,match=>match+'<script src="/public-menu.js" defer></script>');
 html=html.replace(/<\/head>/i,'<link rel="stylesheet" href="/public-site.css"></head>');
 html=html.replace(/<body([^>]*)>/i,(_,attrs)=>'<body'+(/class=/.test(attrs)?attrs.replace(/class=(["'])(.*?)\1/,(_,q,c)=>'class='+q+c+' luce-public-page'+q):attrs+' class="luce-public-page"')+'>');
 return html;
}
function install(app,root){
 app.use((req,res,next)=>{
  if(/^\/(?:api|admin|members|newsletter)(?:\/|\.|$)/.test(req.path))return next();
  const send=res.send.bind(res),sendFile=res.sendFile.bind(res);
  res.send=body=>send(typeof body==='string'?render(body):body);
  res.sendFile=(file,...args)=>{
   if(!((path.dirname(file)===root&&pages.has(path.basename(file)))||(path.dirname(file)===path.join(root,'private-membership')&&path.basename(file)==='purchased.html')))return sendFile(file,...args);
   fs.readFile(file,'utf8',(err,html)=>{if(err){const callback=args.find(x=>typeof x==='function');return callback?callback(err):next(err);}res.type('html').send(html);});
   return res;
  };
  next();
 });
 // Serve direct public .html URLs through the same navigation as clean URLs.
 app.get([...pages].map(file=>'/'+file),(req,res)=>res.sendFile(path.join(root,req.path.slice(1))));
}
module.exports={render,install,membership};
