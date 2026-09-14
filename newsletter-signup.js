// Shared signup behavior: success only follows server confirmation.
(() => {
  const form = document.getElementById('newsletter-form') || document.getElementById('signupForm');
  if (!form) return;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const feedback = document.getElementById('newsletter-feedback') || document.getElementById('feedback');
    const email = form.querySelector('input[type="email"]');
    const name = form.querySelector('input[name="name"]') || document.getElementById('name');
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'Subscribing…';
    feedback.hidden = false;
    feedback.style.display = 'block';
    feedback.textContent = '';
    try {
      const response = await fetch('/api/newsletter/subscribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.value.trim(), name: name?.value.trim() || '', source: 'luce-healing' })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to subscribe. Please try again.');
      feedback.textContent = data.message || 'You’re subscribed. Look out for the next Luce Healing email.';
      form.reset();
    } catch (error) {
      feedback.textContent = error.message === 'Failed to fetch' ? 'We couldn’t connect. Please try again in a moment.' : error.message;
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  });
})();
