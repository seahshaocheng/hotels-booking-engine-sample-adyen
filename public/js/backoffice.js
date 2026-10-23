const REFRESH_MS = 5000;
const expanded = new Set();

const pillClass = (status) => {
  if (['Authorised', 'Confirmed', 'Success', 'Deleted'].includes(status)) return 'pill--ok';
  if (['Refused', 'Cancelled', 'Failed', 'Error'].includes(status)) return 'pill--bad';
  if (['Pending', 'Pending Payment', 'Not Paid', 'In progress'].includes(status)) return 'pill--warn';
  return '';
};
const pill = (status) => `<span class="pill ${pillClass(status)}">${escapeHtml(status || '—')}</span>`;
const mono = (value) => (value ? `<span class="mono">${escapeHtml(value)}</span>` : '<span class="fine">—</span>');
const time = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });

function reservationRows(r) {
  const consent = [
    r.memberId ? (r.saveCardConsent ? 'Yes' : 'No') : '<span class="fine">Guest</span>',
    r.usedMemberToken && `<span class="pill">Paid with member token</span>`,
    r.forward && pill(`storeToken: ${r.forward.status}`),
    r.zeroAuth && pill(`$0 auth: ${r.zeroAuth.status}`),
    r.cardCleanup && pill(`Unsaved card: ${r.cardCleanup.status}`),
  ].filter(Boolean).join('<br>');
  const main = `
    <tr>
      <td>${mono(r.id)}<div class="fine">${time(r.createdAt)}</div></td>
      <td>${escapeHtml(`${r.guest.title} ${r.guest.firstName} ${r.guest.lastName}`)}
        <div class="fine">${escapeHtml(r.guest.email)}</div>
        <div class="fine">${escapeHtml(r.memberType)}</div></td>
      <td>${escapeHtml(r.roomName)}<div class="fine">${escapeHtml(r.packageName)}</div></td>
      <td>${formatDate(r.checkIn)} → ${formatDate(r.checkOut)}
        <div class="fine">${plural(r.nights, 'night')} · ${plural(r.adults, 'adult')}${r.children ? `, ${r.children} child${r.children > 1 ? 'ren' : ''}` : ''}</div></td>
      <td class="num">${money(r.amount.value, { decimals: true })}</td>
      <td>${pill(r.paymentStatus)}${r.pspReference ? `<div class="fine mono">${escapeHtml(r.pspReference)}</div>` : ''}</td>
      <td>${pill(r.reservationStatus)}</td>
      <td>${consent}</td>
      <td>
        <dl class="token-list">
          <dt>OPI</dt><dd>${mono(r.tokens.opiTransToken)}</dd>
          <dt>Shopper ref</dt><dd>${mono(r.tokens.shopperReference)}</dd>
          <dt>Stored PM ID</dt><dd>${mono(r.tokens.storedPaymentMethodId)}</dd>
          <dt>Member token</dt><dd>${mono(r.tokens.memberToken)}</dd>
          ${r.usedMemberToken ? `<dt>Token used</dt><dd>${mono(r.memberTokenUsed)}</dd>` : ''}
          <dt>Session ref</dt><dd>${mono(r.sessionShopperReference)}</dd>
        </dl>
      </td>
      <td><button class="toggle-detail" type="button" data-toggle="${escapeHtml(r.id)}">${expanded.has(r.id) ? 'Hide' : 'History'}</button></td>
    </tr>`;

  if (!expanded.has(r.id)) return main;
  const history = r.history.length
    ? r.history.map((h) => `<li><time>${time(h.at)}</time><strong>${escapeHtml(h.type)}</strong> ${mono(h.detail)}</li>`).join('')
    : '<li class="fine">No events yet.</li>';
  return `${main}
    <tr class="row-detail"><td colspan="10">
      <ul class="history">${history}</ul>
      ${r.forward?.response ? `<p class="fine">storeToken forward response:</p><pre class="mono">${escapeHtml(JSON.stringify(r.forward.response, null, 2))}</pre>` : ''}
      ${r.zeroAuth?.response ? `<p class="fine">$0 auth forward response:</p><pre class="mono">${escapeHtml(JSON.stringify(r.zeroAuth.response, null, 2))}</pre>` : ''}
    </td></tr>`;
}

function render({ reservations, members }) {
  const count = (fn) => reservations.filter(fn).length;
  const stats = [
    ['Reservations', reservations.length],
    ['Confirmed', count((r) => r.reservationStatus === 'Confirmed')],
    ['Pending payment', count((r) => r.reservationStatus === 'Pending Payment')],
    ['Cards saved to members', count((r) => r.tokens.memberToken)],
  ];
  document.getElementById('stats').innerHTML = stats
    .map(([label, value]) => `<div class="stat"><dt>${label}</dt><dd>${value}</dd></div>`)
    .join('');

  document.getElementById('reservations').innerHTML = reservations.length
    ? reservations.map(reservationRows).join('')
    : '<tr><td colspan="10" class="empty">No reservations yet. Make a booking through the <a href="/booking/search">booking demo</a>.</td></tr>';

  document.getElementById('members').innerHTML = members.length
    ? members.map((m) => `
      <tr>
        <td>${mono(m.id)}</td>
        <td>${escapeHtml(`${m.title} ${m.firstName} ${m.lastName}`)}</td>
        <td>${escapeHtml(m.country)}</td>
        <td>${escapeHtml(`${m.phoneCode} ${m.phone}`)}</td>
        <td>${m.storedCards.length ? m.storedCards.map((c) => `${mono(c.token)} <span class="fine">(${escapeHtml(c.reservationId)})</span>`).join('<br>') : '<span class="fine">None</span>'}</td>
      </tr>`).join('')
    : '<tr><td colspan="5" class="empty">No members yet.</td></tr>';
}

let lastData = null;
async function load() {
  try {
    lastData = await api('/reservations');
    render(lastData);
  } catch (err) {
    document.getElementById('reservations').innerHTML = `<tr><td colspan="10" class="empty">${escapeHtml(err.message)}</td></tr>`;
  }
}

document.getElementById('reservations').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-toggle]');
  if (!btn) return;
  const id = btn.dataset.toggle;
  expanded.has(id) ? expanded.delete(id) : expanded.add(id);
  if (lastData) render(lastData);
});
document.getElementById('refresh').addEventListener('click', load);

setInterval(() => {
  if (document.getElementById('auto-refresh').checked && !document.hidden) load();
}, REFRESH_MS);
load();
