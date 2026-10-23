// Shared header, menu, booking stepper and small helpers used on every page.

const LOGO_SVG = `
  <svg viewBox="0 0 40 26" aria-hidden="true">
    <path d="M3 22 L20 3 L37 22" fill="none" stroke="currentColor" stroke-width="1.8"/>
    <path d="M11 22 L20 12 L29 22" fill="none" stroke="currentColor" stroke-width="1.8"/>
    <line x1="1" y1="25" x2="39" y2="25" stroke="currentColor" stroke-width="1.4"/>
  </svg>`;

const BOOKING_STEPS = [
  { label: 'Search', href: '/booking/search' },
  { label: 'Select a Room', href: '/booking/rooms' },
  { label: 'Guest & Credit Card', href: '/booking/guest' },
  { label: 'Confirmation', href: null },
];

function renderHeader() {
  const header = document.getElementById('site-header');
  if (!header) return;
  const solid = header.hasAttribute('data-solid');
  header.className = `site-header${solid ? ' is-solid' : ''}`;
  header.innerHTML = `
    <div class="site-header__inner">
      <div class="site-header__left">
        <a class="btn btn--outline-light" href="/booking/search">Book Now</a>
      </div>
      <a class="logo" href="/" aria-label="Above Beyond home">${LOGO_SVG}<span>Above Beyond</span></a>
      <div class="site-header__right">
        <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="menu-panel">
          <span class="menu-toggle__label">Menu</span>
          <span class="menu-toggle__icon" aria-hidden="true"><i></i><i></i><i></i></span>
        </button>
      </div>
    </div>`;

  const backdrop = document.createElement('div');
  backdrop.className = 'menu-backdrop';
  const panel = document.createElement('aside');
  panel.className = 'menu-panel';
  panel.id = 'menu-panel';
  panel.setAttribute('aria-label', 'Site menu');
  panel.innerHTML = `
    <button class="menu-panel__close" type="button">Close ✕</button>
    <nav>
      <a href="/booking/search">Booking Demo<small>Book a stay with Adyen Drop-in</small></a>
      <a href="/backoffice">Hotel Back Office Demo<small>Reservations, payment status & tokens</small></a>
    </nav>`;
  document.body.append(backdrop, panel);

  const toggleBtn = header.querySelector('.menu-toggle');
  const setOpen = (open) => {
    panel.classList.toggle('is-open', open);
    backdrop.classList.toggle('is-open', open);
    toggleBtn.setAttribute('aria-expanded', String(open));
  };
  toggleBtn.addEventListener('click', () => setOpen(true));
  panel.querySelector('.menu-panel__close').addEventListener('click', () => setOpen(false));
  backdrop.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (e) => e.key === 'Escape' && setOpen(false));

  if (!solid) {
    const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
}

