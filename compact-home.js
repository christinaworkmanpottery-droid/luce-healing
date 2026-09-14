// Reveal the target before scrolling, including direct links to reading/pricing details.
function revealDestination(hash){if(!hash||hash==='#')return;const target=document.getElementById(decodeURIComponent(hash.slice(1)));if(!target)return;let node=target;while(node){if(node.tagName==='DETAILS')node.open=true;node=node.parentElement;}target.scrollIntoView({block:'start'});}
document.addEventListener('click',event=>{const link=event.target.closest('a[href^="#"]');if(link&&link.hash!=='#admin')requestAnimationFrame(()=>revealDestination(link.hash));});
window.addEventListener('hashchange',()=>revealDestination(location.hash));
if(location.hash&&location.hash!=='#admin')revealDestination(location.hash);
