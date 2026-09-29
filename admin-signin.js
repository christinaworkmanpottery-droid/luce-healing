window.luceAdminSignIn = function () {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-labelledby', 'admin-signin-title');
    dialog.style.cssText = 'margin:auto;padding:26px;border:1px solid #d5c4df;border-radius:12px;width:min(420px,calc(100% - 32px));max-height:90dvh;overflow:auto;color:#392c44;background:#fff;';
    dialog.innerHTML = `<form id="admin-signin-form">
      <h2 id="admin-signin-title" style="margin:0 0 18px">Admin sign in</h2>
      <input type="text" name="username" autocomplete="username" value="admin" hidden>
      <label for="admin-signin-password">Admin password</label>
      <input id="admin-signin-password" name="password" type="password" autocomplete="current-password" required style="display:block;width:100%;box-sizing:border-box;font-size:16px;padding:12px;margin:8px 0 18px">
      <label style="display:flex;align-items:center;gap:10px;font-size:16px;line-height:1.5"><input name="remember" type="checkbox" checked style="width:20px;height:20px;flex-shrink:0"> Keep me signed in for 30 days</label>
      <p style="font-size:14px;margin:8px 0 18px">Use this on your own phone or computer.</p>
      <p id="admin-signin-error" role="alert" style="color:#8b2635"></p>
      <div style="display:flex;gap:12px;flex-wrap:wrap"><button type="submit" class="btn btn-primary">Sign In</button><button type="button" class="btn btn-secondary" id="admin-signin-cancel">Cancel</button></div>
    </form>`;
    document.body.append(dialog);
    const form = dialog.querySelector('form');
    let pending = false;
    const finish = success => { form.reset(); dialog.close(); dialog.remove(); resolve(success); };
    dialog.addEventListener('cancel', e => { e.preventDefault(); if (!pending) finish(false); });
    dialog.querySelector('#admin-signin-cancel').addEventListener('click', () => { if (!pending) finish(false); });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (pending) return;
      pending = true;
      const submit = form.querySelector('[type=submit]');
      submit.disabled = true;
      submit.textContent = 'Signing in…';
      const error = dialog.querySelector('#admin-signin-error');
      error.textContent = '';
      try {
        const response = await fetch('/api/admin/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: form.elements.password.value, remember: form.elements.remember.checked }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to sign in.');
        finish(true);
      } catch (err) { error.textContent = err.message || 'Unable to sign in. Please try again.'; }
      finally { pending = false; submit.disabled = false; submit.textContent = 'Sign In'; }
    });
    dialog.showModal();
    form.elements.password.focus();
  });
};
// Existing admin panels share this fetch API. Cookie sessions need no password URL.
const luceAdminFetch = window.fetch.bind(window);
window.fetch = function (input, init) {
  if (typeof input === 'string' || input instanceof URL) {
    const url = new URL(input, window.location.href);
    if (url.origin === window.location.origin && url.pathname.startsWith('/api/admin/') && url.searchParams.get('password') === 'cookie-session') {
      url.searchParams.delete('password');
      input = url.href;
    }
  }
  return luceAdminFetch(input, init);
};
