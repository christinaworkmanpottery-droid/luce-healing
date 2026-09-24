const fs = require('fs');
const path = require('path');
const membership = {label:'Astrology Membership',href:'https://lucehealing.com/astrology-membership'};
const links = [
 ['Home','/'],['Email readings','/#special-offer'],['Gift a Reading','/gift'],
 [membership.label,membership.href],['Meet Christina','/#about'],['Sessions','/#services'],
 ['Pricing','/pricing.html'],['Blog','/blog'],['Free astrology emails','/subscribe'],['Contact','/#contact']
];
const pages = new Set(['index.html','blog.html','pricing.html','reading.html','forecast.html','gift.html','subscribe.html','astrology-membership.html','memes-gallery.html']);
function compactMenu(){
 return `<details class="luce-public-menu" style="margin:12px 0;text-align:left"><summary style="cursor:pointer;padding:10px 0;color:inherit">Menu</summary><nav aria-label="Public navigation" style="display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding:8px 0">${links.map(([label,href])=>`<a href="${href}" style="display:block;padding:8px 0;color:inherit">${label}</a>`).join('')}</nav></details>`;
}
function render(html){
 if(typeof html!=='string'||!/<body\b/i.test(html))return html;
 let found=false;
 html=html.replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi,nav=>{
  found=true;
  // Retain the existing element/classes and normalize its destination.
  if(/>\s*Astrology Membership\s*<\/a>/i.test(nav))return nav.replace(/<a\b([^>]*)>\s*Astrology Membership\s*<\/a>/gi,(anchor,attrs)=>attrs.includes(`href="${membership.href}"`)?anchor:`<a${attrs.replace(/\s+href\s*=\s*(["']).*?\1/i,'')} href="${membership.href}">${membership.label}</a>`);
  if(/<ul\b[^>]*class=["'][^"']*\bnav-menu\b/i.test(nav))return nav.replace(/(<ul\b[^>]*class=["'][^"']*\bnav-menu\b[^>]*>)([\s\S]*?)(<\/ul>)/i,(_,open,items,close)=>`${open}${items}<li><a class="nav-link" href="${membership.href}">${membership.label}</a></li>${close}`);
  // Minimal headers (e.g. Pricing) keep their logo and Back to Home button.
  return nav.replace(/(<a\b[^>]*>Back to Home<\/a>)/i,`<a class="btn btn-secondary" href="${membership.href}">${membership.label}</a>$1`);
 });
 if(!found){
  const menu=compactMenu();
  if(/<main\b[^>]*>/i.test(html))html=html.replace(/<main\b[^>]*>/i,match=>match+menu);
  else if(/<div class="(?:card|reading-back)"[^>]*>/i.test(html))html=html.replace(/<div class="(?:card|reading-back)"[^>]*>/i,match=>match+menu);
  else html=html.replace(/<body\b[^>]*>/i,match=>match+menu);
 }
 return html;
}
function install(app,root){
 app.use((req,res,next)=>{
  if(/^\/(?:api|admin|members|newsletter)(?:\/|\.|$)/.test(req.path))return next();
  const send=res.send.bind(res),sendFile=res.sendFile.bind(res);
  res.send=body=>send(typeof body==='string'?render(body):body);
  res.sendFile=(file,...args)=>{
   if(path.dirname(file)!==root||!pages.has(path.basename(file)))return sendFile(file,...args);
   fs.readFile(file,'utf8',(err,html)=>{if(err){const callback=args.find(x=>typeof x==='function');return callback?callback(err):next(err);}res.type('html').send(html);});
   return res;
  };
  next();
 });
 // Serve direct public .html URLs through the same navigation as clean URLs.
 app.get([...pages].map(file=>'/'+file),(req,res)=>res.sendFile(path.join(root,req.path.slice(1))));
}
module.exports={render,install,membership};
