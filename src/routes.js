const express = require('express');
const crypto = require('crypto');
const catalogue = require('../data/rooms.json');
const db = require('./db');
const adyen = require('./adyen');
const settingsStore = require('./settings');

const router = express.Router();
const BASE_URL = (process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
const MAX_NIGHTS = 30;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------- helpers ----------

const findRoom = (id) => catalogue.rooms.find((room) => room.id === id);
const findPackage = (id) => catalogue.packages.find((pkg) => pkg.id === id);

function localDateString(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function tomorrowString() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return localDateString(d);
}

function nightsBetween(checkIn, checkOut) {
  const [y1, m1, d1] = checkIn.split('-').map(Number);
  const [y2, m2, d2] = checkOut.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

// <room>-<yyyymmddHHMMss>-<4 random alphanumerics>, e.g. bay-suite-20261022154502-K7Q2
function generateReservationId(roomId) {
  const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const suffix = Array.from(crypto.randomBytes(4), (b) => alphabet[b % alphabet.length]).join('');
  return `${roomId}-${timestamp}-${suffix}`;
}

function priceCart(search, cart) {
  const room = findRoom(cart.roomId);
  const pkg = findPackage(cart.packageId);
  if (!room || !pkg) return null;
  const nights = nightsBetween(search.checkIn, search.checkOut);
  const pricePerNight = room.pricePerNight + pkg.surchargePerNight;
  return { room, pkg, nights, pricePerNight, total: pricePerNight * nights, currency: catalogue.currency };
}

// Maps Adyen resultCode to the three confirmation outcomes.
function outcomeFor(resultCode) {
  if (resultCode === 'Authorised') return 'success';
  if (['Pending', 'Received', 'PresentToShopper'].includes(resultCode)) return 'pending';
  return 'refused';
}

const STATUS_BY_OUTCOME = {
  success: { paymentStatus: 'Authorised', reservationStatus: 'Confirmed' },
  pending: { paymentStatus: 'Pending', reservationStatus: 'Pending Payment' },
  refused: { paymentStatus: 'Refused', reservationStatus: 'Cancelled' },
};

// /sessions/{id} statuses -> payment resultCodes
const SESSION_STATUS_TO_RESULT = {
  completed: 'Authorised',
  paymentPending: 'Pending',
  active: 'Pending',
  refused: 'Refused',
  canceled: 'Cancelled',
  expired: 'Cancelled',
};

function publicMember(member) {
  if (!member) return null;
  const { storedCards, ...rest } = member;
  return { ...rest, savedCards: storedCards.length };
}

// ---------- catalogue & booking state ----------

router.get('/config', (req, res) => {
  res.json({ clientKey: adyen.config.clientKey, environment: adyen.config.environment.toLowerCase() });
});

router.get('/rooms', (req, res) => {
  res.json(catalogue);
});

router.get('/state', (req, res) => {
  const { search = null, cart = null, memberId = null } = req.session;
  const priced = search && cart ? priceCart(search, cart) : null;
  res.json({
    search,
    cart: priced && {
      ...cart,
      roomName: priced.room.name,
      roomImage: priced.room.image,
      collection: priced.room.collection,
      packageName: priced.pkg.name,
      nights: priced.nights,
      pricePerNight: priced.pricePerNight,
      total: priced.total,
      currency: priced.currency,
    },
    member: publicMember(memberId && db.getMember(memberId)),
    memberCardsEnabled: settingsStore.getSettings().memberCardsEnabled,
  });
});

router.post('/search', (req, res) => {
  const { checkIn, checkOut } = req.body;
  const adults = Number(req.body.adults);
  const children = Number(req.body.children);
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;

  if (!dateRe.test(checkIn) || !dateRe.test(checkOut)) {
    return res.status(400).json({ error: 'Please select check-in and check-out dates.' });
  }
  if (checkIn < tomorrowString()) {
    return res.status(400).json({ error: 'Check-in must be from tomorrow onwards.' });
  }
  const nights = nightsBetween(checkIn, checkOut);
  if (nights < 1 || nights > MAX_NIGHTS) {
    return res.status(400).json({ error: `Stays must be between 1 and ${MAX_NIGHTS} nights.` });
  }
  if (!Number.isInteger(adults) || adults < 1 || adults > 6 || !Number.isInteger(children) || children < 0 || children > 6) {
    return res.status(400).json({ error: 'Please check the number of guests.' });
  }

  req.session.search = { checkIn, checkOut, nights, adults, children };
  res.json({ search: req.session.search });
});

router.post('/cart', (req, res) => {
  const { roomId, packageId } = req.body;
  if (!req.session.search) return res.status(400).json({ error: 'Please search for dates first.' });
  if (!findRoom(roomId) || !findPackage(packageId)) return res.status(400).json({ error: 'Unknown room or package.' });
  req.session.cart = { roomId, packageId };
  res.json({ cart: req.session.cart });
});

// ---------- members ----------

router.post('/login', (req, res) => {
  const member = db.getMember(req.body.email);
  if (!member) return res.status(404).json({ error: 'No membership found for that email address.' });
  req.session.memberId = member.id;
  res.json({ member: publicMember(member) });
});

router.post('/logout', (req, res) => {
  delete req.session.memberId;
  res.json({ ok: true });
});

// ---------- payments ----------

router.post('/initiateSession', async (req, res) => {
  const { search, cart } = req.session;
  if (!search || !cart) return res.status(400).json({ error: 'Your booking has expired. Please start again.' });

  const priced = priceCart(search, cart);
  if (!priced) return res.status(400).json({ error: 'Please select a room.' });

  const fields = ['title', 'firstName', 'lastName', 'country', 'phoneCode', 'phone', 'email'];
  const guest = Object.fromEntries(fields.map((f) => [f, String(req.body.guest?.[f] ?? '').trim()]));
  const loggedInMember = req.session.memberId && db.getMember(req.session.memberId);
  if (loggedInMember) guest.email = loggedInMember.id;
  guest.email = db.normaliseEmail(guest.email);

  const missingField = fields.find((f) => !guest[f]);
  if (missingField) return res.status(400).json({ error: 'Please complete all required guest fields.' });
  if (!EMAIL_RE.test(guest.email)) return res.status(400).json({ error: 'Please enter a valid email address.' });

  // Membership: logged-in members keep theirs; guests become members only if they opt in.
  const signUp = !loggedInMember && Boolean(req.body.signUp);
  let memberId = null;
  if (loggedInMember || signUp) memberId = db.upsertMember(guest).id;
  const { memberCardsEnabled, blockedPaymentMethods } = settingsStore.getSettings();
  const saveCardConsent = Boolean(memberCardsEnabled && memberId && req.body.saveCard);

  // Logged-in members pay under their own shopperReference (so Drop-in shows
  // their stored cards). A new card is always stored so the $0 auth forward has
  // a token to run on; it is deleted afterwards if they didn't ask to save it.
  // Everyone else (and everyone, when member cards are disabled in settings)
  // is tokenised under "not_provided" purely to obtain the OPI trans token.
  const memberTokenisation = Boolean(memberCardsEnabled && loggedInMember);
  const tokenisation = memberTokenisation
    ? { shopperReference: loggedInMember.id, storePaymentMethodMode: 'enabled' }
    : { shopperReference: 'not_provided', storePaymentMethod: true };

  const reservation = db.createReservation({
    id: generateReservationId(priced.room.id),
    roomId: priced.room.id,
    roomName: priced.room.name,
    packageName: priced.pkg.name,
    checkIn: search.checkIn,
    checkOut: search.checkOut,
    nights: priced.nights,
    adults: search.adults,
    children: search.children,
    pricePerNight: priced.pricePerNight,
    amount: { currency: priced.currency, value: priced.total },
    guest,
    memberId,
    memberType: loggedInMember ? 'Existing member' : signUp ? 'New member' : 'Guest',
    saveCardConsent,
    sessionShopperReference: tokenisation.shopperReference,
    memberCardsEnabled,
    usedMemberToken: false,
    memberTokenUsed: null,
    zeroAuth: null,
    cardCleanup: null,
    paymentStatus: 'Not Paid',
    reservationStatus: 'Pending Payment',
    statusSource: null,
    pspReference: null,
    tokens: {
      opiTransToken: null,
      shopperReference: null,
      storedPaymentMethodId: null,
      memberToken: null,
    },
    forward: null,
    history: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  try {
    const session = await adyen.createSession({
      reference: reservation.id,
      amount: { currency: priced.currency, value: priced.total * 100 },
      returnUrl: `${BASE_URL}/api/redirectUrl?reservationId=${encodeURIComponent(reservation.id)}`,
      countryCode: 'SG',
      shopperLocale: 'en-US',
      shopperEmail: guest.email,
      shopperName: { firstName: guest.firstName, lastName: guest.lastName },
      telephoneNumber: `${guest.phoneCode}${guest.phone}`,
      ...tokenisation,
      recurringProcessingModel: 'CardOnFile',
      shopperInteraction: 'Ecommerce',
      additionalData: { 'opi.includeTransToken': true },
      ...(blockedPaymentMethods.length && { blockedPaymentMethods }),
    });

    db.updateReservation(reservation.id, { adyenSessionId: session.id });
    db.addReservationEvent(reservation.id, { type: 'session.created', detail: session.id });
    req.session.reservationIds = [...(req.session.reservationIds || []), reservation.id];
    // Cards stored under "not_provided" belong to every guest, so never show them.
    res.json({ reservationId: reservation.id, session, showStoredPaymentMethods: memberTokenisation });
  } catch (err) {
    console.error('[initiateSession] Adyen /sessions failed:', err.message);
    db.updateReservation(reservation.id, { reservationStatus: 'Failed', paymentStatus: 'Error' });
    db.addReservationEvent(reservation.id, { type: 'session.error', detail: err.message });
    res.status(502).json({ error: 'We could not start the payment. Please try again.' });
  }
});

// Return URL for redirect payment methods / 3DS, and the drop-in's
// onPaymentCompleted hand-off. Verifies the result with Adyen, then sends the
// shopper to the matching confirmation page.
router.all('/redirectUrl', express.urlencoded({ extended: false }), async (req, res) => {
  const params = { ...req.query, ...req.body };
  const { reservationId, redirectResult, sessionId, sessionResult } = params;
  let resultCode = null;
  let verified = false;

  try {
    if (redirectResult) {
      ({ resultCode } = await adyen.submitRedirectDetails(redirectResult));
      verified = true;
    } else if (sessionId && sessionResult) {
      const { status } = await adyen.getSessionResult(sessionId, sessionResult);
      resultCode = SESSION_STATUS_TO_RESULT[status] || 'Error';
      verified = true;
    }
  } catch (err) {
    console.error('[redirectUrl] Could not verify payment result:', err.message);
  }

  // Fall back to the drop-in's resultCode for display only.
  if (!resultCode) resultCode = params.resultCode || 'Error';
  const outcome = outcomeFor(resultCode);

  const reservation = reservationId && db.getReservation(reservationId);
  if (reservation && verified) {
    db.addReservationEvent(reservation.id, { type: 'payment.result', detail: resultCode });
    // The webhook is the source of truth; only fill in status if it hasn't arrived yet.
    if (reservation.statusSource !== 'webhook') {
      db.updateReservation(reservation.id, { ...STATUS_BY_OUTCOME[outcome], statusSource: 'redirect' });
    }
  }

  const qs = new URLSearchParams({ status: outcome, resultCode, reservationId: reservationId || '' });
  res.redirect(303, `/booking/confirmation?${qs}`);
});

router.post('/webhook', (req, res) => {
  const items = (req.body?.notificationItems || []).map((n) => n.NotificationRequestItem).filter(Boolean);

  for (const item of items) {
    if (!adyen.isValidWebhookItem(item)) {
      console.warn(`[webhook] Invalid HMAC signature for ${item.pspReference}, ignoring.`);
      continue;
    }
    processNotification(item).catch((err) => console.error('[webhook] Processing failed:', err));
  }

  // Acknowledge immediately so Adyen doesn't retry; processing happens async.
  res.send('[accepted]');
});

const readAdditional = (data, ...keys) => keys.map((k) => data[k]).find((v) => v != null && v !== '') ?? null;

const ZERO_AUTH_PREFIX = 'forward-';

async function processNotification(item) {
  if (item.merchantReference?.startsWith(ZERO_AUTH_PREFIX)) return processZeroAuthNotification(item);

  const reservation = db.getReservation(item.merchantReference);
  if (!reservation) {
    console.warn(`[webhook] ${item.eventCode} for unknown reference ${item.merchantReference}`);
    return;
  }

  const success = item.success === 'true';
  db.addReservationEvent(reservation.id, {
    type: `webhook.${item.eventCode}`,
    detail: `success=${success}${item.reason ? ` (${item.reason})` : ''}`,
  });
  if (item.eventCode !== 'AUTHORISATION') return;

  const data = item.additionalData || {};
  const tokens = {
    opiTransToken: readAdditional(data, 'opi.transToken'),
    shopperReference: readAdditional(data, 'tokenization.shopperReference', 'tokenisation.shopperReference', 'recurring.shopperReference'),
    storedPaymentMethodId: readAdditional(data, 'tokenization.storedPaymentMethodId', 'tokenisation.storedPaymentID', 'tokenisation.storedPaymentId', 'recurring.recurringDetailReference'),
  };

  const updated = db.updateReservation(reservation.id, {
    ...STATUS_BY_OUTCOME[success ? 'success' : 'refused'],
    statusSource: 'webhook',
    pspReference: item.pspReference,
    tokens: { ...reservation.tokens, ...Object.fromEntries(Object.entries(tokens).filter(([, v]) => v)) },
  });

  // With member cards disabled, the OPI trans token from this webhook is all we need.
  if (!success || !updated.memberCardsEnabled) return;

  // Logged-in member: always $0 auth on the card they paid with to obtain an
  // OPI trans token. Webhooks can be retried, so this runs only once.
  if (updated.memberType === 'Existing member') {
    if (!updated.zeroAuth) await handleLoggedInMemberPayment(updated);
    return;
  }

  // New sign-up who asked to save: card was stored under "not_provided"; copy it to the member via storeToken.
  if (!updated.memberId || !updated.saveCardConsent || !updated.tokens.storedPaymentMethodId) return;
  if (updated.tokens.shopperReference && !updated.tokens.memberToken && !updated.forward) {
    await saveCardToMember(updated);
  }
}

async function handleLoggedInMemberPayment(reservation) {
  if (reservation.usedMemberToken) {
    await zeroAuthForOpiToken(reservation, reservation.memberTokenUsed);
    return;
  }

  // New card: Adyen stored it under the member (storePaymentMethodMode "enabled").
  const newToken = reservation.tokens.storedPaymentMethodId;
  if (!newToken) {
    db.updateReservation(reservation.id, { zeroAuth: { status: 'Skipped', reason: 'No stored token in webhook' } });
    db.addReservationEvent(reservation.id, {
      type: 'forward.zeroAuth.skipped',
      detail: 'Webhook had no tokenization.storedPaymentMethodId for the new card',
    });
    return;
  }

  await zeroAuthForOpiToken(reservation, newToken);
  if (reservation.saveCardConsent) {
    recordMemberToken(reservation, newToken, 'stored under member shopperReference');
  } else {
    await deleteUnwantedCard(reservation, newToken);
  }
}

// The member didn't ask to save this card; it was only stored for the $0 auth.
async function deleteUnwantedCard(reservation, storedPaymentMethodId) {
  try {
    await adyen.deleteStoredPaymentMethod(storedPaymentMethodId, reservation.memberId);
    db.updateReservation(reservation.id, { cardCleanup: { status: 'Deleted', storedPaymentMethodId } });
    db.addReservationEvent(reservation.id, { type: 'token.deleted', detail: `${storedPaymentMethodId} (not saved by member)` });
  } catch (err) {
    console.error('[cleanup] Could not delete stored card:', err.message);
    db.updateReservation(reservation.id, { cardCleanup: { status: 'Failed', storedPaymentMethodId, error: err.message } });
    db.addReservationEvent(reservation.id, { type: 'token.delete.error', detail: err.message });
  }
}

function recordMemberToken(reservation, memberToken, how) {
  db.updateReservation(reservation.id, { tokens: { ...db.getReservation(reservation.id).tokens, memberToken } });
  db.addReservationEvent(reservation.id, { type: 'member.token', detail: `${memberToken} (${how})` });
  db.addMemberCard(reservation.memberId, { token: memberToken, reservationId: reservation.id });
}

// The forwarded endpoint's response body arrives as a string.
function parseForwardBody(result) {
  try {
    return JSON.parse(result.response?.body || '{}');
  } catch {
    return { raw: result.response?.body };
  }
}

async function zeroAuthForOpiToken(reservation, storedPaymentMethodId) {
  const reference = `${ZERO_AUTH_PREFIX}${reservation.id}`;
  db.updateReservation(reservation.id, { zeroAuth: { status: 'In progress', reference, storedPaymentMethodId } });
  try {
    const result = await adyen.forwardZeroAuthForOpiToken({
      shopperReference: reservation.memberId,
      storedPaymentMethodId,
      reference,
      currency: reservation.amount.currency,
      returnUrl: `${BASE_URL}/booking/confirmation`,
    });

    const body = parseForwardBody(result);
    const opiTransToken = body.additionalData?.['opi.transToken'] || null;
    const ok = result.response?.status === 200 && body.resultCode === 'Authorised';
    const current = db.getReservation(reservation.id);

    db.updateReservation(reservation.id, {
      zeroAuth: {
        ...current.zeroAuth,
        status: ok ? 'Authorised' : 'Failed',
        httpStatus: result.response?.status,
        resultCode: body.resultCode,
        pspReference: body.pspReference,
        opiTransToken,
        response: body,
      },
      ...(opiTransToken && { tokens: { ...current.tokens, opiTransToken } }),
    });
    db.addReservationEvent(reservation.id, {
      type: 'forward.zeroAuth',
      detail: `${body.resultCode || `HTTP ${result.response?.status}`}${opiTransToken ? ` · OPI ${opiTransToken}` : ''}`,
    });
  } catch (err) {
    console.error('[forward] $0 auth failed:', err.message);
    db.updateReservation(reservation.id, { zeroAuth: { status: 'Failed', reference, error: err.message } });
    db.addReservationEvent(reservation.id, { type: 'forward.zeroAuth.error', detail: err.message });
  }
}

// Webhook for the $0 auth: never changes the booking's status, only fills in
// the OPI trans token if the synchronous forward response didn't carry it.
function processZeroAuthNotification(item) {
  const reservation = db.getReservation(item.merchantReference.slice(ZERO_AUTH_PREFIX.length));
  if (!reservation) {
    console.warn(`[webhook] ${item.eventCode} for unknown reference ${item.merchantReference}`);
    return;
  }

  const success = item.success === 'true';
  db.addReservationEvent(reservation.id, {
    type: `webhook.${item.eventCode} ($0 auth)`,
    detail: `success=${success}${item.reason ? ` (${item.reason})` : ''}`,
  });
  if (item.eventCode !== 'AUTHORISATION') return;

  const opiTransToken = readAdditional(item.additionalData || {}, 'opi.transToken');
  db.updateReservation(reservation.id, {
    zeroAuth: {
      ...reservation.zeroAuth,
      webhookSuccess: success,
      pspReference: item.pspReference,
      ...(opiTransToken && { opiTransToken }),
    },
    ...(opiTransToken && { tokens: { ...reservation.tokens, opiTransToken } }),
  });
}

async function saveCardToMember(reservation) {
  db.updateReservation(reservation.id, { forward: { status: 'In progress' } });
  try {
    const result = await adyen.forwardCardToMember({
      shopperReference: reservation.tokens.shopperReference,
      storedPaymentMethodId: reservation.tokens.storedPaymentMethodId,
      memberId: reservation.memberId,
    });

    const body = parseForwardBody(result);
    const memberToken = body.recurringDetailReference || null;
    const ok = result.response?.status === 200 && Boolean(memberToken);

    db.updateReservation(reservation.id, {
      forward: { status: ok ? 'Success' : 'Failed', httpStatus: result.response?.status, pspReference: result.pspReference, response: body },
    });
    db.addReservationEvent(reservation.id, { type: 'forward.storeToken', detail: ok ? 'Success' : `HTTP ${result.response?.status}` });
    if (ok) recordMemberToken(reservation, memberToken, 'forwarded via storeToken');
  } catch (err) {
    console.error('[forward] storeToken failed:', err.message);
    db.updateReservation(reservation.id, { forward: { status: 'Failed', error: err.message } });
    db.addReservationEvent(reservation.id, { type: 'forward.error', detail: err.message });
  }
}

// ---------- reservations (confirmation + back office) ----------

router.get('/reservations', (req, res) => {
  res.json({ reservations: db.listReservations(), members: db.listMembers() });
});

// Called by the Drop-in's beforeSubmit so we know whether the shopper paid
// with one of their stored member cards or a new card.
router.post('/reservations/:id/payment-method', async (req, res) => {
  const reservation = db.getReservation(req.params.id);
  if (!reservation || !(req.session.reservationIds || []).includes(reservation.id)) {
    return res.status(404).json({ error: 'Reservation not found.' });
  }

  const raw = req.body.storedPaymentMethodId;
  const storedPaymentMethodId = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  if (storedPaymentMethodId && (!reservation.memberCardsEnabled || !reservation.memberId || reservation.memberId !== req.session.memberId)) {
    return res.status(403).json({ error: 'Saved cards are only available to logged-in members.' });
  }

  // Confirm with Adyen that the token really is one of this member's saved cards.
  if (storedPaymentMethodId) {
    let ownsCard;
    try {
      const { storedPaymentMethods = [] } = await adyen.listStoredPaymentMethods(reservation.memberId);
      ownsCard = storedPaymentMethods.some((card) => card.id === storedPaymentMethodId);
    } catch (err) {
      console.error('[payment-method] Could not list stored cards:', err.message);
      db.addReservationEvent(reservation.id, { type: 'payment.method.error', detail: err.message });
      return res.status(502).json({ error: 'We could not verify your saved card. Please try again.' });
    }
    if (!ownsCard) {
      db.addReservationEvent(reservation.id, { type: 'payment.method.rejected', detail: `Token ${storedPaymentMethodId} not found for member` });
      return res.status(403).json({ error: 'This saved card is not linked to your membership.' });
    }
  }

  db.updateReservation(reservation.id, { usedMemberToken: Boolean(storedPaymentMethodId), memberTokenUsed: storedPaymentMethodId });
  db.addReservationEvent(reservation.id, {
    type: 'payment.method',
    detail: storedPaymentMethodId ? `Member token ${storedPaymentMethodId}` : 'New card',
  });
  res.json({ ok: true });
});

router.get('/reservations/:id', (req, res) => {
  const reservation = db.getReservation(req.params.id);
  if (!reservation) return res.status(404).json({ error: 'Reservation not found.' });
  res.json({ reservation });
});

// ---------- demo settings ----------

router.get('/settings', (req, res) => {
  res.json({ settings: settingsStore.getSettings() });
});

// Everything the merchant account offers, so the drawer can list tx variants to block.
router.get('/settings/payment-methods', async (req, res) => {
  try {
    const { paymentMethods = [] } = await adyen.listPaymentMethods();
    res.json({
      paymentMethods: paymentMethods.map((pm) => ({ type: pm.type, name: pm.name, brands: pm.brands || [] })),
    });
  } catch (err) {
    console.error('[settings] /paymentMethods failed:', err.message);
    res.status(502).json({ error: 'Could not load payment methods from Adyen.' });
  }
});

router.put('/settings/blocked-payment-methods', (req, res) => {
  const types = req.body.blockedPaymentMethods;
  if (!Array.isArray(types) || !types.every((t) => typeof t === 'string' && t.trim())) {
    return res.status(400).json({ error: 'blockedPaymentMethods must be a list of payment method types.' });
  }
  settingsStore.setBlockedPaymentMethods(types.map((t) => t.trim()));
  res.json({ settings: settingsStore.getSettings() });
});

let resetInProgress = false;

// Changing the member-card setting starts the demo from a clean slate: every
// member's saved cards are deleted from Adyen, then reservations and members are cleared.
router.put('/settings/member-cards', async (req, res) => {
  if (typeof req.body.enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be true or false.' });
  if (req.body.enabled === settingsStore.getSettings().memberCardsEnabled) {
    return res.json({ settings: settingsStore.getSettings(), reset: null });
  }
  if (resetInProgress) return res.status(409).json({ error: 'A reset is already running. Please wait.' });

  resetInProgress = true;
  try {
    const reset = await resetDemoData();
    settingsStore.setMemberCardsEnabled(req.body.enabled);
    delete req.session.memberId;
    req.session.reservationIds = [];
    res.json({ settings: settingsStore.getSettings(), reset });
  } finally {
    resetInProgress = false;
  }
});

async function resetDemoData() {
  const summary = { membersChecked: 0, tokensDeleted: [], errors: [] };

  for (const member of db.listMembers()) {
    summary.membersChecked += 1;
    let cards;
    try {
      ({ storedPaymentMethods: cards = [] } = await adyen.listStoredPaymentMethods(member.id));
    } catch (err) {
      summary.errors.push(`${member.id}: could not list saved cards (${err.message})`);
      continue;
    }
    for (const card of cards) {
      try {
        await adyen.deleteStoredPaymentMethod(card.id, member.id);
        summary.tokensDeleted.push({ memberId: member.id, storedPaymentMethodId: card.id });
      } catch (err) {
        summary.errors.push(`${member.id}: could not delete ${card.id} (${err.message})`);
      }
    }
  }

  const reservationsCleared = db.listReservations().length;
  db.clearAll();
  console.log(`[settings] Reset: deleted ${summary.tokensDeleted.length} saved cards, cleared ${reservationsCleared} reservations and ${summary.membersChecked} members.`);
  return { ...summary, reservationsCleared, membersCleared: summary.membersChecked };
}

module.exports = router;
