// Shared public reviews: one excerpt on Home, full list and submission on Meet Christina.
(() => {
const escapeReview = value => String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        // Star rating system for review form
        document.querySelectorAll('#star-rating .star')?.forEach(star => {
            star.addEventListener('click', () => {
                const rating = star.dataset.rating;
                document.getElementById('review-rating-value').value = rating;
                document.getElementById('rating-text').textContent = `${rating} star${rating > 1 ? 's' : ''}`;
                
                // Update star display
                document.querySelectorAll('#star-rating .star').forEach(s => {
                    if (s.dataset.rating <= rating) {
                        s.textContent = '★';
                        s.style.color = '#D4A574';
                    } else {
                        s.textContent = '☆';
                        s.style.color = '#ddd';
                    }
                });
            });
        });

        document.getElementById('review-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const rating = parseInt(document.getElementById('review-rating-value').value);
            
            if (rating < 1) {
                alert('Please select a rating');
                return;
            }
            
            try {
                const response = await fetch('/api/reviews/submit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: document.getElementById('review-name').value,
                        rating: rating,
                        review_text: document.getElementById('review-text').value,
                        session_type: document.getElementById('review-session-type').value
                    })
                });
                const data = await response.json();
                
                const feedback = document.getElementById('review-feedback');
                feedback.style.display = 'block';
                if (response.ok) {
                    feedback.textContent = data.message;
                    feedback.style.background = '#e8f5e9';
                    feedback.style.color = '#2e7d32';
                    feedback.style.border = '1px solid #4caf50';
                    document.getElementById('review-form').reset();
                    document.getElementById('rating-text').textContent = 'Select rating';
                    document.querySelectorAll('#star-rating .star').forEach(s => {
                        s.textContent = '☆';
                        s.style.color = '#ddd';
                    });
                } else {
                    feedback.textContent = data.error;
                    feedback.style.background = '#ffebee';
                    feedback.style.color = '#c62828';
                    feedback.style.border = '1px solid #f44336';
                }
            } catch (e) {
                alert('Error submitting review: ' + e.message);
            }
        });

        async function loadPublicReviews() {
            try {
                const response = await fetch('/api/reviews');
                const reviews = (await response.json()).filter(review => !(review.name.trim().toLowerCase() === 'test' && review.review_text.trim().toLowerCase() === 'great session'));
                const container = document.getElementById('reviews-container');
                
                if (!reviews.length) {
                    container.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #65576e; padding: 40px;">No reviews yet. Be the first to share!</p>';
                    return;
                }
                
                let html = '';
                const homepage = document.body.classList.contains('home-editorial');
                (homepage ? reviews.slice(0, 1) : reviews).forEach(review => {
                    review = {...review, name: escapeReview(review.name), session_type: escapeReview(review.session_type || 'Energy Healing'), review_text: escapeReview(review.review_text)};
                    const stars = '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating);
                    const maxLen = 250;
                    const isLong = review.review_text.length > maxLen;
                    const shortText = isLong ? review.review_text.substring(0, maxLen).replace(/\s+\S*$/, '') + '…' : review.review_text;
                    html += `
                        <div class="review-card">
                            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px;">
                                <div>
                                    <h4 style="margin: 0 0 3px 0;">${review.name}</h4>
                                    <small style="color: #65576e;">${review.session_type || 'Energy Healing'}</small>
                                </div>
                                <div style="font-size: 1.2em; color: #795526; letter-spacing: 2px;">${stars}</div>
                            </div>
                            <p class="review-text-short" style="color: #333; line-height: 1.6;">${shortText}</p>
                            ${isLong ? `<p class="review-text-full" style="color: #333; line-height: 1.6; display: none;">${review.review_text}</p><a href="#" class="review-read-more" style="color: #795526; font-weight: 600; font-size: 0.9rem; text-decoration: none;" onclick="event.preventDefault(); this.previousElementSibling.style.display='block'; this.previousElementSibling.previousElementSibling.style.display='none'; this.textContent = this.textContent === 'Read more →' ? 'Show less ←' : 'Read more →'; if(this.textContent === 'Read more →'){ this.previousElementSibling.style.display='none'; this.previousElementSibling.previousElementSibling.style.display='block'; }">Read more →</a>` : ''}
                        </div>
                    `;
                });

                container.innerHTML = html;
            } catch (e) {
                document.getElementById('reviews-container').textContent = 'Reviews are temporarily unavailable. Please try again later.';
            }
        }


loadPublicReviews();
})();
