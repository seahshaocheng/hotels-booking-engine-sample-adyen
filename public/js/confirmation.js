renderSteps(4);

const OUTCOMES = {
  success: {
    icon: '✓',
    title: 'Thank you for your booking',
    message: 'We have received your payment. Please wait for an email confirming your booking.',
  },
  pending: {
    icon: '…',
    title: 'Payment pending',
    message: 'Please complete your payment and wait for an email confirming your booking.',
  },
  refused: {
    icon: '✕',
    title: 'Booking unsuccessful',
    message: 'Your booking was not successful. Please try again.',
  },
};

(async function init() {
  const params = new URLSearchParams(window.location.search);
  const status = OUTCOMES[params.get('status')] ? params.get('status') : 'refused';
  const outcome = OUTCOMES[status];
  const reservationId = params.get('reservationId');

  let details = '';
  if (reservationId) {
    try {
      const { reservation: r } = await api(`/reservations/${encodeURIComponent(reservationId)}`);
      const rows = [
        ['Reservation ID', r.id],
        ['Guest', `${r.guest.title} ${r.guest.firstName} ${r.guest.lastName}`],
        ['Room', `${r.roomName} · ${r.packageName}`],
        ['Stay', `${formatDate(r.checkIn)} → ${formatDate(r.checkOut)} (${plural(r.nights, 'night')})`],
        ['Total', money(r.amount.value, { decimals: true })],
        ['Payment result', params.get('resultCode') || r.paymentStatus],
      ];
      details = `<dl class="result__details">${rows
        .map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(v)}</dd></div>`)
        .join('')}</dl>`;
    } catch {
      // Show the outcome without details if the reservation can't be loaded.
    }
  }

  const actions = status === 'refused'
    ? '<a class="btn" href="/booking/guest">Try Again</a><a class="btn btn--ghost" href="/">Back to Home</a>'
    : '<a class="btn" href="/">Back to Home</a><a class="btn btn--ghost" href="/backoffice">View in Back Office</a>';

  document.getElementById('result').innerHTML = `
    <section class="result result--${status}" role="status">
      <div class="result__icon" aria-hidden="true">${outcome.icon}</div>
      <h2>${outcome.title}</h2>
      <p>${outcome.message}</p>
      ${details}
      <div class="result__actions">${actions}</div>
    </section>`;
})();
