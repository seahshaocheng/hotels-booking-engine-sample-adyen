// In-memory "database". Lives in the server process, so it is shared between
// the guest's browser session, Adyen webhooks and the back office, and is
// wiped whenever the server restarts.

const reservations = new Map();
const members = new Map();

const normaliseEmail = (email) => String(email || '').trim().toLowerCase();

function createReservation(reservation) {
  reservations.set(reservation.id, reservation);
  return reservation;
}

function getReservation(id) {
  return reservations.get(id) || null;
}

function updateReservation(id, patch) {
  const existing = reservations.get(id);
  if (!existing) return null;
  const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  reservations.set(id, updated);
  return updated;
}

function addReservationEvent(id, event) {
  const existing = reservations.get(id);
  if (!existing) return;
  existing.history.push({ at: new Date().toISOString(), ...event });
}

function listReservations() {
  return [...reservations.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function getMember(email) {
  return members.get(normaliseEmail(email)) || null;
}

function upsertMember(guest) {
  const id = normaliseEmail(guest.email);
  const existing = members.get(id);
  const member = {
    id,
    storedCards: [],
    createdAt: new Date().toISOString(),
    ...existing,
    title: guest.title,
    firstName: guest.firstName,
    lastName: guest.lastName,
    country: guest.country,
    phoneCode: guest.phoneCode,
    phone: guest.phone,
    email: id,
  };
  members.set(id, member);
  return member;
}

function addMemberCard(email, card) {
  const member = getMember(email);
  if (!member) return null;
  if (member.storedCards.some((c) => c.token === card.token)) return member;
  member.storedCards.push({ ...card, savedAt: new Date().toISOString() });
  return member;
}

function listMembers() {
  return [...members.values()];
}

function clearAll() {
  reservations.clear();
  members.clear();
}

module.exports = {
  normaliseEmail,
  createReservation,
  getReservation,
  updateReservation,
  addReservationEvent,
  listReservations,
  getMember,
  upsertMember,
  addMemberCard,
  listMembers,
  clearAll,
};
