renderSteps(3);

const $ = (id) => document.getElementById(id);
const guestForm = $('guest-form');
const GUEST_FIELDS = ['title', 'firstName', 'lastName', 'country', 'phoneCode', 'phone', 'email'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let member = null;
let memberCardsEnabled = true;
let dropin = null;

// ---------- country + calling code pickers ----------

$('country').innerHTML = COUNTRIES.map(([iso, name]) => `<option value="${iso}">${escapeHtml(name)}</option>`).join('');
$('phoneCode').innerHTML = COUNTRIES
  .map(([iso, name, dial]) => `<option value="${iso}" data-dial="${dial}">${flagEmoji(iso)} ${dial} · ${escapeHtml(name)}</option>`)
  .join('');
$('country').value = 'SG';
$('phoneCode').value = 'SG';

// Keep the calling code in step with the chosen country until the guest picks one themselves.
let phoneCodeTouched = false;
$('phoneCode').addEventListener('change', () => { phoneCodeTouched = true; });
$('country').addEventListener('change', () => {
  if (!phoneCodeTouched) $('phoneCode').value = $('country').value;
});

const dialFor = (iso) => COUNTRIES.find(([code]) => code === iso)?.[2] || '';
const isoForDial = (dial, preferredIso) =>
  (dialFor(preferredIso) === dial ? preferredIso : COUNTRIES.find(([, , d]) => d === dial)?.[0]) || 'SG';

// ---------- summary ----------

function renderSummary({ search, cart }) {
  const guests = [plural(search.adults, 'Adult'), search.children && (search.children === 1 ? '1 Child' : `${search.children} Children`)]
    .filter(Boolean)
    .join(', ');
  $('summary').innerHTML = `
    <div class="card__section">
      <div class="summary__row summary__caps">
        <span>${formatDate(search.checkIn)} → ${formatDate(search.checkOut)}</span>
        <a class="link-caps" href="/booking/search">Edit</a>
      </div>
      <div class="summary__row summary__caps"><span>${plural(search.nights, 'Night')} | 1 Room</span></div>
      <h3>Room 1: ${guests}</h3>
      <div class="summary__media">
        <img src="${cart.roomImage}" alt="${escapeHtml(cart.roomName)}">
        <span class="room-card__tag">${escapeHtml(cart.collection)}</span>
      </div>
      <div class="summary__row summary__caps">
        <span>${escapeHtml(cart.roomName)}</span>
        <a class="link-caps" href="/booking/rooms">Edit</a>
      </div>
    </div>
    <div class="card__section">
      <div class="summary__row"><span>${escapeHtml(cart.packageName)}</span><span>${money(cart.pricePerNight, { decimals: true })} / night</span></div>
      <div class="summary__row"><span>Number of nights</span><span>× ${search.nights}</span></div>
    </div>
    <div class="card__section">
      <div class="summary__row summary__total"><span>Total</span><span>${money(cart.total, { decimals: true })}</span></div>
      <p class="fine" style="text-align:right;margin:8px 0 0">Inclusive of taxes. Rate and availability are subject to change.</p>
    </div>`;
}

// ---------- membership ----------

function fillGuest(data) {
  $('title').value = data.title || 'Mr.';
  $('firstName').value = data.firstName || '';
  $('lastName').value = data.lastName || '';
  if (data.country) $('country').value = data.country;
  if (data.phoneCode) {
    $('phoneCode').value = isoForDial(data.phoneCode, data.country);
    phoneCodeTouched = true;
  }
  $('phone').value = data.phone || '';
  $('email').value = data.email || '';
}

function renderMembership() {
  const loggedIn = Boolean(member);
  $('member-login').hidden = loggedIn;
  $('member-badge').hidden = !loggedIn;
  $('signup-row').hidden = loggedIn;
  $('email').readOnly = loggedIn;
  if (loggedIn) {
    $('member-name').textContent = `${member.title} ${member.firstName} ${member.lastName}`;
    $('member-email').textContent = `Member ID: ${member.email}`;
    $('signUp').checked = false;
  }
  const canSaveCard = memberCardsEnabled && (loggedIn || $('signUp').checked);
  $('savecard-row').hidden = !canSaveCard;
  if (!canSaveCard) $('saveCard').checked = false;
}

$('signUp').addEventListener('change', renderMembership);

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-error').textContent = '';
  const email = $('login-email').value.trim();
  if (!EMAIL_RE.test(email)) {
    $('login-error').textContent = 'Please enter a valid email address.';
    return;
  }
  try {
    ({ member } = await api('/login', { method: 'POST', body: { email } }));
    fillGuest(member);
    renderMembership();
  } catch (err) {
    $('login-error').textContent = `${err.message} Tick “Sign me up” below to join.`;
  }
});

