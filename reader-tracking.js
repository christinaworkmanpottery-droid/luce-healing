(() => {
  const token = document.currentScript?.dataset.token;
  let sent = false, timer;
  function isAdmin() {
    if (/admin|preview|edit/i.test(location.hash) || /preview|admin|password|edit|token|session_id/i.test(location.search)) return true;
    try { if (sessionStorage.getItem('luce-admin-pw')) return true; } catch {}
    return Boolean(document.querySelector('#admin-panel.active, #admin-modal.active'));
  }
  function schedule() {
    clearTimeout(timer);
    if (sent || !token || navigator.webdriver || isAdmin() || document.visibilityState !== 'visible') return;
    timer = setTimeout(() => {
      if (isAdmin() || document.visibilityState !== 'visible') return;
      sent = true;
      fetch('/api/track', {method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,path:location.pathname+location.search+location.hash,visible:true,referrer:document.referrer})}).catch(() => {});
    }, 1000);
  }
  document.addEventListener('visibilitychange',schedule);
  window.addEventListener('hashchange',schedule);
  schedule();
})();
