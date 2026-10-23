renderSteps(2);

const list = document.getElementById('room-list');
const cartBar = document.getElementById('cart-bar');
let catalogue;
let search;
let cart = null;

function packageHtml(room, pkg) {
  const price = room.pricePerNight + pkg.surchargePerNight;
  const selected = cart && cart.roomId === room.id && cart.packageId === pkg.id;
  return `
    <div class="package${selected ? ' is-selected' : ''}">
      <div>
        <h4>${escapeHtml(pkg.name)}</h4>
        ${pkg.badge ? `<span class="badge">${escapeHtml(pkg.badge)}</span>` : ''}
      </div>
      <ul>${pkg.inclusions.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
      <div>
        <div class="price-big">${money(price)} <small>/night</small></div>
        <div class="fine">${money(price * search.nights)} total for ${plural(search.nights, 'night')}</div>
      </div>
      <button class="btn" type="button" data-select-room="${room.id}" data-package="${pkg.id}">
        ${selected ? 'Selected ✓' : 'Select'}
      </button>
    </div>`;
}

function roomHtml(room) {
  const selected = cart && cart.roomId === room.id;
  return `
    <article class="room-card${selected ? ' is-selected' : ''}" id="room-${room.id}">
      <div class="room-card__main">
        <div class="room-card__body">
          <div class="room-card__media">
            <img src="${room.image}" alt="${escapeHtml(room.name)}" loading="lazy">
            <span class="room-card__tag">${escapeHtml(room.collection)}</span>
          </div>
          <div>
            <h2>${escapeHtml(room.name)}</h2>
            <div class="room-card__view">${escapeHtml(room.view)}</div>
            <p class="room-card__desc">${escapeHtml(room.description)}</p>
            <p class="room-card__meta">Up to ${room.maxGuests} guests · ${room.sizeSqm} sqm · ${escapeHtml(room.bed)}</p>
            <ul class="features">${room.features.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
          </div>
        </div>
        <div class="room-card__price">
          <span class="from">From</span>
          <div class="price-big">${money(room.pricePerNight)}<small>/night</small></div>
          <span class="fine">Inclusive of taxes and charges</span>
          <span class="fine">Rate and availability are subject to change.</span>
          <button class="btn" type="button" data-toggle-packages="${room.id}" aria-expanded="${selected}">
            ${selected ? 'Change Package' : 'Select a Package'}
          </button>
        </div>
      </div>
      <div class="packages" ${selected ? '' : 'hidden'}>
        <h3>Choose a Package</h3>
        ${catalogue.packages.map((pkg) => packageHtml(room, pkg)).join('')}
      </div>
    </article>`;
}

function renderCart() {
  if (!cart) {
    cartBar.classList.remove('is-visible');
    return;
  }
  const room = catalogue.rooms.find((r) => r.id === cart.roomId);
  const pkg = catalogue.packages.find((p) => p.id === cart.packageId);
  const perNight = room.pricePerNight + pkg.surchargePerNight;
  document.getElementById('cart-summary').innerHTML =
    `<strong>${escapeHtml(room.name)}</strong> · ${escapeHtml(pkg.name)}<br>${money(perNight)} × ${plural(search.nights, 'night')}`;
  document.getElementById('cart-total').textContent = money(perNight * search.nights);
  cartBar.classList.add('is-visible');
}

function render() {
  list.innerHTML = catalogue.rooms.map(roomHtml).join('');
  renderCart();
}

list.addEventListener('click', async (e) => {
  const toggle = e.target.closest('[data-toggle-packages]');
  if (toggle) {
    const panel = toggle.closest('.room-card').querySelector('.packages');
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
    return;
  }

  const select = e.target.closest('[data-select-room]');
  if (!select) return;
  select.disabled = true;
  try {
    ({ cart } = await api('/cart', {
      method: 'POST',
      body: { roomId: select.dataset.selectRoom, packageId: select.dataset.package },
    }));
    render();
  } catch (err) {
    alert(err.message);
    select.disabled = false;
  }
});

(async function init() {
  try {
    const [rooms, state] = await Promise.all([api('/rooms'), api('/state')]);
    if (!state.search) {
      window.location.replace('/booking/search');
      return;
    }
    catalogue = rooms;
    search = state.search;
    cart = state.cart && { roomId: state.cart.roomId, packageId: state.cart.packageId };
    document.getElementById('stay-dates').textContent = `${formatDate(search.checkIn)} → ${formatDate(search.checkOut)}`;
    document.getElementById('stay-guests').textContent = guestSummary(search);
    render();
  } catch (err) {
    list.innerHTML = `<p class="loading">${escapeHtml(err.message)}</p>`;
  }
})();