$('logout-btn').addEventListener('click', async () => {
  await api('/logout', { method: 'POST' });
  member = null;
  $('email').value = '';
  resetPayment();
  renderMembership();
});

// ---------- guest form -> Adyen session -> Drop-in ----------

function readGuest() {
  const guest = Object.fromEntries(GUEST_FIELDS.map((f) => [f, $(f).value.trim()]));
  guest.phoneCode = $('phoneCode').selectedOptions[0]?.dataset.dial || '';
  return guest;
}

function validateGuest(guest) {
  let firstInvalid = null;
  GUEST_FIELDS.forEach((f) => {
    const invalid = !guest[f] || (f === 'email' && !EMAIL_RE.test(guest[f])) || (f === 'phone' && !/^[\d\s-]{4,}$/.test(guest[f]));
    $(f).classList.toggle('is-invalid', invalid);
    if (invalid && !firstInvalid) firstInvalid = $(f);
  });
  firstInvalid?.focus();
  return !firstInvalid;
}

function setFormLocked(locked) {
  guestForm.querySelectorAll('input, select').forEach((el) => { el.disabled = locked; });
  $('to-payment').hidden = locked;
  $('edit-details').hidden = !locked;
  $('member-section').querySelectorAll('input, button').forEach((el) => { el.disabled = locked; });
}

function resetPayment() {
  if (dropin) dropin.unmount();
  dropin = null;
  $('payment-placeholder').hidden = false;
  setFormLocked(false);
}

$('edit-details').addEventListener('click', resetPayment);

function goToConfirmation(reservationId, sessionId, result = {}) {
  const qs = new URLSearchParams({ reservationId, sessionId, resultCode: result.resultCode || 'Refused' });
  if (result.sessionResult) qs.set('sessionResult', result.sessionResult);
  window.location.href = `/api/redirectUrl?${qs}`;
}

async function mountDropin({ reservationId, session, showStoredPaymentMethods }) {
  const config = await api('/config');
  const { AdyenCheckout, Dropin } = window.AdyenWeb;

  const checkout = await AdyenCheckout({
    environment: config.environment,
    clientKey: config.clientKey,
    session: { id: session.id, sessionData: session.sessionData },
    countryCode: 'SG',
    locale: 'en-US',
    // Tell the server whether a stored member card or a new card is being used.
    beforeSubmit: async (data, component, actions) => {
      try {
        await api(`/reservations/${encodeURIComponent(reservationId)}/payment-method`, {
          method: 'POST',
          body: { storedPaymentMethodId: data.paymentMethod?.storedPaymentMethodId || null },
        });
        actions.resolve(data);
      } catch (err) {
        $('guest-error').textContent = err.message;
        actions.reject();
      }
    },
    onPaymentCompleted: (result) => goToConfirmation(reservationId, session.id, result),
    onPaymentFailed: (result) => goToConfirmation(reservationId, session.id, result),
    onError: (error) => {
      if (error.name === 'CANCEL') return;
      console.error(error);
      $('guest-error').textContent = 'Something went wrong with the payment. Please try again.';
    },
  });

  dropin = new Dropin(checkout, {
    showStoredPaymentMethods,
    paymentMethodsConfiguration: {
      card: { hasHolderName: true, holderNameRequired: true, name: 'Credit or debit card' },
    },
  }).mount('#dropin-container');
  $('payment-placeholder').hidden = true;
}

guestForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  $('guest-error').textContent = '';
  const guest = readGuest();
  if (!validateGuest(guest)) {
    $('guest-error').textContent = 'Please complete the highlighted fields.';
    return;
  }

  const button = $('to-payment');
  button.disabled = true;
  button.textContent = 'Preparing secure payment…';
  try {
    const result = await api('/initiateSession', {
      method: 'POST',
      body: { guest, signUp: $('signUp').checked, saveCard: $('saveCard').checked },
    });
    setFormLocked(true);
    await mountDropin(result);
    $('dropin-container').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    $('guest-error').textContent = err.message;
    setFormLocked(false);
  } finally {
    button.disabled = false;
    button.textContent = 'Continue to Payment';
  }
});

guestForm.addEventListener('input', (e) => e.target.classList?.remove('is-invalid'));

(async function init() {
  try {
    const state = await api('/state');
    if (!state.search) return window.location.replace('/booking/search');
    if (!state.cart) return window.location.replace('/booking/rooms');
    renderSummary(state);
    member = state.member;
    memberCardsEnabled = state.memberCardsEnabled;
    if (member) fillGuest(member);
    renderMembership();
  } catch (err) {
    $('guest-error').textContent = err.message;
  }
})();
