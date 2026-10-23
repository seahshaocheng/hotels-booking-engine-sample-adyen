renderSteps(1);

const MAX_NIGHTS = 30;
const MONTHS_AHEAD = 12;
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const today = new Date();
today.setHours(0, 0, 0, 0);
const tomorrow = new Date(today);
tomorrow.setDate(today.getDate() + 1);
const tomorrowIso = toIso(tomorrow);
const firstMonth = new Date(today.getFullYear(), today.getMonth(), 1);
const lastMonth = new Date(today.getFullYear(), today.getMonth() + MONTHS_AHEAD, 1);

const state = {
  checkIn: null,
  checkOut: null,
  adults: 1,
  children: 0,
  viewMonth: new Date(firstMonth),
  fromPrice: null,
};

const els = {
  calendar: document.getElementById('calendar'),
  prev: document.getElementById('cal-prev'),
  next: document.getElementById('cal-next'),
  metaIn: document.getElementById('meta-in'),
  metaOut: document.getElementById('meta-out'),
  metaDuration: document.getElementById('meta-duration'),
  form: document.getElementById('search-form'),
  submit: document.getElementById('search-next'),
  error: document.getElementById('search-error'),
};

const addMonths = (date, n) => new Date(date.getFullYear(), date.getMonth() + n, 1);
const nights = () => (state.checkIn && state.checkOut
  ? Math.round((parseDate(state.checkOut) - parseDate(state.checkIn)) / 86400000)
  : 0);

function renderMonth(monthStart) {
  const title = monthStart.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
  const leading = (monthStart.getDay() + 6) % 7; // Monday-first grid

  let cells = DOW.map((d) => `<div class="month__dow" aria-hidden="true">${d}</div>`).join('');
  cells += '<span class="day day--empty"></span>'.repeat(leading);

  for (let d = 1; d <= daysInMonth; d++) {
    const iso = toIso(new Date(monthStart.getFullYear(), monthStart.getMonth(), d));
    const past = iso < tomorrowIso;
    const isStart = iso === state.checkIn;
    const isEnd = iso === state.checkOut;
    const inRange = state.checkIn && state.checkOut && iso > state.checkIn && iso < state.checkOut;
    const classes = ['day', past && 'is-past', isStart && 'is-start', isEnd && 'is-end', inRange && 'is-in-range']
      .filter(Boolean)
      .join(' ');
    let sub = '';
    if (isEnd) sub = 'Check out';
    else if (!past && state.fromPrice != null) sub = money(state.fromPrice);

    cells += `<button type="button" class="${classes}" data-date="${iso}" ${past ? 'disabled aria-disabled="true"' : ''}
      aria-pressed="${isStart || isEnd}" aria-label="${formatDate(iso, { weekday: true })}">
      <span>${d}</span><small>${sub || '&nbsp;'}</small></button>`;
  }

  return `<div class="month"><div class="month__title">${title}</div><div class="month__grid">${cells}</div></div>`;
}

function render() {
  els.calendar.innerHTML = renderMonth(state.viewMonth) + renderMonth(addMonths(state.viewMonth, 1));
  els.prev.disabled = state.viewMonth <= firstMonth;
  els.next.disabled = addMonths(state.viewMonth, 1) >= lastMonth;

  const n = nights();
  els.metaIn.textContent = state.checkIn ? formatDate(state.checkIn, { weekday: true }) : 'Select a date';
  els.metaOut.textContent = state.checkOut ? formatDate(state.checkOut, { weekday: true }) : '—';
  els.metaDuration.textContent = n ? `${n + 1}D, ${n}N` : '—';
  els.submit.disabled = !n;

  document.querySelectorAll('[data-counter]').forEach((counter) => {
    const key = counter.dataset.counter;
    counter.querySelector('output').textContent = state[key];
    counter.querySelector('[data-step="-1"]').disabled = state[key] <= Number(counter.dataset.min);
    counter.querySelector('[data-step="1"]').disabled = state[key] >= Number(counter.dataset.max);
  });
}

function selectDate(iso) {
  els.error.textContent = '';
  if (!state.checkIn || state.checkOut || iso <= state.checkIn) {
    state.checkIn = iso;
    state.checkOut = null;
  } else {
    const n = Math.round((parseDate(iso) - parseDate(state.checkIn)) / 86400000);
    if (n > MAX_NIGHTS) {
      els.error.textContent = `Stays are limited to ${MAX_NIGHTS} nights.`;
      return;
    }
    state.checkOut = iso;
  }
  render();
}

els.calendar.addEventListener('click', (e) => {
  const day = e.target.closest('.day[data-date]');
  if (day && !day.disabled) selectDate(day.dataset.date);
});
els.prev.addEventListener('click', () => { state.viewMonth = addMonths(state.viewMonth, -1); render(); });
els.next.addEventListener('click', () => { state.viewMonth = addMonths(state.viewMonth, 1); render(); });

document.querySelectorAll('[data-counter]').forEach((counter) => {
  counter.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-step]');
    if (!btn) return;
    const key = counter.dataset.counter;
    const next = state[key] + Number(btn.dataset.step);
    state[key] = Math.min(Number(counter.dataset.max), Math.max(Number(counter.dataset.min), next));
    render();
  });
});

els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.submit.disabled = true;
  try {
    await api('/search', {
      method: 'POST',
      body: { checkIn: state.checkIn, checkOut: state.checkOut, adults: state.adults, children: state.children },
    });
    window.location.href = '/booking/rooms';
  } catch (err) {
    els.error.textContent = err.message;
    els.submit.disabled = false;
  }
});

(async function init() {
  render();
  try {
    const [{ rooms }, { search }] = await Promise.all([api('/rooms'), api('/state')]);
    state.fromPrice = Math.min(...rooms.map((r) => r.pricePerNight));
    if (search && search.checkIn >= tomorrowIso) {
      Object.assign(state, {
        checkIn: search.checkIn,
        checkOut: search.checkOut,
        adults: search.adults,
        children: search.children,
      });
      const start = parseDate(search.checkIn);
      state.viewMonth = new Date(start.getFullYear(), start.getMonth(), 1);
    }
  } catch (err) {
    els.error.textContent = err.message;
  }
  render();
})();