function renderSteps(current) {
  const el = document.getElementById('steps');
  if (!el) return;
  el.innerHTML = BOOKING_STEPS.map((step, i) => {
    const n = i + 1;
    const state = n < current ? 'is-done' : n === current ? 'is-current' : '';
    const inner = `<span class="num">${n}</span><span class="label">${step.label}</span>`;
    const linkable = n < current && current < 4 && step.href;
    return `<li class="${state}"${n === current ? ' aria-current="step"' : ''}>${linkable ? `<a href="${step.href}">${inner}</a>` : inner}</li>`;
  }).join('');
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const money = (value, { decimals = false } = {}) =>
  `S$${Number(value).toLocaleString('en-SG', {
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  })}`;

function parseDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toIso(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDate(iso, { weekday = false } = {}) {
  if (!iso) return '—';
  const date = parseDate(iso);
  const text = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return weekday ? `${text}, ${date.toLocaleDateString('en-GB', { weekday: 'short' })}` : text;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function guestSummary(search) {
  const parts = [plural(search.nights, 'Night'), '1 Room', plural(search.adults, 'Adult')];
  if (search.children) parts.push(search.children === 1 ? '1 Child' : `${search.children} Children`);
  return parts.join(' | ');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ---------- demo settings drawer ----------

function renderSettingsDrawer() {
  const tab = document.createElement('button');
  tab.type = 'button';
  tab.className = 'settings-tab';
  tab.textContent = 'Demo Settings';
  tab.setAttribute('aria-controls', 'settings-panel');
  tab.setAttribute('aria-expanded', 'false');

  const backdrop = document.createElement('div');
  backdrop.className = 'menu-backdrop';
  const panel = document.createElement('aside');
  panel.className = 'settings-panel';
  panel.id = 'settings-panel';
  panel.setAttribute('aria-label', 'Demo settings');
  panel.innerHTML = `
    <div class="settings-panel__head">
      <h2>Demo Settings</h2>
      <button class="menu-panel__close" type="button">Close ✕</button>
    </div>

    <section class="settings-section">
      <h3>Payment methods</h3>
      <p class="fine">From Adyen <code>/paymentMethods</code> for this merchant account. Untick a method to hide it from the Drop-in; it is sent as <code>blockedPaymentMethods</code> on <code>/sessions</code>.</p>
      <div class="pm-list" id="pm-list"><p class="fine">Loading…</p></div>
      <div class="settings-actions">
        <button class="btn" type="button" id="pm-save" disabled>Save payment methods</button>
        <span class="fine" id="pm-status" role="status"></span>
      </div>
    </section>

    <section class="settings-section">
      <h3>Member saved cards</h3>
      <label class="switch">
        <input type="checkbox" id="member-cards-toggle">
        <span class="switch__track" aria-hidden="true"></span>
        <span>Allow members to save cards</span>
      </label>
      <p class="fine">When off, members can't save or use saved cards, and every session uses <code>shopperReference: "not_provided"</code> to collect only the OPI trans token.</p>
      <p class="settings-warning">Changing this deletes every member's saved cards from Adyen, then clears all reservations and members.</p>
      <div class="fine" id="member-cards-status" role="status"></div>
    </section>`;
  document.body.append(tab, backdrop, panel);

  const $s = (sel) => panel.querySelector(sel);
  let settings = null;
  let loaded = false;

  const setOpen = (open) => {
    panel.classList.toggle('is-open', open);
    backdrop.classList.toggle('is-open', open);
    tab.setAttribute('aria-expanded', String(open));
    if (open && !loaded) load();
  };
  tab.addEventListener('click', () => setOpen(true));
  $s('.menu-panel__close').addEventListener('click', () => setOpen(false));
  backdrop.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (e) => e.key === 'Escape' && setOpen(false));

  function pmCheckbox(type, label, blocked, extraClass = '') {
    return `<label class="check ${extraClass}"><input type="checkbox" value="${escapeHtml(type)}" ${blocked.includes(type) ? '' : 'checked'}>
      <span>${escapeHtml(label)} <code>${escapeHtml(type)}</code></span></label>`;
  }

  async function load() {
    loaded = true;
    try {
      ({ settings } = await api('/settings'));
      $s('#member-cards-toggle').checked = settings.memberCardsEnabled;
    } catch (err) {
      $s('#member-cards-status').textContent = err.message;
    }
    try {
      const { paymentMethods } = await api('/settings/payment-methods');
      const blocked = settings?.blockedPaymentMethods || [];
      // Card brands are tx variants too, but only list them under Cards: blocking
      // "visa" applies everywhere, so repeating it under wallets would mislead.
      const known = new Set(paymentMethods.flatMap((pm) => [pm.type, ...(pm.type === 'scheme' ? pm.brands : [])]));
      // Keep blocked types visible even if Adyen no longer returns them.
      const orphans = blocked.filter((t) => !known.has(t));
      $s('#pm-list').innerHTML = paymentMethods.length || orphans.length
        ? [
          ...paymentMethods.map((pm) => `
            <div class="pm-item">
              ${pmCheckbox(pm.type, pm.name || pm.type, blocked)}
              ${pm.type === 'scheme' && pm.brands.length ? `<div class="pm-brands">${pm.brands.map((b) => pmCheckbox(b, b.toUpperCase(), blocked, 'check--small')).join('')}</div>` : ''}
            </div>`),
          ...orphans.map((t) => `<div class="pm-item">${pmCheckbox(t, '(not returned by Adyen)', blocked)}</div>`),
        ].join('')
        : '<p class="fine">Adyen returned no payment methods for this merchant account.</p>';
      $s('#pm-save').disabled = false;
    } catch (err) {
      $s('#pm-list').innerHTML = `<p class="form-error">${escapeHtml(err.message)}</p>`;
      loaded = false; // let the next open retry
    }
  }

  $s('#pm-list').addEventListener('change', () => { $s('#pm-status').textContent = 'Unsaved changes'; });

  $s('#pm-save').addEventListener('click', async () => {
    const blockedPaymentMethods = [...$s('#pm-list').querySelectorAll('input:not(:checked)')].map((i) => i.value);
    $s('#pm-save').disabled = true;
    try {
      ({ settings } = await api('/settings/blocked-payment-methods', { method: 'PUT', body: { blockedPaymentMethods } }));
      $s('#pm-status').textContent = blockedPaymentMethods.length
        ? `Saved. Blocked: ${blockedPaymentMethods.join(', ')}`
        : 'Saved. All payment methods allowed.';
    } catch (err) {
      $s('#pm-status').textContent = err.message;
    } finally {
      $s('#pm-save').disabled = false;
    }
  });

  $s('#member-cards-toggle').addEventListener('change', async (e) => {
    const toggle = e.target;
    const enabled = toggle.checked;
    const ok = window.confirm(
      `${enabled ? 'Enable' : 'Disable'} member saved cards?\n\nThis deletes every member's saved cards from Adyen and clears all reservations and members.`,
    );
    if (!ok) {
      toggle.checked = !enabled;
      return;
    }

    const status = $s('#member-cards-status');
    toggle.disabled = true;
    status.textContent = 'Deleting saved cards and clearing data…';
    try {
      const { settings: next, reset } = await api('/settings/member-cards', { method: 'PUT', body: { enabled } });
      settings = next;
      const errors = reset?.errors?.length
        ? `<ul class="settings-errors">${reset.errors.map((m) => `<li>${escapeHtml(m)}</li>`).join('')}</ul>`
        : '';
      status.innerHTML = `
        <p>Member saved cards are now <strong>${next.memberCardsEnabled ? 'enabled' : 'disabled'}</strong>.
        Deleted ${reset.tokensDeleted.length} saved card(s) from Adyen; cleared ${reset.reservationsCleared} reservation(s) and ${reset.membersCleared} member(s).</p>
        ${errors}
        <button class="link-caps" type="button" data-reload>Reload page</button>`;
    } catch (err) {
      toggle.checked = !enabled;
      status.textContent = err.message;
    } finally {
      toggle.disabled = false;
    }
  });

  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-reload]')) window.location.reload();
  });
}

renderHeader();
renderSettingsDrawer();
