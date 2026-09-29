// Capture owns the shared menu so legacy page handlers cannot toggle it twice.
(() => {
 const header=document.querySelector('.luce-site-header');
 if(!header)return;
 const button=header.querySelector('.luce-menu-toggle'),menu=header.querySelector('.nav-menu');
 function setOpen(open){menu.classList.toggle('active',open);button.classList.toggle('active',open);button.setAttribute('aria-expanded',String(open));button.setAttribute('aria-label',open?'Close menu':'Open menu');}
 button.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();setOpen(button.getAttribute('aria-expanded')!=='true');},true);
 button.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopImmediatePropagation();setOpen(button.getAttribute('aria-expanded')!=='true');}},true);
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&button.getAttribute('aria-expanded')==='true'){setOpen(false);button.focus();}});
 document.addEventListener('click',e=>{if(!header.contains(e.target))setOpen(false);});
 header.addEventListener('focusout',()=>{requestAnimationFrame(()=>{if(!header.contains(document.activeElement))setOpen(false);});});
 menu.addEventListener('click',e=>{if(e.target.closest('a'))setOpen(false);});
 for(const a of menu.querySelectorAll('a'))if(a.pathname===location.pathname)a.setAttribute('aria-current','page');
})();
